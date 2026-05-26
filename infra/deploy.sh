#!/usr/bin/env bash
# Deploy the Portfolio Tracker stack to Azure (Bash version).
# Prerequisites:
#   - Azure CLI logged in (`az login`)
#   - The target subscription set (`az account set --subscription <id>`)
# Usage:
#   ./deploy.sh <resource-group> <base-name> [location]
set -euo pipefail

RG=${1:?"resource group required"}
BASE=${2:?"base name required"}
LOC=${3:-westeurope}
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
  --parameters baseName="$BASE" location="$LOC" jwtSecret="$JWT" corsOrigins="$CORS" appServiceSku="$SKU" staticWebAppSku="$SWA_SKU"

BACKEND_URL=$(az webapp show --name "${BASE}-api" --resource-group "$RG" --query "defaultHostName" -o tsv)
FRONTEND_URL=$(az staticwebapp show --name "${BASE}-web" --resource-group "$RG" --query "defaultHostname" -o tsv)
echo "Backend  : https://$BACKEND_URL"
echo "Frontend : https://$FRONTEND_URL"

echo "Building backend..."
pushd "$ROOT/../backend" >/dev/null
npm ci
npm run build
ZIP="$(mktemp -d)/backend.zip"
( cd . && zip -r "$ZIP" dist package.json package-lock.json )
az webapp deploy --resource-group "$RG" --name "${BASE}-api" --src-path "$ZIP" --type zip
popd >/dev/null

echo "Building frontend..."
pushd "$ROOT/../frontend" >/dev/null
VITE_API_BASE_URL="https://$BACKEND_URL/api" npm ci
VITE_API_BASE_URL="https://$BACKEND_URL/api" npm run build
DEPLOY_TOKEN=$(az staticwebapp secrets list --name "${BASE}-web" --resource-group "$RG" --query 'properties.apiKey' -o tsv)
npx --yes @azure/static-web-apps-cli deploy ./dist --deployment-token "$DEPLOY_TOKEN" --env production
popd >/dev/null

echo "Deployment complete."
