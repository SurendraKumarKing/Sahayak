using './main.bicep'

param namePrefix = 'sahayak'
param location = 'eastus2'
param documentIntelligenceLocation = 'eastus'
param translatorLocation = 'eastus'
param languageLocation = 'eastus'
param speechLocation = 'eastus'
param contentSafetyLocation = 'eastus'
param openAiLocation = 'eastus'

// Replace both GUID placeholders with registrations in your tenant; these are NOT secrets.
param entraTenantId = '00000000-0000-0000-0000-000000000000'
param entraApiAudience = '00000000-0000-0000-0000-000000000000'
param apiCorsOrigin = 'http://localhost:8081'

// These are examples, NOT a guarantee of regional availability, model lifetime, or quota.
// Leave false for infra-only provisioning. Azure document features require a real deployment.
param deployOpenAiModel = false
param openAiDeploymentName = 'sahayak-chat'
param openAiModelName = 'gpt-4o-mini'
param openAiModelVersion = '2024-07-18'
param openAiDeploymentSku = 'Standard'
param openAiCapacity = 1
