// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { confirmAndMoveBlockToTab, getMoveTargetGroups, isSolePaneInTab, moveBlockToTab } from "@/app/store/blockmove";
import { globalRefocusWithTimeout } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import { cn, fireAndForget } from "@/util/util";
import { memo, useEffect, useMemo, useRef, useState } from "react";

// header rows (window groups, only while the realm has popped-out windows) cannot be selected
type MoveToTabItem = { tabId: string | null; label: string; isHeader?: boolean };

function closeAndRefocus() {
    modalsModel.popModal();
    globalRefocusWithTimeout(50);
}

const MoveToTabModal = memo(({ blockId }: { blockId: string }) => {
    const listRef = useRef<HTMLDivElement>(null);
    const items = useMemo<MoveToTabItem[]>(() => {
        const rtn: MoveToTabItem[] = [];
        for (const group of getMoveTargetGroups()) {
            if (group.label != null) {
                rtn.push({ tabId: null, label: group.label, isHeader: true });
            }
            rtn.push(...group.tabs.map((tab) => ({ tabId: tab.tabId, label: tab.name })));
        }
        if (!isSolePaneInTab()) {
            rtn.push({ tabId: null, label: "New tab" });
        }
        return rtn;
    }, []);
    const selectableIdxs = useMemo(
        () => items.map((item, idx) => (item.isHeader ? -1 : idx)).filter((idx) => idx !== -1),
        [items]
    );
    const [selectedIdx, setSelectedIdx] = useState(() => selectableIdxs[0] ?? 0);

    const stepSelection = (delta: number) => {
        if (selectableIdxs.length === 0) {
            return;
        }
        const pos = Math.max(0, selectableIdxs.indexOf(selectedIdx));
        setSelectedIdx(selectableIdxs[(pos + delta + selectableIdxs.length) % selectableIdxs.length]);
    };

    useEffect(() => {
        listRef.current?.focus();
    }, []);

    const pick = (item: MoveToTabItem) => {
        modalsModel.popModal();
        confirmAndMoveBlockToTab(blockId, item.tabId);
        if (!modalsModel.hasOpenModals()) {
            globalRefocusWithTimeout(50);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            stepSelection(1);
        } else if (e.key === "ArrowUp") {
            stepSelection(-1);
        } else if (e.key === "Enter") {
            if (items[selectedIdx] != null && !items[selectedIdx].isHeader) {
                pick(items[selectedIdx]);
            }
        } else {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
    };

    return (
        <Modal className="min-w-[320px] pb-4" onClose={closeAndRefocus} onClickBackdrop={closeAndRefocus}>
            <div className="mb-2 text-lg font-semibold">Move pane to tab</div>
            <div ref={listRef} tabIndex={0} className="flex flex-col gap-1 outline-none" onKeyDown={handleKeyDown}>
                {items.map((item, idx) =>
                    item.isHeader ? (
                        <div
                            key={`header:${item.label}`}
                            className="px-3 pt-2 pb-0.5 text-xs font-semibold text-muted select-none"
                        >
                            {item.label}
                        </div>
                    ) : (
                        <div
                            key={item.tabId ?? "new"}
                            className={cn(
                                "cursor-pointer rounded px-3 py-1.5",
                                idx === selectedIdx ? "bg-accent/30" : "hover:bg-hoverbg"
                            )}
                            onClick={() => pick(item)}
                            onMouseEnter={() => setSelectedIdx(idx)}
                        >
                            {item.label}
                        </div>
                    )
                )}
            </div>
        </Modal>
    );
});
MoveToTabModal.displayName = "MoveToTabModal";

type MoveToTabConfirmProps = {
    blockId: string;
    destTabId: string;
    // set for a pane dropped in from another window: runs that move instead of moveBlockToTab
    onConfirm?: () => void;
};

const MoveToTabConfirmModal = memo(({ blockId, destTabId, onConfirm }: MoveToTabConfirmProps) => {
    const bodyRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        bodyRef.current?.focus();
    }, []);
    const onOk = () => {
        modalsModel.popModal();
        if (onConfirm != null) {
            onConfirm();
        } else {
            fireAndForget(() => moveBlockToTab(blockId, destTabId));
        }
        globalRefocusWithTimeout(50);
    };
    return (
        <Modal
            className="pt-6 pb-4 px-5 min-w-[400px] max-w-[480px]"
            okLabel="Move"
            cancelLabel="Cancel"
            onOk={onOk}
            onCancel={closeAndRefocus}
            onClose={closeAndRefocus}
        >
            <div
                ref={bodyRef}
                tabIndex={0}
                className="flex flex-col gap-2.5 mx-4 mb-4 outline-none"
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        onOk();
                    }
                }}
            >
                <div className="flex items-center gap-2 pr-10 font-bold text-primary">
                    <i className="fa-sharp fa-solid fa-triangle-exclamation text-attention" />
                    <span>Close this tab?</span>
                </div>
                <div className="text-secondary">This is the only pane in this tab. Moving it will close the tab.</div>
            </div>
        </Modal>
    );
});
MoveToTabConfirmModal.displayName = "MoveToTabConfirmModal";

export { MoveToTabConfirmModal, MoveToTabModal };
