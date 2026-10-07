// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi, globalStore, refocusNode, WOS } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import {
    getPaneDropSide,
    PaneDragMime,
    PaneDragRealmMimePrefix,
    PaneDragSoleMime,
    PaneDropSide,
    parsePaneDragTypes,
} from "@/util/tabdragutil";

// Panes are dragged with react-dnd's HTML5 backend, which already works inside a tab. A drag that
// leaves the window is a native drag between Chromium windows: the source tags it with custom
// dataTransfer types, and another window of the same realm accepts the drop here and asks emain to
// move the pane. Esc or a drop on the desktop produce no drop event, so nothing moves.

type PaneDropTarget =
    | { kind: "tab"; tabId: string; rect: DOMRect }
    | { kind: "newtab"; rect: DOMRect }
    | { kind: "pane"; blockId: string; side: PaneDropSide; rect: DOMRect }
    | { kind: "activetab"; rect: DOMRect };

const PaneFocusPollMs = 50;
const PaneFocusTimeoutMs = 3000;

// set while this view is the source of a pane drag (its own drops are react-dnd's business)
let ownPaneDragActive = false;
let highlightElem: HTMLDivElement = null;

function isSolePaneOfStaticTab(): boolean {
    const tabId = globalStore.get(atoms.staticTabId);
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    return (tab?.blockids?.length ?? 0) <= 1;
}

// called on the native dragstart of a pane's drag handle
export function annotatePaneDragStart(event: DragEvent, blockId: string) {
    const workspaceId = globalStore.get(atoms.workspace)?.oid;
    if (event.dataTransfer == null || blockId == null || workspaceId == null) {
        return;
    }
    ownPaneDragActive = true;
    window.addEventListener(
        "dragend",
        () => {
            ownPaneDragActive = false;
        },
        { once: true, capture: true }
    );
    const isSolePane = isSolePaneOfStaticTab();
    const isPopOut = globalStore.get(atoms.isPopOutWindow);
    const windowTabCount = globalStore.get(atoms.windowTabIds)?.length ?? 0;
    if (isSolePane && !isPopOut && windowTabCount <= 1) {
        // the main window keeps at least one tab: other windows don't accept this pane
        return;
    }
    event.dataTransfer.setData(PaneDragMime, blockId);
    event.dataTransfer.setData(PaneDragRealmMimePrefix + workspaceId.toLowerCase(), "1");
    if (isSolePane) {
        event.dataTransfer.setData(PaneDragSoleMime, "1");
    }
}

function getDropTarget(x: number, y: number): PaneDropTarget {
    const elem = document.elementFromPoint(x, y) as HTMLElement;
    const tabElem = elem?.closest<HTMLElement>("[data-tab-id],[data-tabid]");
    if (tabElem != null) {
        const tabId = tabElem.dataset.tabId ?? tabElem.dataset.tabid;
        return { kind: "tab", tabId, rect: tabElem.getBoundingClientRect() };
    }
    const barElem = elem?.closest<HTMLElement>("[data-vtabbar],.tab-bar-wrapper");
    if (barElem != null) {
        return { kind: "newtab", rect: barElem.getBoundingClientRect() };
    }
    const paneElem = elem?.closest<HTMLElement>("[data-blockid]");
    if (paneElem != null) {
        const rect = paneElem.getBoundingClientRect();
        const side = getPaneDropSide({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }, { x, y });
        return { kind: "pane", blockId: paneElem.dataset.blockid, side, rect };
    }
    return { kind: "activetab", rect: document.documentElement.getBoundingClientRect() };
}

function showHighlight(target: PaneDropTarget) {
    if (highlightElem == null) {
        highlightElem = document.createElement("div");
        highlightElem.className =
            "pointer-events-none fixed z-[10000] rounded-md border-2 border-accent bg-accent/15 transition-all duration-75";
        document.body.appendChild(highlightElem);
    }
    let { left, top, width, height } = target.rect;
    if (target.kind === "pane") {
        if (target.side === "left" || target.side === "right") {
            width = width / 2;
            left = target.side === "right" ? left + width : left;
        } else {
            height = height / 2;
            top = target.side === "bottom" ? top + height : top;
        }
    }
    Object.assign(highlightElem.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        display: "block",
    });
}

function hideHighlight() {
    if (highlightElem != null) {
        highlightElem.style.display = "none";
    }
}

function acceptablePaneDrag(event: DragEvent): ReturnType<typeof parsePaneDragTypes> {
    if (ownPaneDragActive || event.dataTransfer == null) {
        return null;
    }
    const info = parsePaneDragTypes(event.dataTransfer.types, globalStore.get(atoms.workspace)?.oid);
    if (!info.isPane) {
        return null;
    }
    return info;
}

// focus the moved pane once it shows up in this tab's layout
function focusMovedPane(blockId: string) {
    const startTs = Date.now();
    const poll = () => {
        const tab = globalStore.get(
            WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", globalStore.get(atoms.staticTabId)))
        );
        if (tab?.blockids?.includes(blockId) && document.querySelector(`[data-blockid="${blockId}"]`) != null) {
            refocusNode(blockId);
            return;
        }
        if (Date.now() - startTs < PaneFocusTimeoutMs) {
            setTimeout(poll, PaneFocusPollMs);
        }
    };
    setTimeout(poll, PaneFocusPollMs);
}

function sendPaneDrop(blockId: string, target: PaneDropTarget) {
    const staticTabId = globalStore.get(atoms.staticTabId);
    switch (target.kind) {
        case "tab":
            getApi().paneDrop(blockId, target.tabId, null, null);
            if (target.tabId === staticTabId) {
                focusMovedPane(blockId);
            }
            break;
        case "newtab":
            getApi().paneDrop(blockId, null, null, null);
            break;
        case "pane":
            getApi().paneDrop(blockId, staticTabId, target.blockId, target.side);
            focusMovedPane(blockId);
            break;
        default:
            getApi().paneDrop(blockId, staticTabId, null, null);
            focusMovedPane(blockId);
            break;
    }
}

export function registerPaneDropHandlers() {
    document.addEventListener(
        "dragenter",
        (event) => {
            if (acceptablePaneDrag(event)?.sameRealm) {
                event.preventDefault();
                event.stopPropagation();
            }
        },
        true
    );
    document.addEventListener(
        "dragover",
        (event) => {
            const info = acceptablePaneDrag(event);
            if (info == null) {
                return;
            }
            if (!info.sameRealm) {
                hideHighlight();
                return;
            }
            // stop here: react-dnd's own dragover handler would set dropEffect "none" for a drag it didn't start
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            showHighlight(getDropTarget(event.clientX, event.clientY));
        },
        true
    );
    document.addEventListener(
        "dragleave",
        (event) => {
            if (event.relatedTarget == null) {
                hideHighlight();
            }
        },
        true
    );
    window.addEventListener("dragend", hideHighlight, true);
    document.addEventListener(
        "drop",
        (event) => {
            const info = acceptablePaneDrag(event);
            if (info == null) {
                return;
            }
            hideHighlight();
            if (!info.sameRealm) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const blockId = event.dataTransfer.getData(PaneDragMime);
            if (!blockId) {
                return;
            }
            const target = getDropTarget(event.clientX, event.clientY);
            if (info.isSolePane) {
                modalsModel.pushModal("MoveToTabConfirmModal", {
                    blockId,
                    destTabId: null,
                    onConfirm: () => sendPaneDrop(blockId, target),
                });
                return;
            }
            sendPaneDrop(blockId, target);
        },
        true
    );
}
