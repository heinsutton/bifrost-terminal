// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/shadcn/lib/utils";
import * as jotai from "jotai";
import * as React from "react";
import { ClaudeSessionsViewModel } from "./claudesessions-model";
import { displayName, formatAge, Row, SessionRow, SessionState, shortenPath } from "./claudesessions-nav";

const RowHeight = 22;
const RuleFill = "─".repeat(300);

const StateGlyph: Record<SessionState, { glyph: string; className: string; label: string }> = {
    busy: { glyph: "●", className: "text-success", label: "busy" },
    idle: { glyph: "○", className: "text-accent", label: "idle" },
    offline: { glyph: "·", className: "text-muted", label: "offline" },
};

const HelpKeys: [string, string][] = [
    ["↑ ↓  j k", "move"],
    ["← →  h l", "close / open folder, jump to folder"],
    ["PgUp PgDn", "move a page"],
    ["Home End  g G", "first / last"],
    ["Enter  Space", "open / close folder"],
    ["/", "filter (Esc clears)"],
    ["o", "show / hide offline sessions"],
    ["?", "this help"],
    ["mouse", "click selects · click a folder to fold · right-click for actions"],
];

function getHome(): string {
    try {
        return getApi().getEnv("HOME") || getApi().getEnv("USERPROFILE") || "";
    } catch (_) {
        return "";
    }
}

type RowProps = {
    row: Row;
    selected: boolean;
    last: boolean;
    now: number;
    home: string;
    description: string;
    model: ClaudeSessionsViewModel;
};

const GroupLine = React.memo(({ row, selected, home, model }: RowProps & { row: Extract<Row, { kind: "group" }> }) => {
    return (
        <div
            data-rowkey={row.key}
            className={cn(
                "flex items-center gap-2 px-2 cursor-pointer border-l-2 whitespace-nowrap",
                selected ? "bg-highlightbg border-accent" : "border-transparent hover:bg-hover"
            )}
            style={{ height: RowHeight }}
            onClick={() => {
                model.containerRef.current?.focus({ preventScroll: true });
                model.toggleGroup(row.cwd);
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                model.select(row.key);
                const menu: ContextMenuItem[] = [
                    { label: "Copy folder", click: () => navigator.clipboard.writeText(row.cwd) },
                    {
                        label: row.collapsed ? "Open folder group" : "Close folder group",
                        click: () => model.toggleGroup(row.cwd),
                    },
                ];
                ContextMenuModel.getInstance().showContextMenu(menu, e);
            }}
        >
            <span className="text-accent w-3 text-center">{row.collapsed ? "▸" : "▾"}</span>
            <span className={cn("shrink-0 max-w-[60%] truncate", selected ? "text-accenthover" : "text-accent")}>
                {shortenPath(row.cwd, home)}
            </span>
            <span className="flex-1 overflow-hidden text-border select-none" aria-hidden="true">
                {RuleFill}
            </span>
            <span className="text-muted-foreground shrink-0">
                {row.count}
                {row.running > 0 ? <span className="text-success"> · {row.running} running</span> : null}
            </span>
        </div>
    );
});
GroupLine.displayName = "GroupLine";

const SessionLine = React.memo(({ row, selected, last, now, description, model }: RowProps & { row: SessionRow }) => {
    const s = row.session;
    const st = StateGlyph[row.state];
    const hasName = !!s.name;
    return (
        <div
            data-rowkey={row.key}
            className={cn(
                "flex items-center gap-2 px-2 cursor-pointer border-l-2 whitespace-nowrap",
                selected ? "bg-highlightbg border-accent" : "border-transparent hover:bg-hover"
            )}
            style={{ height: RowHeight }}
            onClick={() => {
                model.containerRef.current?.focus({ preventScroll: true });
                model.select(row.key);
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                model.select(row.key);
                const menu: ContextMenuItem[] = [
                    { label: "Copy session ID", click: () => navigator.clipboard.writeText(s.sessionid) },
                    { label: "Copy folder", click: () => navigator.clipboard.writeText(row.cwd) },
                ];
                ContextMenuModel.getInstance().showContextMenu(menu, e);
            }}
        >
            <span className="text-border w-3 text-center select-none">{last ? "└" : "├"}</span>
            <span className={cn("w-3 text-center", st.className)} title={st.label}>
                {st.glyph}
            </span>
            <span
                className={cn(
                    "truncate",
                    hasName ? "w-[24ch] shrink-0" : "w-[24ch] shrink-0 text-muted-foreground",
                    row.state === "offline" && hasName && "text-secondary"
                )}
                title={s.sessionid}
            >
                {displayName(s)}
            </span>
            <span className="w-[4ch] shrink-0 text-right text-muted-foreground">{formatAge(s.lastactive, now)}</span>
            {description ? (
                <span className="truncate text-foreground">{description}</span>
            ) : (
                <span className="truncate text-muted">{s.preview}</span>
            )}
        </div>
    );
});
SessionLine.displayName = "SessionLine";

const DetailStrip = React.memo(({ row, home }: { row: Row; home: string }) => {
    if (row == null) {
        return <div className="px-2 h-[22px]" />;
    }
    if (row.kind === "group") {
        return (
            <div className="px-2 text-muted-foreground truncate" style={{ height: RowHeight }}>
                {row.cwd === "" ? "(unknown folder)" : row.cwd}
            </div>
        );
    }
    const s = row.session;
    return (
        <div className="px-2 text-muted-foreground truncate" style={{ height: RowHeight }}>
            <span className="text-accent">{s.sessionid}</span>
            {s.version ? <span> · v{s.version}</span> : null}
            <span> · {shortenPath(row.cwd, home)}</span>
        </div>
    );
});
DetailStrip.displayName = "DetailStrip";

export const ClaudeSessionsView: React.FC<ViewComponentProps<ClaudeSessionsViewModel>> = React.memo(
    function ClaudeSessionsView({ model }) {
        const data = jotai.useAtomValue(model.dataAtom);
        const error = jotai.useAtomValue(model.errorAtom);
        const rows = jotai.useAtomValue(model.rowsAtom);
        const selectedKey = jotai.useAtomValue(model.selectedKeyAtom);
        const filter = jotai.useAtomValue(model.filterAtom);
        const filterOpen = jotai.useAtomValue(model.filterOpenAtom);
        const showOffline = jotai.useAtomValue(model.showOfflineAtom);
        const helpOpen = jotai.useAtomValue(model.helpOpenAtom);
        const listRef = React.useRef<HTMLDivElement>(null);
        const home = React.useMemo(getHome, []);
        const [now, setNow] = React.useState(() => Date.now());

        React.useEffect(() => {
            const timer = setInterval(() => setNow(Date.now()), 30000);
            return () => clearInterval(timer);
        }, []);

        const effectiveKey = rows.some((r) => r.key === selectedKey) ? selectedKey : (rows[0]?.key ?? null);
        React.useEffect(() => {
            if (effectiveKey != null && effectiveKey !== selectedKey) {
                globalStore.set(model.selectedKeyAtom, effectiveKey);
            }
        }, [effectiveKey, selectedKey]);

        React.useEffect(() => {
            if (effectiveKey == null || listRef.current == null) {
                return;
            }
            const el = listRef.current.querySelector(`[data-rowkey="${CSS.escape(effectiveKey)}"]`);
            el?.scrollIntoView({ block: "nearest" });
        }, [effectiveKey]);

        React.useEffect(() => {
            const el = listRef.current;
            if (el == null) {
                return;
            }
            const update = () => {
                model.pageSize = Math.max(1, Math.floor(el.clientHeight / RowHeight) - 1);
            };
            update();
            const ro = new ResizeObserver(update);
            ro.observe(el);
            return () => ro.disconnect();
        }, []);

        const sessions = data?.sessions ?? [];
        const running = sessions.filter((s) => s.pid != null && s.pid > 0).length;
        const folderCount = new Set(sessions.map((s) => s.cwd ?? "")).size;
        const selectedRow = rows.find((r) => r.key === effectiveKey) ?? null;
        const descriptions = data?.descriptions ?? {};

        return (
            <div
                ref={model.containerRef}
                tabIndex={0}
                className="relative flex flex-col w-full h-full min-h-0 font-mono text-[13px] leading-none bg-background text-foreground outline-none select-none"
            >
                <div
                    className="flex items-center gap-3 px-2 border-b border-border text-muted-foreground whitespace-nowrap"
                    style={{ height: RowHeight + 4 }}
                >
                    <span className="text-accent">{sessions.length} sessions</span>
                    <span className={running > 0 ? "text-success" : ""}>{running} running</span>
                    <span>{folderCount} folders</span>
                    {!showOffline ? <span className="text-attention">offline hidden</span> : null}
                    <span className="flex-1" />
                    <span className="text-muted">? help</span>
                </div>
                {filterOpen ? (
                    <div
                        className="flex items-center gap-2 px-2 border-b border-border"
                        style={{ height: RowHeight + 4 }}
                    >
                        <span className="text-accent">/</span>
                        <input
                            ref={model.filterInputRef}
                            value={filter}
                            onChange={(e) => globalStore.set(model.filterAtom, e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    model.closeFilter(true);
                                } else if (e.key === "Enter" || e.key === "ArrowDown") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    model.closeFilter(false);
                                }
                            }}
                            placeholder="filter name, id, folder, description, prompt"
                            className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted select-text"
                            spellCheck={false}
                        />
                    </div>
                ) : null}
                {error ? <div className="px-2 py-1 text-error truncate">{error}</div> : null}
                <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                    {data == null && !error ? <div className="px-2 py-2 text-muted-foreground">loading…</div> : null}
                    {data != null && rows.length === 0 ? (
                        <div className="px-2 py-2 text-muted-foreground">
                            {filter !== "" ? "no sessions match the filter" : "no Claude Code sessions found"}
                        </div>
                    ) : null}
                    {rows.map((row, i) => {
                        const selected = row.key === effectiveKey;
                        const last = rows[i + 1] == null || rows[i + 1].kind === "group";
                        if (row.kind === "group") {
                            return (
                                <GroupLine
                                    key={row.key}
                                    row={row}
                                    selected={selected}
                                    last={last}
                                    now={now}
                                    home={home}
                                    description=""
                                    model={model}
                                />
                            );
                        }
                        return (
                            <SessionLine
                                key={row.key}
                                row={row}
                                selected={selected}
                                last={last}
                                now={now}
                                home={home}
                                description={descriptions[row.session.sessionid] ?? ""}
                                model={model}
                            />
                        );
                    })}
                </div>
                <div className="border-t border-border">
                    <DetailStrip row={selectedRow} home={home} />
                    <div className="px-2 text-muted whitespace-nowrap overflow-hidden" style={{ height: RowHeight }}>
                        ↑↓ move · ←→ fold · / filter · o offline · ? help
                    </div>
                </div>
                {helpOpen ? (
                    <div
                        className="absolute inset-0 flex items-center justify-center bg-background/80"
                        onClick={() => model.toggleHelp()}
                    >
                        <div
                            className="border border-accent bg-modalbg px-4 py-3 max-w-full overflow-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="text-accent mb-2">Claude Sessions — keys</div>
                            {HelpKeys.map(([k, d]) => (
                                <div key={k} className="flex gap-3 leading-5 whitespace-nowrap">
                                    <span className="w-[16ch] shrink-0 text-accent">{k}</span>
                                    <span className="text-foreground">{d}</span>
                                </div>
                            ))}
                            <div className="mt-2 leading-5 text-muted-foreground">
                                <span className="text-success">●</span> busy · <span className="text-accent">○</span>{" "}
                                idle · <span className="text-muted">·</span> offline
                            </div>
                            <div className="mt-2 text-muted">Esc closes</div>
                        </div>
                    </div>
                ) : null}
            </div>
        );
    }
);
ClaudeSessionsView.displayName = "ClaudeSessionsView";
