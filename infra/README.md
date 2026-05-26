# Infrastructure & deployment

This folder contains the Bicep IaC and helper scripts for deploying Portfolio Tracker to Azure.

## What gets created

| Resource            | SKU                          | Purpose                          |
|---------------------|------------------------------|----------------------------------|
| App Service Plan    | **B1** Linux (Basic, cheap)  | Hosts the Node.js backend        |
| App Service (Web)   | Node 20 LTS                  | `*.azurewebsites.net` API URL    |
| Static Web App      | **Free**                     | Serves the React frontend         |
| Cosmos DB Account   | **Serverless** (pay-per-use) | NoSQL store for users/portfolio  |
| Cosmos DB Database  | `portfolio-tracker`          | Containers: users / securities / transactions / dividends / priceCache |

Total baseline cost ≈ €13/month for App Service B1 + cents for Cosmos DB usage + Static Web App Free tier.

## Prerequisites

1. [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) ≥ 2.55
2. Logged in: `az login`
3. Subscription set: `az account set --subscription <subId>`
4. Node.js ≥ 20 and npm available locally (the script builds both backend and frontend before pushing).

## One-shot deploy

Windows / PowerShell:

```powershell
cd infra
./deploy.ps1 -ResourceGroup portfolio-tracker -BaseName myportfolio01 -Location westeurope
```

macOS / Linux:

```bash
cd infra
./deploy.sh portfolio-tracker myportfolio01 westeurope
```

The script:
1. Creates the resource group (idempotent)
2. Deploys `main.bicep`
3. Builds the backend (`tsc`) and zip-deploys it to App Service
4. Builds the frontend (`vite build`) pointing at the new backend URL and pushes it to the Static Web App

The output prints both URLs.

## Configuring CORS

By default, `corsOrigins=*` so the API accepts any origin. For production, redeploy with:

```powershell
./deploy.ps1 -ResourceGroup portfolio-tracker -BaseName myportfolio01 -CorsOrigins "https://myportfolio01-web.azurestaticapps.net"
```

## Manual cleanup

```bash
az group delete --name portfolio-tracker --yes --no-wait
```
