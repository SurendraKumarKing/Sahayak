targetScope = 'resourceGroup'

@description('Lowercase letters/digits only. Use a short, unique project prefix.')
@minLength(3)
@maxLength(12)
param namePrefix string = 'sahayak'

param location string = resourceGroup().location
param documentIntelligenceLocation string = location
param translatorLocation string = location
param languageLocation string = location
@description('Select a Speech region supporting fast transcription and your input languages.')
param speechLocation string = location
param contentSafetyLocation string = location
@description('Verify model/version availability AND subscription quota in this region before deployment.')
param openAiLocation string = location

@description('Existing single-tenant workforce Entra tenant GUID; no app registrations are created.')
@minLength(36)
@maxLength(36)
param entraTenantId string

@description('API app registration CLIENT ID GUID, not its api:// scope URI. Configure v2 access tokens.')
@minLength(36)
@maxLength(36)
param entraApiAudience string

@description('Exact browser origin without trailing slash; replace with your HTTPS web origin when hosted.')
param apiCorsOrigin string = 'http://localhost:8081'

@description('False creates the OpenAI account only; deploy/select a compatible model before using Azure mode.')
param deployOpenAiModel bool = false
param openAiDeploymentName string = 'sahayak-chat'
@description('Example only: model/region/version availability changes. Verify before enabling deployment.')
param openAiModelName string = 'gpt-4o-mini'
param openAiModelVersion string = '2024-07-18'
@allowed([
  'Standard'
  'GlobalStandard'
  'DataZoneStandard'
])
param openAiDeploymentSku string = 'Standard'
@minValue(1)
@maxValue(10)
@description('Model quota units, not a spending cap. Unit-to-TPM mapping varies by model.')
param openAiCapacity int = 1

var suffix = uniqueString(resourceGroup().id)
var baseName = '${namePrefix}-${suffix}'
var cognitiveUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a97b65f3-24c7-4388-baec-2e87135dc908')
var openAiUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
var blobContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var secretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var tags = {
  project: 'Sahayak'
  purpose: 'hackathon-not-production'
}
var serviceDefinitions = [
  {
    suffix: 'doc'
    kind: 'FormRecognizer'
    sku: 'S0'
    location: documentIntelligenceLocation
  }
  {
    suffix: 'translator'
    kind: 'TextTranslation'
    sku: 'S1'
    location: translatorLocation
  }
  {
    suffix: 'language'
    kind: 'TextAnalytics'
    sku: 'S'
    location: languageLocation
  }
  {
    suffix: 'speech'
    kind: 'SpeechServices'
    sku: 'S0'
    location: speechLocation
  }
  {
    suffix: 'safety'
    kind: 'ContentSafety'
    sku: 'S0'
    location: contentSafetyLocation
  }
]

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${take(namePrefix, 8)}${suffix}'
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // The Functions host uses a server-side account key; app documents use managed identity.
    allowSharedKeyAccess: true
    publicNetworkAccess: 'Enabled'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: false
    deleteRetentionPolicy: {
      enabled: false
    }
    containerDeleteRetentionPolicy: {
      enabled: false
    }
  }
}

resource documents 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'sahayak'
  properties: {
    publicAccess: 'None'
  }
}

resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'expire-sahayak-source-and-derived-data'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              prefixMatch: [
                'sahayak/'
              ]
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: 1
                }
              }
            }
          }
        }
      ]
    }
  }
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${baseName}-logs'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: 1
    }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${baseName}-insights'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    RetentionInDays: 30
    IngestionMode: 'LogAnalytics'
    DisableLocalAuth: false
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${take(namePrefix, 7)}-${suffix}-kv'
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

resource aiServices 'Microsoft.CognitiveServices/accounts@2023-05-01' = [for service in serviceDefinitions: {
  name: '${baseName}-${service.suffix}'
  location: service.location
  tags: tags
  kind: service.kind
  sku: {
    name: service.sku
  }
  properties: {
    customSubDomainName: '${baseName}-${service.suffix}'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}]

resource openAi 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: '${baseName}-openai'
  location: openAiLocation
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: '${baseName}-openai'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource model 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = if (deployOpenAiModel) {
  parent: openAi
  name: openAiDeploymentName
  sku: {
    name: openAiDeploymentSku
    capacity: openAiCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: openAiModelName
      version: openAiModelVersion
    }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${baseName}-plan'
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: '${baseName}-api'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: 'NODE|22'
      alwaysOn: true
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      cors: {
        allowedOrigins: [
          apiCorsOrigin
        ]
        supportCredentials: false
      }
      appSettings: [
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        {
          name: 'ENABLE_ORYX_BUILD'
          value: 'false'
        }
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: insights.properties.ConnectionString
        }
        {
          name: 'SAHAYAK_MODE'
          value: 'azure'
        }
        {
          name: 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT'
          value: 'https://${aiServices[0].name}.cognitiveservices.azure.com'
        }
        {
          name: 'AZURE_TRANSLATOR_ENDPOINT'
          value: 'https://${aiServices[1].name}.cognitiveservices.azure.com'
        }
        {
          name: 'AZURE_LANGUAGE_ENDPOINT'
          value: 'https://${aiServices[2].name}.cognitiveservices.azure.com'
        }
        {
          name: 'AZURE_SPEECH_ENDPOINT'
          value: 'https://${aiServices[3].name}.cognitiveservices.azure.com'
        }
        {
          name: 'AZURE_SPEECH_REGION'
          value: speechLocation
        }
        {
          name: 'AZURE_SPEECH_RESOURCE_ID'
          value: aiServices[3].id
        }
        {
          name: 'AZURE_CONTENT_SAFETY_ENDPOINT'
          value: 'https://${aiServices[4].name}.cognitiveservices.azure.com'
        }
        {
          name: 'AZURE_OPENAI_ENDPOINT'
          value: openAi.properties.endpoint
        }
        {
          name: 'AZURE_OPENAI_DEPLOYMENT'
          value: openAiDeploymentName
        }
        {
          name: 'AZURE_STORAGE_ACCOUNT_URL'
          value: storage.properties.primaryEndpoints.blob
        }
        {
          name: 'AZURE_STORAGE_CONTAINER'
          value: documents.name
        }
        {
          name: 'ENTRA_TENANT_ID'
          value: entraTenantId
        }
        {
          name: 'ENTRA_API_AUDIENCE'
          value: entraApiAudience
        }
        {
          name: 'ENTRA_REQUIRED_SCOPE'
          value: 'access_as_user'
        }
        {
          name: 'API_CORS_ORIGIN'
          value: apiCorsOrigin
        }
      ]
    }
  }
}

resource ftpPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: functionApp
  name: 'ftp'
  properties: {
    allow: false
  }
}

resource scmPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: functionApp
  name: 'scm'
  properties: {
    allow: false
  }
}

resource cognitiveRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (service, index) in serviceDefinitions: {
  name: guid(aiServices[index].id, functionApp.id, cognitiveUserRoleId)
  scope: aiServices[index]
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: cognitiveUserRoleId
  }
}]

resource openAiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openAi.id, functionApp.id, openAiUserRoleId)
  scope: openAi
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: openAiUserRoleId
  }
}

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(documents.id, functionApp.id, blobContributorRoleId)
  scope: documents
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobContributorRoleId
  }
}

resource vaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, functionApp.id, secretsUserRoleId)
  scope: vault
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: secretsUserRoleId
  }
}

output functionAppName string = functionApp.name
output apiBaseUrl string = 'https://${functionApp.properties.defaultHostName}/api'
output storageAccountName string = storage.name
output keyVaultName string = vault.name
output managedIdentityPrincipalId string = functionApp.identity.principalId
output openAiAccountName string = openAi.name
output speechResourceId string = aiServices[3].id
output configuredModelDeployment string = openAiDeploymentName
output modelDeploymentRequested bool = deployOpenAiModel
