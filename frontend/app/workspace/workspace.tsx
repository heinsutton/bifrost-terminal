// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIPanel } from "@/app/aipanel/aipanel";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { FocusTabStrip } from "@/app/tab/focustabstrip";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { VTabBar } from "@/app/tab/vtabbar";
import { Widgets } from "@/app/workspace/widgets";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { atoms, getApi, getSettingsKeyAtom } from "@/store/global";
import { isMacOS } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef, useState } from "react";
import {
    ImperativePanelGroupHandle,
    ImperativePanelHandle,
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from "react-resizable-panels";

const MacOSTabBarSpacer = memo(() => {
    return (
        <div
            className="w-full shrink-0"
            style={
                {
                    height: "calc(8px * var(--zoomfactor-inv))",
                    WebkitAppRegion: "drag",
                    backdropFilter: "blur(20px)",
                    background: "rgba(0, 0, 0, 0.35)",
                } as React.CSSProperties
            }
        />
    );
});
MacOSTabBarSpacer.displayName = "MacOSTabBarSpacer";

const WidgetsSidebarWidth = 48;
const WidgetsSidebarOverlap = 4;
const WidgetsSidebarSlideMs = 180;

const WidgetsSlot = memo(({ visible }: { visible: boolean }) => {
    const [animate, setAnimate] = useState(false);
    useEffect(() => {
        const frame = requestAnimationFrame(() => setAnimate(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    return (
        <div
            aria-hidden={!visible}
            inert={!visible}
            className={cn(
                "flex flex-row shrink-0 overflow-hidden",
                animate && "transition-[width,margin-left,visibility] ease-out motion-reduce:transition-none"
            )}
            style={{
                width: visible ? WidgetsSidebarWidth : 0,
                marginLeft: visible ? -WidgetsSidebarOverlap : 0,
                visibility: visible ? "visible" : "hidden",
                transitionDuration: `${WidgetsSidebarSlideMs}ms`,
                transitionDelay: visible ? "0ms" : `0ms, 0ms, ${WidgetsSidebarSlideMs}ms`,
            }}
        >
            <Widgets />
        </div>
    );
});
WidgetsSlot.displayName = "WidgetsSlot";

// a popped-out window shows only its tab bar and panes: no Wave AI panel and no widgets sidebar
const PopOutWorkspaceElem = memo(() => {
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const tabBarPosition = useAtomValue(getSettingsKeyAtom("app:tabbar")) ?? "top";
    const showLeftTabBar = tabBarPosition === "left";
    const vtabWidth = WorkspaceLayoutModel.getInstance().getVTabWidth();
    const isFullScreen = useAtomValue(atoms.isFullScreen);

    return (
        <div className="flex flex-col w-full flex-grow overflow-hidden relative">
            {!isFullScreen && !(showLeftTabBar && isMacOS()) && (
                <TabBar key={ws.oid} workspace={ws} noTabs={showLeftTabBar} />
            )}
            {!isFullScreen && showLeftTabBar && isMacOS() && <MacOSTabBarSpacer />}
            {isFullScreen && <FocusTabStrip />}
            <div className="flex flex-row flex-grow overflow-hidden">
                <ErrorBoundary key={tabId}>
                    {showLeftTabBar && !isFullScreen && (
                        <div className="h-full shrink-0 overflow-hidden pr-0.5" style={{ width: vtabWidth }}>
                            <VTabBar workspace={ws} />
                        </div>
                    )}
                    <div className="flex flex-row h-full flex-grow overflow-hidden">
                        {tabId === "" ? (
                            <CenteredDiv>No Active Tab</CenteredDiv>
                        ) : (
                            <TabContent key={tabId} tabId={tabId} noTopPadding={showLeftTabBar && isMacOS()} />
                        )}
                    </div>
                    <ModalsRenderer />
                </ErrorBoundary>
            </div>
        </div>
    );
});
PopOutWorkspaceElem.displayName = "PopOutWorkspaceElem";

const MainWorkspaceElem = memo(() => {
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const tabBarPosition = useAtomValue(getSettingsKeyAtom("app:tabbar")) ?? "top";
    const showLeftTabBar = tabBarPosition === "left";
    const aiPanelVisible = useAtomValue(workspaceLayoutModel.panelVisibleAtom);
    const widgetsSidebarVisible = useAtomValue(workspaceLayoutModel.widgetsSidebarVisibleAtom);
    const isFullScreen = useAtomValue(atoms.isFullScreen);
    const windowWidth = window.innerWidth;
    const leftGroupInitialPct = workspaceLayoutModel.getLeftGroupInitialPercentage(windowWidth, showLeftTabBar);
    const innerVTabInitialPct = workspaceLayoutModel.getInnerVTabInitialPercentage(windowWidth, showLeftTabBar);
    const innerAIPanelInitialPct = workspaceLayoutModel.getInnerAIPanelInitialPercentage(windowWidth, showLeftTabBar);
    const outerPanelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const innerPanelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const aiPanelRef = useRef<ImperativePanelHandle>(null);
    const vtabPanelRef = useRef<ImperativePanelHandle>(null);
    const panelContainerRef = useRef<HTMLDivElement>(null);
    const aiPanelWrapperRef = useRef<HTMLDivElement>(null);
    const vtabPanelWrapperRef = useRef<HTMLDivElement>(null);

    // showLeftTabBar is passed as a seed value only; subsequent changes are handled by setShowLeftTabBar below.
    // Do NOT add showLeftTabBar as a dep here — re-registering refs on config changes would redundantly re-run commitLayouts.
    useEffect(() => {
        if (
            aiPanelRef.current &&
            outerPanelGroupRef.current &&
            innerPanelGroupRef.current &&
            panelContainerRef.current &&
            aiPanelWrapperRef.current
        ) {
            workspaceLayoutModel.registerRefs(
                aiPanelRef.current,
                outerPanelGroupRef.current,
                innerPanelGroupRef.current,
                panelContainerRef.current,
                aiPanelWrapperRef.current,
                vtabPanelRef.current ?? undefined,
                vtabPanelWrapperRef.current ?? undefined,
                showLeftTabBar
            );
        }
    }, []);

    useEffect(() => {
        const isVisible = workspaceLayoutModel.getAIPanelVisible();
        getApi().setWaveAIOpen(isVisible);
    }, []);

    useEffect(() => {
        window.addEventListener("resize", workspaceLayoutModel.handleWindowResize);
        return () => window.removeEventListener("resize", workspaceLayoutModel.handleWindowResize);
    }, []);

    useEffect(() => {
        workspaceLayoutModel.setShowLeftTabBar(showLeftTabBar);
    }, [showLeftTabBar]);

    useEffect(() => {
        const handleFocus = () => workspaceLayoutModel.syncVTabWidthFromMeta();
        window.addEventListener("focus", handleFocus);
        return () => window.removeEventListener("focus", handleFocus);
    }, []);

    const innerHandleVisible = showLeftTabBar && aiPanelVisible && !isFullScreen;
    const innerHandleClass = `bg-transparent hover:bg-zinc-500/20 transition-colors ${innerHandleVisible ? "w-0.5" : "w-0 pointer-events-none"}`;
    const outerHandleVisible = (showLeftTabBar || aiPanelVisible) && !isFullScreen;
    const outerHandleClass = `bg-transparent hover:bg-zinc-500/20 transition-colors ${outerHandleVisible ? "w-0.5" : "w-0 pointer-events-none"}`;

    return (
        <div className="flex flex-col w-full flex-grow overflow-hidden relative">
            {!isFullScreen && !(showLeftTabBar && isMacOS()) && (
                <TabBar key={ws.oid} workspace={ws} noTabs={showLeftTabBar} />
            )}
            {!isFullScreen && showLeftTabBar && isMacOS() && <MacOSTabBarSpacer />}
            {isFullScreen && <FocusTabStrip />}
            <div ref={panelContainerRef} className="flex flex-row flex-grow overflow-hidden">
                <ErrorBoundary key={tabId}>
                    <PanelGroup
                        direction="horizontal"
                        onLayout={workspaceLayoutModel.handleOuterPanelLayout}
                        ref={outerPanelGroupRef}
                    >
                        <Panel
                            order={0}
                            defaultSize={leftGroupInitialPct}
                            className={cn("overflow-hidden", isFullScreen && "hidden")}
                        >
                            <PanelGroup
                                direction="horizontal"
                                onLayout={workspaceLayoutModel.handleInnerPanelLayout}
                                ref={innerPanelGroupRef}
                            >
                                <Panel
                                    ref={vtabPanelRef}
                                    collapsible
                                    defaultSize={innerVTabInitialPct}
                                    order={0}
                                    className="overflow-hidden"
                                >
                                    <div ref={vtabPanelWrapperRef} className="w-full h-full">
                                        {showLeftTabBar && <VTabBar workspace={ws} />}
                                    </div>
                                </Panel>
                                <PanelResizeHandle className={innerHandleClass} />
                                <Panel
                                    ref={aiPanelRef}
                                    collapsible
                                    defaultSize={innerAIPanelInitialPct}
                                    order={1}
                                    className="overflow-hidden"
                                >
                                    <div
                                        ref={aiPanelWrapperRef}
                                        className={`w-full h-full pr-0.5 ${aiPanelVisible ? "" : "opacity-0"}`}
                                    >
                                        {tabId !== "" && <AIPanel roundTopLeft={showLeftTabBar} />}
                                    </div>
                                </Panel>
                            </PanelGroup>
                        </Panel>
                        <PanelResizeHandle className={outerHandleClass} />
                        <Panel order={1} defaultSize={100 - leftGroupInitialPct}>
                            {tabId === "" ? (
                                <CenteredDiv>No Active Tab</CenteredDiv>
                            ) : (
                                <div className="flex flex-row h-full">
                                    <TabContent key={tabId} tabId={tabId} noTopPadding={showLeftTabBar && isMacOS()} />
                                    <WidgetsSlot visible={widgetsSidebarVisible && !isFullScreen} />
                                </div>
                            )}
                        </Panel>
                    </PanelGroup>
                    <ModalsRenderer />
                </ErrorBoundary>
            </div>
        </div>
    );
});

MainWorkspaceElem.displayName = "MainWorkspaceElem";

const WorkspaceElem = memo(() => {
    const isPopOutWindow = useAtomValue(atoms.isPopOutWindow);
    if (isPopOutWindow) {
        return <PopOutWorkspaceElem />;
    }
    return <MainWorkspaceElem />;
});

WorkspaceElem.displayName = "WorkspaceElem";

export { WorkspaceElem as Workspace };
