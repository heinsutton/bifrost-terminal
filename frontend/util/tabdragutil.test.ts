// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { countCentersBefore, isTornOff, pickDropWindow, pointInRect, toClientPoint } from "./tabdragutil";

describe("tabdragutil", () => {
    it("tests points against rects (right/bottom edges exclusive)", () => {
        const rect = { x: 10, y: 20, width: 100, height: 50 };
        expect(pointInRect({ x: 10, y: 20 }, rect)).toBe(true);
        expect(pointInRect({ x: 109, y: 69 }, rect)).toBe(true);
        expect(pointInRect({ x: 110, y: 30 }, rect)).toBe(false);
        expect(pointInRect({ x: 50, y: 70 }, rect)).toBe(false);
    });

    it("picks the most recently focused visible window under the point", () => {
        const candidates = [
            { id: "hidden", bounds: { x: 0, y: 0, width: 500, height: 500 }, visible: false },
            { id: "front", bounds: { x: 100, y: 100, width: 300, height: 300 }, visible: true },
            { id: "back", bounds: { x: 0, y: 0, width: 1000, height: 1000 }, visible: true },
        ];
        expect(pickDropWindow({ x: 150, y: 150 }, candidates)).toBe("front");
        expect(pickDropWindow({ x: 50, y: 50 }, candidates)).toBe("back");
        expect(pickDropWindow({ x: 2000, y: 50 }, candidates)).toBe(null);
    });

    it("converts screen points to client points with negative monitor offsets and zoom", () => {
        expect(toClientPoint({ x: -1500, y: 300 }, { x: -1920, y: 100, width: 800, height: 600 }, 1.25)).toEqual({
            x: 336,
            y: 160,
        });
        expect(toClientPoint({ x: 50, y: 60 }, { x: 0, y: 0, width: 10, height: 10 }, 0)).toEqual({ x: 50, y: 60 });
    });

    it("computes a drop index from tab centers", () => {
        const centers = [50, 150, 250];
        expect(countCentersBefore(10, centers)).toBe(0);
        expect(countCentersBefore(160, centers)).toBe(2);
        expect(countCentersBefore(400, centers)).toBe(3);
    });

    it("tears a tab off once it leaves the bar by the threshold or leaves the window", () => {
        const bar = { x: 0, y: 0, width: 800, height: 34 };
        const viewport = { width: 1000, height: 700 };
        expect(isTornOff({ x: 300, y: 60 }, bar, viewport)).toBe(false);
        expect(isTornOff({ x: 300, y: 80 }, bar, viewport)).toBe(true);
        expect(isTornOff({ x: 300, y: -5 }, bar, viewport)).toBe(true);
        expect(isTornOff({ x: 1200, y: 10 }, bar, viewport)).toBe(true);
    });
});
