// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import * as jotai from "jotai";
import * as React from "react";
import { ClaudeSessionsView } from "./claudesessions";
import { buildRows, edgeSelection, foldAction, groupKey, indexOfKey, moveSelection, Row } from "./claudesessions-nav";

type ClaudeSessionsEnv = WaveEnvSubset<{
    rpc: {
        ClaudeSessionsListCommand: WaveEnv["rpc"]["ClaudeSessionsListCommand"];
    };
}>;

const PollIntervalMs = 3000;
const DefaultPageSize = 10;

function isPlain(e: WaveKeyboardEvent, key: string): boolean {
    return e.key === key && !e.control && !e.alt && !e.cmd && !e.meta && !e.option;
}

export class ClaudeSessionsViewModel implements ViewModel {
    viewType = "claudesessions";
    blockId: string;
    env: ClaudeSessionsEnv;

    viewIcon = jotai.atom<string>("robot");
    viewName = jotai.atom<string>("Claude Sessions");
    noPadding = jotai.atom<boolean>(true);

    dataAtom = jotai.atom<ClaudeListResult>(null) as jotai.PrimitiveAtom<ClaudeListResult>;
    errorAtom = jotai.atom<string>(null) as jotai.PrimitiveAtom<string>;
    selectedKeyAtom = jotai.atom<string>(null) as jotai.PrimitiveAtom<string>;
    collapsedAtom = jotai.atom<Set<string>>(new Set<string>());
    filterAtom = jotai.atom<string>("");
    filterOpenAtom = jotai.atom<boolean>(false);
    showOfflineAtom = jotai.atom<boolean>(true);
    helpOpenAtom = jotai.atom<boolean>(false);
    rowsAtom: jotai.Atom<Row[]>;

    containerRef = React.createRef<HTMLDivElement>();
    filterInputRef = React.createRef<HTMLInputElement>();
    pageSize = DefaultPageSize;
    disposed = false;
    pollTimer: ReturnType<typeof setTimeout> | null = null;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.env = waveEnv;
        this.rowsAtom = jotai.atom((get) =>
            buildRows(get(this.dataAtom)?.sessions ?? [], {
                collapsed: get(this.collapsedAtom),
                filter: get(this.filterAtom),
                showOffline: get(this.showOfflineAtom),
                descriptions: get(this.dataAtom)?.descriptions ?? {},
            })
        );
        this.poll();
    }

    get viewComponent(): ViewComponent {
        return ClaudeSessionsView;
    }

    async poll() {
        if (this.disposed) {
            return;
        }
        try {
            const data = await this.env.rpc.ClaudeSessionsListCommand(TabRpcClient);
            if (!this.disposed) {
                globalStore.set(this.dataAtom, data);
                globalStore.set(this.errorAtom, null);
            }
        } catch (e) {
            if (!this.disposed) {
                globalStore.set(this.errorAtom, String(e));
            }
        }
        if (!this.disposed) {
            this.pollTimer = setTimeout(() => this.poll(), PollIntervalMs);
        }
    }

    giveFocus(): boolean {
        if (globalStore.get(this.filterOpenAtom) && this.filterInputRef.current != null) {
            this.filterInputRef.current.focus();
            return true;
        }
        if (this.containerRef.current == null) {
            return false;
        }
        this.containerRef.current.focus({ preventScroll: true });
        return true;
    }

    select(key: string) {
        if (key != null) {
            globalStore.set(this.selectedKeyAtom, key);
        }
    }

    // The selection can vanish when a session disappears or a filter hides it; it then falls back
    // to the first row so the keyboard always has a starting point.
    currentKey(): string {
        const rows = globalStore.get(this.rowsAtom);
        const key = globalStore.get(this.selectedKeyAtom);
        return indexOfKey(rows, key) >= 0 ? key : null;
    }

    move(delta: number) {
        this.select(moveSelection(globalStore.get(this.rowsAtom), this.currentKey(), delta));
    }

    toggleGroup(cwd: string) {
        const next = new Set(globalStore.get(this.collapsedAtom));
        if (next.has(cwd)) {
            next.delete(cwd);
        } else {
            next.add(cwd);
        }
        globalStore.set(this.collapsedAtom, next);
        this.select(groupKey(cwd));
    }

    fold(dir: "left" | "right") {
        const key = this.currentKey();
        if (key == null) {
            return;
        }
        const action = foldAction(globalStore.get(this.rowsAtom), key, dir);
        if (action.toggle != null) {
            this.toggleGroup(action.toggle);
        }
        if (action.select != null) {
            this.select(action.select);
        }
    }

    activate() {
        const rows = globalStore.get(this.rowsAtom);
        const row = rows[indexOfKey(rows, this.currentKey())];
        if (row?.kind === "group") {
            this.toggleGroup(row.cwd);
        }
    }

    openFilter() {
        globalStore.set(this.filterOpenAtom, true);
        setTimeout(() => this.filterInputRef.current?.focus(), 0);
    }

    closeFilter(clear: boolean) {
        if (clear) {
            globalStore.set(this.filterAtom, "");
        }
        globalStore.set(this.filterOpenAtom, globalStore.get(this.filterAtom) !== "");
        this.giveFocus();
    }

    toggleOffline() {
        globalStore.set(this.showOfflineAtom, !globalStore.get(this.showOfflineAtom));
    }

    toggleHelp() {
        globalStore.set(this.helpOpenAtom, !globalStore.get(this.helpOpenAtom));
    }

    keyDownHandler(e: WaveKeyboardEvent): boolean {
        if (e.control || e.alt || e.cmd || e.meta || e.option) {
            return false;
        }
        if (globalStore.get(this.helpOpenAtom)) {
            if (e.key === "Escape" || e.key === "?" || e.key === "Enter") {
                this.toggleHelp();
                return true;
            }
            return false;
        }
        const rows = globalStore.get(this.rowsAtom);
        switch (e.key) {
            case "ArrowDown":
            case "j":
                this.move(1);
                return true;
            case "ArrowUp":
            case "k":
                this.move(-1);
                return true;
            case "PageDown":
                this.move(this.pageSize);
                return true;
            case "PageUp":
                this.move(-this.pageSize);
                return true;
            case "Home":
            case "g":
                this.select(edgeSelection(rows, false));
                return true;
            case "End":
            case "G":
                this.select(edgeSelection(rows, true));
                return true;
            case "ArrowLeft":
            case "h":
                this.fold("left");
                return true;
            case "ArrowRight":
            case "l":
                this.fold("right");
                return true;
            case "Enter":
            case " ":
                this.activate();
                return true;
            case "Escape":
                if (globalStore.get(this.filterAtom) !== "") {
                    this.closeFilter(true);
                    return true;
                }
                return false;
        }
        if (isPlain(e, "/")) {
            this.openFilter();
            return true;
        }
        if (isPlain(e, "o")) {
            this.toggleOffline();
            return true;
        }
        if (isPlain(e, "?")) {
            this.toggleHelp();
            return true;
        }
        return false;
    }

    dispose() {
        this.disposed = true;
        if (this.pollTimer != null) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }
}
