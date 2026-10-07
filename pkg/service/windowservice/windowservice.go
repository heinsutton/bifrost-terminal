// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package windowservice

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const DefaultTimeout = 2 * time.Second

type WindowService struct{}

func (svc *WindowService) GetWindow_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"windowId"},
	}
}

func (svc *WindowService) GetWindow(windowId string) (*waveobj.Window, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	window, err := wstore.DBGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		return nil, fmt.Errorf("error getting window: %w", err)
	}
	return window, nil
}

func (svc *WindowService) CreateWindow_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"ctx", "winSize", "workspaceId"},
	}
}

func (svc *WindowService) CreateWindow(ctx context.Context, winSize *waveobj.WinSize, workspaceId string) (*waveobj.Window, error) {
	window, err := wcore.CreateWindow(ctx, winSize, workspaceId)
	if err != nil {
		return nil, fmt.Errorf("error creating window: %w", err)
	}
	return window, nil
}

func (svc *WindowService) SetWindowPosAndSize_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "set window position and size",
		ArgNames: []string{"ctx", "windowId", "pos", "size"},
	}
}

func (ws *WindowService) SetWindowPosAndSize(ctx context.Context, windowId string, pos *waveobj.Point, size *waveobj.WinSize) (waveobj.UpdatesRtnType, error) {
	if pos == nil && size == nil {
		return nil, nil
	}
	ctx = waveobj.ContextWithUpdates(ctx)
	win, err := wstore.DBMustGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		return nil, err
	}
	if pos != nil {
		win.Pos = *pos
	}
	if size != nil {
		win.WinSize = *size
	}
	win.IsNew = false
	err = wstore.DBUpdate(ctx, win)
	if err != nil {
		return nil, err
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *WindowService) SwitchWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"ctx", "windowId", "workspaceId"},
	}
}

func (svc *WindowService) SwitchWorkspace(ctx context.Context, windowId string, workspaceId string) (*waveobj.Workspace, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	ws, err := wcore.SwitchWorkspace(ctx, windowId, workspaceId)

	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WindowService:SwitchWorkspace:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return ws, err
}

func (svc *WindowService) CloseWindow_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"ctx", "windowId", "fromElectron"},
	}
}

func (svc *WindowService) CloseWindow(ctx context.Context, windowId string, fromElectron bool) error {
	ctx = waveobj.ContextWithUpdates(ctx)
	return wcore.CloseWindow(ctx, windowId, fromElectron)
}

func (svc *WindowService) PopOutTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "move a tab into a new popped-out window of the same workspace",
		ArgNames:   []string{"ctx", "tabId", "pos", "size"},
		ReturnDesc: "PopOutRtn",
	}
}

func (svc *WindowService) PopOutTab(ctx context.Context, tabId string, pos *waveobj.Point, size *waveobj.WinSize) (*wcore.PopOutRtn, waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	rtn, err := wcore.PopOutTab(ctx, tabId, pos, size)
	if err != nil {
		return nil, nil, fmt.Errorf("error popping out tab: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WindowService:PopOutTab:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return rtn, updates, nil
}

func (svc *WindowService) MoveTabToWindow_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "move a tab to another window of the same workspace (index -1 appends)",
		ArgNames:   []string{"ctx", "tabId", "destWindowId", "index"},
		ReturnDesc: "TabWindowMoveRtn",
	}
}

func (svc *WindowService) MoveTabToWindow(ctx context.Context, tabId string, destWindowId string, index int) (*wcore.TabWindowMoveRtn, waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	rtn, err := wcore.MoveTabToWindow(ctx, tabId, destWindowId, index)
	if err != nil {
		return nil, nil, fmt.Errorf("error moving tab to window: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WindowService:MoveTabToWindow:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return rtn, updates, nil
}

func (svc *WindowService) CreateTabInWindow_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "create a new tab shown in the given window and make it that window's active tab",
		ArgNames:   []string{"ctx", "windowId"},
		ReturnDesc: "tabId",
	}
}

func (svc *WindowService) CreateTabInWindow(ctx context.Context, windowId string) (string, waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	tabId, err := wcore.CreateTabInWindow(ctx, windowId)
	if err != nil {
		return "", nil, fmt.Errorf("error creating tab in window: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WindowService:CreateTabInWindow:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return tabId, updates, nil
}

func (svc *WindowService) PopOutBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "move a block into a new tab in a new popped-out window of the same workspace",
		ArgNames:   []string{"ctx", "blockId", "pos", "size"},
		ReturnDesc: "PopOutRtn",
	}
}

func (svc *WindowService) PopOutBlock(ctx context.Context, blockId string, pos *waveobj.Point, size *waveobj.WinSize) (*wcore.PopOutRtn, waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	rtn, err := wcore.PopOutBlock(ctx, blockId, pos, size)
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WindowService:PopOutBlock:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	if err != nil {
		return nil, updates, fmt.Errorf("error popping out block: %w", err)
	}
	return rtn, updates, nil
}
