// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// initPopOutTestStore is initTestWStore with a temp dir that is removed best-effort:
// wstore has no close, and on Windows the open sqlite file makes t.TempDir's
// cleanup fail the test.
func initPopOutTestStore(t *testing.T) context.Context {
	t.Helper()
	dataDir, err := os.MkdirTemp("", "wcore-popout-test-")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(dataDir) })
	wavebase.DataHome_VarCache = dataDir
	if err := os.MkdirAll(filepath.Join(dataDir, wavebase.WaveDBDir), 0700); err != nil {
		t.Fatalf("failed to create wave db dir: %v", err)
	}
	if err := wstore.InitWStore(); err != nil {
		t.Fatalf("failed to init wstore: %v", err)
	}
	ctx := context.Background()
	if _, err := CreateClient(ctx); err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	return ctx
}

type popOutFixture struct {
	wsId     string
	windowId string
	tabIds   []string
}

func insertTestTab(t *testing.T, ctx context.Context, blockCount int) (string, []string) {
	t.Helper()
	tab := &waveobj.Tab{
		OID:         uuid.NewString(),
		Name:        "T",
		BlockIds:    []string{},
		LayoutState: uuid.NewString(),
	}
	var blockIds []string
	for i := 0; i < blockCount; i++ {
		block := &waveobj.Block{
			OID:        uuid.NewString(),
			ParentORef: waveobj.MakeORef(waveobj.OType_Tab, tab.OID).String(),
			Meta:       waveobj.MetaMapType{},
		}
		if err := wstore.DBInsert(ctx, block); err != nil {
			t.Fatalf("failed to insert block: %v", err)
		}
		tab.BlockIds = append(tab.BlockIds, block.OID)
		blockIds = append(blockIds, block.OID)
	}
	if err := wstore.DBInsert(ctx, tab); err != nil {
		t.Fatalf("failed to insert tab: %v", err)
	}
	if err := wstore.DBInsert(ctx, &waveobj.LayoutState{OID: tab.LayoutState}); err != nil {
		t.Fatalf("failed to insert layout state: %v", err)
	}
	return tab.OID, blockIds
}

// creates a saved (named) workspace with numTabs tabs, the first one active; withWindow adds a main window
func makePopOutFixture(t *testing.T, ctx context.Context, numTabs int, withWindow bool) *popOutFixture {
	t.Helper()
	fx := &popOutFixture{}
	for i := 0; i < numTabs; i++ {
		tabId, _ := insertTestTab(t, ctx, 0)
		fx.tabIds = append(fx.tabIds, tabId)
	}
	ws := &waveobj.Workspace{
		OID:    uuid.NewString(),
		Name:   "Realm",
		Icon:   "rune@dagaz",
		Color:  "#5EF3D6",
		TabIds: slices.Clone(fx.tabIds),
	}
	if numTabs > 0 {
		ws.ActiveTabId = fx.tabIds[0]
	}
	if err := wstore.DBInsert(ctx, ws); err != nil {
		t.Fatalf("failed to insert workspace: %v", err)
	}
	fx.wsId = ws.OID
	if withWindow {
		window := &waveobj.Window{OID: uuid.NewString(), WorkspaceId: ws.OID}
		if err := wstore.DBInsert(ctx, window); err != nil {
			t.Fatalf("failed to insert window: %v", err)
		}
		client := mustGetClient(t, ctx)
		client.WindowIds = append(client.WindowIds, window.OID)
		if err := wstore.DBUpdate(ctx, client); err != nil {
			t.Fatalf("failed to update client: %v", err)
		}
		fx.windowId = window.OID
	}
	return fx
}

func mustGetClient(t *testing.T, ctx context.Context) *waveobj.Client {
	t.Helper()
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		t.Fatalf("failed to get client: %v", err)
	}
	return client
}

func mustGetWorkspace(t *testing.T, ctx context.Context, wsId string) *waveobj.Workspace {
	t.Helper()
	ws, err := wstore.DBMustGet[*waveobj.Workspace](ctx, wsId)
	if err != nil {
		t.Fatalf("failed to get workspace %s: %v", wsId, err)
	}
	return ws
}

func windowExists(t *testing.T, ctx context.Context, windowId string) bool {
	t.Helper()
	window, err := wstore.DBGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		t.Fatalf("failed to get window %s: %v", windowId, err)
	}
	return window != nil
}

func mustPopOutTab(t *testing.T, ctx context.Context, tabId string) *PopOutRtn {
	t.Helper()
	rtn, err := PopOutTab(ctx, tabId, nil, nil)
	if err != nil {
		t.Fatalf("PopOutTab(%s) failed: %v", tabId, err)
	}
	return rtn
}

func assertWindowGone(t *testing.T, ctx context.Context, windowId string) {
	t.Helper()
	if windowExists(t, ctx, windowId) {
		t.Fatalf("window %s still exists", windowId)
	}
	if slices.Contains(mustGetClient(t, ctx).WindowIds, windowId) {
		t.Fatalf("client.WindowIds still contains %s", windowId)
	}
}

func TestPopOutTab_CloseReturnsTab(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 3, true)
	tabA, tabB := fx.tabIds[0], fx.tabIds[1]

	rtn := mustPopOutTab(t, ctx, tabA)
	if !rtn.Window.IsPopOut || rtn.Window.WorkspaceId != fx.wsId || rtn.Window.ActiveTabId != tabA {
		t.Fatalf("unexpected popped-out window: %+v", rtn.Window)
	}
	if rtn.SourceWindowId != fx.windowId || rtn.SourceNewActiveTabId != tabB {
		t.Fatalf("unexpected source info: %+v", rtn)
	}
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	if ws.PopOutTabs[tabA] != rtn.Window.OID {
		t.Fatalf("PopOutTabs = %v, want %s -> %s", ws.PopOutTabs, tabA, rtn.Window.OID)
	}
	if ws.ActiveTabId != tabB {
		t.Fatalf("main active tab = %s, want %s", ws.ActiveTabId, tabB)
	}
	if !slices.Equal(ws.TabIds, fx.tabIds) {
		t.Fatalf("master TabIds changed: %v", ws.TabIds)
	}
	if !slices.Contains(mustGetClient(t, ctx).WindowIds, rtn.Window.OID) {
		t.Fatalf("client.WindowIds misses the popped-out window")
	}
	if got, _ := FindWindowForTab(ctx, tabA); got != rtn.Window.OID {
		t.Fatalf("FindWindowForTab(popped) = %s, want %s", got, rtn.Window.OID)
	}
	if got, _ := FindWindowForTab(ctx, tabB); got != fx.windowId {
		t.Fatalf("FindWindowForTab(main) = %s, want %s", got, fx.windowId)
	}

	if err := CloseWindow(ctx, rtn.Window.OID, true); err != nil {
		t.Fatalf("CloseWindow(popped) failed: %v", err)
	}
	assertWindowGone(t, ctx, rtn.Window.OID)
	ws = mustGetWorkspace(t, ctx, fx.wsId)
	if len(ws.PopOutTabs) != 0 {
		t.Fatalf("PopOutTabs not cleared: %v", ws.PopOutTabs)
	}
	if !slices.Equal(ws.TabIds, fx.tabIds) {
		t.Fatalf("tabs not returned: %v", ws.TabIds)
	}
	if !windowExists(t, ctx, fx.windowId) {
		t.Fatalf("main window was closed")
	}
	if err := CloseWindow(ctx, rtn.Window.OID, true); err != nil {
		t.Fatalf("echo CloseWindow should be a no-op, got: %v", err)
	}
}

func TestPopOutTab_RejectsOnlyTab(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 1, true)
	if _, err := PopOutTab(ctx, fx.tabIds[0], nil, nil); err == nil {
		t.Fatalf("expected popping out the main window's only tab to fail")
	}

	fx2 := makePopOutFixture(t, ctx, 2, true)
	mustPopOutTab(t, ctx, fx2.tabIds[0])
	if _, err := PopOutTab(ctx, fx2.tabIds[0], nil, nil); err == nil {
		t.Fatalf("expected popping out a popped-out window's only tab to fail")
	}
}

func TestSetActiveTab_RoutesToOwnerWindow(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 4, true)
	rtn := mustPopOutTab(t, ctx, fx.tabIds[2])
	if _, err := MoveTabToWindow(ctx, fx.tabIds[3], rtn.Window.OID, -1); err != nil {
		t.Fatalf("MoveTabToWindow failed: %v", err)
	}
	if err := SetActiveTab(ctx, fx.wsId, fx.tabIds[2]); err != nil {
		t.Fatalf("SetActiveTab failed: %v", err)
	}
	window, _ := GetWindow(ctx, rtn.Window.OID)
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	if window.ActiveTabId != fx.tabIds[2] || ws.ActiveTabId != fx.tabIds[0] {
		t.Fatalf("popped active = %s, main active = %s", window.ActiveTabId, ws.ActiveTabId)
	}
	if err := SetActiveTab(ctx, fx.wsId, fx.tabIds[1]); err != nil {
		t.Fatalf("SetActiveTab failed: %v", err)
	}
	window, _ = GetWindow(ctx, rtn.Window.OID)
	ws = mustGetWorkspace(t, ctx, fx.wsId)
	if window.ActiveTabId != fx.tabIds[2] || ws.ActiveTabId != fx.tabIds[1] {
		t.Fatalf("popped active = %s, main active = %s", window.ActiveTabId, ws.ActiveTabId)
	}
}

func TestMoveTabToWindow(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 4, true)
	a, b, c, d := fx.tabIds[0], fx.tabIds[1], fx.tabIds[2], fx.tabIds[3]
	pop := mustPopOutTab(t, ctx, d).Window.OID

	rtn, err := MoveTabToWindow(ctx, a, pop, 0)
	if err != nil {
		t.Fatalf("MoveTabToWindow failed: %v", err)
	}
	if rtn.SourceWindowId != fx.windowId || rtn.DestWindowId != pop || rtn.SourceWindowEmpty || rtn.SourceNewActiveTabId != b {
		t.Fatalf("unexpected rtn: %+v", rtn)
	}
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	if got := getTabIdsForOwner(ws, pop); !slices.Equal(got, []string{a, d}) {
		t.Fatalf("popped tabs = %v, want [a d]", got)
	}
	if !slices.Equal(ws.TabIds, []string{b, c, a, d}) {
		t.Fatalf("master TabIds = %v", ws.TabIds)
	}
	window, _ := GetWindow(ctx, pop)
	if window.ActiveTabId != a || ws.ActiveTabId != b {
		t.Fatalf("popped active = %s, main active = %s", window.ActiveTabId, ws.ActiveTabId)
	}

	if _, err := MoveTabToWindow(ctx, a, fx.windowId, 0); err != nil {
		t.Fatalf("MoveTabToWindow(main) failed: %v", err)
	}
	rtn, err = MoveTabToWindow(ctx, d, fx.windowId, -1)
	if err != nil {
		t.Fatalf("MoveTabToWindow(main) failed: %v", err)
	}
	if !rtn.SourceWindowEmpty {
		t.Fatalf("expected the popped-out window to be empty")
	}
	if !windowExists(t, ctx, pop) {
		t.Fatalf("an emptied popped-out window must be kept until the caller closes it")
	}
	if err := CloseWindow(ctx, pop, true); err != nil {
		t.Fatalf("CloseWindow(empty popped) failed: %v", err)
	}
	assertWindowGone(t, ctx, pop)
	ws = mustGetWorkspace(t, ctx, fx.wsId)
	if len(ws.PopOutTabs) != 0 || !slices.Equal(ws.TabIds, []string{a, b, c, d}) || ws.ActiveTabId != d {
		t.Fatalf("unexpected workspace: tabs=%v popout=%v active=%s", ws.TabIds, ws.PopOutTabs, ws.ActiveTabId)
	}

	if _, err := MoveTabToWindow(ctx, a, fx.windowId, 0); err == nil {
		t.Fatalf("expected moving a tab into its own window to fail")
	}
	other := makePopOutFixture(t, ctx, 2, true)
	if _, err := MoveTabToWindow(ctx, a, other.windowId, 0); err == nil {
		t.Fatalf("expected moving a tab to another workspace's window to fail")
	}
}

func TestDeleteTab_LastPopOutTabRemovesWindow(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 3, true)
	pop := mustPopOutTab(t, ctx, fx.tabIds[2]).Window.OID

	newActive, err := DeleteTab(ctx, fx.wsId, fx.tabIds[2], true)
	if err != nil {
		t.Fatalf("DeleteTab failed: %v", err)
	}
	if newActive != "" {
		t.Fatalf("DeleteTab returned %q, want \"\" (close the popped-out window)", newActive)
	}
	assertWindowGone(t, ctx, pop)
	if !windowExists(t, ctx, fx.windowId) {
		t.Fatalf("main window was closed")
	}
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	if len(ws.PopOutTabs) != 0 || !slices.Equal(ws.TabIds, fx.tabIds[:2]) || ws.ActiveTabId != fx.tabIds[0] {
		t.Fatalf("unexpected workspace: tabs=%v popout=%v active=%s", ws.TabIds, ws.PopOutTabs, ws.ActiveTabId)
	}
}

func TestDeleteTab_PicksActiveWithinWindow(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 4, true)
	a, b, c, d := fx.tabIds[0], fx.tabIds[1], fx.tabIds[2], fx.tabIds[3]
	pop := mustPopOutTab(t, ctx, b).Window.OID
	if _, err := MoveTabToWindow(ctx, d, pop, -1); err != nil {
		t.Fatalf("MoveTabToWindow failed: %v", err)
	}
	newActive, err := DeleteTab(ctx, fx.wsId, d, true)
	if err != nil {
		t.Fatalf("DeleteTab failed: %v", err)
	}
	if newActive != b {
		t.Fatalf("DeleteTab returned %q, want the popped-out neighbour %s", newActive, b)
	}
	window, _ := GetWindow(ctx, pop)
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	if window.ActiveTabId != b || ws.ActiveTabId != a {
		t.Fatalf("popped active = %s, main active = %s", window.ActiveTabId, ws.ActiveTabId)
	}
	newActive, err = DeleteTab(ctx, fx.wsId, a, true)
	if err != nil {
		t.Fatalf("DeleteTab failed: %v", err)
	}
	if newActive != c {
		t.Fatalf("DeleteTab returned %q, want the main neighbour %s", newActive, c)
	}
}

func TestDeleteTab_MainLastTabFoldsPopOuts(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 3, true)
	pop1 := mustPopOutTab(t, ctx, fx.tabIds[1]).Window.OID
	pop2 := mustPopOutTab(t, ctx, fx.tabIds[2]).Window.OID

	newActive, err := DeleteTab(ctx, fx.wsId, fx.tabIds[0], true)
	if err != nil {
		t.Fatalf("DeleteTab failed: %v", err)
	}
	if newActive != fx.tabIds[1] {
		t.Fatalf("DeleteTab returned %q, want first folded tab %s", newActive, fx.tabIds[1])
	}
	assertWindowGone(t, ctx, pop1)
	assertWindowGone(t, ctx, pop2)
	if !windowExists(t, ctx, fx.windowId) {
		t.Fatalf("main window was closed")
	}
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	if len(ws.PopOutTabs) != 0 || !slices.Equal(ws.TabIds, fx.tabIds[1:]) || ws.ActiveTabId != fx.tabIds[1] {
		t.Fatalf("unexpected workspace: tabs=%v popout=%v active=%s", ws.TabIds, ws.PopOutTabs, ws.ActiveTabId)
	}
}

func TestCloseMainWindow_FoldsPopOuts(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 2, true)
	pop := mustPopOutTab(t, ctx, fx.tabIds[1]).Window.OID

	if err := CloseWindow(ctx, fx.windowId, true); err != nil {
		t.Fatalf("CloseWindow(main) failed: %v", err)
	}
	assertWindowGone(t, ctx, pop)
	assertWindowGone(t, ctx, fx.windowId)
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	if len(ws.PopOutTabs) != 0 || !slices.Equal(ws.TabIds, fx.tabIds) {
		t.Fatalf("named workspace not kept intact: tabs=%v popout=%v", ws.TabIds, ws.PopOutTabs)
	}
}

func TestSwitchWorkspace_FoldsPopOuts(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 2, true)
	pop := mustPopOutTab(t, ctx, fx.tabIds[1]).Window.OID
	other := makePopOutFixture(t, ctx, 1, false)

	if _, err := SwitchWorkspace(ctx, pop, other.wsId); err == nil {
		t.Fatalf("expected switching a popped-out window's workspace to fail")
	}
	ws, err := SwitchWorkspace(ctx, fx.windowId, other.wsId)
	if err != nil {
		t.Fatalf("SwitchWorkspace failed: %v", err)
	}
	if ws == nil || ws.OID != other.wsId {
		t.Fatalf("SwitchWorkspace returned %v", ws)
	}
	assertWindowGone(t, ctx, pop)
	window, _ := GetWindow(ctx, fx.windowId)
	if window.WorkspaceId != other.wsId {
		t.Fatalf("main window shows %s, want %s", window.WorkspaceId, other.wsId)
	}
	oldWs := mustGetWorkspace(t, ctx, fx.wsId)
	if len(oldWs.PopOutTabs) != 0 || !slices.Equal(oldWs.TabIds, fx.tabIds) {
		t.Fatalf("old workspace not folded: tabs=%v popout=%v", oldWs.TabIds, oldWs.PopOutTabs)
	}
}

func TestDeleteWorkspace_FoldsPopOuts(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 2, true)
	pop := mustPopOutTab(t, ctx, fx.tabIds[1]).Window.OID

	deleted, _, err := DeleteWorkspace(ctx, fx.wsId, true)
	if err != nil || !deleted {
		t.Fatalf("DeleteWorkspace = %v, %v", deleted, err)
	}
	assertWindowGone(t, ctx, pop)
	ws, _ := wstore.DBGet[*waveobj.Workspace](ctx, fx.wsId)
	if ws != nil {
		t.Fatalf("workspace still exists")
	}
}

func TestEnsureInitialData_FoldsPopOuts(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx1 := makePopOutFixture(t, ctx, 2, true)
	fx2 := makePopOutFixture(t, ctx, 3, true)
	pop1 := mustPopOutTab(t, ctx, fx1.tabIds[1]).Window.OID
	pop2 := mustPopOutTab(t, ctx, fx2.tabIds[0]).Window.OID
	if _, err := MoveTabToWindow(ctx, fx2.tabIds[2], pop2, -1); err != nil {
		t.Fatalf("MoveTabToWindow failed: %v", err)
	}

	if _, err := EnsureInitialData(); err != nil {
		t.Fatalf("EnsureInitialData failed: %v", err)
	}
	assertWindowGone(t, ctx, pop1)
	assertWindowGone(t, ctx, pop2)
	client := mustGetClient(t, ctx)
	if !slices.Equal(client.WindowIds, []string{fx1.windowId, fx2.windowId}) {
		t.Fatalf("client.WindowIds = %v, want only the main windows", client.WindowIds)
	}
	wantTabIds := map[string][]string{
		fx1.wsId: fx1.tabIds,
		fx2.wsId: {fx2.tabIds[0], fx2.tabIds[2], fx2.tabIds[1]},
	}
	for wsId, want := range wantTabIds {
		ws := mustGetWorkspace(t, ctx, wsId)
		if len(ws.PopOutTabs) != 0 || !slices.Equal(ws.TabIds, want) {
			t.Fatalf("workspace %s not folded: tabs=%v popout=%v", wsId, ws.TabIds, ws.PopOutTabs)
		}
	}
}

func TestMergeTabIdOrder(t *testing.T) {
	master := []string{"a", "b", "c", "d", "e"}
	cases := []struct {
		name   string
		tabIds []string
		want   []string
	}{
		{"full replace", []string{"e", "d", "c", "b", "a"}, []string{"e", "d", "c", "b", "a"}},
		{"subset", []string{"d", "b"}, []string{"a", "d", "c", "b", "e"}},
		{"complement subset", []string{"e", "c", "a"}, []string{"e", "b", "c", "d", "a"}},
		{"empty", []string{}, master},
	}
	for _, tc := range cases {
		got, err := mergeTabIdOrder(master, tc.tabIds)
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", tc.name, err)
		}
		if !slices.Equal(got, tc.want) {
			t.Fatalf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
	if _, err := mergeTabIdOrder(master, []string{"a", "x"}); err == nil {
		t.Fatalf("expected an unknown id to fail")
	}
	if _, err := mergeTabIdOrder(master, []string{"a", "a"}); err == nil {
		t.Fatalf("expected a duplicate id to fail")
	}
}

func TestUpdateWorkspaceTabIds_SubsetMerge(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 5, true)
	a, b, c, d, e := fx.tabIds[0], fx.tabIds[1], fx.tabIds[2], fx.tabIds[3], fx.tabIds[4]
	pop := mustPopOutTab(t, ctx, b).Window.OID
	if _, err := MoveTabToWindow(ctx, d, pop, -1); err != nil {
		t.Fatalf("MoveTabToWindow failed: %v", err)
	}
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	if !slices.Equal(ws.TabIds, []string{a, b, d, c, e}) {
		t.Fatalf("unexpected master order before reorder: %v", ws.TabIds)
	}

	if err := UpdateWorkspaceTabIds(ctx, fx.wsId, []string{d, b}); err != nil {
		t.Fatalf("UpdateWorkspaceTabIds(popped subset) failed: %v", err)
	}
	if err := UpdateWorkspaceTabIds(ctx, fx.wsId, []string{e, c, a}); err != nil {
		t.Fatalf("UpdateWorkspaceTabIds(main subset) failed: %v", err)
	}
	ws = mustGetWorkspace(t, ctx, fx.wsId)
	if !slices.Equal(ws.TabIds, []string{e, d, b, c, a}) {
		t.Fatalf("master TabIds = %v", ws.TabIds)
	}
	if got := getTabIdsForOwner(ws, pop); !slices.Equal(got, []string{d, b}) {
		t.Fatalf("popped tabs = %v, want [d b]", got)
	}

	if err := UpdateWorkspaceTabIds(ctx, fx.wsId, []string{a, b, c, d, e}); err != nil {
		t.Fatalf("UpdateWorkspaceTabIds(full) failed: %v", err)
	}
	ws = mustGetWorkspace(t, ctx, fx.wsId)
	if !slices.Equal(ws.TabIds, []string{a, b, c, d, e}) {
		t.Fatalf("full replace: master TabIds = %v", ws.TabIds)
	}
	if err := UpdateWorkspaceTabIds(ctx, fx.wsId, []string{a, uuid.NewString()}); err == nil {
		t.Fatalf("expected an unknown tab id to fail")
	}
}

func TestListWorkspaces_WindowIdIsMainWindow(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 3, true)
	mustPopOutTab(t, ctx, fx.tabIds[1])
	mustPopOutTab(t, ctx, fx.tabIds[2])

	list, err := ListWorkspaces(ctx)
	if err != nil {
		t.Fatalf("ListWorkspaces failed: %v", err)
	}
	if len(list) != 1 || list[0].WorkspaceId != fx.wsId || list[0].WindowId != fx.windowId {
		t.Fatalf("unexpected list: %+v", list[0])
	}
	mainId, err := FindMainWindowForWorkspace(ctx, fx.wsId)
	if err != nil || mainId != fx.windowId {
		t.Fatalf("FindMainWindowForWorkspace = %q, %v; want %s", mainId, err, fx.windowId)
	}
}

func TestMoveBlockToTab_NewTabStaysInPopOutWindow(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 1, true)
	tabId, blockIds := insertTestTab(t, ctx, 2)
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	ws.TabIds = append(ws.TabIds, tabId)
	if err := wstore.DBUpdate(ctx, ws); err != nil {
		t.Fatalf("failed to update workspace: %v", err)
	}
	pop := mustPopOutTab(t, ctx, tabId).Window.OID

	rtn, err := MoveBlockToTab(ctx, blockIds[0], "")
	if err != nil {
		t.Fatalf("MoveBlockToTab failed: %v", err)
	}
	ws = mustGetWorkspace(t, ctx, fx.wsId)
	if ws.PopOutTabs[rtn.DestTabId] != pop {
		t.Fatalf("new tab %s not in the popped-out window: %v", rtn.DestTabId, ws.PopOutTabs)
	}
	if got, _ := FindWindowForTab(ctx, rtn.DestTabId); got != pop {
		t.Fatalf("FindWindowForTab(new tab) = %s, want %s", got, pop)
	}

	rtn, err = MoveBlockToTab(ctx, blockIds[1], "")
	if err != nil {
		t.Fatalf("MoveBlockToTab failed: %v", err)
	}
	if _, ok := mustGetWorkspace(t, ctx, fx.wsId).PopOutTabs[rtn.DestTabId]; !ok {
		t.Fatalf("second new tab not in the popped-out window")
	}
}

func TestPopOutBlock(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 0, true)
	tabId, blockIds := insertTestTab(t, ctx, 2)
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	ws.TabIds = []string{tabId}
	ws.ActiveTabId = tabId
	if err := wstore.DBUpdate(ctx, ws); err != nil {
		t.Fatalf("failed to update workspace: %v", err)
	}

	rtn, err := PopOutBlock(ctx, blockIds[0], &waveobj.Point{X: 10, Y: 20}, &waveobj.WinSize{Width: 800, Height: 600})
	if err != nil {
		t.Fatalf("PopOutBlock failed: %v", err)
	}
	if rtn.SourceWindowId != fx.windowId || rtn.SourceNewActiveTabId != tabId {
		t.Fatalf("unexpected rtn: %+v", rtn)
	}
	if rtn.Window.Pos.X != 10 || rtn.Window.WinSize.Width != 800 || rtn.Window.IsNew {
		t.Fatalf("unexpected window geometry: %+v", rtn.Window)
	}
	newTabId := rtn.Window.ActiveTabId
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, newTabId)
	if err != nil || !slices.Equal(tab.BlockIds, blockIds[:1]) {
		t.Fatalf("popped-out tab blocks = %v, %v", tab, err)
	}
	if _, err := PopOutBlock(ctx, blockIds[1], nil, nil); err == nil {
		t.Fatalf("expected popping out a tab's only block to fail")
	}
}

func TestMoveTabToWindow_RollbackIntoEmptiedPopOut(t *testing.T) {
	ctx := initPopOutTestStore(t)
	fx := makePopOutFixture(t, ctx, 3, true)
	b := fx.tabIds[1]
	pop := mustPopOutTab(t, ctx, b).Window.OID

	rtn, err := MoveTabToWindow(ctx, b, fx.windowId, -1)
	if err != nil || !rtn.SourceWindowEmpty {
		t.Fatalf("MoveTabToWindow = %+v, %v", rtn, err)
	}
	if _, err := MoveTabToWindow(ctx, b, pop, 0); err != nil {
		t.Fatalf("moving the tab back into the emptied popped-out window failed: %v", err)
	}
	ws := mustGetWorkspace(t, ctx, fx.wsId)
	window, _ := GetWindow(ctx, pop)
	if ws.PopOutTabs[b] != pop || window.ActiveTabId != b {
		t.Fatalf("rollback did not restore the tab: popout=%v active=%s", ws.PopOutTabs, window.ActiveTabId)
	}
}
