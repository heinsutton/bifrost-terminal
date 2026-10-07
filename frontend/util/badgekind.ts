// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type BadgeKind = "attention" | "bell" | "done";
export type BadgeRuneName = "naudiz" | "dagaz";

export const AttentionColor = "#ff9e64";
export const DoneColor = "#7ee787";

export const AllBadgeKinds: BadgeKind[] = ["attention", "bell", "done"];

export function getBadgeKind(badge: Pick<Badge, "icon"> | null | undefined): BadgeKind | null {
    switch (badge?.icon) {
        case "bell-exclamation":
        case "message-question":
            return "attention";
        case "bell":
            return "bell";
        case "check":
            return "done";
        default:
            return null;
    }
}

export function getBadgeVisual(
    badge: Pick<Badge, "icon"> | null | undefined
): { kind: BadgeKind; rune: BadgeRuneName; color: string } | null {
    const kind = getBadgeKind(badge);
    if (kind == null) {
        return null;
    }
    if (kind === "done") {
        return { kind, rune: "dagaz", color: DoneColor };
    }
    return { kind, rune: "naudiz", color: AttentionColor };
}

export function shouldNotifyForBadge(params: {
    kind: BadgeKind | null;
    enabledKinds: string[] | null | undefined;
    isLooking: boolean;
}): boolean {
    if (params.kind == null || params.isLooking) {
        return false;
    }
    return params.enabledKinds?.includes(params.kind) ?? false;
}

export function cmpBadge(a: Badge, b: Badge): number {
    if (a.priority !== b.priority) {
        return a.priority > b.priority ? 1 : -1;
    }
    if (a.badgeid !== b.badgeid) {
        return a.badgeid > b.badgeid ? 1 : -1;
    }
    return 0;
}
