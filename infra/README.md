# Infrastructure & deployment

This folder contains the Bicep IaC and helper scripts for deploying Portfolio Tracker to Azure.

The backend ships as a **Docker container** built remotely by **`az acr build`** —
no Docker daemon needed locally, and no slow Windows-side zipping. The build runs
on Linux in the cloud and the resulting image is pushed straight into Azure
Container Registry.

## What gets created

| Resource             | SKU                          | Region (default)     | Purpose                          |
|----------------------|------------------------------|----------------------|----------------------------------|
| Container Registry   | **Basic** (~€5/mo)           | `italynorth`         | Hosts the backend Docker image    |
| App Service Plan     | **B1** Linux (Basic, cheap)  | `italynorth`         | Container hosting                |
| App Service (Web)    | Linux Container, Node 22     | `italynorth`         | `*.azurewebsites.net` API URL    |
| Static Web App       | **Free**                     | `westeurope` *(see note)* | Serves the React frontend  |
| Cosmos DB Account    | **Serverless** (pay-per-use) | `italynorth`         | NoSQL store for users/portfolio  |
| Cosmos DB Database   | `portfolio-tracker`          | `italynorth`         | Containers: users / securities / transactions / dividends / priceCache |

> **Region note:** Azure Static Web Apps is only available in a handful of
> regions. Italy North is **not** one of them, so the Static Web App goes
> to `westeurope` by default. The other regions you can pick are
> `northeurope`, `eastus2`, `centralus`, `westus2`, and `eastasia`.
> Latency is fine because the SWA only serves static HTML/JS/CSS and
> proxies API calls to the App Service.

Total baseline cost ≈ €18/month: €13 App Service B1 + €5 ACR Basic + cents for
Cosmos DB usage + Static Web App Free tier.

## Prerequisites

1. [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) ≥ 2.55
2. Logged in: `az login`
3. Subscription set: `az account set --subscription <subId>`
4. Node.js ≥ 22 and npm available locally (only needed to build the frontend; the
   backend image is built remotely in ACR).

You do **not** need Docker Desktop or any container runtime locally — `az acr build`
ships the Dockerfile + source to the registry and runs the build there.

## One-shot deploy

Windows / PowerShell:

```powershell
cd infra
./deploy.ps1 -ResourceGroup portfolio-tracker -BaseName myportfolio01
# Override regions if needed:
# ./deploy.ps1 -ResourceGroup portfolio-tracker -BaseName myportfolio01 -Location westeurope -StaticWebAppLocation eastus2
```

macOS / Linux:

```bash
cd infra
./deploy.sh portfolio-tracker myportfolio01
# Override regions: ./deploy.sh portfolio-tracker myportfolio01 italynorth westeurope
```

The script:
1. Creates the resource group (idempotent).
2. Deploys `main.bicep` (creates ACR, App Service, SWA, Cosmos DB, role assignment).
3. Configures CORS on the App Service to match the actual Static Web App hostname.
4. Runs `az acr build` to build & push the backend container image (Linux Dockerfile, ~30-60s).
5. Updates the App Service to use the new image tag and restarts it.
6. Builds the frontend with the right `VITE_API_BASE_URL` and deploys it to the SWA.

The image is tagged with a timestamp (`vYYYYMMDDHHmmss`) so you can roll back easily:

```powershell
# Roll back to a previous build
az webapp config container set -g <rg> -n <basename>-api `
  --container-image-name "<acr-server>/backend:v20260526151200"
az webapp restart -g <rg> -n <basename>-api
```

## Configuring CORS

The deploy scripts **automatically set `CORS_ORIGINS` to the actual Static Web
App URL** that Azure assigns after provisioning (e.g.
`https://lively-sand-0064cfa03.azurestaticapps.net`). You don't normally need
to pass `-CorsOrigins` at all.

If you have a custom domain in front of the SWA, pass it via `-CorsOrigins` and
it will be **appended** to the auto-detected URL:

```powershell
./deploy.ps1 -ResourceGroup portfolio-tracker -BaseName myportfolio01 `
             -CorsOrigins "https://app.example.com"
# → CORS_ORIGINS = "https://app.example.com,https://<actual-swa-hostname>"
```

To fix CORS on an existing deployment without redeploying:

```powershell
$swa = az staticwebapp show -g <rg> -n <basename>-web --query defaultHostname -o tsv
az webapp config appsettings set -g <rg> -n <basename>-api `
  --settings "CORS_ORIGINS=https://$swa"
```

## Local development with Docker (optional)

If you want to test the production container locally:

```bash
cd backend
docker build -t portfolio-backend .
docker run -p 4000:4000 \
  -e JWT_SECRET=dev-secret \
  -e STORAGE_DRIVER=local \
  portfolio-backend
# Hit http://localhost:4000/api/health
```

For day-to-day local dev, the plain `npm run dev` workflow at the repo root is
still recommended — it gives you tsx hot-reload and the Vite dev server.

## Manual cleanup

```bash
az group delete --name portfolio-tracker --yes --no-wait
```

## Configuring CORS

The deploy scripts **automatically set `CORS_ORIGINS` to the actual Static Web
App URL** that Azure assigns after provisioning (e.g.
`https://lively-sand-0064cfa03.azurestaticapps.net`). You don't normally need
to pass `-CorsOrigins` at all.

If you have a custom domain in front of the SWA, pass it via `-CorsOrigins` and
it will be **appended** to the auto-detected URL:

```powershell
./deploy.ps1 -ResourceGroup portfolio-tracker -BaseName myportfolio01 `
             -CorsOrigins "https://app.example.com"
# → CORS_ORIGINS = "https://app.example.com,https://<actual-swa-hostname>"
```

To fix CORS on an existing deployment without redeploying:

```powershell
$swa = az staticwebapp show -g <rg> -n <basename>-web --query defaultHostname -o tsv
az webapp config appsettings set -g <rg> -n <basename>-api `
  --settings "CORS_ORIGINS=https://$swa"
```

## Manual cleanup

```bash
az group delete --name portfolio-tracker --yes --no-wait
```
