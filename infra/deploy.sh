#!/usr/bin/env bash
# Deploy the Portfolio Tracker stack to Azure (Bash version).
# Prerequisites:
#   - Azure CLI logged in (`az login`)
#   - The target subscription set (`az account set --subscription <id>`)
# Usage:
#   ./deploy.sh <resource-group> <base-name> [location] [static-web-app-location]
#   Defaults: location=italynorth, static-web-app-location=westeurope
#   Static Web Apps is only available in: westeurope northeurope eastus2 centralus westus2 eastasia
set -euo pipefail

RG=${1:?"resource group required"}
BASE=${2:?"base name required"}
LOC=${3:-italynorth}
SWA_LOC=${4:-westeurope}
CORS=${CORS_ORIGINS:-"*"}
SKU=${APP_SERVICE_SKU:-B1}
SWA_SKU=${STATIC_WEB_APP_SKU:-Free}
JWT=${JWT_SECRET:-$(openssl rand -base64 36)}
ROOT=$(cd "$(dirname "$0")" && pwd)

echo "JWT_SECRET=$JWT  (save this!)"

az group create --name "$RG" --location "$LOC" >/dev/null

az deployment group create \
  --resource-group "$RG" \
  --template-file "$ROOT/main.bicep" \
  --parameters baseName="$BASE" location="$LOC" staticWebAppLocation="$SWA_LOC" jwtSecret="$JWT" corsOrigins="$CORS" appServiceSku="$SKU" staticWebAppSku="$SWA_SKU"

BACKEND_URL=$(az webapp show --name "${BASE}-api" --resource-group "$RG" --query "defaultHostName" -o tsv)
FRONTEND_URL=$(az staticwebapp show --name "${BASE}-web" --resource-group "$RG" --query "defaultHostname" -o tsv)
ACR_NAME=$(az acr list --resource-group "$RG" --query "[0].name" -o tsv)
ACR_SERVER=$(az acr list --resource-group "$RG" --query "[0].loginServer" -o tsv)
echo "Backend  : https://$BACKEND_URL"
echo "Frontend : https://$FRONTEND_URL"
echo "Registry : $ACR_SERVER"

# Configure CORS to match the ACTUAL SWA hostname (randomly prefixed by Azure).
if [ -z "$CORS" ] || [ "$CORS" = "*" ]; then
  EFFECTIVE_CORS="https://$FRONTEND_URL"
elif [[ "$CORS" == *"$FRONTEND_URL"* ]]; then
  EFFECTIVE_CORS="$CORS"
else
  EFFECTIVE_CORS="$CORS,https://$FRONTEND_URL"
fi
echo "Configuring backend CORS_ORIGINS=$EFFECTIVE_CORS"
az webapp config appsettings set \
  --resource-group "$RG" \
  --name "${BASE}-api" \
  --settings "CORS_ORIGINS=$EFFECTIVE_CORS" >/dev/null

echo "Building & pushing backend image via ACR Tasks..."
IMAGE_TAG="v$(date +%Y%m%d%H%M%S)"
az acr build \
  --registry "$ACR_NAME" \
  --image "backend:$IMAGE_TAG" \
  --image "backend:latest" \
  --file "$ROOT/../backend/Dockerfile" \
  "$ROOT/../backend"

echo "Updating App Service to backend:$IMAGE_TAG..."
az webapp config container set \
  --resource-group "$RG" \
  --name "${BASE}-api" \
  --container-image-name "$ACR_SERVER/backend:$IMAGE_TAG" >/dev/null
az webapp restart --resource-group "$RG" --name "${BASE}-api" >/dev/null

echo "Building frontend..."
pushd "$ROOT/../frontend" >/dev/null
VITE_API_BASE_URL="https://$BACKEND_URL/api" npm ci
VITE_API_BASE_URL="https://$BACKEND_URL/api" npm run build
DEPLOY_TOKEN=$(az staticwebapp secrets list --name "${BASE}-web" --resource-group "$RG" --query 'properties.apiKey' -o tsv)
npx --yes @azure/static-web-apps-cli deploy ./dist --deployment-token "$DEPLOY_TOKEN" --env production
popd >/dev/null

echo "Deployment complete."
