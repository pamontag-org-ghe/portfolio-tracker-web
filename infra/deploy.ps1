#!/usr/bin/env pwsh
# Deploy the Portfolio Tracker stack to Azure.
#
# Prerequisites:
#   - Azure CLI logged in (`az login`)
#   - The target subscription set (`az account set --subscription <id>`)
#
# Usage:
#   ./deploy.ps1 -ResourceGroup portfolio-tracker -Location westeurope -BaseName myportfolio01

param(
  [Parameter(Mandatory=$true)] [string] $ResourceGroup,
  [Parameter(Mandatory=$true)] [string] $BaseName,
  [string] $Location = 'italynorth',
  [ValidateSet('westeurope','northeurope','eastus2','centralus','westus2','eastasia')]
  [string] $StaticWebAppLocation = 'westeurope',
  [string] $JwtSecret = '',
  [string] $CorsOrigins = '*',
  [string] $AppServiceSku = 'B1',
  [string] $StaticWebAppSku = 'Free'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $JwtSecret) {
  # Generate 48 cryptographically-random bytes → base64 URL-safe (works in PS 5 and PS 7+).
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $JwtSecret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  Write-Host "Generated JWT secret (save it!): $JwtSecret" -ForegroundColor Yellow
}

Write-Host "Ensuring resource group '$ResourceGroup' in $Location..." -ForegroundColor Cyan
az group create --name $ResourceGroup --location $Location | Out-Null

Write-Host "Deploying Bicep template..." -ForegroundColor Cyan
$deployment = az deployment group create `
  --resource-group $ResourceGroup `
  --template-file "$root/main.bicep" `
  --parameters baseName=$BaseName location=$Location staticWebAppLocation=$StaticWebAppLocation jwtSecret=$JwtSecret corsOrigins=$CorsOrigins appServiceSku=$AppServiceSku staticWebAppSku=$StaticWebAppSku `
  --query 'properties.outputs' -o json | ConvertFrom-Json

$backendUrl = $deployment.backendUrl.value
$frontendUrl = $deployment.frontendUrl.value
$acrName = $deployment.acrName.value
$acrServer = $deployment.containerRegistry.value
Write-Host "Backend URL: $backendUrl" -ForegroundColor Green
Write-Host "Frontend URL: $frontendUrl" -ForegroundColor Green
Write-Host "Container registry: $acrServer" -ForegroundColor Green

# Configure CORS to match the ACTUAL SWA hostname (it's randomly prefixed by Azure,
# e.g. lively-sand-XXXXX.azurestaticapps.net — not derived from -BaseName).
# If the caller passed an explicit -CorsOrigins, merge it with the real SWA URL so
# both custom domains and the default Azure URL work.
$effectiveCors = if ($CorsOrigins -eq '*' -or [string]::IsNullOrWhiteSpace($CorsOrigins)) {
  $frontendUrl
} elseif ($CorsOrigins -like "*$frontendUrl*") {
  $CorsOrigins
} else {
  "$CorsOrigins,$frontendUrl"
}
Write-Host "Configuring backend CORS_ORIGINS=$effectiveCors" -ForegroundColor Cyan
az webapp config appsettings set `
  --resource-group $ResourceGroup `
  --name "$BaseName-api" `
  --settings "CORS_ORIGINS=$effectiveCors" | Out-Null

# Build & push backend container image via ACR Tasks (builds run in Azure on Linux —
# no Docker daemon needed locally, and no slow Windows-side zipping).
Write-Host "`nBuilding & pushing backend image via ACR (this runs in Azure)..." -ForegroundColor Cyan
$imageTag = "v$(Get-Date -Format yyyyMMddHHmmss)"
az acr build `
  --registry $acrName `
  --image "backend:$imageTag" `
  --image "backend:latest" `
  --file "$root/../backend/Dockerfile" `
  "$root/../backend" | Out-Null

# Update the App Service's container image to the newly-built tag and restart.
Write-Host "Updating App Service to use backend:$imageTag..." -ForegroundColor Cyan
az webapp config container set `
  --resource-group $ResourceGroup `
  --name "$BaseName-api" `
  --container-image-name "$acrServer/backend:$imageTag" | Out-Null
az webapp restart --resource-group $ResourceGroup --name "$BaseName-api" | Out-Null

# Build & deploy backend
# (Image build happens remotely on ACR — local zipping eliminated entirely.)
Write-Host "`nBackend deployment complete (image already pushed via az acr build above)." -ForegroundColor DarkGray

# Build & deploy frontend
Write-Host "`nBuilding frontend (VITE_API_BASE_URL=$backendUrl/api)..." -ForegroundColor Cyan
Push-Location "$root/../frontend"
try {
  $env:VITE_API_BASE_URL = "$backendUrl/api"
  npm ci
  npm run build

  Write-Host "Deploying frontend to Static Web App..." -ForegroundColor Cyan
  $apiKey = az staticwebapp secrets list --name "$BaseName-web" --resource-group $ResourceGroup --query 'properties.apiKey' -o tsv
  npx --yes @azure/static-web-apps-cli deploy ./dist --deployment-token $apiKey --env production
} finally { Pop-Location }

Write-Host "`nDeployment complete." -ForegroundColor Green
Write-Host "Frontend: $frontendUrl"
Write-Host "Backend : $backendUrl"
