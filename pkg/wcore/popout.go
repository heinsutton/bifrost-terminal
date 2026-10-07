// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"fmt"
	"log"
	"slices"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/eventbus"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// A popped-out window shows a subset of its main window's workspace tabs.
// Workspace.TabIds stays the master list; Workspace.PopOutTabs maps a tabid to
// the popped-out window that shows it. Tabs not in the map belong to the main
// window (the workspace's only non-popped-out window).

type PopOutRtn struct {
	Window               *waveobj.Window `json:"window"`
	SourceWindowId       string          `json:"sourcewindowid"`
	SourceNewActiveTabId string          `json:"sourcenewactivetabid"`
}

type TabWindowMoveRtn struct {
	SourceWindowId       string `json:"sourcewindowid"`
	SourceNewActiveTabId string `json:"sourcenewactivetabid"`
	DestWindowId         string `json:"destwindowid"`
	SourceWindowEmpty    bool   `json:"sourcewindowempty"`
}

// popOutWindowId == "" returns the main window's tabs; both in master TabIds order
func getTabIdsForOwner(ws *waveobj.Workspace, popOutWindowId string) []string {
	rtn := make([]string, 0, len(ws.TabIds))
	for _, tabId := range ws.TabIds {
		if ws.PopOutTabs[tabId] == popOutWindowId {
			rtn = append(rtn, tabId)
		}
	}
	return rtn
}

func getWindowTabIds(ws *waveobj.Workspace, window *waveobj.Window) []string {
	if window == nil || !window.IsPopOut {
		return getTabIdsForOwner(ws, "")
	}
	return getTabIdsForOwner(ws, window.OID)
}

func getTabOwnerWindowId(ctx context.Context, ws *waveobj.Workspace, tabId string) (string, error) {
	if popOutWindowId := ws.PopOutTabs[tabId]; popOutWindowId != "" {
		return popOutWindowId, nil
	}
	return FindMainWindowForWorkspace(ctx, ws.OID)
}

// returns "" if the workspace is not shown in any window
func FindMainWindowForWorkspace(ctx context.Context, workspaceId string) (string, error) {
	return wstore.DBFindWindowForWorkspaceId(ctx, workspaceId)
}

// returns the window that shows the tab (a popped-out window or the workspace's main window)
func FindWindowForTab(ctx context.Context, tabId string) (string, error) {
	workspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, tabId)
	if err != nil {
		return "", fmt.Errorf("error finding workspace for tab %s: %w", tabId, err)
	}
	if workspaceId == "" {
		return "", fmt.Errorf("no workspace found for tab %s", tabId)
	}
	ws, err := GetWorkspace(ctx, workspaceId)
	if err != nil {
		return "", fmt.Errorf("error getting workspace %s: %w", workspaceId, err)
	}
	return getTabOwnerWindowId(ctx, ws, tabId)
}

// list is the window's tab list after the removal; prefers the tab left of the removed one
func pickNeighbourTab(list []string, removedIdx int) string {
	if len(list) == 0 {
		return ""
	}
	return list[max(0, min(removedIdx-1, len(list)-1))]
}

// returns a copy of tabIds with tabId removed, and its former index (-1 if absent)
func removeTabId(tabIds []string, tabId string) ([]string, int) {
	idx := slices.Index(tabIds, tabId)
	if idx == -1 {
		return slices.Clone(tabIds), -1
	}
	return slices.Delete(slices.Clone(tabIds), idx, idx+1), idx
}

func getPopOutWindowsForWorkspace(ctx context.Context, workspaceId string) ([]*waveobj.Window, error) {
	windows, err := wstore.DBGetAllObjsByType[*waveobj.Window](ctx, waveobj.OType_Window)
	if err != nil {
		return nil, fmt.Errorf("error getting windows: %w", err)
	}
	var rtn []*waveobj.Window
	for _, window := range windows {
		if window.IsPopOut && window.WorkspaceId == workspaceId {
			rtn = append(rtn, window)
		}
	}
	return rtn, nil
}

func removeClientWindowIds(ctx context.Context, windowIds []string) error {
	if len(windowIds) == 0 {
		return nil
	}
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return fmt.Errorf("error getting client: %w", err)
	}
	for _, windowId := range windowIds {
		client.WindowIds = utilfn.RemoveElemFromSlice(client.WindowIds, windowId)
	}
	if err := wstore.DBUpdate(ctx, client); err != nil {
		return fmt.Errorf("error updating client: %w", err)
	}
	return nil
}

// Runs inside the caller's tx. Deletes every popped-out window of ws and returns
// all of its tabs to the main window. Mutates ws but does not write it; the caller must.
// Returns the deleted window ids; the caller sends the Electron close events after the tx.
func foldPopOutWindowsTx(ctx context.Context, ws *waveobj.Workspace) ([]string, error) {
	windows, err := getPopOutWindowsForWorkspace(ctx, ws.OID)
	if err != nil {
		return nil, err
	}
	windowIds := make([]string, 0, len(windows))
	for _, window := range windows {
		if err := wstore.DBDelete(ctx, waveobj.OType_Window, window.OID); err != nil {
			return nil, fmt.Errorf("error deleting window %s: %w", window.OID, err)
		}
		windowIds = append(windowIds, window.OID)
	}
	ws.PopOutTabs = nil
	if err := removeClientWindowIds(ctx, windowIds); err != nil {
		return nil, err
	}
	return windowIds, nil
}

// Runs inside the caller's tx. Deletes one popped-out window and returns its tabs to
// the main window. ws may be nil (workspace already gone). Mutates ws but does not write it.
func closePopOutWindowTx(ctx context.Context, ws *waveobj.Workspace, windowId string) error {
	if ws != nil {
		for tabId, popOutWindowId := range ws.PopOutTabs {
			if popOutWindowId == windowId {
				delete(ws.PopOutTabs, tabId)
			}
		}
		if len(ws.PopOutTabs) == 0 {
			ws.PopOutTabs = nil
		}
	}
	if err := wstore.DBDelete(ctx, waveobj.OType_Window, windowId); err != nil {
		return fmt.Errorf("error deleting window %s: %w", windowId, err)
	}
	return removeClientWindowIds(ctx, []string{windowId})
}

func sendElectronCloseWindows(windowIds []string) {
	for _, windowId := range windowIds {
		eventbus.SendEventToElectron(eventbus.WSEventType{
			EventType: eventbus.WSEvent_ElectronCloseWindow,
			Data:      windowId,
		})
	}
}

func publishWorkspaceUpdate() {
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_WorkspaceUpdate,
	})
}

// Folds the workspace's popped-out windows back into its main window and tells Electron
// to close them. A workspace without popped-out windows is not written.
func foldPopOutWindows(ctx context.Context, workspaceId string) error {
	windowIds, err := wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) ([]string, error) {
		txCtx := tx.Context()
		ws, err := wstore.DBGet[*waveobj.Workspace](txCtx, workspaceId)
		if err != nil {
			return nil, fmt.Errorf("error getting workspace: %w", err)
		}
		if ws == nil {
			return nil, nil
		}
		hadPopOutTabs := len(ws.PopOutTabs) > 0
		windowIds, err := foldPopOutWindowsTx(txCtx, ws)
		if err != nil {
			return nil, err
		}
		if !hadPopOutTabs && len(windowIds) == 0 {
			return nil, nil
		}
		if err := wstore.DBUpdate(txCtx, ws); err != nil {
			return nil, fmt.Errorf("error updating workspace: %w", err)
		}
		return windowIds, nil
	})
	if err != nil {
		return fmt.Errorf("error folding popped-out windows of workspace %s: %w", workspaceId, err)
	}
	if len(windowIds) > 0 {
		log.Printf("folded popped-out windows %v into workspace %s\n", windowIds, workspaceId)
		sendElectronCloseWindows(windowIds)
		publishWorkspaceUpdate()
	}
	return nil
}

// Startup only: popped-out windows never come back after a restart, so delete them all
// and return every popped-out tab to its main window. Updates client in place.
func foldAllPopOutWindows(ctx context.Context, client *waveobj.Client) error {
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		txCtx := tx.Context()
		windows, err := wstore.DBGetAllObjsByType[*waveobj.Window](txCtx, waveobj.OType_Window)
		if err != nil {
			return fmt.Errorf("error getting windows: %w", err)
		}
		var windowIds []string
		for _, window := range windows {
			if !window.IsPopOut {
				continue
			}
			if err := wstore.DBDelete(txCtx, waveobj.OType_Window, window.OID); err != nil {
				return fmt.Errorf("error deleting window %s: %w", window.OID, err)
			}
			windowIds = append(windowIds, window.OID)
		}
		workspaces, err := wstore.DBGetAllObjsByType[*waveobj.Workspace](txCtx, waveobj.OType_Workspace)
		if err != nil {
			return fmt.Errorf("error getting workspaces: %w", err)
		}
		for _, ws := range workspaces {
			if len(ws.PopOutTabs) == 0 {
				continue
			}
			ws.PopOutTabs = nil
			if err := wstore.DBUpdate(txCtx, ws); err != nil {
				return fmt.Errorf("error updating workspace %s: %w", ws.OID, err)
			}
		}
		if len(windowIds) == 0 {
			return nil
		}
		log.Printf("folded %d popped-out windows on startup\n", len(windowIds))
		for _, windowId := range windowIds {
			client.WindowIds = utilfn.RemoveElemFromSlice(client.WindowIds, windowId)
		}
		if err := wstore.DBUpdate(txCtx, client); err != nil {
			return fmt.Errorf("error updating client: %w", err)
		}
		return nil
	})
}

func closePopOutWindow(ctx context.Context, window *waveobj.Window) error {
	err := wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		txCtx := tx.Context()
		ws, err := wstore.DBGet[*waveobj.Workspace](txCtx, window.WorkspaceId)
		if err != nil {
			return fmt.Errorf("error getting workspace: %w", err)
		}
		if err := closePopOutWindowTx(txCtx, ws, window.OID); err != nil {
			return err
		}
		if ws == nil {
			return nil
		}
		if err := wstore.DBUpdate(txCtx, ws); err != nil {
			return fmt.Errorf("error updating workspace: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("error closing popped-out window %s: %w", window.OID, err)
	}
	SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Workspace, window.WorkspaceId))
	publishWorkspaceUpdate()
	return nil
}

// Merges a reordered list of tab ids into the master list. tabIds may be the full list
// (plain replace) or one window's subset, which refills the slots those ids held in
// master order. Unknown or duplicate ids are an error.
func mergeTabIdOrder(master []string, tabIds []string) ([]string, error) {
	inMaster := make(map[string]bool, len(master))
	for _, tabId := range master {
		inMaster[tabId] = true
	}
	given := make(map[string]bool, len(tabIds))
	for _, tabId := range tabIds {
		if !inMaster[tabId] {
			return nil, fmt.Errorf("tab %s not found in workspace", tabId)
		}
		if given[tabId] {
			return nil, fmt.Errorf("duplicate tab id %s", tabId)
		}
		given[tabId] = true
	}
	if len(tabIds) == len(master) {
		return slices.Clone(tabIds), nil
	}
	rtn := slices.Clone(master)
	nextIdx := 0
	for slot, tabId := range rtn {
		if given[tabId] {
			rtn[slot] = tabIds[nextIdx]
			nextIdx++
		}
	}
	return rtn, nil
}

// Returns a copy of tabIds with tabId moved next to destTabIds (a window's tabs, not
// containing tabId). index is a position in destTabIds; -1 or past the end appends.
func repositionTabForWindow(tabIds []string, tabId string, destTabIds []string, index int) []string {
	rtn, _ := removeTabId(tabIds, tabId)
	insertIdx := len(rtn)
	if index >= 0 && index < len(destTabIds) {
		insertIdx = slices.Index(rtn, destTabIds[index])
	} else if len(destTabIds) > 0 {
		insertIdx = slices.Index(rtn, destTabIds[len(destTabIds)-1]) + 1
	}
	if insertIdx < 0 {
		insertIdx = len(rtn)
	}
	return slices.Insert(rtn, insertIdx, tabId)
}

// Sets the window's active tab (popped-out window: Window.ActiveTabId, main window:
// Workspace.ActiveTabId) to newActiveTabId. Writes the popped-out window, not ws.
func setWindowActiveTabTx(ctx context.Context, ws *waveobj.Workspace, window *waveobj.Window, newActiveTabId string) error {
	if window != nil && window.IsPopOut {
		window.ActiveTabId = newActiveTabId
		if err := wstore.DBUpdate(ctx, window); err != nil {
			return fmt.Errorf("error updating window: %w", err)
		}
		return nil
	}
	ws.ActiveTabId = newActiveTabId
	return nil
}

func getWindowActiveTabId(ws *waveobj.Workspace, window *waveobj.Window) string {
	if window != nil && window.IsPopOut {
		return window.ActiveTabId
	}
	return ws.ActiveTabId
}

func getWorkspaceForTabTx(ctx context.Context, tabId string) (*waveobj.Workspace, error) {
	workspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error finding workspace for tab %s: %w", tabId, err)
	}
	if workspaceId == "" {
		return nil, fmt.Errorf("no workspace found for tab %s", tabId)
	}
	ws, err := wstore.DBMustGet[*waveobj.Workspace](ctx, workspaceId)
	if err != nil {
		return nil, fmt.Errorf("error getting workspace %s: %w", workspaceId, err)
	}
	return ws, nil
}

// returns the window object that shows tabId (popped-out or main)
func getTabOwnerWindowTx(ctx context.Context, ws *waveobj.Workspace, tabId string) (*waveobj.Window, error) {
	windowId, err := getTabOwnerWindowId(ctx, ws, tabId)
	if err != nil {
		return nil, fmt.Errorf("error finding window for tab %s: %w", tabId, err)
	}
	if windowId == "" {
		return nil, fmt.Errorf("workspace %s is not shown in a window", ws.OID)
	}
	window, err := wstore.DBMustGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		return nil, fmt.Errorf("error getting window %s: %w", windowId, err)
	}
	return window, nil
}

// Moves a tab into a new popped-out window of the same workspace. A window's only tab
// cannot be popped out.
func PopOutTab(ctx context.Context, tabId string, pos *waveobj.Point, size *waveobj.WinSize) (*PopOutRtn, error) {
	rtn, err := wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (*PopOutRtn, error) {
		txCtx := tx.Context()
		ws, err := getWorkspaceForTabTx(txCtx, tabId)
		if err != nil {
			return nil, err
		}
		mainWindowId, err := FindMainWindowForWorkspace(txCtx, ws.OID)
		if err != nil {
			return nil, fmt.Errorf("error finding main window: %w", err)
		}
		if mainWindowId == "" {
			return nil, fmt.Errorf("workspace %s has no main window", ws.OID)
		}
		sourceWindow, err := getTabOwnerWindowTx(txCtx, ws, tabId)
		if err != nil {
			return nil, err
		}
		sourceTabIds, removedIdx := removeTabId(getWindowTabIds(ws, sourceWindow), tabId)
		if len(sourceTabIds) == 0 {
			return nil, fmt.Errorf("cannot pop out the only tab of a window")
		}
		window := &waveobj.Window{
			OID:         uuid.NewString(),
			WorkspaceId: ws.OID,
			IsNew:       size == nil,
			IsPopOut:    true,
			ActiveTabId: tabId,
		}
		if pos != nil {
			window.Pos = *pos
		}
		if size != nil {
			window.WinSize = *size
		}
		if err := wstore.DBInsert(txCtx, window); err != nil {
			return nil, fmt.Errorf("error inserting window: %w", err)
		}
		client, err := wstore.DBGetSingleton[*waveobj.Client](txCtx)
		if err != nil {
			return nil, fmt.Errorf("error getting client: %w", err)
		}
		client.WindowIds = append(client.WindowIds, window.OID)
		if err := wstore.DBUpdate(txCtx, client); err != nil {
			return nil, fmt.Errorf("error updating client: %w", err)
		}
		if ws.PopOutTabs == nil {
			ws.PopOutTabs = make(map[string]string)
		}
		ws.PopOutTabs[tabId] = window.OID
		sourceActiveTabId := getWindowActiveTabId(ws, sourceWindow)
		if sourceActiveTabId == tabId {
			sourceActiveTabId = pickNeighbourTab(sourceTabIds, removedIdx)
			if err := setWindowActiveTabTx(txCtx, ws, sourceWindow, sourceActiveTabId); err != nil {
				return nil, err
			}
		}
		if err := wstore.DBUpdate(txCtx, ws); err != nil {
			return nil, fmt.Errorf("error updating workspace: %w", err)
		}
		return &PopOutRtn{
			Window:               window,
			SourceWindowId:       sourceWindow.OID,
			SourceNewActiveTabId: sourceActiveTabId,
		}, nil
	})
	if err != nil {
		return nil, err
	}
	publishWorkspaceUpdate()
	return rtn, nil
}

// Moves a tab to another window of the same workspace. index is a position in the
// destination window's tab list (-1 = end). A popped-out source window left without
// tabs is kept (SourceWindowEmpty) so the caller can close it once the destination has
// loaded the tab, or move the tab back; the main window's only tab cannot be moved.
func MoveTabToWindow(ctx context.Context, tabId string, destWindowId string, index int) (*TabWindowMoveRtn, error) {
	rtn, err := wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (*TabWindowMoveRtn, error) {
		txCtx := tx.Context()
		ws, err := getWorkspaceForTabTx(txCtx, tabId)
		if err != nil {
			return nil, err
		}
		destWindow, err := wstore.DBMustGet[*waveobj.Window](txCtx, destWindowId)
		if err != nil {
			return nil, fmt.Errorf("error getting destination window %s: %w", destWindowId, err)
		}
		if destWindow.WorkspaceId != ws.OID {
			return nil, fmt.Errorf("cannot move a tab to a window of a different workspace")
		}
		sourceWindow, err := getTabOwnerWindowTx(txCtx, ws, tabId)
		if err != nil {
			return nil, err
		}
		if sourceWindow.OID == destWindow.OID {
			return nil, fmt.Errorf("tab %s is already in window %s", tabId, destWindowId)
		}
		sourceTabIds, removedIdx := removeTabId(getWindowTabIds(ws, sourceWindow), tabId)
		sourceEmpty := len(sourceTabIds) == 0
		if sourceEmpty && !sourceWindow.IsPopOut {
			return nil, fmt.Errorf("cannot move the only tab of the main window")
		}
		ws.TabIds = repositionTabForWindow(ws.TabIds, tabId, getWindowTabIds(ws, destWindow), index)
		if destWindow.IsPopOut {
			if ws.PopOutTabs == nil {
				ws.PopOutTabs = make(map[string]string)
			}
			ws.PopOutTabs[tabId] = destWindow.OID
		} else {
			delete(ws.PopOutTabs, tabId)
		}
		if err := setWindowActiveTabTx(txCtx, ws, destWindow, tabId); err != nil {
			return nil, err
		}
		sourceActiveTabId := ""
		if sourceEmpty {
			if err := setWindowActiveTabTx(txCtx, ws, sourceWindow, ""); err != nil {
				return nil, err
			}
		} else {
			sourceActiveTabId = getWindowActiveTabId(ws, sourceWindow)
			if sourceActiveTabId == tabId {
				sourceActiveTabId = pickNeighbourTab(sourceTabIds, removedIdx)
				if err := setWindowActiveTabTx(txCtx, ws, sourceWindow, sourceActiveTabId); err != nil {
					return nil, err
				}
			}
		}
		if len(ws.PopOutTabs) == 0 {
			ws.PopOutTabs = nil
		}
		if err := wstore.DBUpdate(txCtx, ws); err != nil {
			return nil, fmt.Errorf("error updating workspace: %w", err)
		}
		return &TabWindowMoveRtn{
			SourceWindowId:       sourceWindow.OID,
			SourceNewActiveTabId: sourceActiveTabId,
			DestWindowId:         destWindow.OID,
			SourceWindowEmpty:    sourceEmpty,
		}, nil
	})
	if err != nil {
		return nil, err
	}
	publishWorkspaceUpdate()
	return rtn, nil
}

// Creates a new tab shown in the given window and makes it that window's active tab.
func CreateTabInWindow(ctx context.Context, windowId string) (string, error) {
	window, err := GetWindow(ctx, windowId)
	if err != nil {
		return "", fmt.Errorf("error getting window %s: %w", windowId, err)
	}
	if !window.IsPopOut {
		return CreateTab(ctx, window.WorkspaceId, "", true, false)
	}
	tabId, err := CreateTab(ctx, window.WorkspaceId, "", false, false)
	if err != nil {
		return "", err
	}
	err = wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		txCtx := tx.Context()
		ws, err := wstore.DBMustGet[*waveobj.Workspace](txCtx, window.WorkspaceId)
		if err != nil {
			return fmt.Errorf("error getting workspace: %w", err)
		}
		popOutWindow, err := wstore.DBMustGet[*waveobj.Window](txCtx, windowId)
		if err != nil {
			return fmt.Errorf("error getting window %s: %w", windowId, err)
		}
		if ws.PopOutTabs == nil {
			ws.PopOutTabs = make(map[string]string)
		}
		ws.PopOutTabs[tabId] = windowId
		if err := wstore.DBUpdate(txCtx, ws); err != nil {
			return fmt.Errorf("error updating workspace: %w", err)
		}
		return setWindowActiveTabTx(txCtx, ws, popOutWindow, tabId)
	})
	if err != nil {
		return "", fmt.Errorf("error assigning tab %s to window %s: %w", tabId, windowId, err)
	}
	publishWorkspaceUpdate()
	return tabId, nil
}

// Moves a block into a new tab of its window (MoveBlockToTab), then pops that tab out.
// If the second step fails the block stays in the new tab of the source window.
// A tab's only block cannot be popped out (pop out the tab instead).
func PopOutBlock(ctx context.Context, blockId string, pos *waveobj.Point, size *waveobj.WinSize) (*PopOutRtn, error) {
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("error getting block %s: %w", blockId, err)
	}
	parentORef := waveobj.ParseORefNoErr(block.ParentORef)
	if parentORef == nil || parentORef.OType != waveobj.OType_Tab {
		return nil, fmt.Errorf("block %q is not a direct child of a tab", blockId)
	}
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, parentORef.OID)
	if err != nil {
		return nil, fmt.Errorf("error getting tab %s: %w", parentORef.OID, err)
	}
	if len(tab.BlockIds) <= 1 {
		return nil, fmt.Errorf("cannot pop out the only block of a tab")
	}
	moveRtn, err := MoveBlockToTab(ctx, blockId, "")
	if err != nil {
		return nil, err
	}
	return PopOutTab(ctx, moveRtn.DestTabId, pos, size)
}
