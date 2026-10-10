// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    buildRows,
    displayName,
    edgeSelection,
    foldAction,
    formatAge,
    groupKey,
    moveSelection,
    sessionKey,
    shortenPath,
} from "./claudesessions-nav";

function mk(id: string, cwd: string, lastactive: number, extra: Partial<ClaudeSession> = {}): ClaudeSession {
    return { harness: "claude", sessionid: id, cwd, lastactive, ...extra };
}

const sessions: ClaudeSession[] = [
    mk("a", "/p/one", 100, { name: "alpha" }),
    mk("b", "/p/one", 300, { pid: 5, status: "busy" }),
    mk("c", "/p/two", 200, { name: "gamma", preview: "fix the parser" }),
    mk("d", "/p/two", 50),
];
const opts = { collapsed: new Set<string>(), filter: "", showOffline: true, descriptions: {} };

describe("buildRows", () => {
    it("groups by folder, newest group first, running sessions first", () => {
        const rows = buildRows(sessions, opts);
        expect(rows.map((r) => r.key)).toEqual([
            groupKey("/p/one"),
            sessionKey("b"),
            sessionKey("a"),
            groupKey("/p/two"),
            sessionKey("c"),
            sessionKey("d"),
        ]);
        expect(rows[0]).toMatchObject({ kind: "group", count: 2, running: 1 });
    });

    it("hides offline sessions and drops empty groups", () => {
        const rows = buildRows(sessions, { ...opts, showOffline: false });
        expect(rows.map((r) => r.key)).toEqual([groupKey("/p/one"), sessionKey("b")]);
    });

    it("hides the rows of a collapsed group", () => {
        const rows = buildRows(sessions, { ...opts, collapsed: new Set(["/p/one"]) });
        expect(rows.map((r) => r.key)).toEqual([
            groupKey("/p/one"),
            groupKey("/p/two"),
            sessionKey("c"),
            sessionKey("d"),
        ]);
    });

    it("filters on name, id, folder, preview and description, and opens collapsed groups", () => {
        const collapsed = new Set(["/p/two"]);
        expect(buildRows(sessions, { ...opts, collapsed, filter: "parser" }).map((r) => r.key)).toEqual([
            groupKey("/p/two"),
            sessionKey("c"),
        ]);
        expect(buildRows(sessions, { ...opts, filter: "ALPHA" }).map((r) => r.key)).toEqual([
            groupKey("/p/one"),
            sessionKey("a"),
        ]);
        expect(
            buildRows(sessions, { ...opts, filter: "notes", descriptions: { d: "my notes" } }).map((r) => r.key)
        ).toEqual([groupKey("/p/two"), sessionKey("d")]);
    });

    it("puts sessions without a folder in one unknown group", () => {
        const rows = buildRows([mk("x", undefined, 1)], opts);
        expect(rows[0]).toMatchObject({ kind: "group", cwd: "" });
    });

    it("copes with no sessions", () => {
        expect(buildRows(null, opts)).toEqual([]);
    });
});

describe("selection", () => {
    const rows = buildRows(sessions, opts);

    it("moves and clamps", () => {
        expect(moveSelection(rows, sessionKey("b"), 1)).toBe(sessionKey("a"));
        expect(moveSelection(rows, sessionKey("d"), 1)).toBe(sessionKey("d"));
        expect(moveSelection(rows, groupKey("/p/one"), -1)).toBe(groupKey("/p/one"));
        expect(moveSelection(rows, sessionKey("a"), 99)).toBe(sessionKey("d"));
    });

    it("lands on the first row when nothing valid is selected", () => {
        expect(moveSelection(rows, "s:gone", 1)).toBe(groupKey("/p/one"));
        expect(moveSelection([], null, 1)).toBeNull();
    });

    it("finds the edges", () => {
        expect(edgeSelection(rows, false)).toBe(groupKey("/p/one"));
        expect(edgeSelection(rows, true)).toBe(sessionKey("d"));
    });

    it("folds with left and right", () => {
        expect(foldAction(rows, sessionKey("a"), "left")).toEqual({ select: groupKey("/p/one") });
        expect(foldAction(rows, groupKey("/p/one"), "left")).toEqual({ toggle: "/p/one" });
        expect(foldAction(rows, groupKey("/p/one"), "right")).toEqual({ select: sessionKey("b") });
        const closed = buildRows(sessions, { ...opts, collapsed: new Set(["/p/one"]) });
        expect(foldAction(closed, groupKey("/p/one"), "right")).toEqual({ toggle: "/p/one" });
        expect(foldAction(closed, groupKey("/p/one"), "left")).toEqual({});
        expect(foldAction(rows, sessionKey("a"), "right")).toEqual({});
    });
});

describe("formatting", () => {
    const now = 10_000_000_000;
    it("formats ages", () => {
        expect(formatAge(now - 5_000, now)).toBe("now");
        expect(formatAge(now - 5 * 60_000, now)).toBe("5m");
        expect(formatAge(now - 3 * 3_600_000, now)).toBe("3h");
        expect(formatAge(now - 2 * 86_400_000, now)).toBe("2d");
        expect(formatAge(now - 90 * 86_400_000, now)).toBe("3mo");
        expect(formatAge(0, now)).toBe("");
    });

    it("shortens the home folder only at a path boundary", () => {
        expect(shortenPath("/home/u/p", "/home/u")).toBe("~/p");
        expect(shortenPath("/home/u", "/home/u")).toBe("~");
        expect(shortenPath("/home/ux/p", "/home/u")).toBe("/home/ux/p");
        expect(shortenPath("", "/home/u")).toBe("(unknown folder)");
    });

    it("shows the id when a session has no name", () => {
        expect(displayName(mk("abc", "/", 1))).toBe("abc");
        expect(displayName(mk("abc", "/", 1, { name: "n" }))).toBe("n");
    });
});
