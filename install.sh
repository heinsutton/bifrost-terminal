#!/usr/bin/env bash
# Install the newest package built by ./publish.sh. Run with sudo: sudo ./install.sh
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo: sudo ./install.sh" >&2
    exit 1
fi

pkg="$(ls -t make/bifrosterm-linux-x64-*.pacman 2>/dev/null | head -n 1 || true)"
if [ -z "$pkg" ]; then
    echo "No package in make/. Run ./publish.sh first." >&2
    exit 1
fi

if pgrep -f '/opt/Bifrost Terminal/' >/dev/null 2>&1; then
    echo "Bifrost Terminal is running. Close it first, then run this again." >&2
    exit 1
fi

echo "Installing $pkg"
pacman -U --noconfirm "$pkg"
echo "Installed. Start Bifrost Terminal from your launcher."
