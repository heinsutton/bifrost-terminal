# Copyright 2026, Command Line Inc.
# SPDX-License-Identifier: Apache-2.0

# Creates (once) the self-signed code-signing certificate that scripts\package-local.ps1 signs local builds with,
# and exports its public part for IT to exclude Bifrost Terminal in SentinelOne by signer.
#
# Idempotent: reuses an existing certificate that is still valid for 30+ days. The private key stays in
# Cert:\CurrentUser\My, non-exportable. The Root and TrustedPublisher stores are never touched.
#
# Usage (from anywhere):
#   .\scripts\new-signing-cert.ps1

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

$cerPath = Join-Path $env:USERPROFILE "bifrost-signing.cer"

$cert = Get-SigningCert -MinValidDays 30
if ($cert) {
    Write-Host "Reusing existing certificate" -ForegroundColor Cyan
}
else {
    Write-Host "Creating certificate" -ForegroundColor Cyan
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $SigningCertSubject `
        -CertStoreLocation Cert:\CurrentUser\My -KeyExportPolicy NonExportable -KeyAlgorithm RSA `
        -KeyLength 3072 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(2)
}

Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null

Write-Host "Subject:    $($cert.Subject)"
Write-Host "Thumbprint: $($cert.Thumbprint)"
Write-Host "Expires:    $($cert.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host "Public .cer (give this to IT): $cerPath" -ForegroundColor Green
