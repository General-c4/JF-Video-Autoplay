param(
  [string]$Configuration = "Release",
  [string]$OutDir = "..\dist",
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
Push-Location (Split-Path $MyInvocation.MyCommand.Path)

if ([string]::IsNullOrWhiteSpace($Version)) {
  [xml]$versionProps = Get-Content -Raw -LiteralPath "..\Directory.Build.props"
  $Version = [string]$versionProps.Project.PropertyGroup.PluginVersion
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  throw "PluginVersion is missing from Directory.Build.props"
}

# Normalize OutDir
if (-not [System.IO.Path]::IsPathRooted($OutDir)) {
  $OutDir = Join-Path (Get-Location) $OutDir
}
New-Item -Force -ItemType Directory -Path $OutDir | Out-Null

Write-Host "== Building plugin =="
dotnet build ..\src\Jellyfin.Plugin.VideoAutoplay.csproj -c $Configuration

$buildDir = "..\src\bin\$Configuration\net9.0"
$dll = Join-Path $buildDir "Jellyfin.Plugin.VideoAutoplay.dll"

if (!(Test-Path $dll)) {
  throw "DLL not found: $dll"
}

# ✅ مهم: بدون مجلدات
$stageDir = Join-Path $OutDir "_stage"
if (Test-Path $stageDir) {
  Remove-Item $stageDir -Recurse -Force
}

New-Item -ItemType Directory -Path $stageDir | Out-Null
Copy-Item $dll $stageDir

$zipPath = Join-Path $OutDir "Jellyfin.Plugin.VideoAutoplay-$Version.zip"
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

Write-Host "== Creating canonical ZIP =="
Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipPath

# تنظيف
Remove-Item $stageDir -Recurse -Force

Write-Host "Done:"
Write-Host $zipPath

Pop-Location
