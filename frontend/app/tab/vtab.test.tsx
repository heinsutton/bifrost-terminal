// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VTab, VTabItem } from "./vtab";

const OriginalCss = globalThis.CSS;
const HexColorRegex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;

function renderVTab(tab: VTabItem): string {
    return renderToStaticMarkup(
        <VTab
            tab={tab}
            active={false}
            isDragging={false}
            isReordering={false}
            onSelect={() => null}
            onPointerDown={() => null}
        />
    );
}

describe("VTab badges", () => {
    beforeAll(() => {
        globalThis.CSS = {
            supports: (_property: string, value: string) => HexColorRegex.test(value),
        } as typeof CSS;
    });

    afterAll(() => {
        globalThis.CSS = OriginalCss;
    });

    it("renders shared badges and a validated sigil badge", () => {
        const markup = renderVTab({
            id: "tab-1",
            name: "Build Logs",
            badges: [{ badgeid: "badge-1", icon: "star", color: "#f59e0b", priority: 2 }],
            sigilColor: "#4da2ff",
        });

        expect(markup).toContain("#4da2ff");
        expect(markup).toContain("#f59e0b");
        expect(markup).toContain("rounded-full");
    });

    it("renders the algiz rune when only a sigil is set", () => {
        const markup = renderVTab({ id: "tab-3", name: "Rune", sigilColor: "#ff5370" });

        expect(markup).toContain("<svg");
        expect(markup).toContain('stroke="#ff5370"');
        expect(markup).not.toContain("fa-flag");
    });

    it("renders the naudiz rune and tint for attention badges", () => {
        const markup = renderVTab({
            id: "tab-4",
            name: "Agent",
            badges: [{ badgeid: "badge-4", icon: "bell-exclamation", color: "#123456", priority: 20 }],
        });

        expect(markup).toContain('data-badge-kind="attention"');
        expect(markup).toContain('stroke="#ff9e64"');
        expect(markup).not.toContain("#123456");
        expect(markup).not.toContain("fa-bell-exclamation");
    });

    it("renders the dagaz rune and tint for done badges", () => {
        const markup = renderVTab({
            id: "tab-5",
            name: "Agent",
            badges: [{ badgeid: "badge-5", icon: "check", color: "#123456", priority: 10 }],
        });

        expect(markup).toContain('data-badge-kind="done"');
        expect(markup).toContain('stroke="#7ee787"');
    });

    it("ignores invalid sigil colors", () => {
        const markup = renderVTab({
            id: "tab-2",
            name: "Deploy",
            badges: [{ badgeid: "badge-2", icon: "star", color: "#4ade80", priority: 2 }],
            sigilColor: "definitely-not-a-color",
        });

        expect(markup).not.toContain("definitely-not-a-color");
        expect(markup).not.toContain("<svg");
        expect(markup).toContain("#4ade80");
    });
});
