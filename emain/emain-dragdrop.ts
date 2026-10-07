// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { DropQueryResult, pickDropWindow, pointInRect, toClientPoint } from "@/util/tabdragutil";
import { fireAndForget } from "@/util/util";
import { ipcMain, screen } from "electron";
import {
    getWaveWindowById,
    getWaveWindowByWebContentsId,
    getWaveWindowsByFocusRecency,
    getWindowTabCount,
    moveTabToWindow,
    popOutTab,
    senderWindowOwnsTab,
    WaveBrowserWindow,
} from "./emain-window";

const DropQueryTimeoutMs = 300;
// the new window's top-left relative to the cursor, so the cursor lands on its tab bar
const TearOffWindowOffset = { x: 80, y: 16 };

type PendingDropQuery = {
    webContentsId: number;
    resolve: (result: DropQueryResult) => void;
};

// reqId -> pending drop query (main process is single-threaded; no lock needed)
const pendingDropQueries = new Map<string, PendingDropQuery>();

// asks the target window's renderer where a tab dropped at screenPoint would go
function queryDropTarget(targetWin: WaveBrowserWindow, screenPoint: Electron.Point): Promise<DropQueryResult> {
    const wc = targetWin.activeTabView?.webContents;
    if (wc == null || wc.isDestroyed()) {
        return Promise.resolve({ area: "content" });
    }
    const clientPoint = toClientPoint(screenPoint, targetWin.getContentBounds(), wc.getZoomFactor());
    const reqId = crypto.randomUUID();
    return new Promise((resolve) => {
        const timeoutHandle = setTimeout(() => {
            pendingDropQueries.delete(reqId);
            resolve({ area: "content" });
        }, DropQueryTimeoutMs);
        pendingDropQueries.set(reqId, {
            webContentsId: wc.id,
            resolve: (result) => {
                clearTimeout(timeoutHandle);
                pendingDropQueries.delete(reqId);
                resolve(result);
            },
        });
        wc.send("drop-query", reqId, clientPoint.x, clientPoint.y);
    });
}

// a tab was released outside its own tab bar: dock it in the realm window under the cursor
// (at the tab bar position, or at the end when dropped on content), or tear it off into a new
// popped-out window at the cursor. Dropping back on the source window does nothing.
async function handleTabDragEnd(srcWin: WaveBrowserWindow, tabId: string) {
    const point = screen.getCursorScreenPoint();
    if (pointInRect(point, srcWin.getBounds())) {
        return;
    }
    const candidates = getWaveWindowsByFocusRecency()
        .filter((ww) => ww !== srcWin && !ww.isDestroyed())
        .map((ww) => ({ id: ww.waveWindowId, bounds: ww.getBounds(), visible: ww.isVisible() && !ww.isMinimized() }));
    const targetWin = getWaveWindowById(pickDropWindow(point, candidates));
    if (targetWin != null && targetWin.workspaceId === srcWin.workspaceId) {
        const result = await queryDropTarget(targetWin, point);
        const index = result.area === "tabbar" && result.tabIndex != null ? result.tabIndex : -1;
        console.log("tab-drag-end: docking tab", tabId, "into window", targetWin.waveWindowId, "at", index);
        await moveTabToWindow(srcWin, tabId, targetWin, index);
        return;
    }
    if ((await getWindowTabCount(srcWin)) <= 1) {
        console.log("tab-drag-end: not tearing off the only tab of window", srcWin.waveWindowId);
        return;
    }
    console.log("tab-drag-end: tearing off tab", tabId, "at", point);
    await popOutTab(srcWin, tabId, { x: point.x - TearOffWindowOffset.x, y: point.y - TearOffWindowOffset.y });
}

export function initDragDropHandlers() {
    ipcMain.on("tab-drag-end", (event, tabId: string) => {
        fireAndForget(async () => {
            const srcWin = getWaveWindowByWebContentsId(event.sender.id);
            if (!(await senderWindowOwnsTab(srcWin, tabId))) {
                console.log("tab-drag-end: tab is not shown in the sender window", tabId, srcWin?.waveWindowId);
                return;
            }
            await handleTabDragEnd(srcWin, tabId);
        });
    });

    ipcMain.on("drop-query-result", (event, reqId: string, result: DropQueryResult) => {
        const pending = pendingDropQueries.get(reqId);
        if (pending == null || pending.webContentsId !== event.sender.id) {
            return;
        }
        const area = result?.area;
        if (area !== "tabbar" && area !== "content" && area !== "none") {
            pending.resolve({ area: "content" });
            return;
        }
        const tabIndex = Number.isInteger(result.tabIndex) && result.tabIndex >= 0 ? result.tabIndex : undefined;
        pending.resolve({ area, tabIndex });
    });
}
