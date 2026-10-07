// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";

export type FocusStripState = "closed" | "hover" | "peek";

export const FocusStripPeekMs = 2500;
export const FocusStripCloseDelayMs = 300;
export const FocusStripSlideMs = 150;
export const FocusStripHoverZonePx = 4;

export class FocusStripModel {
    private static instance: FocusStripModel;

    stateAtom: jotai.PrimitiveAtom<FocusStripState> = jotai.atom<FocusStripState>("closed");
    hoveredAtom: jotai.PrimitiveAtom<boolean> = jotai.atom(false);
    private peekTimer: ReturnType<typeof setTimeout> | null = null;
    private closeTimer: ReturnType<typeof setTimeout> | null = null;

    static getInstance(): FocusStripModel {
        if (FocusStripModel.instance == null) {
            FocusStripModel.instance = new FocusStripModel();
        }
        return FocusStripModel.instance;
    }

    private clearPeekTimer() {
        if (this.peekTimer != null) {
            clearTimeout(this.peekTimer);
            this.peekTimer = null;
        }
    }

    private clearCloseTimer() {
        if (this.closeTimer != null) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }
    }

    openHover() {
        this.clearCloseTimer();
        globalStore.set(this.hoveredAtom, true);
        globalStore.set(this.stateAtom, "hover");
    }

    peek() {
        this.clearPeekTimer();
        if (globalStore.get(this.stateAtom) !== "hover") {
            globalStore.set(this.stateAtom, "peek");
        }
        this.peekTimer = setTimeout(() => {
            this.peekTimer = null;
            this.close();
        }, FocusStripPeekMs);
    }

    setHovered(hovered: boolean) {
        globalStore.set(this.hoveredAtom, hovered);
        this.clearCloseTimer();
        if (hovered) {
            return;
        }
        this.closeTimer = setTimeout(() => {
            this.closeTimer = null;
            this.close();
        }, FocusStripCloseDelayMs);
    }

    close() {
        if (globalStore.get(this.hoveredAtom)) {
            return;
        }
        this.clearPeekTimer();
        globalStore.set(this.stateAtom, "closed");
    }

    reset() {
        this.clearPeekTimer();
        this.clearCloseTimer();
        globalStore.set(this.hoveredAtom, false);
        globalStore.set(this.stateAtom, "closed");
    }
}
