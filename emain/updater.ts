// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ipcMain } from "electron";

export let updater: { status: UpdaterStatus; stop: () => void } | undefined;

export function getResolvedUpdateChannel(): string {
    return "none";
}

ipcMain.on("install-app-update", () => {});
ipcMain.on("get-app-update-status", (event) => {
    event.returnValue = updater?.status;
});
ipcMain.on("get-updater-channel", (event) => {
    event.returnValue = getResolvedUpdateChannel();
});

export async function configureAutoUpdater() {
    console.log("auto-updater disabled");
}
