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

export function AlgizRune({ color }: { color: string }) {
    return <RuneSvg path="M6 11V1M6 5L2 1.5M6 5L10 1.5" color={color} size={12} />;
}

export function DagazRune(props: Omit<RuneSvgProps, "path">) {
    return <RuneSvg path="M2 1V11M10 1V11M2 1L10 11M10 1L2 11" {...props} />;
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
    if (resolved === DagazWorkspaceIcon) {
        return <DagazRune color={color} className={className} onClick={onClick} />;
    }
    return <i className={cn(makeIconClass(resolved, fw), className)} style={{ color }} onClick={onClick} />;
}
