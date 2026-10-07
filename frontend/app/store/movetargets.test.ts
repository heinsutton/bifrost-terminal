// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { groupMoveTargets } from "./movetargets";

function makeWorkspace(tabids: string[], popouttabs?: { [key: string]: string }): Workspace {
    return { oid: "ws1", version: 1, tabids, activetabid: tabids[0], meta: {}, popouttabs } as Workspace;
}

const names: { [key: string]: string } = { a: "Alpha", b: "Bravo", c: "", d: "Delta", e: "Echo" };
const getTabName = (tabId: string) => names[tabId];

describe("groupMoveTargets", () => {
    it("returns one unlabeled group without popped-out windows", () => {
        const groups = groupMoveTargets({
            workspace: makeWorkspace(["a", "b", "c"]),
            curTabId: "a",
            windowId: "main",
            isPopOut: false,
            isSolePane: false,
            getTabName,
        });
        expect(groups).toEqual([
            {
                label: null,
                tabs: [
                    { tabId: "b", name: "Bravo" },
                    { tabId: "c", name: "Tab 3" },
                ],
            },
        ]);
    });

    it("groups by window from the main window", () => {
        const ws = makeWorkspace(["a", "b", "c", "d", "e"], { d: "pop2", b: "pop1", e: "pop2" });
        const groups = groupMoveTargets({
            workspace: ws,
            curTabId: "a",
            windowId: "main",
            isPopOut: false,
            isSolePane: false,
            getTabName,
        });
        expect(groups.map((g) => [g.label, g.tabs.map((t) => t.tabId)])).toEqual([
            ["This window", ["c"]],
            ["↗ Window 1", ["b"]],
            ["↗ Window 2", ["d", "e"]],
        ]);
    });

    it("lists the main window and the other popped-out windows from a popped-out window", () => {
        const ws = makeWorkspace(["a", "b", "c", "d"], { b: "pop1", d: "pop2" });
        const groups = groupMoveTargets({
            workspace: ws,
            curTabId: "d",
            windowId: "pop2",
            isPopOut: true,
            isSolePane: false,
            getTabName,
        });
        expect(groups.map((g) => [g.label, g.tabs.map((t) => t.tabId)])).toEqual([
            ["Main window", ["a", "c"]],
            ["↗ Window 1", ["b"]],
        ]);
    });

    it("gives the only pane of the main window's only tab no other-window targets", () => {
        const ws = makeWorkspace(["a", "b", "c"], { b: "pop1", c: "pop1" });
        const opts = { workspace: ws, curTabId: "a", windowId: "main", isPopOut: false, getTabName };
        expect(groupMoveTargets({ ...opts, isSolePane: true })).toEqual([]);
        expect(groupMoveTargets({ ...opts, isSolePane: false }).map((g) => g.label)).toEqual(["↗ Window 1"]);
    });

    it("still lets the last pane of a popped-out window move out", () => {
        const ws = makeWorkspace(["a", "b"], { b: "pop1" });
        const groups = groupMoveTargets({
            workspace: ws,
            curTabId: "b",
            windowId: "pop1",
            isPopOut: true,
            isSolePane: true,
            getTabName,
        });
        expect(groups.map((g) => [g.label, g.tabs.map((t) => t.tabId)])).toEqual([["Main window", ["a"]]]);
    });
});
