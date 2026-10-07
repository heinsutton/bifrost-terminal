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
