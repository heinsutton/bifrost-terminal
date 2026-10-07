// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure helpers for dragging tabs between windows (used by emain and the renderer).

export type DragPoint = { x: number; y: number };
export type DragRect = { x: number; y: number; width: number; height: number };

export type DropWindowCandidate = {
    id: string;
    bounds: DragRect;
    visible: boolean;
};

export type DropQueryArea = "tabbar" | "content" | "none";

export type DropQueryResult = {
    area: DropQueryArea;
    tabIndex?: number;
};

export function pointInRect(point: DragPoint, rect: DragRect): boolean {
    return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

// candidates are ordered most recently focused first (Electron exposes no z-order)
export function pickDropWindow(point: DragPoint, candidates: DropWindowCandidate[]): string {
    for (const candidate of candidates) {
        if (candidate.visible && pointInRect(point, candidate.bounds)) {
            return candidate.id;
        }
    }
    return null;
}

// screen point (DIP) -> renderer client coordinates of a window's content view
export function toClientPoint(screenPoint: DragPoint, contentBounds: DragRect, zoomFactor: number): DragPoint {
    const zoom = zoomFactor > 0 ? zoomFactor : 1;
    return { x: (screenPoint.x - contentBounds.x) / zoom, y: (screenPoint.y - contentBounds.y) / zoom };
}

// drop index in a tab bar: the number of tabs whose center lies before pos
export function countCentersBefore(pos: number, centers: number[]): number {
    return centers.filter((center) => center < pos).length;
}

// a tab dragged this far away from its bar (or out of the window) is torn off instead of reordered
export const TabTearOffDistancePx = 40;

export function isTornOff(point: DragPoint, barRect: DragRect, viewport: { width: number; height: number }) {
    if (point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height) {
        return true;
    }
    return (
        point.x < barRect.x - TabTearOffDistancePx ||
        point.x > barRect.x + barRect.width + TabTearOffDistancePx ||
        point.y < barRect.y - TabTearOffDistancePx ||
        point.y > barRect.y + barRect.height + TabTearOffDistancePx
    );
}

// A pane dragged (HTML5, react-dnd) out of its window carries its identity in custom dataTransfer
// types so other windows can tell, while hovering, whether they may accept it (data values are only
// readable on drop).
export const PaneDragMime = "application/x-bifrost-pane";
export const PaneDragSoleMime = "application/x-bifrost-pane-sole";
export const PaneDragRealmMimePrefix = "application/x-bifrost-realm-";

export type PaneDragTypesInfo = { isPane: boolean; sameRealm: boolean; isSolePane: boolean };

export function parsePaneDragTypes(types: readonly string[], workspaceId: string): PaneDragTypesInfo {
    const typeList = Array.from(types ?? []);
    const isPane = typeList.includes(PaneDragMime);
    return {
        isPane,
        sameRealm:
            isPane && workspaceId != null && typeList.includes(PaneDragRealmMimePrefix + workspaceId.toLowerCase()),
        isSolePane: isPane && typeList.includes(PaneDragSoleMime),
    };
}

export type PaneDropSide = "left" | "right" | "top" | "bottom";

// the edge of rect nearest to point (a dropped pane splits that side)
export function getPaneDropSide(rect: DragRect, point: DragPoint): PaneDropSide {
    const fx = rect.width > 0 ? (point.x - rect.x) / rect.width : 0.5;
    const fy = rect.height > 0 ? (point.y - rect.y) / rect.height : 0.5;
    const distances: [PaneDropSide, number][] = [
        ["left", fx],
        ["right", 1 - fx],
        ["top", fy],
        ["bottom", 1 - fy],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][0];
}
