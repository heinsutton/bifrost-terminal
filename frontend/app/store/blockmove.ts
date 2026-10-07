// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi, globalStore, WOS } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { BlockService } from "@/app/store/services";
import { deleteLayoutModelForTab, getLayoutModelForStaticTab } from "@/layout/index";
import { fireAndForget } from "@/util/util";

export async function moveBlockToTab(blockId: string, destTabId: string | null): Promise<void> {
    const layoutModel = getLayoutModelForStaticTab();
    const ephemeralNode = globalStore.get(layoutModel.ephemeralNode);
    if (ephemeralNode?.data?.blockId === blockId) {
        return;
    }
    const sourceTabId = globalStore.get(atoms.staticTabId);
    const workspaceId = globalStore.get(atoms.workspaceId);
    const sourceTab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", sourceTabId)));
    if (destTabId == null && (sourceTab?.blockids?.length ?? 0) <= 1) {
        return;
    }
    const rtn = await BlockService.MoveBlockToTab(blockId, destTabId ?? "");
    getApi().setActiveTab(rtn.desttabid);
    if (rtn.sourcetabempty) {
        const didClose = await getApi().closeTab(workspaceId, rtn.sourcetabid, false);
        if (didClose) {
            deleteLayoutModelForTab(rtn.sourcetabid);
        }
    }
}

export type MoveTargetTab = { tabId: string; name: string };

export function getOtherTabs(): MoveTargetTab[] {
    const ws = globalStore.get(atoms.workspace);
    const curTabId = globalStore.get(atoms.staticTabId);
    const tabIds = ws?.tabids ?? [];
    const rtn: MoveTargetTab[] = [];
    tabIds.forEach((tabId, idx) => {
        if (tabId === curTabId) {
            return;
        }
        const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
        const name = tab?.name?.trim() ? tab.name : `Tab ${idx + 1}`;
        rtn.push({ tabId, name });
    });
    return rtn;
}

export function isSolePaneInTab(): boolean {
    const tabId = globalStore.get(atoms.staticTabId);
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    return (tab?.blockids?.length ?? 0) <= 1;
}

export function canMoveBlockToTab(blockId: string): boolean {
    const ephemeralNode = globalStore.get(getLayoutModelForStaticTab().ephemeralNode);
    if (ephemeralNode?.data?.blockId === blockId) {
        return false;
    }
    return getOtherTabs().length > 0 || !isSolePaneInTab();
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

export function getMoveToTabMenuItems(blockId: string): ContextMenuItem[] {
    if (!canMoveBlockToTab(blockId)) {
        return [];
    }
    const submenu: ContextMenuItem[] = getOtherTabs().map((tab) => ({
        label: tab.name,
        click: () => confirmAndMoveBlockToTab(blockId, tab.tabId),
    }));
    if (!isSolePaneInTab()) {
        if (submenu.length > 0) {
            submenu.push({ type: "separator" });
        }
        submenu.push({ label: "New Tab", click: () => confirmAndMoveBlockToTab(blockId, null) });
    }
    return [{ label: "Move to Tab", submenu }];
}
