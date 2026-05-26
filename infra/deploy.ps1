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
  [string] $Location = 'westeurope',
  [string] $JwtSecret = '',
  [string] $CorsOrigins = '*',
  [string] $AppServiceSku = 'B1',
  [string] $StaticWebAppSku = 'Free'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $JwtSecret) {
  Add-Type -AssemblyName System.Web
  $JwtSecret = [System.Web.Security.Membership]::GeneratePassword(48, 8)
  Write-Host "Generated JWT secret (save it!): $JwtSecret" -ForegroundColor Yellow
}

Write-Host "Ensuring resource group '$ResourceGroup' in $Location..." -ForegroundColor Cyan
az group create --name $ResourceGroup --location $Location | Out-Null

Write-Host "Deploying Bicep template..." -ForegroundColor Cyan
$deployment = az deployment group create `
  --resource-group $ResourceGroup `
  --template-file "$root/main.bicep" `
  --parameters baseName=$BaseName location=$Location jwtSecret=$JwtSecret corsOrigins=$CorsOrigins appServiceSku=$AppServiceSku staticWebAppSku=$StaticWebAppSku `
  --query 'properties.outputs' -o json | ConvertFrom-Json

$backendUrl = $deployment.backendUrl.value
$frontendUrl = $deployment.frontendUrl.value
Write-Host "Backend URL: $backendUrl" -ForegroundColor Green
Write-Host "Frontend URL: $frontendUrl" -ForegroundColor Green

# Build & deploy backend
Write-Host "`nBuilding backend..." -ForegroundColor Cyan
Push-Location "$root/../backend"
try {
  npm ci
  npm run build
  # Zip dist + package files
  $zip = Join-Path $env:TEMP "portfolio-backend-$(Get-Date -Format yyyyMMddHHmmss).zip"
  Compress-Archive -Path 'dist','package.json','package-lock.json' -DestinationPath $zip -Force
  Write-Host "Deploying backend zip..." -ForegroundColor Cyan
  az webapp deploy --resource-group $ResourceGroup --name "$BaseName-api" --src-path $zip --type zip | Out-Null
  Remove-Item $zip -Force
} finally { Pop-Location }

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
