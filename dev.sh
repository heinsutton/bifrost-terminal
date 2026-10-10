#!/usr/bin/env bash
# Run Bifrost Terminal in dev mode on Linux (builds wavesrv, starts the Vite dev server + Electron).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

if command -v go-task >/dev/null 2>&1; then
    TASK=go-task
elif command -v task >/dev/null 2>&1; then
    TASK=task
else
    echo "Task not found. Install it: sudo pacman -S go-task" >&2
    exit 1
fi

exec "$TASK" electron:linuxquickdev "$@"
