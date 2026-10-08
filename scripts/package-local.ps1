# Copyright 2026, Command Line Inc.
# SPDX-License-Identifier: Apache-2.0

# Builds a local Windows NSIS installer for this fork (make\Bifrost*-win32-x64-<version>.exe).
#
# Use this instead of `task package` for local builds. `task package` runs `clean` (which deletes dist/)
# in parallel with build:backend, and Task's checksum cache in .task/ can mark build:backend as up to date
# even though dist/bin was just deleted -- producing an installer with no wavesrv.x64.exe that opens a
# window but never starts its backend (waveapp.log: "spawn ...wavesrv.x64.exe ENOENT").
#
# Usage (from anywhere):
#   .\scripts\package-local.ps1             # build the installer only
#   .\scripts\package-local.ps1 -Install    # build, close Bifrost Terminal, install silently over the existing install
#   .\scripts\package-local.ps1 -RequireSigning   # fail instead of building unsigned when the signing certificate is missing
#
# Signing: if scripts\new-signing-cert.ps1 has created the certificate, the build is signed with it (see RELEASES.md).

param(
    [switch]$Install,
    [switch]$RequireSigning
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

function Assert-Signed([string]$Path, [string]$Thumbprint) {
    if (-not (Test-Path $Path)) {
        throw "Cannot verify signature, file is missing: $Path"
    }
    $signer = (Get-AuthenticodeSignature $Path).SignerCertificate
    if ($signer -eq $null -or $signer.Thumbprint -ne $Thumbprint) {
        throw "$Path is not signed by certificate $Thumbprint"
    }
    Write-Host "Signed: $Path"
}

Push-Location $RepoRoot
try {
    Use-SupportedNode
    Assert-BuildTools

    $signingCert = Get-SigningCert
    if ($signingCert) {
        $env:BIFROST_SIGN_CERT_SHA1 = $signingCert.Thumbprint
        Write-Host "Signing with $($signingCert.Subject) ($($signingCert.Thumbprint))" -ForegroundColor Green
    }
    elseif ($RequireSigning) {
        throw "No valid code-signing certificate '$SigningCertSubject' in Cert:\CurrentUser\My; run scripts\new-signing-cert.ps1"
    }
    else {
        Remove-Item Env:\BIFROST_SIGN_CERT_SHA1 -ErrorAction SilentlyContinue
        Write-Warning "No code-signing certificate '$SigningCertSubject' found; building UNSIGNED. Run scripts\new-signing-cert.ps1 once, or pass -RequireSigning to fail instead."
    }

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
    $installer = Get-ChildItem (Join-Path $RepoRoot "make") -Filter "Bifrost*-win32-x64-*.exe" | Select-Object -First 1
    if ($installer -eq $null) {
        throw "Installer not found in make\"
    }

    if ($signingCert) {
        Write-Host ""
        Write-Host "==> Verifying signatures" -ForegroundColor Cyan
        $unpackedBin = Join-Path $RepoRoot "make\win-unpacked\resources\app.asar.unpacked\dist\bin"
        $packagedWsh = Get-ChildItem $unpackedBin -Filter "wsh-*-windows*.exe"
        if (-not $packagedWsh) {
            throw "Packaged app has no Windows wsh exe in $unpackedBin"
        }
        $toVerify = @($installer.FullName, (Join-Path $RepoRoot "make\win-unpacked\Bifrost Terminal.exe"), $packagedSrv) +
            @($packagedWsh | ForEach-Object { $_.FullName })
        foreach ($file in $toVerify) {
            Assert-Signed $file $signingCert.Thumbprint
        }
    }

    Write-Host ""
    Write-Host "Built $($installer.FullName)" -ForegroundColor Green

    if (-not $Install) {
        Write-Host "Close Bifrost Terminal, then run the installer above (or re-run this script with -Install)."
        return
    }

    Write-Host ""
    Write-Host "==> Closing Bifrost Terminal and installing" -ForegroundColor Cyan
    Get-Process -Name "Bifrost Terminal", "wavesrv.x64" -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    $proc = Start-Process -FilePath $installer.FullName -ArgumentList "/S" -PassThru -Wait
    if ($proc.ExitCode -ne 0) {
        throw "Installer exited with code $($proc.ExitCode)"
    }
    $installedSrv = Join-Path $env:LOCALAPPDATA "Programs\waveterm\resources\app.asar.unpacked\dist\bin\wavesrv.x64.exe"
    if (-not (Test-Path $installedSrv)) {
        throw "Install finished but $installedSrv is missing"
    }
    Write-Host "Installed. Start Bifrost Terminal from the Start menu." -ForegroundColor Green
}
finally {
    Pop-Location
}
