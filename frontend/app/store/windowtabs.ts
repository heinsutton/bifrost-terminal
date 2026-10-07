// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A popped-out window shows the workspace tabs mapped to it in workspace.popouttabs;
// the main window shows every other tab. Both keep the workspace's tab order.
export function getWindowTabIds(workspace: Workspace, windowId: string, isPopOut: boolean): string[] {
    const tabIds = workspace?.tabids ?? [];
    const popOutTabs = workspace?.popouttabs;
    if (popOutTabs == null) {
        return isPopOut ? [] : tabIds;
    }
    if (isPopOut) {
        return tabIds.filter((tabId) => popOutTabs[tabId] === windowId);
    }
    return tabIds.filter((tabId) => !popOutTabs[tabId]);
}

export function countPopOutWindows(workspace: Workspace): number {
    return new Set(Object.values(workspace?.popouttabs ?? {})).size;
}
