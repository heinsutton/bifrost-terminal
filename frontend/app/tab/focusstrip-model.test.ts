// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocusStripCloseDelayMs, FocusStripModel, FocusStripPeekMs } from "./focusstrip-model";

describe("FocusStripModel", () => {
    const model = FocusStripModel.getInstance();
    const state = () => globalStore.get(model.stateAtom);

    beforeEach(() => {
        vi.useFakeTimers();
        model.reset();
    });
    afterEach(() => {
        model.reset();
        vi.useRealTimers();
    });

    it("peek opens then closes after the peek time", () => {
        model.peek();
        expect(state()).toBe("peek");
        vi.advanceTimersByTime(FocusStripPeekMs + 1);
        expect(state()).toBe("closed");
    });

    it("a second peek restarts the timer", () => {
        model.peek();
        vi.advanceTimersByTime(FocusStripPeekMs - 100);
        model.peek();
        vi.advanceTimersByTime(FocusStripPeekMs - 100);
        expect(state()).toBe("peek");
        vi.advanceTimersByTime(200);
        expect(state()).toBe("closed");
    });

    it("hover keeps a peek open and leaving closes after the delay", () => {
        model.peek();
        model.setHovered(true);
        vi.advanceTimersByTime(FocusStripPeekMs + 1);
        expect(state()).toBe("peek");
        model.setHovered(false);
        vi.advanceTimersByTime(FocusStripCloseDelayMs - 1);
        expect(state()).toBe("peek");
        vi.advanceTimersByTime(2);
        expect(state()).toBe("closed");
    });

    it("re-entering during the close delay cancels the close", () => {
        model.openHover();
        model.setHovered(false);
        vi.advanceTimersByTime(100);
        model.setHovered(true);
        vi.advanceTimersByTime(FocusStripCloseDelayMs * 2);
        expect(state()).toBe("hover");
    });

    it("peek does not downgrade an open hover", () => {
        model.openHover();
        model.peek();
        expect(state()).toBe("hover");
    });
});
