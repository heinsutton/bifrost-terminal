// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { isTabHandoverPending, onTabHandoverResume, setTabHandoverState } from "./tabhandover";

describe("tabhandover", () => {
    it("goes read-only on start and resumes on rollback", () => {
        const resume = vi.fn();
        const unsubscribe = onTabHandoverResume(resume);
        expect(isTabHandoverPending()).toBe(false);
        setTabHandoverState("start");
        expect(isTabHandoverPending()).toBe(true);
        expect(resume).not.toHaveBeenCalled();
        setTabHandoverState("rollback");
        expect(isTabHandoverPending()).toBe(false);
        expect(resume).toHaveBeenCalledTimes(1);
        setTabHandoverState("rollback");
        expect(resume).toHaveBeenCalledTimes(1);
        unsubscribe();
        setTabHandoverState("start");
        setTabHandoverState("rollback");
        expect(resume).toHaveBeenCalledTimes(1);
    });
});
