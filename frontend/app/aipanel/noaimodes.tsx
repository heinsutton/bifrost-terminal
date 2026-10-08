// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { BYOKAnnouncement } from "./byokannouncement";

interface NoAIModesMessageProps {
    inBuilder: boolean;
    className?: string;
}

const NoAIModesMessage = ({ inBuilder, className }: NoAIModesMessageProps) => {
    return (
        <div className={cn("flex flex-col h-full", className)}>
            <div className="flex-grow"></div>
            <div className="flex items-center justify-center p-8 text-center">
                <div className="max-w-md space-y-4">
                    <i className="fa fa-sparkles text-accent text-5xl"></i>
                    <h2 className="text-2xl font-semibold text-foreground">No AI mode configured</h2>
                    <p className="text-secondary leading-relaxed">
                        {inBuilder
                            ? "The app builder needs an AI mode that you configure yourself. Add a bring-your-own-key or local model mode to use it."
                            : "Bifrost Terminal does not include a hosted AI service. Add a bring-your-own-key or local model mode to use the AI panel."}
                    </p>
                    <BYOKAnnouncement />
                </div>
            </div>
            <div className="flex-grow-[2]"></div>
        </div>
    );
};

NoAIModesMessage.displayName = "NoAIModesMessage";

export { NoAIModesMessage };
