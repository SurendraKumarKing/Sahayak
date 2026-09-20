[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $projectRoot 'apps\api'
$sharedRoot = Join-Path $projectRoot 'packages\shared'
$outputRoot = Join-Path $PSScriptRoot 'artifacts'
$stage = Join-Path $outputRoot ('stage-' + [Guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $outputRoot 'sahayak-api.zip'

function Invoke-Npm {
    param([string[]] $NpmArguments)
    & npm.cmd @NpmArguments
    if ($LASTEXITCODE -ne 0) { throw "npm failed: $($NpmArguments -join ' ')" }
}

foreach ($required in @('package.json', 'host.json', 'dist\functions.js')) {
    if (-not (Test-Path (Join-Path $apiRoot $required))) {
        throw "Missing apps\api\$required. Run npm install and npm run build:api at project root first."
    }
}
if (-not (Test-Path (Join-Path $sharedRoot 'dist'))) {
    throw 'Missing compiled shared package. Run npm run build:api first.'
}

New-Item -ItemType Directory -Path $stage -Force | Out-Null
try {
    Copy-Item (Join-Path $apiRoot 'dist') -Destination $stage -Recurse
    Copy-Item (Join-Path $apiRoot 'host.json') -Destination $stage
    $sharedStage = Join-Path $stage 'shared-package'
    New-Item -ItemType Directory -Path $sharedStage | Out-Null
    Copy-Item (Join-Path $sharedRoot 'package.json') -Destination $sharedStage
    Copy-Item (Join-Path $sharedRoot 'dist') -Destination $sharedStage -Recurse
    Push-Location $sharedStage
    try {
        Invoke-Npm -NpmArguments @('pack', '--ignore-scripts', '--pack-destination', $stage)
    } finally { Pop-Location }
    Remove-Item $sharedStage -Recurse -Force
    $tarballs = @(Get-ChildItem -Path $stage -Filter '*.tgz')
    if ($tarballs.Count -ne 1) { throw 'Expected exactly one packed shared package.' }

    $manifest = Get-Content (Join-Path $apiRoot 'package.json') -Raw | ConvertFrom-Json
    if (-not $manifest.dependencies.'@sahayak/shared') {
        throw 'API manifest must declare @sahayak/shared as a production dependency.'
    }
    $manifest.dependencies.'@sahayak/shared' = 'file:./' + $tarballs[0].Name
    $manifest | Add-Member -MemberType NoteProperty -Name main -Value 'dist/functions.js' -Force
    foreach ($property in @('devDependencies', 'workspaces', 'scripts')) {
        $manifest.PSObject.Properties.Remove($property)
    }
    $json = $manifest | ConvertTo-Json -Depth 30
    [IO.File]::WriteAllText((Join-Path $stage 'package.json'), $json, [Text.UTF8Encoding]::new($false))

    Push-Location $stage
    try {
        # Production dependencies only; never copy a developer's node_modules or .env files.
        Invoke-Npm -NpmArguments @('install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund')
        Invoke-Npm -NpmArguments @('ls', '--omit=dev')
        & node --input-type=module -e "await import('@sahayak/shared'); await import('@azure/functions');"
        if ($LASTEXITCODE -ne 0) { throw 'Packaged production dependency import check failed.' }
    } finally { Pop-Location }

    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)
    $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        foreach ($entry in @('host.json', 'package.json', 'dist/functions.js', 'node_modules/@sahayak/shared/package.json')) {
            if ($entries -notcontains $entry) { throw "Invalid deployment archive: missing $entry at zip root." }
        }
        if ($entries | Where-Object { $_ -match '(^|/)(\.env($|\.)|local\.settings\.json$)' }) {
            throw 'Refusing to produce an archive containing environment settings.'
        }
    } finally { $archive.Dispose() }
    Write-Output "Verified Azure Functions artifact: $zipPath"
    Write-Output 'No deployment performed. Node dependencies must remain pure JavaScript when packaging on Windows for Linux.'
} catch {
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    throw
} finally {
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
}
