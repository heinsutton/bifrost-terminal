# Copyright 2026, Command Line Inc.
# SPDX-License-Identifier: Apache-2.0

# Shared helpers for the local PowerShell scripts (dev.ps1, scripts\package-local.ps1). Dot-source, don't run:
#   . (Join-Path $PSScriptRoot "common.ps1")

$SupportedNodeMajors = @(24, 22, 20)

function Use-SupportedNode {
    $current = (& node --version 2>$null)
    if ($current -match '^v(\d+)\.' -and $SupportedNodeMajors -contains [int]$Matches[1]) {
        Write-Host "Using node $current"
        return
    }
    # node 26+ breaks `npm install` (sharp@0.32 in the docs workspace has no prebuilt binary), so prefer an
    # nvm-installed LTS for this process only rather than switching the user's global node with `nvm use`
    $nvmRoot = Join-Path $env:APPDATA "nvm"
    foreach ($major in $SupportedNodeMajors) {
        $candidate = Get-ChildItem $nvmRoot -Directory -Filter "v$major.*" -ErrorAction SilentlyContinue |
            Sort-Object { [version]$_.Name.TrimStart("v") } -Descending |
            Select-Object -First 1
        if ($candidate -and (Test-Path (Join-Path $candidate.FullName "node.exe"))) {
            $env:PATH = "$($candidate.FullName);$env:PATH"
            Write-Host "Using node $(& node --version) from $($candidate.FullName)"
            return
        }
    }
    throw "No supported node found (need major $($SupportedNodeMajors -join '/')); current is '$current'. Install one with: nvm install 24"
}

function Assert-BuildTools {
    foreach ($tool in @("task", "go", "zig")) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "'$tool' is not on PATH (scoop install $tool)"
        }
    }
}
