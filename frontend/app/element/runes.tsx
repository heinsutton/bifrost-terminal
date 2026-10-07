// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn, makeIconClass } from "@/util/util";
import { CSSProperties } from "react";

type RuneSvgProps = {
    path: string;
    color?: string;
    size?: number | string;
    className?: string;
    style?: CSSProperties;
    onClick?: () => void;
};

function RuneSvg({ path, color, size = "1em", className, style, onClick }: RuneSvgProps) {
    return (
        <svg
            viewBox="0 0 12 12"
            width={size}
            height={size}
            fill="none"
            stroke={color ?? "currentColor"}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("shrink-0", className)}
            style={style}
            onClick={onClick}
            aria-hidden="true"
        >
            <path d={path} />
        </svg>
    );
}

const RuneGlyphs: Record<string, string> = {
    algiz: "M6 11V1M6 5L2 1.5M6 5L10 1.5",
    dagaz: "M2 1V11M10 1V11M2 1L10 11M10 1L2 11",
    ansuz: "M3 1V11M3 1.5L9 5M3 5.5L9 9",
    tiwaz: "M6 11V1M2 5L6 1L10 5",
    sowilo: "M9 1L3 4.5L9 7.5L3 11",
    othala: "M6 1L9.5 4.5L6 8L2.5 4.5Z M2.5 4.5L9 11M9.5 4.5L3 11",
    raidho: "M3 1V11M3 1L9 3.5L3 6M3 6L9 11",
    fehu: "M3 1V11M3 4.5L9 1M3 8.5L9 5",
};

const RunePrefix = "rune@";

function getRuneName(icon: string): string | null {
    return icon.startsWith(RunePrefix) ? icon.slice(RunePrefix.length) : null;
}

export function AlgizRune({ color }: { color: string }) {
    return <RuneSvg path={RuneGlyphs.algiz} color={color} size={12} />;
}

export function DagazRune(props: Omit<RuneSvgProps, "path">) {
    return <RuneSvg path={RuneGlyphs.dagaz} {...props} />;
}

export const DagazWorkspaceIcon = "rune@dagaz";

const LegacyWaveWorkspaceIcons = new Set(["custom@wave-logo-solid", "custom@wave-logo-outline"]);

export function resolveWorkspaceIcon(icon: string): string {
    return LegacyWaveWorkspaceIcons.has(icon) ? DagazWorkspaceIcon : icon;
}

type WorkspaceIconProps = {
    icon: string;
    fw?: boolean;
    color?: string;
    className?: string;
    onClick?: () => void;
};

export function WorkspaceIcon({ icon, fw, color, className, onClick }: WorkspaceIconProps) {
    const resolved = resolveWorkspaceIcon(icon);
    const runeName = getRuneName(resolved);
    if (runeName != null) {
        return (
            <RuneSvg
                path={RuneGlyphs[runeName] ?? RuneGlyphs.dagaz}
                color={color}
                className={className}
                onClick={onClick}
            />
        );
    }
    return <i className={cn(makeIconClass(resolved, fw), className)} style={{ color }} onClick={onClick} />;
}
