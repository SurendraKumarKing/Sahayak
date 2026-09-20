[CmdletBinding()]
param(
    [string] $Destination = (Join-Path (Split-Path -Parent $PSScriptRoot) '..\sahayak-hackathon-source.zip')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (Test-Path $destinationPath) {
    throw "Destination already exists: $destinationPath. Choose a new -Destination."
}
$stage = Join-Path ([IO.Path]::GetTempPath()) ('sahayak-source-' + [Guid]::NewGuid().ToString('N'))
$payload = Join-Path $stage 'sahayak-hackathon'
$allowedExtensions = @('.ts', '.tsx', '.json', '.txt', '.bicep', '.bicepparam', '.ps1')

function Copy-SourceDirectory {
    param([string] $Source, [string] $Target)
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        if ($item.LinkType -in @('SymbolicLink', 'Junction')) { continue }
        if ($item.PSIsContainer) {
            if ($item.Name -in @('node_modules', 'dist', '.expo', '.git', 'artifacts', 'coverage', '.azure')) { continue }
            Copy-SourceDirectory -Source $item.FullName -Target (Join-Path $Target $item.Name)
            continue
        }
        if ($item.Name -eq 'local.settings.json' -or ($item.Name -like '.env*' -and $item.Name -ne '.env.example')) { continue }
        if ($item.Extension -in $allowedExtensions -or $item.Name -in @('.gitignore', '.env.example', 'README.md')) {
            Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $Target $item.Name)
        }
    }
}

try {
    Copy-SourceDirectory -Source $root -Target $payload
    foreach ($required in @('package.json', 'package-lock.json', 'SETUP.txt', 'apps\mobile\App.tsx', 'apps\api\src\functions.ts', 'infra\main.bicep')) {
        if (-not (Test-Path (Join-Path $payload $required))) { throw "Source package missing $required" }
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $destinationPath)
    Write-Output $destinationPath
} finally {
    if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
