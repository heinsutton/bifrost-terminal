// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockService, ObjectService, WindowService } from "@/app/store/services";
import { DropQueryResult, pickDropWindow, pointInRect, toClientPoint } from "@/util/tabdragutil";
import { fireAndForget } from "@/util/util";
import { BrowserWindow, ipcMain, screen, webContents } from "electron";
import {
    getTabOwnerWindowId,
    getWaveWindowById,
    getWaveWindowByWebContentsId,
    getWaveWindowsByFocusRecency,
    getWindowTabCount,
    moveTabToWindow,
    popOutTab,
    senderWindowOwnsTab,
    showMovedPane,
    WaveBrowserWindow,
} from "./emain-window";

const PaneDropSides = ["left", "right", "top", "bottom"];

const DropQueryTimeoutMs = 300;
const DragFeedbackTickMs = 16;
// hover hints are sent every other tick (~30 Hz)
const DragHoverEveryTicks = 2;
const GhostSize = { width: 240, height: 40 };
const GhostCursorOffset = { x: 14, y: 10 };
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

// the realm window (other than the source) under the point, or null for the desktop / another realm
function findDropTargetWindow(srcWin: WaveBrowserWindow, point: Electron.Point): WaveBrowserWindow {
    const candidates = getWaveWindowsByFocusRecency()
        .filter((ww) => ww !== srcWin && !ww.isDestroyed())
        .map((ww) => ({ id: ww.waveWindowId, bounds: ww.getBounds(), visible: ww.isVisible() && !ww.isMinimized() }));
    const targetWin = getWaveWindowById(pickDropWindow(point, candidates));
    if (targetWin == null || targetWin.workspaceId !== srcWin.workspaceId) {
        return null;
    }
    return targetWin;
}

type TabDragFeedback = {
    srcWin: WaveBrowserWindow;
    tabId: string;
    webContentsId: number;
    ghost: BrowserWindow;
    timer: NodeJS.Timeout;
    tick: number;
    hoverWin: WaveBrowserWindow;
    hoverWebContentsId: number; // the tab view that shows the drop hint
};

// the drag currently shown outside its tab bar (ghost chip + drop hints); one at a time
let activeFeedback: TabDragFeedback = null;
// bumped on every feedback start/stop request; a start that finishes its awaits after a newer
// request (e.g. the drag already ended) is dropped instead of leaving a ghost nothing stops
let feedbackGeneration = 0;

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function makeGhostHtml(tabName: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:transparent;overflow:hidden;font-family:system-ui,'Segoe UI',sans-serif;">
<div style="display:inline-flex;align-items:center;gap:8px;height:30px;max-width:${GhostSize.width - 8}px;padding:0 12px;box-sizing:border-box;margin:2px;background:#171b26;border:1px solid rgba(94,243,214,0.5);border-radius:6px;color:#e2ecf5;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.45);">
<span style="flex:none;width:8px;height:8px;border-radius:2px;background:#5ef3d6;"></span>
<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(tabName)}</span>
</div></body></html>`;
}

// a frameless, transparent, click-through window that never takes focus; it only shows the chip
function createGhostWindow(tabName: string): BrowserWindow {
    const ghost = new BrowserWindow({
        width: GhostSize.width,
        height: GhostSize.height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        show: false,
        webPreferences: { javascript: false, sandbox: true },
    });
    ghost.setIgnoreMouseEvents(true);
    ghost.webContents.once("did-finish-load", () => {
        if (!ghost.isDestroyed() && activeFeedback?.ghost === ghost) {
            ghost.showInactive();
        }
    });
    fireAndForget(() => ghost.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(makeGhostHtml(tabName))));
    return ghost;
}

function clearDragHover(webContentsId: number) {
    const wc = webContentsId != null ? webContents.fromId(webContentsId) : null;
    if (wc != null && !wc.isDestroyed()) {
        wc.send("drag-hover", null, null);
    }
}

// returns the webContents id that now shows the hint (null if none)
function sendDragHover(ww: WaveBrowserWindow, screenPoint: Electron.Point): number {
    const wc = ww?.activeTabView?.webContents;
    if (ww == null || ww.isDestroyed() || wc == null || wc.isDestroyed()) {
        return null;
    }
    const clientPoint = toClientPoint(screenPoint, ww.getContentBounds(), wc.getZoomFactor());
    wc.send("drag-hover", clientPoint.x, clientPoint.y);
    return wc.id;
}

function tickTabDragFeedback() {
    const feedback = activeFeedback;
    if (feedback == null) {
        return;
    }
    const srcWc = webContents.fromId(feedback.webContentsId);
    if (feedback.srcWin.isDestroyed() || srcWc == null || srcWc.isDestroyed()) {
        // the source tab view crashed or was destroyed: no end message will come
        stopTabDragFeedback();
        return;
    }
    const point = screen.getCursorScreenPoint();
    if (!feedback.ghost.isDestroyed()) {
        feedback.ghost.setPosition(
            Math.round(point.x + GhostCursorOffset.x),
            Math.round(point.y + GhostCursorOffset.y)
        );
    }
    feedback.tick++;
    if (feedback.tick % DragHoverEveryTicks !== 0) {
        return;
    }
    const hoverWin = pointInRect(point, feedback.srcWin.getBounds())
        ? null
        : findDropTargetWindow(feedback.srcWin, point);
    feedback.hoverWin = hoverWin;
    const hoverWebContentsId = sendDragHover(hoverWin, point);
    if (hoverWebContentsId !== feedback.hoverWebContentsId) {
        // left that window, or it switched to another tab view
        clearDragHover(feedback.hoverWebContentsId);
        feedback.hoverWebContentsId = hoverWebContentsId;
    }
}

async function startTabDragFeedback(srcWin: WaveBrowserWindow, tabId: string, webContentsId: number) {
    const generation = ++feedbackGeneration;
    if (activeFeedback?.tabId === tabId && activeFeedback.webContentsId === webContentsId) {
        return;
    }
    stopTabDragFeedback();
    if (!(await senderWindowOwnsTab(srcWin, tabId))) {
        console.log("tab-drag-feedback: tab is not shown in the sender window", tabId, srcWin?.waveWindowId);
        return;
    }
    let tabName = "";
    try {
        tabName = ((await ObjectService.GetObject("tab:" + tabId)) as Tab)?.name ?? "";
    } catch (e) {
        console.log("tab drag feedback: error getting tab name", tabId, e);
    }
    if (generation !== feedbackGeneration || activeFeedback != null || srcWin.isDestroyed()) {
        return;
    }
    activeFeedback = {
        srcWin,
        tabId,
        webContentsId,
        ghost: createGhostWindow(tabName || "Tab"),
        timer: setInterval(tickTabDragFeedback, DragFeedbackTickMs),
        tick: 0,
        hoverWin: null,
        hoverWebContentsId: null,
    };
    tickTabDragFeedback();
}

// destroys the ghost window too: a hidden BrowserWindow would keep window-all-closed from firing
function stopTabDragFeedback() {
    const feedback = activeFeedback;
    if (feedback == null) {
        return;
    }
    activeFeedback = null;
    clearInterval(feedback.timer);
    clearDragHover(feedback.hoverWebContentsId);
    if (!feedback.ghost.isDestroyed()) {
        feedback.ghost.destroy();
    }
}

// the sender's drag returned to its bar or ended: cancel a start still in flight and stop the feedback.
// Only the sender's own drag is affected (another view's message never stops it).
function endTabDragFeedback(senderWebContentsId: number) {
    if (activeFeedback != null && activeFeedback.webContentsId !== senderWebContentsId) {
        return;
    }
    feedbackGeneration++;
    stopTabDragFeedback();
}

// a tab was released outside its own tab bar: dock it in the realm window under the cursor
// (at the tab bar position, or at the end when dropped on content), or tear it off into a new
// popped-out window at the cursor. Dropping back on the source window does nothing.
async function handleTabDragEnd(srcWin: WaveBrowserWindow, tabId: string) {
    const point = screen.getCursorScreenPoint();
    if (pointInRect(point, srcWin.getBounds())) {
        return;
    }
    const targetWin = findDropTargetWindow(srcWin, point);
    if (targetWin != null) {
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

// a pane dragged from another window of the realm was dropped on targetWin: move it into destTabId
// (null = a new tab in targetWin), split next to targetBlockId on side when given, then close an
// emptied source tab and bring targetWin to the front
async function handlePaneDrop(
    targetWin: WaveBrowserWindow,
    blockId: string,
    destTabId: string,
    targetBlockId: string,
    side: string
) {
    const block = (await ObjectService.GetObject("block:" + blockId)) as Block;
    const srcTabId = block?.parentoref?.startsWith("tab:") ? block.parentoref.substring(4) : null;
    const srcWindowId = srcTabId != null ? await getTabOwnerWindowId(targetWin.workspaceId, srcTabId) : null;
    const srcWin = getWaveWindowById(srcWindowId);
    if (srcWin == null || srcWin === targetWin) {
        console.log("pane-drop: pane is not in another window of the sender's realm", blockId);
        return;
    }
    if (destTabId != null && !(await senderWindowOwnsTab(targetWin, destTabId))) {
        console.log("pane-drop: destination tab is not shown in the sender window", destTabId);
        return;
    }
    const srcTab = (await ObjectService.GetObject("tab:" + srcTabId)) as Tab;
    const isSolePane = (srcTab?.blockids?.length ?? 0) <= 1;
    if (isSolePane && !srcWin.isPopOut && (await getWindowTabCount(srcWin)) <= 1) {
        console.log("pane-drop: the main window keeps its only tab's only pane", blockId);
        return;
    }
    const dropSide = PaneDropSides.includes(side) && targetBlockId ? side : "";
    let rtn: MoveBlockRtn;
    if (destTabId == null) {
        rtn = await BlockService.MoveBlockToTab(blockId, "");
        await WindowService.MoveTabToWindow(rtn.desttabid, targetWin.waveWindowId, -1);
    } else {
        rtn = await BlockService.MoveBlockToTabAt(blockId, destTabId, dropSide ? targetBlockId : "", dropSide);
    }
    await showMovedPane(srcWin, rtn.desttabid, rtn.sourcetabempty ? rtn.sourcetabid : null);
}

export function initDragDropHandlers() {
    ipcMain.on("pane-drop", (event, blockId: string, destTabId: string, targetBlockId: string, side: string) => {
        fireAndForget(async () => {
            const targetWin = getWaveWindowByWebContentsId(event.sender.id);
            if (targetWin == null || !blockId) {
                return;
            }
            try {
                await handlePaneDrop(targetWin, blockId, destTabId || null, targetBlockId || null, side || null);
            } catch (e) {
                console.log("pane-drop: error moving pane", blockId, e);
            }
        });
    });

    // the source renderer reports when a tab drag leaves its tab bar (outside=true) and when it comes back or ends
    ipcMain.on("tab-drag-feedback", (event, tabId: string, outside: boolean) => {
        if (!outside) {
            endTabDragFeedback(event.sender.id);
            return;
        }
        const srcWin = getWaveWindowByWebContentsId(event.sender.id);
        fireAndForget(() => startTabDragFeedback(srcWin, tabId, event.sender.id));
    });

    ipcMain.on("tab-drag-end", (event, tabId: string) => {
        endTabDragFeedback(event.sender.id);
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
