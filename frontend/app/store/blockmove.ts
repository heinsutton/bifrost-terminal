// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi, globalStore, WOS } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { groupMoveTargets, MoveTargetGroup } from "@/app/store/movetargets";
import { BlockService } from "@/app/store/services";
import { deleteLayoutModelForTab, getLayoutModelForStaticTab } from "@/layout/index";
import { fireAndForget } from "@/util/util";

export type { MoveTargetGroup, MoveTargetTab } from "@/app/store/movetargets";

function isEphemeralBlock(blockId: string): boolean {
    const ephemeralNode = globalStore.get(getLayoutModelForStaticTab().ephemeralNode);
    return ephemeralNode?.data?.blockId === blockId;
}

export async function moveBlockToTab(blockId: string, destTabId: string | null): Promise<void> {
    if (isEphemeralBlock(blockId)) {
        return;
    }
    const sourceTabId = globalStore.get(atoms.staticTabId);
    const workspaceId = globalStore.get(atoms.workspaceId);
    const sourceTab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", sourceTabId)));
    if (destTabId == null && (sourceTab?.blockids?.length ?? 0) <= 1) {
        return;
    }
    const destInOtherWindow = destTabId != null && !(globalStore.get(atoms.windowTabIds) ?? []).includes(destTabId);
    const rtn = await BlockService.MoveBlockToTab(blockId, destTabId ?? "");
    if (destInOtherWindow) {
        // emain closes an emptied source tab first, then brings the destination window to the front
        getApi().showMovedPane(rtn.desttabid, rtn.sourcetabempty ? rtn.sourcetabid : null);
        return;
    }
    getApi().setActiveTab(rtn.desttabid);
    if (rtn.sourcetabempty) {
        const didClose = await getApi().closeTab(workspaceId, rtn.sourcetabid, false);
        if (didClose) {
            deleteLayoutModelForTab(rtn.sourcetabid);
        }
    }
}

// move targets grouped by window; a single unlabeled group while the realm has no popped-out windows
export function getMoveTargetGroups(): MoveTargetGroup[] {
    return groupMoveTargets({
        workspace: globalStore.get(atoms.workspace),
        curTabId: globalStore.get(atoms.staticTabId),
        windowId: globalStore.get(atoms.uiContext)?.windowid,
        isPopOut: globalStore.get(atoms.isPopOutWindow),
        isSolePane: isSolePaneInTab(),
        getTabName: (tabId) => globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)))?.name,
    });
}

function countMoveTargets(groups: MoveTargetGroup[]): number {
    return groups.reduce((sum, group) => sum + group.tabs.length, 0);
}

export function isSolePaneInTab(): boolean {
    const tabId = globalStore.get(atoms.staticTabId);
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    return (tab?.blockids?.length ?? 0) <= 1;
}

export function canMoveBlockToTab(blockId: string): boolean {
    if (isEphemeralBlock(blockId)) {
        return false;
    }
    return countMoveTargets(getMoveTargetGroups()) > 0 || !isSolePaneInTab();
}

export function confirmAndMoveBlockToTab(blockId: string, destTabId: string | null) {
    if (destTabId != null && isSolePaneInTab()) {
        modalsModel.pushModal("MoveToTabConfirmModal", { blockId, destTabId });
        return;
    }
    fireAndForget(() => moveBlockToTab(blockId, destTabId));
}

export function openMoveToTabModal(blockId: string) {
    if (modalsModel.hasOpenModals() || !canMoveBlockToTab(blockId)) {
        return;
    }
    modalsModel.pushModal("MoveToTabModal", { blockId });
}

// a sole pane pops its tab out instead, which is hidden when that tab is the window's only tab
export function canPopOutBlock(blockId: string): boolean {
    if (isEphemeralBlock(blockId)) {
        return false;
    }
    return !isSolePaneInTab() || (globalStore.get(atoms.windowTabIds)?.length ?? 0) > 1;
}

export function popOutBlock(blockId: string) {
    if (!canPopOutBlock(blockId)) {
        return;
    }
    if (isSolePaneInTab()) {
        getApi().popOutTab(globalStore.get(atoms.staticTabId));
        return;
    }
    getApi().popOutBlock(blockId);
}

function getMoveToTabSubmenu(blockId: string): ContextMenuItem[] {
    const submenu: ContextMenuItem[] = [];
    getMoveTargetGroups().forEach((group, idx) => {
        if (group.label != null) {
            if (idx > 0) {
                submenu.push({ type: "separator" });
            }
            submenu.push({ label: group.label, enabled: false });
        }
        for (const tab of group.tabs) {
            submenu.push({ label: tab.name, click: () => confirmAndMoveBlockToTab(blockId, tab.tabId) });
        }
    });
    if (!isSolePaneInTab()) {
        if (submenu.length > 0) {
            submenu.push({ type: "separator" });
        }
        submenu.push({ label: "New Tab", click: () => confirmAndMoveBlockToTab(blockId, null) });
    }
    return submenu;
}

// the "Move to Tab" submenu and "Pop Out" items of a pane's menus
export function getPaneMoveMenuItems(blockId: string): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (canMoveBlockToTab(blockId)) {
        items.push({ label: "Move to Tab", submenu: getMoveToTabSubmenu(blockId) });
    }
    if (canPopOutBlock(blockId)) {
        items.push({ label: "Pop Out", click: () => popOutBlock(blockId) });
    }
    return items;
}
