// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWindowTabIds } from "@/app/store/windowtabs";

export type MoveTargetTab = { tabId: string; name: string };

// label is null for the single group shown while the realm has no popped-out windows
export type MoveTargetGroup = { label: string; tabs: MoveTargetTab[] };

export type MoveTargetOpts = {
    workspace: Workspace;
    curTabId: string;
    windowId: string;
    isPopOut: boolean;
    isSolePane: boolean; // the pane being moved is the only pane of curTabId
    getTabName: (tabId: string) => string;
};

// Groups the tabs a pane can move to: "This window", then "Main window" (from a popped-out
// window), then each other popped-out window as "↗ Window n" (n follows the window's first tab
// in workspace order). Empty groups are left out. The main window always keeps a tab, so the only
// pane of its only tab gets no other-window targets.
export function groupMoveTargets(opts: MoveTargetOpts): MoveTargetGroup[] {
    const { workspace, curTabId, windowId, isPopOut, isSolePane, getTabName } = opts;
    const tabIds = workspace?.tabids ?? [];
    const makeTarget = (tabId: string): MoveTargetTab => {
        const name = getTabName(tabId);
        return { tabId, name: name?.trim() ? name : `Tab ${tabIds.indexOf(tabId) + 1}` };
    };
    const popOutTabs = workspace?.popouttabs ?? {};
    if (Object.keys(popOutTabs).length === 0) {
        return [{ label: null, tabs: tabIds.filter((tabId) => tabId !== curTabId).map(makeTarget) }];
    }
    const thisWindowTabIds = getWindowTabIds(workspace, windowId, isPopOut);
    const groups: MoveTargetGroup[] = [
        {
            label: "This window",
            tabs: thisWindowTabIds.filter((tabId) => tabId !== curTabId).map(makeTarget),
        },
    ];
    if (!isPopOut && isSolePane && thisWindowTabIds.length <= 1) {
        return groups.filter((group) => group.tabs.length > 0);
    }
    if (isPopOut) {
        groups.push({ label: "Main window", tabs: getWindowTabIds(workspace, null, false).map(makeTarget) });
    }
    const popOutWindowIds: string[] = [];
    for (const tabId of tabIds) {
        const popOutWindowId = popOutTabs[tabId];
        if (popOutWindowId && !popOutWindowIds.includes(popOutWindowId)) {
            popOutWindowIds.push(popOutWindowId);
        }
    }
    popOutWindowIds.forEach((popOutWindowId, idx) => {
        if (isPopOut && popOutWindowId === windowId) {
            return;
        }
        groups.push({
            label: `↗ Window ${idx + 1}`,
            tabs: getWindowTabIds(workspace, popOutWindowId, true).map(makeTarget),
        });
    });
    return groups.filter((group) => group.tabs.length > 0);
}
