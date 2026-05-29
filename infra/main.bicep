// Bicep template for Portfolio Tracker on Azure.
// Provisions: Container Registry + App Service (Linux Container) + Static Web App + Cosmos DB (serverless, NoSQL).
// The backend ships as a Docker image built in-cloud via `az acr build`.

@description('Base name used for all resources (lowercase, 3-20 chars).')
@minLength(3)
@maxLength(20)
param baseName string

@description('Primary region for App Service + Cosmos DB. Italy North is the default for low latency from Italy and to avoid the recurring West Europe Cosmos capacity issues.')
param location string = resourceGroup().location

@description('Region for the Static Web App. SWA is only available in a handful of regions; Italy North is *not* supported. Keep this in westeurope (or eastus2 / centralus / westus2 / eastasia).')
@allowed([
  'westeurope'
  'northeurope'
  'eastus2'
  'centralus'
  'westus2'
  'eastasia'
])
param staticWebAppLocation string = 'westeurope'

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

@description('Container image tag deployed to App Service. Bumped each release.')
param imageTag string = 'latest'

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
    // Disable key-based auth. The backend authenticates via the App Service's
    // system-assigned managed identity using the data-plane RBAC role assigned below.
    disableLocalAuth: true
    // Block ALL public traffic. The only way to reach the data plane is via the
    // private endpoint defined further down, resolved through the Private DNS Zone
    // linked to the integrated VNet.
    publicNetworkAccess: 'Disabled'
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

// ---- Virtual Network for private connectivity ----
// We put the backend on a VNet and reach Cosmos DB through a private endpoint, so
// data-plane traffic never traverses the public internet. Two subnets:
//
//   * app-subnet — delegated to Microsoft.Web/serverFarms for App Service regional
//                  VNet integration. The web app's outbound traffic enters here.
//   * pe-subnet  — hosts the Cosmos DB private endpoint NIC. Network policies are
//                  disabled because private endpoints don't support NSG/UDR rules
//                  on their own NIC.
//
// Address space is in 10.20.0.0/16 to avoid clashing with the very common
// 10.0.0.0/16 default that's often used by other corporate VNets.
var vnetName = '${baseName}-vnet'
var appSubnetName = 'app-subnet'
var peSubnetName = 'pe-subnet'

resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: { addressPrefixes: [ '10.20.0.0/16' ] }
    subnets: [
      {
        name: appSubnetName
        properties: {
          addressPrefix: '10.20.1.0/24'
          delegations: [
            {
              name: 'webapp'
              properties: { serviceName: 'Microsoft.Web/serverFarms' }
            }
          ]
        }
      }
      {
        name: peSubnetName
        properties: {
          addressPrefix: '10.20.2.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource appSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-01-01' existing = {
  parent: vnet
  name: appSubnetName
}

resource peSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-01-01' existing = {
  parent: vnet
  name: peSubnetName
}

// ---- Private DNS Zone for Cosmos DB SQL API ----
// Required so the backend resolves <account>.documents.azure.com to the private IP
// allocated to the private endpoint, instead of the public Cosmos load balancer.
// The zone name is fixed by Azure — must be exactly 'privatelink.documents.azure.com'.
resource cosmosDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.documents.azure.com'
  location: 'global'
}

resource cosmosDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: cosmosDnsZone
  name: '${vnetName}-link'
  location: 'global'
  properties: {
    virtualNetwork: { id: vnet.id }
    registrationEnabled: false
  }
}

// ---- Private Endpoint for Cosmos DB (SQL/NoSQL API) ----
// groupIds=['Sql'] targets the NoSQL data plane. The DNS zone group below auto-
// populates the linked Private DNS Zone with the right A records (one per Cosmos
// region — for a single-region account that's just the primary endpoint).
resource cosmosPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: '${cosmosAccountName}-pe'
  location: location
  properties: {
    subnet: { id: peSubnet.id }
    privateLinkServiceConnections: [
      {
        name: 'cosmos-plsc'
        properties: {
          privateLinkServiceId: cosmos.id
          groupIds: [ 'Sql' ]
        }
      }
    ]
  }
}

resource cosmosPrivateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: cosmosPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'cosmos'
        properties: { privateDnsZoneId: cosmosDnsZone.id }
      }
    ]
  }
}

// ---- Log Analytics workspace + Application Insights ----
// All backend traces (console logs, requests, exceptions) flow into this AI
// instance via the SDK initialised in backend/src/telemetry.ts. Using a
// workspace-based AI is the current recommendation (the classic standalone
// kind has been deprecated since 2024).
var logAnalyticsName = '${baseName}-logs'
var appInsightsName = '${baseName}-ai'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    // 30 days is the minimum free retention; bump if you want to pay for longer.
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// ---- Azure Container Registry (Basic SKU, ~€5/month) ----
// Holds the backend image built with `az acr build`.
var acrName = replace(toLower('${baseName}acr'), '-', '')

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

// ---- App Service Plan + Linux Container Web App ----
var planName = '${baseName}-plan'
var apiName = '${baseName}-api'
var imageReference = '${acr.properties.loginServer}/backend:${imageTag}'

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
  kind: 'app,linux,container'
  // System-assigned managed identity so App Service can pull from ACR without a password.
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    // ---- Regional VNet integration ----
    // The web app's outbound traffic enters app-subnet (delegated above) so it can
    // reach the Cosmos DB private endpoint in pe-subnet. Basic (B1) plans support
    // regional VNet integration since 2022, so no SKU upgrade is required.
    virtualNetworkSubnetId: appSubnet.id
    siteConfig: {
      linuxFxVersion: 'DOCKER|${imageReference}'
      // Pull image via managed identity (AcrPull role granted below) — no docker registry password needed.
      acrUseManagedIdentityCreds: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      alwaysOn: true
      // Route ALL outbound traffic through the integrated VNet. This ensures DNS
      // queries for *.documents.azure.com resolve via Azure DNS (168.63.129.16),
      // which consults the Private DNS Zone linked to the VNet and returns the
      // private endpoint IP. Public endpoints (Yahoo Finance, Stooq, etc.) still
      // work via Azure's implicit outbound NAT from the integrated subnet.
      vnetRouteAllEnabled: true
      appSettings: [
        { name: 'WEBSITES_PORT', value: '4000' }
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' }
        // Disable Oryx — we ship a pre-built container.
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'PORT', value: '4000' }
        { name: 'STORAGE_DRIVER', value: 'cosmos' }
        { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
        // No COSMOS_KEY: the backend uses DefaultAzureCredential against the
        // App Service's system-assigned managed identity (RBAC role below).
        { name: 'COSMOS_DATABASE', value: cosmosDatabaseName }
        { name: 'JWT_SECRET', value: jwtSecret }
        { name: 'CORS_ORIGINS', value: corsOrigins }
        // Force the worker to use Azure-provided DNS via the integrated VNet so
        // Private DNS Zone records (privatelink.documents.azure.com) resolve.
        // Belt-and-braces with vnetRouteAllEnabled above; the explicit setting
        // protects against the platform default ever flipping back to public DNS.
        { name: 'WEBSITE_DNS_SERVER', value: '168.63.129.16' }
        // Application Insights wiring. The backend reads
        // APPLICATIONINSIGHTS_CONNECTION_STRING in src/telemetry.ts and starts
        // the SDK when present. The XDT_MicrosoftApplicationInsights_NodeJS=0
        // setting tells the App Service runtime *not* to inject its own auto-
        // attach agent — we already do code-based instrumentation.
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'APPINSIGHTS_INSTRUMENTATIONKEY', value: appInsights.properties.InstrumentationKey }
        { name: 'ApplicationInsightsAgent_EXTENSION_VERSION', value: '~3' }
        { name: 'XDT_MicrosoftApplicationInsights_NodeJS', value: '0' }
      ]
    }
  }
  // Make sure the private endpoint + DNS plumbing are fully provisioned before the
  // app starts and tries to open a Cosmos connection on cold-start.
  dependsOn: [
    cosmosPrivateDnsZoneGroup
  ]
}

// Grant the App Service managed identity AcrPull on the registry.
resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, api.id, 'AcrPull')
  properties: {
    // Built-in role: AcrPull
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: api.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Grant the App Service managed identity the Cosmos DB Built-in Data Contributor
// role on the Cosmos account (data plane). This is what lets the backend perform
// read/write operations on documents using only an AAD token — local auth (keys)
// is disabled on the account.
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, api.id, cosmosDataContributorRoleId)
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    principalId: api.identity.principalId
    scope: cosmos.id
  }
}

// ---- Static Web App for frontend ----
var swaName = '${baseName}-web'

resource swa 'Microsoft.Web/staticSites@2024-04-01' = {
  name: swaName
  location: staticWebAppLocation
  sku: { name: staticWebAppSku, tier: staticWebAppSku }
  properties: {}
}

output backendUrl string = 'https://${api.properties.defaultHostName}'
output frontendUrl string = 'https://${swa.properties.defaultHostname}'
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output cosmosAccountName string = cosmos.name
output containerRegistry string = acr.properties.loginServer
output acrName string = acr.name
output appInsightsName string = appInsights.name
output logAnalyticsName string = logAnalytics.name
output vnetName string = vnet.name
output cosmosPrivateEndpointName string = cosmosPrivateEndpoint.name

