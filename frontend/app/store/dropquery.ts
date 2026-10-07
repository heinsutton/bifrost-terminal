// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi, globalStore } from "@/app/store/global";
import { countCentersBefore, DropQueryResult } from "@/util/tabdragutil";
import { atom, PrimitiveAtom } from "jotai";

// where a tab dragged in from another window would land in this window's tab bar (null = no hint)
export const tabDropHintAtom = atom(null) as PrimitiveAtom<number>;

// Answers emain's question "where in this window would a tab dropped at (x, y) go?" for a tab
// dragged in from another window. x/y are client coordinates of this tab view.
function answerDropQuery(x: number, y: number): DropQueryResult {
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
        return { area: "none" };
    }
    const vtabBar = document.querySelector<HTMLElement>("[data-vtabbar]");
    if (vtabBar != null && pointInElement(vtabBar, x, y)) {
        const centers = Array.from(vtabBar.querySelectorAll<HTMLElement>("[data-tabid]")).map((elem) => {
            const rect = elem.getBoundingClientRect();
            return rect.top + rect.height / 2;
        });
        return { area: "tabbar", tabIndex: countCentersBefore(y, centers) };
    }
    const tabBar = document.querySelector<HTMLElement>(".tab-bar-wrapper");
    if (tabBar != null && pointInElement(tabBar, x, y)) {
        const centers = Array.from(tabBar.querySelectorAll<HTMLElement>("[data-tab-id]")).map((elem) => {
            const rect = elem.getBoundingClientRect();
            return rect.left + rect.width / 2;
        });
        if (centers.length > 0) {
            return { area: "tabbar", tabIndex: countCentersBefore(x, centers) };
        }
    }
    return { area: "content" };
}

function pointInElement(elem: HTMLElement, x: number, y: number): boolean {
    const rect = elem.getBoundingClientRect();
    return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

export function setTabDragCursor(dragging: boolean) {
    document.documentElement.classList.toggle("tab-dragging", dragging);
}

function updateDropHint(x: number, y: number) {
    let index: number = null;
    if (x != null && y != null) {
        try {
            const result = answerDropQuery(x, y);
            index = result.area === "tabbar" ? (result.tabIndex ?? null) : null;
        } catch (e) {
            console.log("error computing drop hint", e);
        }
    }
    if (globalStore.get(tabDropHintAtom) !== index) {
        globalStore.set(tabDropHintAtom, index);
    }
}

export function registerDropQueryHandler() {
    getApi().onDragHover(updateDropHint);
    getApi().onDropQuery((reqId, x, y) => {
        let result: DropQueryResult = { area: "content" };
        try {
            result = answerDropQuery(x, y);
        } catch (e) {
            console.log("error answering drop query", e);
        }
        getApi().sendDropQueryResult(reqId, result);
    });
}
