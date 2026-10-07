// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atoms, getApi } from "@/store/global";
import * as WOS from "@/store/wos";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo } from "react";
import { FocusStripHoverZonePx, FocusStripModel, FocusStripSlideMs } from "./focusstrip-model";

function registerFocusStripPeekHandler() {
    getApi().onFocusStripPeek(() => {
        if (globalStore.get(atoms.isFullScreen)) {
            FocusStripModel.getInstance().peek();
        }
    });
}

const FocusStripTab = memo(({ tabId, active }: { tabId: string; active: boolean }) => {
    const tabAtom = useMemo(() => WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)), [tabId]);
    const tabData = useAtomValue(tabAtom);
    const model = FocusStripModel.getInstance();

    const handleClick = () => {
        if (!active) {
            getApi().setActiveTab(tabId);
        }
        model.setHovered(false);
        model.close();
    };

    return (
        <div
            onClick={handleClick}
            className={cn(
                "px-3 py-1 text-sm cursor-pointer rounded-md whitespace-nowrap max-w-[200px] truncate",
                active ? "bg-accent/20 text-accent" : "text-secondary hover:bg-hover hover:text-white"
            )}
        >
            {tabData?.name ?? ""}
        </div>
    );
});
FocusStripTab.displayName = "FocusStripTab";

const FocusTabStrip = memo(() => {
    const model = FocusStripModel.getInstance();
    const state = useAtomValue(model.stateAtom);
    const tabIds = useAtomValue(atoms.windowTabIds);
    const activeTabId = useAtomValue(atoms.staticTabId);
    const open = state !== "closed";

    useEffect(() => {
        return () => model.reset();
    }, []);

    return (
        <>
            <div
                className="absolute top-0 inset-x-0 z-50"
                style={{ height: FocusStripHoverZonePx }}
                onMouseEnter={() => model.openHover()}
                onMouseLeave={() => model.setHovered(false)}
            />
            <div
                aria-hidden={!open}
                inert={!open}
                onMouseEnter={() => model.setHovered(true)}
                onMouseLeave={() => model.setHovered(false)}
                className="absolute top-0 inset-x-0 z-[51] flex flex-row items-center gap-1 px-2 py-1 overflow-x-auto bg-zinc-900/95 border-b border-white/10 transition-[transform,visibility] ease-out motion-reduce:transition-none"
                style={{
                    transform: open ? "translateY(0)" : "translateY(-100%)",
                    visibility: open ? "visible" : "hidden",
                    transitionDuration: `${FocusStripSlideMs}ms`,
                }}
            >
                {tabIds.map((tabId) => (
                    <FocusStripTab key={tabId} tabId={tabId} active={tabId === activeTabId} />
                ))}
            </div>
        </>
    );
});
FocusTabStrip.displayName = "FocusTabStrip";

export { FocusTabStrip, registerFocusStripPeekHandler };
