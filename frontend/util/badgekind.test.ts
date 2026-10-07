// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { sortBadgesForTab } from "@/app/store/badge";
import { describe, expect, it } from "vitest";
import { AttentionColor, DoneColor, getBadgeKind, getBadgeVisual, shouldNotifyForBadge } from "./badgekind";

function makeBadge(icon: string, priority: number, badgeid: string): Badge {
    return { icon, priority, badgeid, color: "#000000" };
}

describe("getBadgeKind", () => {
    it("maps icons to kinds", () => {
        expect(getBadgeKind({ icon: "bell-exclamation" })).toBe("attention");
        expect(getBadgeKind({ icon: "message-question" })).toBe("attention");
        expect(getBadgeKind({ icon: "bell" })).toBe("bell");
        expect(getBadgeKind({ icon: "check" })).toBe("done");
    });

    it("returns null for unknown or missing badges", () => {
        expect(getBadgeKind({ icon: "star" })).toBeNull();
        expect(getBadgeKind(null)).toBeNull();
    });
});

describe("getBadgeVisual", () => {
    it("uses the naudiz rune for attention and bell, dagaz for done", () => {
        expect(getBadgeVisual({ icon: "bell-exclamation" })).toEqual({
            kind: "attention",
            rune: "naudiz",
            color: AttentionColor,
        });
        expect(getBadgeVisual({ icon: "bell" })?.rune).toBe("naudiz");
        expect(getBadgeVisual({ icon: "check" })).toEqual({ kind: "done", rune: "dagaz", color: DoneColor });
        expect(getBadgeVisual({ icon: "star" })).toBeNull();
    });

    it("follows the top badge by priority: attention beats done beats bell", () => {
        const sorted = sortBadgesForTab([
            makeBadge("bell", 1, "a"),
            makeBadge("check", 10, "b"),
            makeBadge("bell-exclamation", 20, "c"),
        ]);
        expect(getBadgeKind(sorted[0])).toBe("attention");
        expect(getBadgeKind(sorted[1])).toBe("done");
        expect(getBadgeKind(sorted[2])).toBe("bell");
    });
});

describe("shouldNotifyForBadge", () => {
    const enabledKinds = ["attention", "done"];

    it("notifies for enabled kinds when not looking", () => {
        expect(shouldNotifyForBadge({ kind: "attention", enabledKinds, isLooking: false })).toBe(true);
    });

    it("skips when looking, disabled, unclassified or setting empty", () => {
        expect(shouldNotifyForBadge({ kind: "attention", enabledKinds, isLooking: true })).toBe(false);
        expect(shouldNotifyForBadge({ kind: "bell", enabledKinds, isLooking: false })).toBe(false);
        expect(shouldNotifyForBadge({ kind: null, enabledKinds, isLooking: false })).toBe(false);
        expect(shouldNotifyForBadge({ kind: "done", enabledKinds: [], isLooking: false })).toBe(false);
        expect(shouldNotifyForBadge({ kind: "done", enabledKinds: null, isLooking: false })).toBe(false);
    });
});
