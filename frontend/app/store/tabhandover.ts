// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// While this tab view hands its tab over to another window, both windows run a renderer for
// the same tab. The handing-over (source) view goes read-only: it stops persisting the layout,
// consuming backend layout actions, resizing ptys and caching terminal state, so the target's
// writes win. On success the source view is destroyed; on rollback it resumes.

export type TabHandoverState = "start" | "rollback";

let handoverPending = false;
const resumeCallbacks = new Set<() => void>();

export function isTabHandoverPending(): boolean {
    return handoverPending;
}

// returns an unsubscribe function
export function onTabHandoverResume(callback: () => void): () => void {
    resumeCallbacks.add(callback);
    return () => {
        resumeCallbacks.delete(callback);
    };
}

export function setTabHandoverState(state: TabHandoverState) {
    if (state === "start") {
        handoverPending = true;
        return;
    }
    if (!handoverPending) {
        return;
    }
    handoverPending = false;
    for (const callback of Array.from(resumeCallbacks)) {
        try {
            callback();
        } catch (e) {
            console.log("error in tab handover resume callback", e);
        }
    }
}
