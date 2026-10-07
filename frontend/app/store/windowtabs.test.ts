// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { countPopOutWindows, getWindowTabIds } from "./windowtabs";

function makeWorkspace(tabids: string[], popouttabs?: { [key: string]: string }): Workspace {
    return { oid: "ws1", version: 1, tabids, activetabid: tabids[0], meta: {}, popouttabs } as Workspace;
}

describe("getWindowTabIds", () => {
    it("returns every tab for the main window when nothing is popped out", () => {
        const ws = makeWorkspace(["a", "b", "c"]);
        expect(getWindowTabIds(ws, "main", false)).toEqual(["a", "b", "c"]);
        expect(getWindowTabIds(ws, "pop1", true)).toEqual([]);
    });

    it("splits tabs between the main and popped-out windows in workspace order", () => {
        const ws = makeWorkspace(["a", "b", "c", "d", "e"], { d: "pop1", b: "pop1", e: "pop2" });
        expect(getWindowTabIds(ws, "main", false)).toEqual(["a", "c"]);
        expect(getWindowTabIds(ws, "pop1", true)).toEqual(["b", "d"]);
        expect(getWindowTabIds(ws, "pop2", true)).toEqual(["e"]);
    });

    it("handles a missing workspace", () => {
        expect(getWindowTabIds(null, "main", false)).toEqual([]);
    });
});

describe("countPopOutWindows", () => {
    it("counts distinct popped-out windows", () => {
        expect(countPopOutWindows(makeWorkspace(["a"]))).toBe(0);
        expect(countPopOutWindows(makeWorkspace(["a", "b", "c"], { b: "pop1", c: "pop1" }))).toBe(1);
        expect(countPopOutWindows(makeWorkspace(["a", "b", "c"], { b: "pop1", c: "pop2" }))).toBe(2);
    });
});
