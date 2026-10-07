// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientService, ObjectService, WindowService, WorkspaceService } from "@/app/store/services";
import { getWindowTabIds } from "@/app/store/windowtabs";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { fireAndForget } from "@/util/util";
import { BaseWindow, BaseWindowConstructorOptions, dialog, globalShortcut, ipcMain, screen, webContents } from "electron";
import { globalEvents } from "emain/emain-events";
import path from "path";
import { debounce } from "throttle-debounce";
import {
    getGlobalIsQuitting,
    getGlobalIsRelaunching,
    setGlobalIsRelaunching,
    setWasActive,
    setWasInFg,
} from "./emain-activity";
import { log } from "./emain-log";
import { getElectronAppBasePath, isDev, unamePlatform } from "./emain-platform";
import { getOrCreateWebViewForTab, getWaveTabViewByWebContentsId, WaveTabView } from "./emain-tabview";
import { delay, ensureBoundsAreVisible, waveKeyToElectronKey } from "./emain-util";
import { ElectronWshClient } from "./emain-wsh";
import { updater } from "./updater";

const DevInitDiagnosticMs = 5000;
const TabHandoverTimeoutMs = 5000;

export type WindowOpts = {
    unamePlatform: NodeJS.Platform;
    isPrimaryStartupWindow?: boolean;
    foregroundWindow?: boolean;
};

export const MinWindowWidth = 800;
export const MinWindowHeight = 500;

export function calculateWindowBounds(
    winSize?: { width?: number; height?: number },
    pos?: { x?: number; y?: number },
    settings?: any
): { x: number; y: number; width: number; height: number } {
    let winWidth = winSize?.width;
    let winHeight = winSize?.height;
    const winPosX = pos?.x ?? 100;
    const winPosY = pos?.y ?? 100;

    if (
        (winWidth == null || winWidth === 0 || winHeight == null || winHeight === 0) &&
        settings?.["window:dimensions"]
    ) {
        const dimensions = settings["window:dimensions"];
        const match = dimensions.match(/^(\d+)[xX](\d+)$/);

        if (match) {
            const [, dimensionWidth, dimensionHeight] = match;
            const parsedWidth = parseInt(dimensionWidth, 10);
            const parsedHeight = parseInt(dimensionHeight, 10);

            if ((!winWidth || winWidth === 0) && Number.isFinite(parsedWidth) && parsedWidth > 0) {
                winWidth = parsedWidth;
            }
            if ((!winHeight || winHeight === 0) && Number.isFinite(parsedHeight) && parsedHeight > 0) {
                winHeight = parsedHeight;
            }
        } else {
            console.warn('Invalid window:dimensions format. Expected "widthxheight".');
        }
    }

    if (winWidth == null || winWidth == 0) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width } = primaryDisplay.workAreaSize;
        winWidth = width - winPosX - 100;
        if (winWidth > 2000) {
            winWidth = 2000;
        }
    }
    if (winHeight == null || winHeight == 0) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { height } = primaryDisplay.workAreaSize;
        winHeight = height - winPosY - 100;
        if (winHeight > 1200) {
            winHeight = 1200;
        }
    }

    winWidth = Math.max(winWidth, MinWindowWidth);
    winHeight = Math.max(winHeight, MinWindowHeight);

    const winBounds = {
        x: winPosX,
        y: winPosY,
        width: winWidth,
        height: winHeight,
    };
    return ensureBoundsAreVisible(winBounds);
}

export const waveWindowMap = new Map<string, WaveBrowserWindow>(); // waveWindowId -> WaveBrowserWindow

// on blur we do not set this to null (but on destroy we do), so this tracks the *last* focused window
// e.g. it persists when the app itself is not focused
export let focusedWaveWindow: WaveBrowserWindow = null;

// quake window for toggle hotkey (show/hide behavior)
let quakeWindow: WaveBrowserWindow | null = null;

export function getQuakeWindow(): WaveBrowserWindow | null {
    return quakeWindow;
}

let cachedClientId: string = null;
let hasCompletedFirstRelaunch = false;

async function getClientId() {
    if (cachedClientId != null) {
        return cachedClientId;
    }
    const clientData = await ClientService.GetClientData();
    cachedClientId = clientData?.oid;
    return cachedClientId;
}

type WindowActionQueueEntry =
    | {
          op: "switchtab";
          tabId: string;
          setInBackend: boolean;
          primaryStartupTab?: boolean;
          noFocus?: boolean; // don't focus the tab's webContents (that would raise this window on Windows)
      }
    | {
          op: "createtab";
      }
    | {
          op: "closetab";
          tabId: string;
          noFocus?: boolean; // don't focus the next active tab (another window is being brought to the front)
      }
    | {
          op: "switchworkspace";
          workspaceId: string;
      };

function isNonEmptyUnsavedWorkspace(workspace: Workspace): boolean {
    return !workspace.name && !workspace.icon && workspace.tabids?.length > 1;
}

export class WaveBrowserWindow extends BaseWindow {
    waveWindowId: string;
    workspaceId: string;
    isPopOut: boolean; // a popped-out window shows some tabs of its main window's workspace; never changes
    handoverOutTabIds: Set<string>; // tabs this window is handing over to another window (its views stay until the target is ready)
    allLoadedTabViews: Map<string, WaveTabView>;
    activeTabView: WaveTabView;
    private canClose: boolean;
    private deleteAllowed: boolean;
    private actionQueue: WindowActionQueueEntry[];

    constructor(waveWindow: WaveWindow, fullConfig: FullConfigType, opts: WindowOpts) {
        const settings = fullConfig?.settings;

        console.log("create win", waveWindow.oid);
        const winBounds = calculateWindowBounds(waveWindow.winsize, waveWindow.pos, settings);
        const winOpts: BaseWindowConstructorOptions = {
            x: winBounds.x,
            y: winBounds.y,
            width: winBounds.width,
            height: winBounds.height,
            minWidth: MinWindowWidth,
            minHeight: MinWindowHeight,
            show: false,
        };

        const isTransparent = settings?.["window:transparent"] ?? false;
        const isBlur = !isTransparent && (settings?.["window:blur"] ?? false);

        if (opts.unamePlatform === "darwin") {
            winOpts.titleBarStyle = "hiddenInset";
            winOpts.titleBarOverlay = false;
            winOpts.autoHideMenuBar = !settings?.["window:showmenubar"];
            winOpts.acceptFirstMouse = true;
            if (isTransparent) {
                winOpts.transparent = true;
            } else if (isBlur) {
                winOpts.vibrancy = "fullscreen-ui";
            } else {
                winOpts.backgroundColor = "#0e1117";
            }
        } else if (opts.unamePlatform === "linux") {
            winOpts.titleBarStyle = settings["window:nativetitlebar"] ? "default" : "hidden";
            winOpts.titleBarOverlay = {
                symbolColor: "white",
                color: "#00000000",
            };
            winOpts.icon = path.join(getElectronAppBasePath(), "public/logos/bifrost-icon.png");
            winOpts.autoHideMenuBar = !settings?.["window:showmenubar"];
            if (isTransparent) {
                winOpts.transparent = true;
            } else {
                winOpts.backgroundColor = "#0e1117";
            }
        } else if (opts.unamePlatform === "win32") {
            winOpts.titleBarStyle = "hidden";
            winOpts.titleBarOverlay = {
                color: "#0e1117",
                symbolColor: "#c3c8c2",
                height: 32,
            };
            winOpts.icon = path.join(getElectronAppBasePath(), "public/logos/bifrost-icon.png");
            if (isTransparent) {
                winOpts.transparent = true;
            } else if (isBlur) {
                winOpts.backgroundMaterial = "acrylic";
            } else {
                winOpts.backgroundColor = "#0e1117";
            }
        }

        super(winOpts);

        if (opts.unamePlatform === "win32") {
            this.setMenu(null);
        }

        const fullscreenOnLaunch = fullConfig?.settings["window:fullscreenonlaunch"];
        if (fullscreenOnLaunch && opts.foregroundWindow) {
            this.once("show", () => {
                this.setFullScreen(true);
            });
        }
        this.actionQueue = [];
        this.waveWindowId = waveWindow.oid;
        this.workspaceId = waveWindow.workspaceid;
        this.isPopOut = waveWindow.ispopout ?? false;
        this.handoverOutTabIds = new Set<string>();
        this.allLoadedTabViews = new Map<string, WaveTabView>();
        const winBoundsPoller = setInterval(() => {
            if (this.isDestroyed()) {
                clearInterval(winBoundsPoller);
                return;
            }
            if (this.actionQueue.length > 0) {
                return;
            }
            this.finalizePositioning();
        }, 1000);
        this.on(
            // @ts-expect-error -- "resize" event with debounce handler not in Electron type definitions
            "resize",
            debounce(400, (e) => this.mainResizeHandler(e))
        );
        this.on("resize", () => {
            if (this.isDestroyed()) {
                return;
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on(
            // @ts-expect-error -- "move" event with debounce handler not in Electron type definitions
            "move",
            debounce(400, (e) => this.mainResizeHandler(e))
        );
        this.on("enter-full-screen", async () => {
            if (this.isDestroyed()) {
                return;
            }
            console.log("enter-full-screen event", this.getContentBounds());
            const tabView = this.activeTabView;
            if (tabView) {
                tabView.webContents.send("fullscreen-change", true);
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on("leave-full-screen", async () => {
            if (this.isDestroyed()) {
                return;
            }
            const tabView = this.activeTabView;
            if (tabView) {
                tabView.webContents.send("fullscreen-change", false);
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on("focus", () => {
            if (this.isDestroyed()) {
                return;
            }
            if (getGlobalIsRelaunching()) {
                return;
            }
            focusedWaveWindow = this; // eslint-disable-line @typescript-eslint/no-this-alias
            noteWindowFocused(this.waveWindowId);
            console.log("focus win", this.waveWindowId);
            fireAndForget(() => ClientService.FocusWindow(this.waveWindowId));
            setWasInFg(true);
            setWasActive(true);
            setTimeout(() => globalEvents.emit("windows-updated"), 50);
        });
        this.on("blur", () => {
            setTimeout(() => globalEvents.emit("windows-updated"), 50);
        });
        this.on("close", (e) => {
            if (this.canClose) {
                return;
            }
            if (this.isDestroyed()) {
                return;
            }
            this.closeAllDevTools();
            console.log("win 'close' handler fired", this.waveWindowId);
            if (getGlobalIsQuitting() || updater?.status == "installing" || getGlobalIsRelaunching()) {
                return;
            }
            e.preventDefault();
            if (this.isPopOut) {
                // the backend returns a popped-out window's tabs to the main window, so no confirm is needed
                this.deleteAllowed = true;
                this.canClose = true;
                setTimeout(() => {
                    if (!this.isDestroyed()) {
                        this.close();
                    }
                }, 0);
                return;
            }
            fireAndForget(async () => {
                const numWindows = getAllWaveWindows().filter((ww) => !ww.isPopOut).length;
                const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
                if (numWindows > 1 || !fullConfig.settings["window:savelastwindow"]) {
                    if (fullConfig.settings["window:confirmclose"]) {
                        const workspace = await WorkspaceService.GetWorkspace(this.workspaceId);
                        if (isNonEmptyUnsavedWorkspace(workspace)) {
                            const choice = dialog.showMessageBoxSync(this, {
                                type: "question",
                                buttons: ["Cancel", "Close Window"],
                                title: "Confirm",
                                message:
                                    "Window has unsaved tabs, closing window will delete existing tabs.\n\nContinue?",
                            });
                            if (choice === 0) {
                                return;
                            }
                        }
                    }
                    this.deleteAllowed = true;
                }
                for (const popOutWin of getPopOutWaveWindows(this.workspaceId)) {
                    popOutWin.destroy();
                }
                this.canClose = true;
                this.close();
            });
        });
        this.on("closed", () => {
            console.log("win 'closed' handler fired", this.waveWindowId);
            if (getGlobalIsQuitting() || updater?.status == "installing") {
                console.log("win quitting or updating", this.waveWindowId);
                return;
            }
            setTimeout(() => globalEvents.emit("windows-updated"), 50);
            waveWindowMap.delete(this.waveWindowId);
            forgetWindowFocus(this.waveWindowId);
            if (focusedWaveWindow == this) {
                focusedWaveWindow = null;
            }
            if (quakeWindow == this) {
                quakeWindow = null;
            }
            this.removeAllChildViews();
            if (getGlobalIsRelaunching()) {
                console.log("win relaunching", this.waveWindowId);
                this.destroy();
                return;
            }
            if (this.deleteAllowed) {
                console.log("win removing window from backend DB", this.waveWindowId);
                fireAndForget(() => WindowService.CloseWindow(this.waveWindowId, true));
            }
        });
        waveWindowMap.set(waveWindow.oid, this);
        setTimeout(() => globalEvents.emit("windows-updated"), 50);
    }

    private closeAllDevTools() {
        for (const tabView of this.allLoadedTabViews.values()) {
            if (tabView.webContents?.isDevToolsOpened()) {
                tabView.webContents.closeDevTools();
            }
        }
        const tabViewIds = new Set(
            [...this.allLoadedTabViews.values()].map((tv) => tv.webContents?.id).filter((id) => id != null)
        );
        for (const wc of webContents.getAllWebContents()) {
            if (wc.getType() === "webview" && tabViewIds.has(wc.hostWebContents?.id)) {
                if (wc.isDevToolsOpened()) {
                    wc.closeDevTools();
                }
            }
        }
    }

    private removeAllChildViews() {
        for (const tabView of this.allLoadedTabViews.values()) {
            if (!this.isDestroyed()) {
                this.contentView.removeChildView(tabView);
            }
            tabView?.destroy();
        }
    }

    async switchWorkspace(workspaceId: string) {
        console.log("switchWorkspace", workspaceId, this.waveWindowId);
        if (this.isPopOut) {
            const mainWin = getMainWaveWindowByWorkspaceId(this.workspaceId);
            console.log("switchWorkspace from popped-out window, delegating to main window", mainWin?.waveWindowId);
            mainWin?.focus();
            await mainWin?.switchWorkspace(workspaceId);
            return;
        }
        if (workspaceId == this.workspaceId) {
            console.log("switchWorkspace already on this workspace", this.waveWindowId);
            return;
        }

        // If the workspace is already owned by a window, then we can just call SwitchWorkspace without first prompting the user, since it'll just focus to the other window.
        const workspaceList = await WorkspaceService.ListWorkspaces();
        if (!workspaceList?.find((wse) => wse.workspaceid === workspaceId)?.windowid) {
            const curWorkspace = await WorkspaceService.GetWorkspace(this.workspaceId);

            if (curWorkspace && isNonEmptyUnsavedWorkspace(curWorkspace)) {
                console.log(
                    `existing unsaved workspace ${this.workspaceId} has content, opening workspace ${workspaceId} in new window`
                );
                await createWindowForWorkspace(workspaceId);
                return;
            }
        }
        await this._queueActionInternal({ op: "switchworkspace", workspaceId });
    }

    async setActiveTab(tabId: string, setInBackend: boolean, primaryStartupTab = false, noFocus = false) {
        console.log(
            "setActiveTab",
            tabId,
            this.waveWindowId,
            this.workspaceId,
            setInBackend,
            primaryStartupTab ? "(primary startup)" : ""
        );
        await this._queueActionInternal({ op: "switchtab", tabId, setInBackend, primaryStartupTab, noFocus });
    }

    private async initializeTab(tabView: WaveTabView, primaryStartupTab: boolean) {
        const clientId = await getClientId();
        await this.awaitWithDevDiagnostics(tabView.initPromise, "initPromise", tabView);
        const winBounds = this.getContentBounds();
        tabView.setBounds({ x: 0, y: 0, width: winBounds.width, height: winBounds.height });
        this.contentView.addChildView(tabView);
        const initOpts: WaveInitOpts = {
            tabId: tabView.waveTabId,
            clientId: clientId,
            windowId: this.waveWindowId,
            activate: true,
            isPopOut: this.isPopOut,
        };
        if (primaryStartupTab) {
            initOpts.primaryTabStartup = true;
        }
        tabView.savedInitOpts = { ...initOpts };
        tabView.savedInitOpts.activate = false;
        delete tabView.savedInitOpts.primaryTabStartup;
        const startTime = Date.now();
        console.log(
            "before wave ready, init tab, sending wave-init",
            tabView.waveTabId,
            primaryStartupTab ? "(primary startup)" : ""
        );
        tabView.webContents.send("wave-init", initOpts);
        await this.awaitWithDevDiagnostics(tabView.waveReadyPromise, "waveReadyPromise", tabView);
        console.log("wave-ready init time", Date.now() - startTime + "ms");
    }

    private async awaitWithDevDiagnostics<T>(promise: Promise<T>, name: string, tabView: WaveTabView): Promise<T> {
        if (!isDev) {
            return promise;
        }
        const wc = tabView.webContents;
        if (this.isDestroyed() || tabView.isDestroyed || wc.isDestroyed()) {
            throw new Error(`[dev] ${name} aborted for destroyed tab/window ${tabView.waveTabId}`);
        }
        let rejectWait: (error: Error) => void;
        const lifecyclePromise = new Promise<never>((_, reject) => {
            rejectWait = reject;
        });
        const onClosed = () =>
            rejectWait(new Error(`[dev] ${name} aborted: window closed for tab ${tabView.waveTabId}`));
        const onDestroyed = () => rejectWait(new Error(`[dev] ${name} aborted: tab ${tabView.waveTabId} destroyed`));
        const onRenderProcessGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) =>
            rejectWait(new Error(`[dev] ${name} aborted: renderer ${details.reason} for tab ${tabView.waveTabId}`));
        this.once("closed", onClosed);
        wc.once("destroyed", onDestroyed);
        wc.once("render-process-gone", onRenderProcessGone);
        // Slow dev-server loads can still complete; the diagnostic threshold must not abandon wave-init.
        const diagnosticHandle = setTimeout(() => {
            console.log(
                `[dev] ${name} still pending after ${DevInitDiagnosticMs}ms for tab ${tabView.waveTabId}, showing window for devtools; continuing to wait`
            );
            if (this.isDestroyed() || tabView.isDestroyed || wc.isDestroyed()) {
                return;
            }
            if (!this.isVisible()) {
                this.show();
            }
            if (!wc.isDevToolsOpened()) {
                wc.openDevTools();
            }
        }, DevInitDiagnosticMs);
        try {
            return await Promise.race([promise, lifecyclePromise]);
        } finally {
            clearTimeout(diagnosticHandle);
            this.removeListener("closed", onClosed);
            wc.removeListener("destroyed", onDestroyed);
            wc.removeListener("render-process-gone", onRenderProcessGone);
        }
    }

    private async setTabViewIntoWindow(
        tabView: WaveTabView,
        tabInitialized: boolean,
        primaryStartupTab = false,
        noFocus = false
    ) {
        if (this.activeTabView == tabView) {
            return;
        }
        const oldActiveView = this.activeTabView;
        tabView.isActiveTab = true;
        if (oldActiveView != null) {
            oldActiveView.isActiveTab = false;
        }
        this.activeTabView = tabView;
        this.allLoadedTabViews.set(tabView.waveTabId, tabView);
        if (!tabInitialized) {
            console.log("initializing a new tab", primaryStartupTab ? "(primary startup)" : "");
            await this.initializeTab(tabView, primaryStartupTab);
            this.finalizePositioning();
        } else {
            console.log("reusing an existing tab, calling wave-init", tabView.waveTabId);
            tabView.webContents.send("wave-init", tabView.savedInitOpts); // reinit
            this.finalizePositioning();
        }
        if (tabView.isWaveReady && this.activeTabView == tabView) {
            notifyTabReady(this.waveWindowId, tabView.waveTabId);
        }

        if (noFocus) {
            return;
        }
        // something is causing the new tab to lose focus so it requires manual refocusing
        tabView.webContents.focus();
        setTimeout(() => {
            if (tabView.webContents && this.activeTabView == tabView && !tabView.webContents.isFocused()) {
                tabView.webContents.focus();
            }
        }, 10);
        setTimeout(() => {
            if (tabView.webContents && this.activeTabView == tabView && !tabView.webContents.isFocused()) {
                tabView.webContents.focus();
            }
        }, 30);
    }

    private finalizePositioning() {
        if (this.isDestroyed()) {
            return;
        }
        const curBounds = this.getContentBounds();
        this.activeTabView?.positionTabOnScreen(curBounds);
        for (const tabView of this.allLoadedTabViews.values()) {
            if (tabView == this.activeTabView) {
                continue;
            }
            tabView?.positionTabOffScreen(curBounds);
        }
    }

    async queueCreateTab() {
        await this._queueActionInternal({ op: "createtab" });
    }

    async queueCloseTab(tabId: string, noFocus = false) {
        await this._queueActionInternal({ op: "closetab", tabId, noFocus });
    }

    private async _queueActionInternal(entry: WindowActionQueueEntry) {
        if (this.actionQueue.length >= 2) {
            this.actionQueue[1] = entry;
            return;
        }
        const wasEmpty = this.actionQueue.length === 0;
        this.actionQueue.push(entry);
        if (wasEmpty) {
            await this.processActionQueue();
        }
    }

    private removeTabViewLater(tabId: string, delayMs: number) {
        setTimeout(() => {
            this.removeTabView(tabId, false);
        }, delayMs);
    }

    // the queue and this function are used to serialize operations that update the window contents view
    // processActionQueue will replace [1] if it is already set
    // we don't mess with [0] because it is "in process"
    // we replace [1] because there is no point to run an action that is going to be overwritten
    private async processActionQueue() {
        while (this.actionQueue.length > 0) {
            try {
                if (this.isDestroyed()) {
                    break;
                }
                const entry = this.actionQueue[0];
                let tabId: string = null;
                // have to use "===" here to get the typechecker to work :/
                switch (entry.op) {
                    case "createtab":
                        if (this.isPopOut) {
                            tabId = await WindowService.CreateTabInWindow(this.waveWindowId);
                        } else {
                            tabId = await WorkspaceService.CreateTab(this.workspaceId, null, true);
                        }
                        break;
                    case "switchtab": {
                        tabId = entry.tabId;
                        if (this.activeTabView?.waveTabId == tabId) {
                            continue;
                        }
                        const ownerWin = await this.findOtherOwnerWindow(tabId);
                        if (ownerWin != null) {
                            console.log("switchtab: tab is shown in another window", tabId, ownerWin.waveWindowId);
                            ownerWin.focus();
                            fireAndForget(() => ownerWin.setActiveTab(tabId, entry.setInBackend));
                            continue;
                        }
                        if (entry.setInBackend) {
                            await WorkspaceService.SetActiveTab(this.workspaceId, tabId);
                        }
                        break;
                    }
                    case "closetab": {
                        tabId = entry.tabId;
                        const rtn = await WorkspaceService.CloseTab(this.workspaceId, tabId, true);
                        if (rtn == null) {
                            console.log(
                                "[error] closeTab: no return value",
                                tabId,
                                this.workspaceId,
                                this.waveWindowId
                            );
                            return;
                        }
                        this.removeTabViewLater(tabId, 1000);
                        if (rtn.closewindow) {
                            // the backend may already have closed a popped-out window (electron:closewindow)
                            if (!this.isDestroyed()) {
                                this.close();
                            }
                            return;
                        }
                        if (!rtn.newactivetabid) {
                            return;
                        }
                        tabId = rtn.newactivetabid;
                        break;
                    }
                    case "switchworkspace": {
                        const newWs = await WindowService.SwitchWorkspace(this.waveWindowId, entry.workspaceId);
                        if (!newWs) {
                            return;
                        }
                        console.log("processActionQueue switchworkspace newWs", newWs);
                        this.removeAllChildViews();
                        console.log("destroyed all tabs", this.waveWindowId);
                        this.workspaceId = entry.workspaceId;
                        this.allLoadedTabViews = new Map();
                        tabId = newWs.activetabid;
                        break;
                    }
                }
                if (tabId == null) {
                    return;
                }
                const [tabView, tabInitialized] = await getOrCreateWebViewForTab(this.waveWindowId, tabId);
                const primaryStartupTabFlag = entry.op === "switchtab" ? (entry.primaryStartupTab ?? false) : false;
                const noFocusFlag =
                    entry.op === "switchtab" || entry.op === "closetab" ? (entry.noFocus ?? false) : false;
                await this.setTabViewIntoWindow(tabView, tabInitialized, primaryStartupTabFlag, noFocusFlag);
            } catch (e) {
                console.log("error caught in processActionQueue", e);
            } finally {
                this.actionQueue.shift();
            }
        }
    }

    private async mainResizeHandler(_: any) {
        if (this == null || this.isDestroyed() || this.fullScreen) {
            return;
        }
        const bounds = this.getBounds();
        try {
            await WindowService.SetWindowPosAndSize(
                this.waveWindowId,
                { x: bounds.x, y: bounds.y },
                { width: bounds.width, height: bounds.height }
            );
        } catch (e) {
            console.log("error sending new window bounds to backend", e);
        }
    }

    removeTabView(tabId: string, force: boolean) {
        if (!force && this.activeTabView?.waveTabId == tabId) {
            console.log("cannot remove active tab", tabId, this.waveWindowId);
            return;
        }
        const tabView = this.allLoadedTabViews.get(tabId);
        if (tabView == null) {
            console.log("removeTabView -- tabView not found", tabId, this.waveWindowId);
            // the tab was never loaded, so just return
            return;
        }
        if (!this.isDestroyed()) {
            this.contentView.removeChildView(tabView);
        }
        this.allLoadedTabViews.delete(tabId);
        if (this.activeTabView == tabView) {
            this.activeTabView = null;
        }
        tabView.destroy();
    }

    // returns the other window of this realm that shows tabId, or null if this window owns it.
    // only asks the backend while the realm has popped-out windows.
    private async findOtherOwnerWindow(tabId: string): Promise<WaveBrowserWindow> {
        if (!this.isPopOut && getPopOutWaveWindows(this.workspaceId).length === 0) {
            return null;
        }
        const ownerWindowId = await getTabOwnerWindowId(this.workspaceId, tabId);
        if (ownerWindowId == null || ownerWindowId === this.waveWindowId) {
            return null;
        }
        return getWaveWindowById(ownerWindowId) ?? null;
    }

    // make-before-break: the source keeps its view of the tab (read-only) until the target window is ready
    beginTabHandoverOut(tabId: string) {
        this.handoverOutTabIds.add(tabId);
        this.sendTabHandoverState(tabId, "start");
    }

    // success: drop the source view; rollback: the source view takes the tab back
    endTabHandoverOut(tabId: string, rolledBack: boolean) {
        if (!this.handoverOutTabIds.delete(tabId)) {
            return;
        }
        if (rolledBack) {
            this.sendTabHandoverState(tabId, "rollback");
        }
    }

    private sendTabHandoverState(tabId: string, state: "start" | "rollback") {
        const tabView = this.allLoadedTabViews.get(tabId);
        if (tabView == null || tabView.isDestroyed || tabView.webContents?.isDestroyed()) {
            return;
        }
        tabView.webContents.send("tab-handover", state);
    }

    destroy() {
        console.log("destroy win", this.waveWindowId);
        this.deleteAllowed = true;
        super.destroy();
    }
}

// windowId:tabId -> resolvers waiting for that window to show the tab with a ready renderer
const tabReadyWaiters = new Map<string, ((ready: boolean) => void)[]>();

function makeTabReadyKey(windowId: string, tabId: string): string {
    return `${windowId}:${tabId}`;
}

function notifyTabReady(windowId: string, tabId: string) {
    const key = makeTabReadyKey(windowId, tabId);
    const waiters = tabReadyWaiters.get(key);
    if (waiters == null) {
        return;
    }
    tabReadyWaiters.delete(key);
    for (const resolve of waiters) {
        resolve(true);
    }
}

// resolves true once windowId shows tabId with a wave-ready renderer, false after timeoutMs.
// register before the window starts loading the tab.
function waitForTabReady(windowId: string, tabId: string, timeoutMs: number): Promise<boolean> {
    const ww = getWaveWindowById(windowId);
    if (ww?.activeTabView?.waveTabId === tabId && ww.activeTabView.isWaveReady) {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        const key = makeTabReadyKey(windowId, tabId);
        let done = false;
        const finish = (ready: boolean) => {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timeoutHandle);
            const waiters = tabReadyWaiters.get(key)?.filter((w) => w !== finish);
            if (waiters?.length) {
                tabReadyWaiters.set(key, waiters);
            } else {
                tabReadyWaiters.delete(key);
            }
            resolve(ready);
        };
        const timeoutHandle = setTimeout(() => finish(false), timeoutMs);
        tabReadyWaiters.set(key, [...(tabReadyWaiters.get(key) ?? []), finish]);
    });
}

// during a handover two windows hold a view of the tab; the one taking it over wins
export function getWaveWindowByTabId(tabId: string): WaveBrowserWindow {
    let handingOver: WaveBrowserWindow = null;
    for (const ww of waveWindowMap.values()) {
        if (!ww.allLoadedTabViews.has(tabId)) {
            continue;
        }
        if (!ww.handoverOutTabIds.has(tabId)) {
            return ww;
        }
        handingOver = ww;
    }
    return handingOver;
}

export function getWaveWindowByWebContentsId(webContentsId: number): WaveBrowserWindow {
    if (webContentsId == null) {
        return null;
    }
    const tabView = getWaveTabViewByWebContentsId(webContentsId);
    if (tabView == null) {
        return null;
    }
    return getWaveWindowById(tabView.waveWindowId) ?? getWaveWindowByTabId(tabView.waveTabId);
}

export function getWaveWindowById(windowId: string): WaveBrowserWindow {
    return waveWindowMap.get(windowId);
}

// the realm's main window; popped-out windows are never returned
export function getMainWaveWindowByWorkspaceId(workspaceId: string): WaveBrowserWindow {
    for (const waveWindow of waveWindowMap.values()) {
        if (waveWindow.workspaceId === workspaceId && !waveWindow.isPopOut) {
            return waveWindow;
        }
    }
}

// window ids, most recently focused first (Electron exposes no z-order)
const windowFocusOrder: string[] = [];

function noteWindowFocused(windowId: string) {
    forgetWindowFocus(windowId);
    windowFocusOrder.unshift(windowId);
}

function forgetWindowFocus(windowId: string) {
    const idx = windowFocusOrder.indexOf(windowId);
    if (idx !== -1) {
        windowFocusOrder.splice(idx, 1);
    }
}

// all windows, most recently focused first; never-focused windows last
export function getWaveWindowsByFocusRecency(): WaveBrowserWindow[] {
    const focused = windowFocusOrder.map((id) => waveWindowMap.get(id)).filter((ww) => ww != null);
    const others = getAllWaveWindows().filter((ww) => !windowFocusOrder.includes(ww.waveWindowId));
    return [...focused, ...others];
}

export function getPopOutWaveWindows(workspaceId: string): WaveBrowserWindow[] {
    return getAllWaveWindows().filter((ww) => ww.isPopOut && ww.workspaceId === workspaceId);
}

// returns the id of the window that shows tabId (a popped-out window or the realm's main window);
// null if the tab is not in the workspace
export async function getTabOwnerWindowId(workspaceId: string, tabId: string): Promise<string> {
    const workspace = await WorkspaceService.GetWorkspace(workspaceId);
    if (workspace == null || !workspace.tabids?.includes(tabId)) {
        return null;
    }
    const popOutWindowId = workspace.popouttabs?.[tabId];
    if (popOutWindowId) {
        return popOutWindowId;
    }
    return getMainWaveWindowByWorkspaceId(workspaceId)?.waveWindowId ?? null;
}

export async function senderWindowOwnsTab(ww: WaveBrowserWindow, tabId: string): Promise<boolean> {
    if (ww == null || !tabId) {
        return false;
    }
    const ownerWindowId = await getTabOwnerWindowId(ww.workspaceId, tabId);
    return ownerWindowId === ww.waveWindowId;
}

export function getAllWaveWindows(): WaveBrowserWindow[] {
    return Array.from(waveWindowMap.values());
}

export async function createWindowForWorkspace(workspaceId: string) {
    const newWin = await WindowService.CreateWindow(null, workspaceId);
    if (!newWin) {
        console.log("error creating new window", this.waveWindowId);
    }
    const newBwin = await createBrowserWindow(newWin, await RpcApi.GetFullConfigCommand(ElectronWshClient), {
        unamePlatform,
        isPrimaryStartupWindow: false,
    });
    newBwin.show();
}

// reopens the last used named realm if it still exists and no window shows it; otherwise a new blank realm
async function createWindowOnLastWorkspace(): Promise<WaveWindow> {
    const clientData = await ClientService.GetClientData();
    const lastWorkspaceId = clientData?.lastworkspaceid;
    if (lastWorkspaceId && getMainWaveWindowByWorkspaceId(lastWorkspaceId) == null) {
        try {
            const lastWorkspace = await WorkspaceService.GetWorkspace(lastWorkspaceId);
            if (lastWorkspace != null) {
                return await WindowService.CreateWindow(null, lastWorkspaceId);
            }
        } catch (e) {
            console.log("error reopening last workspace", lastWorkspaceId, e);
        }
    }
    return await WindowService.CreateWindow(null, "");
}

// note, this does not *show* the window.
// to show, await win.readyPromise and then win.show()
export async function createBrowserWindow(
    waveWindow: WaveWindow,
    fullConfig: FullConfigType,
    opts: WindowOpts
): Promise<WaveBrowserWindow> {
    if (!waveWindow) {
        console.log("createBrowserWindow: no waveWindow");
        waveWindow = await WindowService.CreateWindow(null, "");
    }
    let workspace = await WorkspaceService.GetWorkspace(waveWindow.workspaceid);
    if (!workspace) {
        console.log("createBrowserWindow: no workspace, creating new window");
        await WindowService.CloseWindow(waveWindow.oid, true);
        waveWindow = await createWindowOnLastWorkspace();
        workspace = await WorkspaceService.GetWorkspace(waveWindow.workspaceid);
    }
    console.log("createBrowserWindow", waveWindow.oid, workspace.oid, workspace);
    const bwin = new WaveBrowserWindow(waveWindow, fullConfig, opts);

    if (bwin.isPopOut) {
        bwin.setTitle(getPopOutWindowTitle(workspace));
        if (waveWindow.activetabid) {
            await bwin.setActiveTab(waveWindow.activetabid, false);
        }
    } else if (workspace.activetabid) {
        await bwin.setActiveTab(workspace.activetabid, false, opts.isPrimaryStartupWindow ?? false);
    }
    return bwin;
}

function getPopOutWindowTitle(workspace: Workspace): string {
    return `${workspace?.name || "Bifrost Terminal"} ↗`;
}

async function updatePopOutWindowTitles() {
    const workspaceIds = new Set(
        getAllWaveWindows()
            .filter((ww) => ww.isPopOut)
            .map((ww) => ww.workspaceId)
    );
    for (const workspaceId of workspaceIds) {
        const workspace = await WorkspaceService.GetWorkspace(workspaceId);
        for (const ww of getPopOutWaveWindows(workspaceId)) {
            if (!ww.isDestroyed()) {
                ww.setTitle(getPopOutWindowTitle(workspace));
            }
        }
    }
}

export function initPopOutWindowEventSubscriptions() {
    waveEventSubscribeSingle({
        eventType: "workspace:update",
        handler: () => fireAndForget(updatePopOutWindowTitles),
    });
}

// number of tabs the window shows
export async function getWindowTabCount(ww: WaveBrowserWindow): Promise<number> {
    const workspace = await WorkspaceService.GetWorkspace(ww.workspaceId);
    return getWindowTabIds(workspace, ww.waveWindowId, ww.isPopOut).length;
}

// index of tabId in the window's tab list (used to put a tab back on rollback)
async function getTabIndexInWindow(ww: WaveBrowserWindow, tabId: string): Promise<number> {
    const workspace = await WorkspaceService.GetWorkspace(ww.workspaceId);
    return getWindowTabIds(workspace, ww.waveWindowId, ww.isPopOut).indexOf(tabId);
}

// after the target is ready: the source drops its view, or closes when the tab was its last one
async function completeTabHandover(
    srcWin: WaveBrowserWindow,
    tabId: string,
    sourceNewActiveTabId: string,
    closeSource: boolean
) {
    srcWin.endTabHandoverOut(tabId, false);
    if (srcWin.isDestroyed()) {
        return;
    }
    if (closeSource) {
        // destroy() lets the closed handler call CloseWindow, which deletes the emptied popped-out window
        srcWin.removeTabView(tabId, true);
        srcWin.destroy();
        return;
    }
    if (sourceNewActiveTabId && srcWin.activeTabView?.waveTabId === tabId) {
        // not awaited (the next tab may still have to load) and no focus: the window taking the tab is
        // brought to the front right after, and focusing here would raise the source again
        fireAndForget(() => srcWin.setActiveTab(sourceNewActiveTabId, false, false, true));
    }
    srcWin.removeTabView(tabId, true);
}

// the target did not get ready in time: move the tab back to the source, which still has its view.
// returns false if the tab could not be moved back (it then stays in the target window).
async function rollbackTabHandover(
    srcWin: WaveBrowserWindow,
    tabId: string,
    srcIndex: number,
    prevSrcActiveTabId: string,
    targetWindowId: string
): Promise<boolean> {
    console.log("tab handover timed out, moving tab back", tabId, srcWin.waveWindowId, targetWindowId);
    let rtn: TabWindowMoveRtn = null;
    try {
        rtn = await WindowService.MoveTabToWindow(tabId, srcWin.waveWindowId, srcIndex);
    } catch (e) {
        console.log("error moving tab back after handover timeout", tabId, e);
    }
    if (rtn == null) {
        return false;
    }
    srcWin.endTabHandoverOut(tabId, true);
    const targetWin = getWaveWindowById(targetWindowId);
    if (rtn?.sourcewindowempty) {
        if (targetWin != null && !targetWin.isDestroyed()) {
            targetWin.destroy();
        } else {
            await WindowService.CloseWindow(targetWindowId, true);
        }
    } else if (targetWin != null && !targetWin.isDestroyed()) {
        if (rtn?.sourcenewactivetabid && targetWin.activeTabView?.waveTabId === tabId) {
            await targetWin.setActiveTab(rtn.sourcenewactivetabid, false);
        }
        targetWin.removeTabView(tabId, true);
    }
    if (srcWin.isDestroyed()) {
        return true;
    }
    if (prevSrcActiveTabId && prevSrcActiveTabId !== tabId) {
        await srcWin.setActiveTab(prevSrcActiveTabId, true);
    } else {
        await srcWin.setActiveTab(tabId, false);
    }
    return true;
}

type TabHandoverInfo = {
    srcWin: WaveBrowserWindow;
    tabId: string;
    srcIndex: number;
    prevSrcActiveTabId: string;
    targetWindowId: string;
    sourceNewActiveTabId: string;
    closeSource: boolean;
};

// after the target got ready (or timed out): complete, roll back, or (if the move-back failed)
// follow whatever window the backend now says owns the tab
async function finishTabHandover(
    info: TabHandoverInfo,
    ready: boolean,
    revealTarget: (target: WaveBrowserWindow) => void
) {
    const { srcWin, tabId } = info;
    if (!ready) {
        if (await rollbackTabHandover(srcWin, tabId, info.srcIndex, info.prevSrcActiveTabId, info.targetWindowId)) {
            return;
        }
        if (await resumeSourceIfOwner(srcWin, tabId)) {
            return;
        }
    }
    // source first, then bring the target to the front, so the target ends up in front and focused
    await completeTabHandover(srcWin, tabId, info.sourceNewActiveTabId, info.closeSource);
    const targetWin = getWaveWindowById(info.targetWindowId);
    if (targetWin != null && !targetWin.isDestroyed()) {
        revealTarget(targetWin);
    }
}

// after a failed move-back: the source resumes if the backend says it still owns the tab;
// returns false when another window owns it (the caller then completes the handover)
async function resumeSourceIfOwner(srcWin: WaveBrowserWindow, tabId: string): Promise<boolean> {
    let ownerWindowId: string = null;
    try {
        ownerWindowId = await getTabOwnerWindowId(srcWin.workspaceId, tabId);
    } catch (e) {
        console.log("error finding the owner of a handed-over tab", tabId, e);
    }
    if (ownerWindowId !== srcWin.waveWindowId) {
        return false;
    }
    srcWin.endTabHandoverOut(tabId, true);
    return true;
}

function bringWindowToFront(ww: WaveBrowserWindow) {
    if (!ww.isVisible()) {
        ww.show();
    }
    ww.focus();
    const wc = ww.activeTabView?.webContents;
    if (wc != null && !wc.isDestroyed()) {
        wc.focus();
    }
}

// moves a tab into a new popped-out window, make-before-break: the source keeps its view until the
// new window's renderer is ready, and gets the tab back if that takes longer than TabHandoverTimeoutMs
// pos: top-left of the new window (screen DIP); defaults to the source window offset by 40,40
export async function popOutTab(srcWin: WaveBrowserWindow, tabId: string, pos?: { x: number; y: number }) {
    if (srcWin.handoverOutTabIds.has(tabId)) {
        return;
    }
    const srcIndex = await getTabIndexInWindow(srcWin, tabId);
    const prevSrcActiveTabId = srcWin.activeTabView?.waveTabId;
    const bounds = srcWin.getBounds();
    srcWin.beginTabHandoverOut(tabId);
    try {
        let rtn: PopOutRtn = null;
        try {
            rtn = await WindowService.PopOutTab(tabId, pos ?? { x: bounds.x + 40, y: bounds.y + 40 }, {
                width: bounds.width,
                height: bounds.height,
            });
        } catch (e) {
            console.log("error popping out tab", tabId, e);
        }
        if (rtn == null) {
            return;
        }
        const newWindowId = rtn.window.oid;
        const readyPromise = waitForTabReady(newWindowId, tabId, TabHandoverTimeoutMs);
        let newWin: WaveBrowserWindow = null;
        try {
            const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
            const workspace = await WorkspaceService.GetWorkspace(rtn.window.workspaceid);
            // built directly (not via createBrowserWindow, which waits for the tab) so a rollback can destroy it
            newWin = new WaveBrowserWindow(rtn.window, fullConfig, { unamePlatform, isPrimaryStartupWindow: false });
            newWin.setTitle(getPopOutWindowTitle(workspace));
        } catch (e) {
            // the backend already gave the tab to the new window: move it back and delete that window
            console.log("error creating popped-out window", newWindowId, e);
            if (!(await rollbackTabHandover(srcWin, tabId, srcIndex, prevSrcActiveTabId, newWindowId))) {
                await WindowService.CloseWindow(newWindowId, true);
                if (!(await resumeSourceIfOwner(srcWin, tabId))) {
                    await completeTabHandover(srcWin, tabId, rtn.sourcenewactivetabid, false);
                }
            }
            return;
        }
        fireAndForget(() => newWin.setActiveTab(tabId, false));
        const ready = await readyPromise;
        const info: TabHandoverInfo = {
            srcWin,
            tabId,
            srcIndex,
            prevSrcActiveTabId,
            targetWindowId: newWindowId,
            sourceNewActiveTabId: rtn.sourcenewactivetabid,
            closeSource: false,
        };
        await finishTabHandover(info, ready, bringWindowToFront);
    } finally {
        // any path that did not complete the handover gives the tab back to the source view
        srcWin.endTabHandoverOut(tabId, true);
    }
}

// moves a tab to another window of the same realm, make-before-break (see popOutTab)
// index: position in the destination window's tab list (-1 = end)
export async function moveTabToWindow(
    srcWin: WaveBrowserWindow,
    tabId: string,
    destWin: WaveBrowserWindow,
    index = -1
) {
    if (destWin == null || destWin === srcWin || destWin.workspaceId !== srcWin.workspaceId) {
        console.log("moveTabToWindow: invalid destination window", tabId, destWin?.waveWindowId);
        return;
    }
    if (srcWin.handoverOutTabIds.has(tabId)) {
        return;
    }
    const srcIndex = await getTabIndexInWindow(srcWin, tabId);
    const prevSrcActiveTabId = srcWin.activeTabView?.waveTabId;
    srcWin.beginTabHandoverOut(tabId);
    try {
        let rtn: TabWindowMoveRtn = null;
        try {
            rtn = await WindowService.MoveTabToWindow(tabId, destWin.waveWindowId, index);
        } catch (e) {
            console.log("error moving tab to window", tabId, destWin.waveWindowId, e);
        }
        if (rtn == null) {
            return;
        }
        const readyPromise = waitForTabReady(destWin.waveWindowId, tabId, TabHandoverTimeoutMs);
        fireAndForget(() => destWin.setActiveTab(tabId, false));
        const ready = await readyPromise;
        const info: TabHandoverInfo = {
            srcWin,
            tabId,
            srcIndex,
            prevSrcActiveTabId,
            targetWindowId: destWin.waveWindowId,
            sourceNewActiveTabId: rtn.sourcenewactivetabid,
            closeSource: rtn.sourcewindowempty,
        };
        await finishTabHandover(info, ready, bringWindowToFront);
    } finally {
        // any path that did not complete the handover gives the tab back to the source view
        srcWin.endTabHandoverOut(tabId, true);
    }
}

ipcMain.on("popout-tab", (event, tabId: string) => {
    fireAndForget(async () => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        if (!(await senderWindowOwnsTab(ww, tabId))) {
            console.log("popout-tab: tab is not shown in the sender window", tabId, ww?.waveWindowId);
            return;
        }
        await popOutTab(ww, tabId);
    });
});

ipcMain.on("move-tab-to-window", (event, tabId: string, destWindowId: string) => {
    fireAndForget(async () => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        if (!(await senderWindowOwnsTab(ww, tabId))) {
            console.log("move-tab-to-window: tab is not shown in the sender window", tabId, ww?.waveWindowId);
            return;
        }
        const destWin = destWindowId ? getWaveWindowById(destWindowId) : getMainWaveWindowByWorkspaceId(ww.workspaceId);
        await moveTabToWindow(ww, tabId, destWin);
    });
});

// pane Pop Out: the pane moves into a new tab of a new popped-out window. Nothing else shows that tab,
// so there is no handover; the new window is brought to the front once its tab is ready (or after the timeout).
export async function popOutBlock(srcWin: WaveBrowserWindow, blockId: string) {
    const bounds = srcWin.getBounds();
    const rtn = await WindowService.PopOutBlock(
        blockId,
        { x: bounds.x + 40, y: bounds.y + 40 },
        { width: bounds.width, height: bounds.height }
    );
    if (rtn?.window == null) {
        return;
    }
    const newTabId = rtn.window.activetabid;
    const readyPromise = waitForTabReady(rtn.window.oid, newTabId, TabHandoverTimeoutMs);
    let newWin: WaveBrowserWindow = null;
    try {
        const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
        const workspace = await WorkspaceService.GetWorkspace(rtn.window.workspaceid);
        newWin = new WaveBrowserWindow(rtn.window, fullConfig, { unamePlatform, isPrimaryStartupWindow: false });
        newWin.setTitle(getPopOutWindowTitle(workspace));
    } catch (e) {
        // the backend already created the window: delete it, which returns the pane's new tab to the main window
        console.log("error creating popped-out window for pane", rtn.window.oid, e);
        await WindowService.CloseWindow(rtn.window.oid, true);
        const mainWin = getMainWaveWindowByWorkspaceId(srcWin.workspaceId);
        if (mainWin != null && !mainWin.isDestroyed()) {
            bringWindowToFront(mainWin);
        }
        return;
    }
    fireAndForget(() => newWin.setActiveTab(newTabId, false));
    await readyPromise;
    if (!newWin.isDestroyed()) {
        bringWindowToFront(newWin);
    }
}

// after a pane moved to a tab of another window: close the emptied source tab without focusing
// this window, then switch the destination window to that tab and bring it to the front
async function showMovedPane(srcWin: WaveBrowserWindow, destTabId: string, closeSourceTabId: string) {
    const destWindowId = await getTabOwnerWindowId(srcWin.workspaceId, destTabId);
    const destWin = getWaveWindowById(destWindowId);
    if (closeSourceTabId) {
        await srcWin.queueCloseTab(closeSourceTabId, destWin != null && destWin !== srcWin);
    }
    if (destWin == null || destWin.isDestroyed()) {
        return;
    }
    const readyPromise = waitForTabReady(destWin.waveWindowId, destTabId, TabHandoverTimeoutMs);
    fireAndForget(() => destWin.setActiveTab(destTabId, false));
    await readyPromise;
    if (!destWin.isDestroyed()) {
        bringWindowToFront(destWin);
    }
}

ipcMain.on("popout-block", (event, blockId: string) => {
    fireAndForget(async () => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        const block = blockId ? ((await ObjectService.GetObject("block:" + blockId)) as Block) : null;
        const parentTabId = block?.parentoref?.startsWith("tab:") ? block.parentoref.substring(4) : null;
        if (!(await senderWindowOwnsTab(ww, parentTabId))) {
            console.log("popout-block: pane is not in a tab of the sender window", blockId, ww?.waveWindowId);
            return;
        }
        await popOutBlock(ww, blockId);
    });
});

ipcMain.on("show-moved-pane", (event, destTabId: string, closeSourceTabId: string) => {
    fireAndForget(async () => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        if (ww == null || (await getTabOwnerWindowId(ww.workspaceId, destTabId)) == null) {
            console.log("show-moved-pane: destination tab is not in the sender's realm", destTabId, ww?.waveWindowId);
            return;
        }
        if (closeSourceTabId && !(await senderWindowOwnsTab(ww, closeSourceTabId))) {
            console.log("show-moved-pane: source tab is not shown in the sender window", closeSourceTabId);
            return;
        }
        await showMovedPane(ww, destTabId, closeSourceTabId);
    });
});

ipcMain.on("focus-main-window", (event) => {
    const ww = getWaveWindowByWebContentsId(event.sender.id);
    if (ww == null) {
        return;
    }
    const mainWin = getMainWaveWindowByWorkspaceId(ww.workspaceId);
    if (mainWin != null && !mainWin.isDestroyed()) {
        mainWin.focus();
    }
});

ipcMain.on("set-active-tab", async (event, tabId) => {
    const ww = getWaveWindowByWebContentsId(event.sender.id);
    console.log("set-active-tab", tabId, ww?.waveWindowId);
    await ww?.setActiveTab(tabId, true);
});

ipcMain.on("create-tab", async (event, _opts) => {
    const senderWc = event.sender;
    const ww = getWaveWindowByWebContentsId(senderWc.id);
    if (ww != null) {
        await ww.queueCreateTab();
    }
    event.returnValue = true;
    return null;
});

ipcMain.on("set-waveai-open", (event, isOpen: boolean) => {
    const tabView = getWaveTabViewByWebContentsId(event.sender.id);
    if (tabView) {
        tabView.isWaveAIOpen = isOpen;
    }
});

ipcMain.handle("close-tab", async (event, workspaceId: string, tabId: string, confirmClose: boolean) => {
    let ww = getWaveWindowByWebContentsId(event.sender.id);
    if (ww == null || ww.workspaceId !== workspaceId) {
        ww = getMainWaveWindowByWorkspaceId(workspaceId);
    }
    if (ww != null && getPopOutWaveWindows(workspaceId).length > 0) {
        const ownerWindowId = await getTabOwnerWindowId(workspaceId, tabId);
        ww = getWaveWindowById(ownerWindowId) ?? ww;
    }
    if (ww == null) {
        console.log(`close-tab: no window found for workspace ws=${workspaceId} tab=${tabId}`);
        return false;
    }
    if (confirmClose) {
        const choice = dialog.showMessageBoxSync(ww, {
            type: "question",
            defaultId: 1, // Enter activates "Close Tab"
            cancelId: 0, // Esc activates "Cancel"
            buttons: ["Cancel", "Close Tab"],
            title: "Confirm",
            message: "Are you sure you want to close this tab?",
        });
        if (choice === 0) {
            return false;
        }
    }
    await ww.queueCloseTab(tabId);
    return true;
});

ipcMain.on("switch-workspace", (event, workspaceId) => {
    fireAndForget(async () => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        console.log("switch-workspace", workspaceId, ww?.waveWindowId);
        await ww?.switchWorkspace(workspaceId);
    });
});

export async function createWorkspace(window: WaveBrowserWindow) {
    const newWsId = await WorkspaceService.CreateWorkspace("", "", "", true);
    if (newWsId) {
        if (window) {
            await window.switchWorkspace(newWsId);
        } else {
            await createWindowForWorkspace(newWsId);
        }
    }
}

ipcMain.on("create-workspace", (event) => {
    fireAndForget(async () => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        console.log("create-workspace", ww?.waveWindowId);
        await createWorkspace(ww);
    });
});

ipcMain.on("delete-workspace", (event, workspaceId) => {
    fireAndForget(async () => {
        let ww = getWaveWindowByWebContentsId(event.sender.id);
        console.log("delete-workspace", workspaceId, ww?.waveWindowId);

        const workspaceList = await WorkspaceService.ListWorkspaces();

        const _workspaceHasWindow = !!workspaceList.find((wse) => wse.workspaceid === workspaceId)?.windowid;

        const choice = dialog.showMessageBoxSync(this, {
            type: "question",
            buttons: ["Cancel", "Delete Realm"],
            title: "Confirm",
            message: `Deleting realm will also delete its contents.\n\nContinue?`,
        });
        if (choice === 0) {
            console.log("user cancelled workspace delete", workspaceId, ww?.waveWindowId);
            return;
        }

        const newWorkspaceId = await WorkspaceService.DeleteWorkspace(workspaceId);
        console.log("delete-workspace done", workspaceId, ww?.waveWindowId);
        if (ww?.isPopOut) {
            // the backend folded (closed) the popped-out windows; the main window follows the deletion
            ww = getMainWaveWindowByWorkspaceId(ww.workspaceId);
        }
        if (ww?.workspaceId == workspaceId) {
            if (newWorkspaceId) {
                await ww.switchWorkspace(newWorkspaceId);
            } else {
                console.log("delete-workspace closing window", workspaceId, ww?.waveWindowId);
                ww.destroy();
            }
        }
    });
});

export async function createNewWaveWindow() {
    log("createNewWaveWindow");
    const clientData = await ClientService.GetClientData();
    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    let recreatedWindow = false;
    const allWindows = getAllWaveWindows();
    if (allWindows.length === 0 && clientData?.windowids?.length >= 1) {
        console.log("no windows, but clientData has windowids, recreating first window");
        // reopen the first window
        let existingWindowData: WaveWindow = null;
        for (const existingWindowId of clientData.windowids) {
            const windowData = (await ObjectService.GetObject("window:" + existingWindowId)) as WaveWindow;
            if (windowData != null && !windowData.ispopout) {
                existingWindowData = windowData;
                break;
            }
        }
        if (existingWindowData != null) {
            const win = await createBrowserWindow(existingWindowData, fullConfig, {
                unamePlatform,
                isPrimaryStartupWindow: false,
            });
            if (quakeWindow == null) {
                quakeWindow = win;
            }
            win.show();
            recreatedWindow = true;
        }
    }
    if (recreatedWindow) {
        console.log("recreated window, returning");
        return;
    }
    console.log("creating new window");
    const newWaveWindow = allWindows.length === 0 ? await createWindowOnLastWorkspace() : null;
    const newBrowserWindow = await createBrowserWindow(newWaveWindow, fullConfig, {
        unamePlatform,
        isPrimaryStartupWindow: false,
    });
    if (quakeWindow == null) {
        quakeWindow = newBrowserWindow;
    }
    newBrowserWindow.show();
}

export async function relaunchBrowserWindows() {
    console.log("relaunchBrowserWindows");
    setGlobalIsRelaunching(true);
    const windows = getAllWaveWindows();
    if (windows.length > 0) {
        for (const window of windows) {
            console.log("relaunch -- closing window", window.waveWindowId);
            window.close();
        }
        await delay(1200);
    }
    setGlobalIsRelaunching(false);

    const clientData = await ClientService.GetClientData();
    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    const windowIds = clientData.windowids ?? [];
    const wins: WaveBrowserWindow[] = [];
    const isFirstRelaunch = !hasCompletedFirstRelaunch;
    const windowDataMap = new Map<string, WaveWindow>();
    for (const windowId of windowIds) {
        windowDataMap.set(windowId, await WindowService.GetWindow(windowId));
    }
    const primaryWindowId = windowIds.find((id) => windowDataMap.get(id) != null && !windowDataMap.get(id).ispopout);
    for (const windowId of windowIds.slice().reverse()) {
        const windowData: WaveWindow = windowDataMap.get(windowId);
        if (windowData == null) {
            console.log("relaunch -- window data not found, closing window", windowId);
            await WindowService.CloseWindow(windowId, true);
            continue;
        }
        if (windowData.ispopout) {
            // like a restart, a relaunch folds popped-out windows back into their main window
            console.log("relaunch -- folding popped-out window", windowId);
            await WindowService.CloseWindow(windowId, true);
            continue;
        }
        const isPrimaryStartupWindow = isFirstRelaunch && windowId === primaryWindowId;
        console.log(
            "relaunch -- creating window",
            windowId,
            windowData,
            isPrimaryStartupWindow ? "(primary startup)" : ""
        );
        const win = await createBrowserWindow(windowData, fullConfig, {
            unamePlatform,
            isPrimaryStartupWindow,
            foregroundWindow: windowId === primaryWindowId,
        });
        wins.push(win);
        if (windowId === primaryWindowId) {
            quakeWindow = win;
            console.log("designated quake window", win.waveWindowId);
        }
    }
    hasCompletedFirstRelaunch = true;
    for (const win of wins) {
        console.log("show window", win.waveWindowId);
        win.show();
    }
}

function getDisplayForQuakeToggle() {
    // We cannot reliably query the OS-wide active window in Electron.
    // Cursor position is the best cross-platform proxy for the user's active display.
    const cursorPoint = screen.getCursorScreenPoint();
    const displayAtCursor = screen
        .getAllDisplays()
        .find(
            (display) =>
                cursorPoint.x >= display.bounds.x &&
                cursorPoint.x < display.bounds.x + display.bounds.width &&
                cursorPoint.y >= display.bounds.y &&
                cursorPoint.y < display.bounds.y + display.bounds.height
        );
    return displayAtCursor ?? screen.getDisplayNearestPoint(cursorPoint);
}

function moveWindowToDisplay(win: WaveBrowserWindow, targetDisplay: Electron.Display) {
    if (!win || !targetDisplay || win.isDestroyed()) {
        return;
    }
    const curBounds = win.getBounds();
    const sourceDisplay = screen.getDisplayMatching(curBounds);
    if (sourceDisplay.id === targetDisplay.id) {
        return;
    }

    const sourceArea = sourceDisplay.workArea;
    const targetArea = targetDisplay.workArea;
    const nextHeight = Math.min(curBounds.height, targetArea.height);
    const nextWidth = Math.min(curBounds.width, targetArea.width);
    const maxXOffset = Math.max(0, targetArea.width - nextWidth);
    const maxYOffset = Math.max(0, targetArea.height - nextHeight);
    const sourceXOffset = curBounds.x - sourceArea.x;
    const sourceYOffset = curBounds.y - sourceArea.y;
    const nextX = targetArea.x + Math.min(Math.max(sourceXOffset, 0), maxXOffset);
    const nextY = targetArea.y + Math.min(Math.max(sourceYOffset, 0), maxYOffset);

    win.setBounds({ ...curBounds, x: nextX, y: nextY, width: nextWidth, height: nextHeight });
}

const FullscreenTransitionTimeoutMs = 2000;

// handles a theoretical race condition where the user spams the hotkey before the toggle finishes
let quakeToggleInProgress = false;
let quakeRestoreFullscreenOnShow = false;

function waitForFullscreenLeave(window: WaveBrowserWindow): Promise<void> {
    if (!window.isFullScreen()) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        // eslint-disable-next-line prefer-const
        let timeout: ReturnType<typeof setTimeout>;
        const onLeave = () => {
            clearTimeout(timeout);
            resolve();
        };
        timeout = setTimeout(() => {
            window.removeListener("leave-full-screen", onLeave);
            reject(new Error("fullscreen transition timeout"));
        }, FullscreenTransitionTimeoutMs);
        window.once("leave-full-screen", onLeave);
    });
}

function waitForFullscreenEnter(window: WaveBrowserWindow): Promise<void> {
    if (window.isFullScreen()) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        // eslint-disable-next-line prefer-const
        let timeout: ReturnType<typeof setTimeout>;
        const onEnter = () => {
            clearTimeout(timeout);
            resolve();
        };
        timeout = setTimeout(() => {
            window.removeListener("enter-full-screen", onEnter);
            reject(new Error("fullscreen transition timeout"));
        }, FullscreenTransitionTimeoutMs);
        window.once("enter-full-screen", onEnter);
    });
}

async function quakeToggle() {
    if (quakeToggleInProgress) {
        return;
    }
    quakeToggleInProgress = true;
    try {
        let window = quakeWindow;
        if (window?.isDestroyed()) {
            quakeWindow = null;
            window = null;
        }
        if (window == null) {
            await createNewWaveWindow();
            return;
        }
        // Some environments don't hide or move the window if it's fullscreen (even when hidden), so leave fullscreen first
        if (window.isFullScreen()) {
            // macos has a really long fullscreen animation and can have issues restoring from fullscreen, so we skip on macos
            quakeRestoreFullscreenOnShow = process.platform !== "darwin";
            const leavePromise = waitForFullscreenLeave(window);
            window.setFullScreen(false);
            try {
                await leavePromise;
            } catch {
                // timeout — proceed anyway
            }
            if (window.isDestroyed()) {
                return;
            }
        }
        if (window.isVisible()) {
            window.hide();
        } else {
            const targetDisplay = getDisplayForQuakeToggle();
            moveWindowToDisplay(window, targetDisplay);
            window.show();
            if (quakeRestoreFullscreenOnShow) {
                const enterPromise = waitForFullscreenEnter(window);
                window.setFullScreen(true);
                try {
                    await enterPromise;
                } catch {
                    // timeout — proceed anyway
                }
            }
            quakeRestoreFullscreenOnShow = false;
            window.focus();
            if (window.activeTabView?.webContents) {
                window.activeTabView.webContents.focus();
            }
        }
    } finally {
        quakeToggleInProgress = false;
    }
}

let currentRawGlobalHotKey: string = null;
let currentGlobalHotKey: string = null;

export function registerGlobalHotkey(rawGlobalHotKey: string) {
    if (rawGlobalHotKey === currentRawGlobalHotKey) {
        return;
    }
    if (currentGlobalHotKey != null) {
        globalShortcut.unregister(currentGlobalHotKey);
        currentGlobalHotKey = null;
        currentRawGlobalHotKey = null;
    }
    if (!rawGlobalHotKey) {
        return;
    }
    try {
        const electronHotKey = waveKeyToElectronKey(rawGlobalHotKey);
        const ok = globalShortcut.register(electronHotKey, () => {
            fireAndForget(quakeToggle);
        });
        currentRawGlobalHotKey = rawGlobalHotKey;
        currentGlobalHotKey = electronHotKey;
        console.log("registered globalhotkey", rawGlobalHotKey, "=>", electronHotKey, "ok=", ok);
    } catch (e) {
        console.log("error registering global hotkey", rawGlobalHotKey, ":", e);
    }
}

export function initGlobalHotkeyEventSubscription() {
    waveEventSubscribeSingle({
        eventType: "config",
        handler: (event) => {
            try {
                const hotkey = event?.data?.fullconfig?.settings?.["app:globalhotkey"];
                registerGlobalHotkey(hotkey ?? null);
            } catch (e) {
                console.log("error handling config event for globalhotkey", e);
            }
        },
    });
}
