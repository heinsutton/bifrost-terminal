// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"slices"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func makeUnnamed(t *testing.T, ctx context.Context, wsId string) {
	t.Helper()
	ws := mustGetWorkspace(t, ctx, wsId)
	ws.Name = ""
	ws.Icon = ""
	ws.Color = ""
	if err := wstore.DBUpdate(ctx, ws); err != nil {
		t.Fatalf("failed to update workspace: %v", err)
	}
}

func workspaceExists(t *testing.T, ctx context.Context, wsId string) bool {
	t.Helper()
	ws, err := wstore.DBGet[*waveobj.Workspace](ctx, wsId)
	if err != nil {
		t.Fatalf("failed to get workspace %s: %v", wsId, err)
	}
	return ws != nil
}

func TestLastTabClose_KeepsNamedRealm(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 1, true)

	newActive, err := DeleteTab(ctx, fx.wsId, fx.tabIds[0], true)
	if err != nil || newActive != "" {
		t.Fatalf("DeleteTab = %q, %v", newActive, err)
	}
	assertWindowGone(t, ctx, fx.windowId)
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	if len(ws.TabIds) != 0 || ws.Name != "Realm" {
		t.Fatalf("unexpected kept workspace: %+v", ws)
	}
	if got := mustGetClient(t, ctx).LastWorkspaceId; got != fx.wsId {
		t.Fatalf("LastWorkspaceId = %q, want %s", got, fx.wsId)
	}
}

func TestLastTabClose_DeletesUnnamedRealm(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 1, true)
	makeUnnamed(t, ctx, fx.wsId)

	if _, err := DeleteTab(ctx, fx.wsId, fx.tabIds[0], true); err != nil {
		t.Fatalf("DeleteTab failed: %v", err)
	}
	assertWindowGone(t, ctx, fx.windowId)
	if workspaceExists(t, ctx, fx.wsId) {
		t.Fatalf("unnamed workspace was kept")
	}
	if got := mustGetClient(t, ctx).LastWorkspaceId; got != "" {
		t.Fatalf("LastWorkspaceId = %q, want empty", got)
	}
}

func TestCloseWindow_UnnamedRealmWithTabsDeleted(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 2, true)
	makeUnnamed(t, ctx, fx.wsId)

	if err := CloseWindow(ctx, fx.windowId, true); err != nil {
		t.Fatalf("CloseWindow failed: %v", err)
	}
	if workspaceExists(t, ctx, fx.wsId) {
		t.Fatalf("unnamed workspace was kept")
	}
}

func TestRelaunch_ReopensLastRealmWithFreshTab(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 1, true)
	if _, err := DeleteTab(ctx, fx.wsId, fx.tabIds[0], true); err != nil {
		t.Fatalf("DeleteTab failed: %v", err)
	}

	if _, err := EnsureInitialData(); err != nil {
		t.Fatalf("EnsureInitialData failed: %v", err)
	}
	client := mustGetClient(t, ctx)
	if len(client.WindowIds) != 1 {
		t.Fatalf("client.WindowIds = %v, want one window", client.WindowIds)
	}
	window, err := GetWindow(ctx, client.WindowIds[0])
	if err != nil || window.WorkspaceId != fx.wsId {
		t.Fatalf("reopened window = %+v, %v; want workspace %s", window, err, fx.wsId)
	}
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	if len(ws.TabIds) != 1 || ws.ActiveTabId != ws.TabIds[0] {
		t.Fatalf("reopened workspace tabs = %v active = %s, want one fresh active tab", ws.TabIds, ws.ActiveTabId)
	}
}

func TestRelaunch_ReopensClosedRealmWithItsTabs(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 2, true)
	other := makePopOutFixture(t, ctx, 1, true)
	pop := mustPopOutTab(t, ctx, fx.tabIds[1]).Window.OID

	if err := CloseWindow(ctx, other.windowId, true); err != nil {
		t.Fatalf("CloseWindow(other) failed: %v", err)
	}
	if err := CloseWindow(ctx, fx.windowId, true); err != nil {
		t.Fatalf("CloseWindow failed: %v", err)
	}
	assertWindowGone(t, ctx, pop)
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	if !slices.Equal(ws.TabIds, fx.tabIds) || len(ws.PopOutTabs) != 0 {
		t.Fatalf("kept workspace tabs = %v popout = %v", ws.TabIds, ws.PopOutTabs)
	}

	if _, err := EnsureInitialData(); err != nil {
		t.Fatalf("EnsureInitialData failed: %v", err)
	}
	client := mustGetClient(t, ctx)
	if len(client.WindowIds) != 1 {
		t.Fatalf("client.WindowIds = %v, want one window", client.WindowIds)
	}
	window, _ := GetWindow(ctx, client.WindowIds[0])
	if window.WorkspaceId != fx.wsId {
		t.Fatalf("reopened workspace %s, want the last closed %s", window.WorkspaceId, fx.wsId)
	}
	if ws := mustGetWorkspace(t, ctx, fx.wsId); !slices.Equal(ws.TabIds, fx.tabIds) {
		t.Fatalf("reopened workspace tabs = %v, want %v", ws.TabIds, fx.tabIds)
	}
}

func TestRelaunch_FallsBackToBlankRealm(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 1, true)
	if err := CloseWindow(ctx, fx.windowId, true); err != nil {
		t.Fatalf("CloseWindow failed: %v", err)
	}
	if _, _, err := DeleteWorkspace(ctx, fx.wsId, true); err != nil {
		t.Fatalf("DeleteWorkspace failed: %v", err)
	}
	if workspaceExists(t, ctx, fx.wsId) {
		t.Fatalf("explicit delete kept the named workspace")
	}

	if _, err := EnsureInitialData(); err != nil {
		t.Fatalf("EnsureInitialData failed: %v", err)
	}
	client := mustGetClient(t, ctx)
	if len(client.WindowIds) != 1 {
		t.Fatalf("client.WindowIds = %v, want one window", client.WindowIds)
	}
	window, _ := GetWindow(ctx, client.WindowIds[0])
	ws := mustGetWorkspace(t, ctx, window.WorkspaceId)
	if ws.OID == fx.wsId || isNamedWorkspace(ws) {
		t.Fatalf("expected a new blank workspace, got %+v", ws)
	}
}

func TestExplicitDelete_DeletesNamedRealm(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 2, true)
	deleted, _, err := DeleteWorkspace(ctx, fx.wsId, true)
	if err != nil || !deleted {
		t.Fatalf("DeleteWorkspace = %v, %v", deleted, err)
	}
	if workspaceExists(t, ctx, fx.wsId) {
		t.Fatalf("named workspace still exists")
	}
}

func TestFocusAndSwitch_RecordLastRealm(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 1, true)
	empty := makePopOutFixture(t, ctx, 0, false)
	client := mustGetClient(t, ctx)
	client.LastWorkspaceId = ""
	if err := wstore.DBUpdate(ctx, client); err != nil {
		t.Fatalf("failed to update client: %v", err)
	}

	if err := FocusWindow(ctx, fx.windowId); err != nil {
		t.Fatalf("FocusWindow failed: %v", err)
	}
	if got := mustGetClient(t, ctx).LastWorkspaceId; got != fx.wsId {
		t.Fatalf("after focus LastWorkspaceId = %q, want %s", got, fx.wsId)
	}

	ws, err := SwitchWorkspace(ctx, fx.windowId, empty.wsId)
	if err != nil {
		t.Fatalf("SwitchWorkspace failed: %v", err)
	}
	if len(ws.TabIds) != 1 || ws.ActiveTabId != ws.TabIds[0] {
		t.Fatalf("switched-to empty realm tabs = %v active = %s, want one fresh tab", ws.TabIds, ws.ActiveTabId)
	}
	if got := mustGetClient(t, ctx).LastWorkspaceId; got != empty.wsId {
		t.Fatalf("after switch LastWorkspaceId = %q, want %s", got, empty.wsId)
	}
}
