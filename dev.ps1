# Copyright 2026, Command Line Inc.
# SPDX-License-Identifier: Apache-2.0

# Runs Bifrost Terminal in dev mode on Windows. Wraps `task dev` (Taskfile.yml, electron:dev).
#
# Picks a supported node (24/22/20) for this process only: the default node may be 26+, which breaks the
# npm/electron toolchain, and `task dev` would otherwise inherit it.
#
# Usage (from anywhere):
#   .\dev.ps1                  # task dev
#   .\dev.ps1 <args...>        # extra args are passed through to `task dev`

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
. (Join-Path $RepoRoot "scripts\common.ps1")

Push-Location $RepoRoot
try {
    Use-SupportedNode
    Assert-BuildTools

    task dev @args
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    Pop-Location
}
