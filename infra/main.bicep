// Bicep template for Portfolio Tracker on Azure.
// Provisions: App Service (Linux, Node 20, B1) + Static Web App + Cosmos DB (serverless, NoSQL).
// All resources go in a single resource group.

@description('Base name used for all resources (lowercase, 3-20 chars).')
@minLength(3)
@maxLength(20)
param baseName string

@description('Primary region for all resources.')
param location string = resourceGroup().location

@description('JWT signing secret for the backend. Generate a strong random string.')
@secure()
param jwtSecret string

@description('Allowed origins for backend CORS (comma-separated).')
param corsOrigins string = '*'

@description('SKU for the App Service Plan.')
@allowed(['B1', 'B2', 'P0v3', 'P1v3'])
param appServiceSku string = 'B1'

@description('Static Web App SKU.')
@allowed(['Free', 'Standard'])
param staticWebAppSku string = 'Free'

// ---- Cosmos DB ----
var cosmosAccountName = toLower('${baseName}-cosmos')
var cosmosDatabaseName = 'portfolio-tracker'

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [
      { locationName: location, failoverPriority: 0, isZoneRedundant: false }
    ]
    capabilities: [
      { name: 'EnableServerless' }
    ]
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: cosmosDatabaseName
  properties: {
    resource: { id: cosmosDatabaseName }
  }
}

var containers = [
  { name: 'users', partitionKey: '/id' }
  { name: 'securities', partitionKey: '/id' }
  { name: 'transactions', partitionKey: '/userId' }
  { name: 'dividends', partitionKey: '/userId' }
  { name: 'priceCache', partitionKey: '/symbol' }
]

resource cosmosContainers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [for c in containers: {
  parent: cosmosDb
  name: c.name
  properties: {
    resource: {
      id: c.name
      partitionKey: { paths: [ c.partitionKey ], kind: 'Hash' }
    }
  }
}]

// ---- App Service for backend ----
var planName = '${baseName}-plan'
var apiName = '${baseName}-api'

resource appServicePlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  sku: { name: appServiceSku, tier: startsWith(appServiceSku, 'P') ? 'PremiumV3' : 'Basic' }
  kind: 'linux'
  properties: { reserved: true }
}

resource api 'Microsoft.Web/sites@2024-04-01' = {
  name: apiName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      alwaysOn: appServiceSku == 'B1' ? true : true
      appSettings: [
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'WEBSITES_PORT', value: '4000' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'PORT', value: '4000' }
        { name: 'STORAGE_DRIVER', value: 'cosmos' }
        { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
        { name: 'COSMOS_KEY', value: cosmos.listKeys().primaryMasterKey }
        { name: 'COSMOS_DATABASE', value: cosmosDatabaseName }
        { name: 'JWT_SECRET', value: jwtSecret }
        { name: 'CORS_ORIGINS', value: corsOrigins }
      ]
    }
  }
}

// ---- Static Web App for frontend ----
var swaName = '${baseName}-web'

resource swa 'Microsoft.Web/staticSites@2024-04-01' = {
  name: swaName
  location: location
  sku: { name: staticWebAppSku, tier: staticWebAppSku }
  properties: {}
}

output backendUrl string = 'https://${api.properties.defaultHostName}'
output frontendUrl string = 'https://${swa.properties.defaultHostname}'
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output cosmosAccountName string = cosmos.name
