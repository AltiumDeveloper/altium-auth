#Requires -Version 5.1
<#
.SYNOPSIS
Signs in to Altium 365 from PowerShell and emits a token set.

.DESCRIPTION
Drives the Altium.Auth .NET client (nuget: Altium.Auth) directly from PowerShell 7+ or
Windows PowerShell 5.1. The assembly is downloaded from nuget.org on first run and
cached under LocalAppData.

With -TokenFile, the token set is persisted DPAPI-encrypted for the current Windows
user and later runs refresh it silently instead of prompting the browser again.

.EXAMPLE
./Get-AltiumToken.ps1 -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
$t = ./Get-AltiumToken.ps1 -ClientId $id -WorkspaceId $authId -TokenFile ~/.altium-tokens
Invoke-RestMethod https://api.altium.com/... -Headers @{ Authorization = "Bearer $($t.AccessToken)" }
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ClientId,
    [string]$Scopes = 'openid profile offline_access',
    [string]$WorkspaceId,
    [string]$TokenFile,
    [int]$TimeoutMinutes = 5,
    [string]$PackageVersion
)

$ErrorActionPreference = 'Stop'
$isDesktop = $PSVersionTable.PSEdition -eq 'Desktop'
if ($isDesktop) {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Add-Type -AssemblyName System.Security
}

function Get-AltiumAuthAssembly {
    param([string]$Version)

    $feed = 'https://api.nuget.org/v3-flatcontainer/altium.auth'
    if (-not $Version) { $Version = (Invoke-RestMethod "$feed/index.json").versions[-1] }

    $cache = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "Altium.Auth/$Version"
    $lib = if ($isDesktop) { 'netstandard2.0' } else { 'net8.0' }
    $dll = Join-Path $cache "lib/$lib/Altium.Auth.dll"
    if (-not (Test-Path $dll)) {
        $nupkg = Join-Path ([System.IO.Path]::GetTempPath()) "altium.auth.$Version.nupkg"
        Invoke-WebRequest "$feed/$Version/altium.auth.$Version.nupkg" -OutFile $nupkg
        Expand-Archive $nupkg -DestinationPath $cache -Force
        Remove-Item $nupkg
    }
    if (-not (Test-Path $dll)) {
        throw "Altium.Auth $Version ships no $lib asset; this PowerShell edition needs one."
    }
    $dll
}

function Invoke-Sync {
    param($Task)
    try { $Task.GetAwaiter().GetResult() }
    catch { if ($_.Exception.InnerException) { throw $_.Exception.InnerException } else { throw } }
}

function Resolve-TokenFilePath {
    param([string]$Path)
    $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

function Read-TokenFile {
    param([string]$Path)
    if (-not $Path -or -not (Test-Path $Path)) { return $null }
    $protected = [System.IO.File]::ReadAllBytes((Resolve-TokenFilePath $Path))
    $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, 'CurrentUser')
    [System.Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
}

function Write-TokenFile {
    param([string]$Path, $Tokens)
    if (-not $Path) { return }
    $plain = [System.Text.Encoding]::UTF8.GetBytes(($Tokens | ConvertTo-Json -Compress))
    $protected = [System.Security.Cryptography.ProtectedData]::Protect($plain, $null, 'CurrentUser')
    [System.IO.File]::WriteAllBytes((Resolve-TokenFilePath $Path), $protected)
}

Add-Type -Path (Get-AltiumAuthAssembly -Version $PackageVersion)

$http = [System.Net.Http.HttpClient]::new()
$http.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan
$options = [Altium.Auth.AltiumAuthOptions]@{
    ClientId    = $ClientId
    Scopes      = $Scopes
    OpenBrowser = { param($url) Start-Process $url }
}
$client = [Altium.Auth.AltiumAuthClient]::new($http, $options)
$cts = [System.Threading.CancellationTokenSource]::new([timespan]::FromMinutes($TimeoutMinutes))

$tokens = $null
$saved = Read-TokenFile $TokenFile
if ($saved.RefreshToken) {
    Write-Verbose 'Refreshing the saved token set.'
    try { $tokens = Invoke-Sync $client.RefreshTokenAsync($saved.RefreshToken, $cts.Token) }
    catch { Write-Warning "Refresh failed ($($_.Exception.Message)). Signing in interactively instead." }
}
if (-not $tokens) {
    Write-Host "Opening the browser to sign in (waiting up to $TimeoutMinutes minute(s))..."
    $tokens = Invoke-Sync $client.SignInAsync([Altium.Auth.WorkspaceSelection]::None, $cts.Token)
    if ($WorkspaceId) {
        $tokens = Invoke-Sync $client.SignIntoWorkspaceAsync($tokens.AccessToken, $WorkspaceId, $cts.Token)
    }
}

Write-TokenFile $TokenFile $tokens
$tokens
