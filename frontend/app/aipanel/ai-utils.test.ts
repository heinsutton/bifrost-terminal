// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getSortedAIModeConfigs, resolveDefaultAIMode } from "./ai-utils";

const byokModes = {
    "my-claude": { "display:name": "Claude", "display:order": 2, "ai:provider": "custom" },
    "my-ollama": { "display:name": "Ollama", "display:order": 1, "ai:provider": "custom" },
} as Record<string, AIModeConfigType>;

describe("resolveDefaultAIMode", () => {
    it("keeps a requested mode that exists", () => {
        expect(resolveDefaultAIMode(byokModes, "my-claude")).toBe("my-claude");
    });

    it("falls back to the first sorted mode when a legacy waveai@ default is configured", () => {
        expect(resolveDefaultAIMode(byokModes, "waveai@balanced")).toBe("my-ollama");
    });

    it("falls back to the first sorted mode when no default is set", () => {
        expect(resolveDefaultAIMode(byokModes, null)).toBe("my-ollama");
    });

    it("returns unknown when no modes are configured", () => {
        expect(resolveDefaultAIMode({}, "waveai@balanced")).toBe("unknown");
        expect(resolveDefaultAIMode(null, undefined)).toBe("unknown");
    });
});

describe("getSortedAIModeConfigs", () => {
    it("sorts by display order and includes the mode key", () => {
        expect(getSortedAIModeConfigs(byokModes).map((c) => c.mode)).toEqual(["my-ollama", "my-claude"]);
    });
});
