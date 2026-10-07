# Copyright 2026, Command Line Inc.
# SPDX-License-Identifier: Apache-2.0

# Builds a local Windows NSIS installer for this fork (make\Wave-win32-x64-<version>.exe).
#
# Use this instead of `task package` for local builds. `task package` runs `clean` (which deletes dist/)
# in parallel with build:backend, and Task's checksum cache in .task/ can mark build:backend as up to date
# even though dist/bin was just deleted -- producing an installer with no wavesrv.x64.exe that opens a
# window but never starts its backend (waveapp.log: "spawn ...wavesrv.x64.exe ENOENT").
#
# Usage (from anywhere):
#   .\scripts\package-local.ps1             # build the installer only
#   .\scripts\package-local.ps1 -Install    # build, close Wave, install silently over the existing install

param(
    [switch]$Install
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "common.ps1")

function Invoke-Step([string]$Name, [scriptblock]$Command) {
    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

Push-Location $RepoRoot
try {
    Use-SupportedNode
    Assert-BuildTools

    Remove-Item -Recurse -Force (Join-Path $RepoRoot "make") -ErrorAction SilentlyContinue
    Invoke-Step "Backend (wavesrv, wsh, tsunami scaffold)" { task build:backend build:tsunamiscaffold --force }
    Invoke-Step "Frontend (production build)" { npm run build:prod }
    Invoke-Step "Installer (electron-builder, NSIS only)" {
        npx electron-builder -c electron-builder.config.cjs -p never --win nsis
    }

    $packagedSrv = Join-Path $RepoRoot "make\win-unpacked\resources\app.asar.unpacked\dist\bin\wavesrv.x64.exe"
    if (-not (Test-Path $packagedSrv)) {
        throw "Packaged app is missing wavesrv.x64.exe ($packagedSrv); the installer would not start its backend"
    }
    $installer = Get-ChildItem (Join-Path $RepoRoot "make") -Filter "Wave-win32-x64-*.exe" | Select-Object -First 1
    if ($installer -eq $null) {
        throw "Installer not found in make\"
    }
    Write-Host ""
    Write-Host "Built $($installer.FullName)" -ForegroundColor Green

    if (-not $Install) {
        Write-Host "Close Wave, then run the installer above (or re-run this script with -Install)."
        return
    }

    Write-Host ""
    Write-Host "==> Closing Wave and installing" -ForegroundColor Cyan
    Get-Process -Name "Wave", "wavesrv.x64" -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    $proc = Start-Process -FilePath $installer.FullName -ArgumentList "/S" -PassThru -Wait
    if ($proc.ExitCode -ne 0) {
        throw "Installer exited with code $($proc.ExitCode)"
    }
    $installedSrv = Join-Path $env:LOCALAPPDATA "Programs\waveterm\resources\app.asar.unpacked\dist\bin\wavesrv.x64.exe"
    if (-not (Test-Path $installedSrv)) {
        throw "Install finished but $installedSrv is missing"
    }
    Write-Host "Installed. Start Wave from the Start menu." -ForegroundColor Green
}
finally {
    Pop-Location
}
