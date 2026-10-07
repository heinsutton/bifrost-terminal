// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi, globalStore, WOS } from "@/app/store/global";
import { BlockService } from "@/app/store/services";
import { deleteLayoutModelForTab, getLayoutModelForStaticTab } from "@/layout/index";

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
