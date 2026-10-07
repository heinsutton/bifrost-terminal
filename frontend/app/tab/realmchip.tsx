// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WorkspaceIcon } from "@/app/element/runes";
import { Tooltip } from "@/app/element/tooltip";
import { useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { useAtomValue } from "jotai";
import { memo } from "react";

export type RealmChipEnv = WaveEnvSubset<{
    electron: {
        focusMainWindow: WaveEnv["electron"]["focusMainWindow"];
    };
    atoms: {
        workspace: WaveEnv["atoms"]["workspace"];
    };
}>;

// shown in place of the realm switcher in a popped-out window; clicking it focuses the realm's main window
const RealmChip = memo(({ divRef }: { divRef?: React.RefObject<HTMLDivElement> }) => {
    const env = useWaveEnv<RealmChipEnv>();
    const workspace = useAtomValue(env.atoms.workspace);
    const isSaved = !!(workspace?.name && workspace?.icon);

    return (
        <Tooltip
            content="Focus Main Window"
            placement="bottom"
            hideOnClick
            divRef={divRef}
            divClassName="flex h-[22px] mb-1 mr-1 px-2 items-center gap-1.5 rounded-md box-border cursor-pointer bg-hover hover:bg-hoverbg transition-colors text-[12px] text-secondary hover:text-primary select-none"
            divStyle={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            divOnClick={() => env.electron.focusMainWindow()}
        >
            <span>↗</span>
            {isSaved && <WorkspaceIcon icon={workspace.icon} color={workspace.color} className="w-3.5 h-3.5" />}
            <span className="max-w-[160px] truncate">{workspace?.name || "Bifrost Terminal"}</span>
        </Tooltip>
    );
});
RealmChip.displayName = "RealmChip";

export { RealmChip };
