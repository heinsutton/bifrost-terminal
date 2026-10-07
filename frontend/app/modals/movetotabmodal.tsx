// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { confirmAndMoveBlockToTab, getOtherTabs, isSolePaneInTab, moveBlockToTab } from "@/app/store/blockmove";
import { globalRefocusWithTimeout } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import { cn, fireAndForget } from "@/util/util";
import { memo, useEffect, useMemo, useRef, useState } from "react";

type MoveToTabItem = { tabId: string | null; label: string };

function closeAndRefocus() {
    modalsModel.popModal();
    globalRefocusWithTimeout(50);
}

const MoveToTabModal = memo(({ blockId }: { blockId: string }) => {
    const listRef = useRef<HTMLDivElement>(null);
    const items = useMemo<MoveToTabItem[]>(() => {
        const rtn: MoveToTabItem[] = getOtherTabs().map((tab) => ({ tabId: tab.tabId, label: tab.name }));
        if (!isSolePaneInTab()) {
            rtn.push({ tabId: null, label: "New tab" });
        }
        return rtn;
    }, []);
    const [selectedIdx, setSelectedIdx] = useState(0);

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
            setSelectedIdx((idx) => (idx + 1) % items.length);
        } else if (e.key === "ArrowUp") {
            setSelectedIdx((idx) => (idx - 1 + items.length) % items.length);
        } else if (e.key === "Enter") {
            if (items[selectedIdx] != null) {
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
                {items.map((item, idx) => (
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
                ))}
            </div>
        </Modal>
    );
});
MoveToTabModal.displayName = "MoveToTabModal";

const MoveToTabConfirmModal = memo(({ blockId, destTabId }: { blockId: string; destTabId: string }) => {
    const bodyRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        bodyRef.current?.focus();
    }, []);
    const onOk = () => {
        modalsModel.popModal();
        fireAndForget(() => moveBlockToTab(blockId, destTabId));
        globalRefocusWithTimeout(50);
    };
    return (
        <Modal
            className="message-modal"
            okLabel="Move"
            cancelLabel="Cancel"
            onOk={onOk}
            onCancel={closeAndRefocus}
            onClose={closeAndRefocus}
        >
            <div
                ref={bodyRef}
                tabIndex={0}
                className="outline-none"
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        onOk();
                    }
                }}
            >
                This is the only pane in this tab - the tab will be closed. Move anyway?
            </div>
        </Modal>
    );
});
MoveToTabConfirmModal.displayName = "MoveToTabConfirmModal";

export { MoveToTabConfirmModal, MoveToTabModal };
