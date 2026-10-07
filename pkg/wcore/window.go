// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"fmt"
	"log"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/eventbus"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func SwitchWorkspace(ctx context.Context, windowId string, workspaceId string) (*waveobj.Workspace, error) {
	log.Printf("SwitchWorkspace %s %s\n", windowId, workspaceId)
	ws, err := GetWorkspace(ctx, workspaceId)
	if err != nil {
		return nil, fmt.Errorf("error getting new workspace: %w", err)
	}
	window, err := GetWindow(ctx, windowId)
	if err != nil {
		return nil, fmt.Errorf("error getting window: %w", err)
	}
	if window.IsPopOut {
		return nil, fmt.Errorf("cannot switch the workspace of a popped-out window")
	}
	curWsId := window.WorkspaceId
	if curWsId == workspaceId {
		return nil, nil
	}

	allWindows, err := wstore.DBGetAllObjsByType[*waveobj.Window](ctx, waveobj.OType_Window)
	if err != nil {
		return nil, fmt.Errorf("error getting all windows: %w", err)
	}

	for _, w := range allWindows {
		if w.IsPopOut {
			continue
		}
		if w.WorkspaceId == workspaceId {
			log.Printf("workspace %s already has a window %s, focusing that window\n", workspaceId, w.OID)
			client := wshclient.GetBareRpcClient()
			err = wshclient.FocusWindowCommand(client, w.OID, &wshrpc.RpcOpts{Route: wshutil.ElectronRoute})
			return nil, err
		}
	}
	err = foldPopOutWindows(ctx, curWsId)
	if err != nil {
		return nil, err
	}
	ws, err = ensureWorkspaceHasTab(ctx, ws)
	if err != nil {
		return nil, err
	}
	window.WorkspaceId = workspaceId
	err = wstore.DBUpdate(ctx, window)
	if err != nil {
		return nil, fmt.Errorf("error updating window: %w", err)
	}
	err = setLastWorkspace(ctx, ws)
	if err != nil {
		return nil, err
	}

	deleted, _, err := DeleteWorkspace(ctx, curWsId, false)
	if err != nil && deleted {
		print(err.Error()) // @jalileh isolated the error for now, curwId/workspace was deleted when this occurs.
	} else if err != nil {
		return nil, fmt.Errorf("error deleting workspace: %w", err)
	}

	if !deleted {
		log.Printf("current workspace %s was not deleted\n", curWsId)
	} else {
		log.Printf("deleted current workspace %s\n", curWsId)
	}

	log.Printf("switching window %s to workspace %s\n", windowId, workspaceId)
	return ws, nil
}

func GetWindow(ctx context.Context, windowId string) (*waveobj.Window, error) {
	window, err := wstore.DBMustGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		log.Printf("error getting window %q: %v\n", windowId, err)
		return nil, err
	}
	return window, nil
}

func CreateWindow(ctx context.Context, winSize *waveobj.WinSize, workspaceId string) (*waveobj.Window, error) {
	log.Printf("CreateWindow %v %v\n", winSize, workspaceId)
	var ws *waveobj.Workspace
	if workspaceId == "" {
		ws1, err := CreateWorkspace(ctx, "", "", "", false, false)
		if err != nil {
			return nil, fmt.Errorf("error creating workspace: %w", err)
		}
		ws = ws1
	} else {
		ws1, err := GetWorkspace(ctx, workspaceId)
		if err != nil {
			return nil, fmt.Errorf("error getting workspace: %w", err)
		}
		ws, err = ensureWorkspaceHasTab(ctx, ws1)
		if err != nil {
			return nil, err
		}
	}
	windowId := uuid.NewString()
	if winSize == nil {
		winSize = &waveobj.WinSize{
			Width:  0,
			Height: 0,
		}
	}
	window := &waveobj.Window{
		OID:         windowId,
		WorkspaceId: ws.OID,
		IsNew:       true,
		Pos: waveobj.Point{
			X: 0,
			Y: 0,
		},
		WinSize: *winSize,
	}
	err := wstore.DBInsert(ctx, window)
	if err != nil {
		return nil, fmt.Errorf("error inserting window: %w", err)
	}
	client, err := GetClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client: %w", err)
	}
	client.WindowIds = append(client.WindowIds, windowId)
	if isNamedWorkspace(ws) {
		client.LastWorkspaceId = ws.OID
	}
	err = wstore.DBUpdate(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("error updating client: %w", err)
	}
	return GetWindow(ctx, windowId)
}

// a named (saved) workspace is never deleted by its window closing
func isNamedWorkspace(ws *waveobj.Workspace) bool {
	return ws != nil && ws.Name != "" && ws.Icon != ""
}

// gives a workspace without tabs a fresh default tab (same as "new tab"); returns the reloaded workspace
func ensureWorkspaceHasTab(ctx context.Context, ws *waveobj.Workspace) (*waveobj.Workspace, error) {
	if len(ws.TabIds) > 0 {
		return ws, nil
	}
	log.Printf("workspace %s has no tabs, creating one\n", ws.OID)
	_, err := CreateTab(ctx, ws.OID, "", true, false)
	if err != nil {
		return nil, fmt.Errorf("error creating tab for workspace %s: %w", ws.OID, err)
	}
	ws, err = GetWorkspace(ctx, ws.OID)
	if err != nil {
		return nil, fmt.Errorf("error getting workspace: %w", err)
	}
	return ws, nil
}

// records ws as the last used workspace if it is named
func setLastWorkspace(ctx context.Context, ws *waveobj.Workspace) error {
	if !isNamedWorkspace(ws) {
		return nil
	}
	client, err := GetClientData(ctx)
	if err != nil {
		return err
	}
	if client.LastWorkspaceId == ws.OID {
		return nil
	}
	client.LastWorkspaceId = ws.OID
	err = wstore.DBUpdate(ctx, client)
	if err != nil {
		return fmt.Errorf("error updating client: %w", err)
	}
	return nil
}

// returns the last used workspace if it still exists and no main window shows it, else ""
func getReopenableLastWorkspaceId(ctx context.Context, client *waveobj.Client) (string, error) {
	if client.LastWorkspaceId == "" {
		return "", nil
	}
	ws, err := wstore.DBGet[*waveobj.Workspace](ctx, client.LastWorkspaceId)
	if err != nil {
		return "", fmt.Errorf("error getting last workspace: %w", err)
	}
	if ws == nil {
		return "", nil
	}
	windowId, err := FindMainWindowForWorkspace(ctx, ws.OID)
	if err != nil {
		return "", fmt.Errorf("error finding window for last workspace: %w", err)
	}
	if windowId != "" {
		return "", nil
	}
	return ws.OID, nil
}

// CloseWindow closes a window and deletes its workspace if it is not named.
// A named workspace is kept (even without tabs) and recorded as the last used workspace.
// If fromElectron is true, it does not send an event to Electron.
// A popped-out window returns its tabs to the main window and never deletes the workspace;
// closing a main window folds its popped-out windows first.
func CloseWindow(ctx context.Context, windowId string, fromElectron bool) error {
	log.Printf("CloseWindow %s\n", windowId)
	window, err := GetWindow(ctx, windowId)
	if err == nil && window.IsPopOut {
		err = closePopOutWindow(ctx, window)
		if err != nil {
			return err
		}
		log.Printf("closed popped-out window %s\n", windowId)
		if !fromElectron {
			sendElectronCloseWindows([]string{windowId})
		}
		return nil
	}
	if err == nil {
		log.Printf("got window %s\n", windowId)
		err = foldPopOutWindows(ctx, window.WorkspaceId)
		if err != nil {
			return err
		}
		ws, err := wstore.DBGet[*waveobj.Workspace](ctx, window.WorkspaceId)
		if err != nil {
			return fmt.Errorf("error getting workspace: %w", err)
		}
		if isNamedWorkspace(ws) {
			log.Printf("keeping named workspace %s\n", ws.OID)
			err = setLastWorkspace(ctx, ws)
			if err != nil {
				return err
			}
		} else {
			deleted, _, err := DeleteWorkspace(ctx, window.WorkspaceId, false)
			if err != nil {
				log.Printf("error deleting workspace: %v\n", err)
			}
			if deleted {
				log.Printf("deleted workspace %s\n", window.WorkspaceId)
			}
		}
		err = wstore.DBDelete(ctx, waveobj.OType_Window, windowId)
		if err != nil {
			return fmt.Errorf("error deleting window: %w", err)
		}
		log.Printf("deleted window %s\n", windowId)
	} else {
		log.Printf("error getting window %s: %v\n", windowId, err)
	}
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return fmt.Errorf("error getting client: %w", err)
	}
	client.WindowIds = utilfn.RemoveElemFromSlice(client.WindowIds, windowId)
	err = wstore.DBUpdate(ctx, client)
	if err != nil {
		return fmt.Errorf("error updating client: %w", err)
	}
	log.Printf("updated client\n")
	if !fromElectron {
		eventbus.SendEventToElectron(eventbus.WSEventType{
			EventType: eventbus.WSEvent_ElectronCloseWindow,
			Data:      windowId,
		})
	}
	return nil
}

func CheckAndFixWindow(ctx context.Context, windowId string) *waveobj.Window {
	log.Printf("CheckAndFixWindow %s\n", windowId)
	window, err := GetWindow(ctx, windowId)
	if err != nil {
		log.Printf("error getting window %q (in checkAndFixWindow): %v\n", windowId, err)
		return nil
	}
	ws, err := GetWorkspace(ctx, window.WorkspaceId)
	if err != nil {
		log.Printf("error getting workspace %q (in checkAndFixWindow): %v\n", window.WorkspaceId, err)
		CloseWindow(ctx, windowId, false)
		return nil
	}
	if len(ws.TabIds) == 0 {
		log.Printf("fixing workspace with no tabs %q (in checkAndFixWindow)\n", ws.OID)
		_, err = CreateTab(ctx, ws.OID, "", true, false)
		if err != nil {
			log.Printf("error creating tab (in checkAndFixWindow): %v\n", err)
		}
	}
	return window
}

func FocusWindow(ctx context.Context, windowId string) error {
	log.Printf("FocusWindow %s\n", windowId)
	client, err := GetClientData(ctx)
	if err != nil {
		log.Printf("error getting client data: %v\n", err)
		return err
	}
	winIdx := utilfn.SliceIdx(client.WindowIds, windowId)
	if winIdx == -1 {
		log.Printf("window %s not found in client data\n", windowId)
		return nil
	}
	client.WindowIds = utilfn.MoveSliceIdxToFront(client.WindowIds, winIdx)
	log.Printf("client.WindowIds: %v\n", client.WindowIds)
	window, err := wstore.DBGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		return fmt.Errorf("error getting window: %w", err)
	}
	if window != nil && !window.IsPopOut {
		ws, err := wstore.DBGet[*waveobj.Workspace](ctx, window.WorkspaceId)
		if err != nil {
			return fmt.Errorf("error getting workspace: %w", err)
		}
		if isNamedWorkspace(ws) {
			client.LastWorkspaceId = ws.OID
		}
	}
	return wstore.DBUpdate(ctx, client)
}
