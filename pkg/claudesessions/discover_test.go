// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudesessions

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

const (
	idNamed   = "11111111-1111-4111-8111-111111111111"
	idUnnamed = "22222222-2222-4222-8222-222222222222"
	idLive    = "33333333-3333-4333-8333-333333333333"
	idHuge    = "44444444-4444-4444-8444-444444444444"
	idSdk     = "55555555-5555-4555-8555-555555555555"
)

func write(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func fixture(t *testing.T) *Provider {
	dir := t.TempDir()
	proj := filepath.Join(dir, "projects", "-home-x-proj")
	write(t, filepath.Join(proj, idNamed+".jsonl"),
		`{"type":"custom-title","customTitle":"old name","sessionId":"x"}`+"\n"+
			`{"type":"user","cwd":"/home/x/proj","message":"hi"}`+"\n"+
			`not json at all`+"\n"+
			`{"type":"custom-title","customTitle":"baldr","sessionId":"x"}`+"\n"+
			`{"type":"last-prompt","lastPrompt":"do the\nthing"}`+"\n")
	write(t, filepath.Join(proj, idUnnamed+".jsonl"), `{"type":"mode","mode":"normal"}`+"\n")
	write(t, filepath.Join(proj, idLive+".jsonl"), `{"type":"user","cwd":"/home/x/proj"}`+"\n")
	// Past both read windows: the name sits in the head, the last prompt in the tail.
	huge := `{"type":"custom-title","customTitle":"big","sessionId":"x"}` + "\n" +
		`{"type":"user","cwd":"/home/x/big"}` + "\n" +
		strings.Repeat(`{"type":"assistant","message":"`+strings.Repeat("a", 900)+`"}`+"\n", 400) +
		`{"type":"last-prompt","lastPrompt":"the end"}` + "\n"
	write(t, filepath.Join(proj, idHuge+".jsonl"), huge)
	write(t, filepath.Join(dir, "sessions", "100.json"),
		fmt.Sprintf(`{"pid":100,"sessionId":%q,"cwd":"/home/x/proj","kind":"interactive","name":"live one","status":"busy","updatedAt":%d}`, idLive, time.Now().UnixMilli()))
	write(t, filepath.Join(dir, "sessions", "101.json"), fmt.Sprintf(`{"pid":101,"sessionId":%q,"kind":"interactive"}`, idNamed))
	write(t, filepath.Join(dir, "sessions", "102.json"), fmt.Sprintf(`{"pid":102,"sessionId":%q,"kind":"sdk"}`, idSdk))
	write(t, filepath.Join(dir, "sessions", "103.json"), `{broken`)
	write(t, filepath.Join(dir, "sessions", "100.abc.key"), `secret`)
	write(t, filepath.Join(dir, "history.jsonl"),
		fmt.Sprintf(`{"display":"from history","timestamp":5,"project":"/home/x/proj","sessionId":%q}`, idUnnamed)+"\n"+"garbage\n")
	p := MakeProvider(dir)
	p.pidAlive = func(pid int) bool { return pid == 100 }
	p.blockOf = func(pid int) string { return "block-" + fmt.Sprint(pid) }
	return p
}

func byId(ss []ClaudeSession) map[string]ClaudeSession {
	m := map[string]ClaudeSession{}
	for _, s := range ss {
		m[s.SessionId] = s
	}
	return m
}

func TestDiscover(t *testing.T) {
	sessions := fixture(t).Discover()
	m := byId(sessions)
	if len(sessions) != 4 {
		t.Fatalf("want 4 sessions, got %d", len(sessions))
	}
	if s := m[idNamed]; s.Name != "baldr" || s.Cwd != "/home/x/proj" || s.Preview != "do the thing" || s.Pid != 0 {
		t.Errorf("named: %+v", s)
	}
	if s := m[idUnnamed]; s.Name != "" || s.Cwd != "/home/x/proj" || s.Preview != "from history" {
		t.Errorf("unnamed should fall back to history: %+v", s)
	}
	if s := m[idLive]; s.Name != "live one" || s.Pid != 100 || s.Status != "busy" {
		t.Errorf("live: %+v", s)
	}
	if s := m[idHuge]; s.Name != "big" || s.Cwd != "/home/x/big" || s.Preview != "the end" {
		t.Errorf("huge: %+v", s)
	}
	if _, ok := m[idSdk]; ok {
		t.Errorf("sdk session must be skipped")
	}
}

func TestDiscoverEmptyDir(t *testing.T) {
	p := MakeProvider(filepath.Join(t.TempDir(), "missing"))
	if got := p.Discover(); len(got) != 0 {
		t.Errorf("want none, got %d", len(got))
	}
}

func TestDiscoverLiveWithoutTranscript(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "sessions", "7.json"), fmt.Sprintf(`{"pid":7,"sessionId":%q,"cwd":"/a","kind":"interactive","status":"idle"}`, idLive))
	p := MakeProvider(dir)
	p.pidAlive = func(int) bool { return true }
	p.blockOf = func(int) string { return "" }
	got := p.Discover()
	if len(got) != 1 || got[0].Cwd != "/a" || got[0].Pid != 7 || !got[0].External || got[0].BlockId != "" {
		t.Errorf("got %+v", got)
	}
}

func TestCacheReusedUntilFileChanges(t *testing.T) {
	p := fixture(t)
	p.Discover()
	path := filepath.Join(p.claudeDir, "projects", "-home-x-proj", idNamed+".jsonl")
	fi, _ := os.Stat(path)
	p.lock.Lock()
	p.cache[path] = cacheEntry{key: cacheKey{mtime: fi.ModTime().UnixMilli(), size: fi.Size()}, info: transcriptInfo{Name: "cached"}}
	p.lock.Unlock()
	if s := byId(p.Discover())[idNamed]; s.Name != "cached" {
		t.Errorf("unchanged file should come from cache, got %q", s.Name)
	}
	write(t, path, `{"type":"custom-title","customTitle":"fresh"}`+"\n")
	if s := byId(p.Discover())[idNamed]; s.Name != "fresh" {
		t.Errorf("changed file should be re-read, got %q", s.Name)
	}
}

func TestListStore(t *testing.T) {
	cfg := t.TempDir()
	write(t, filepath.Join(cfg, StoreFileName), `{"folders":[{"path":"/a"}],"descriptions":{"`+idNamed+`":"notes"}}`)
	res := List(fixture(t), cfg)
	if len(res.Folders) != 1 || res.Descriptions[idNamed] != "notes" {
		t.Errorf("store not loaded: %+v", res)
	}
	bad := t.TempDir()
	write(t, filepath.Join(bad, StoreFileName), `{broken`)
	res = List(fixture(t), bad)
	if res.Folders == nil || res.Descriptions == nil {
		t.Errorf("damaged store must give empty, non-nil values")
	}
}

func TestIsSessionId(t *testing.T) {
	if !IsSessionId(idNamed) || IsSessionId("../etc") || IsSessionId(idNamed+";rm") {
		t.Errorf("session id check wrong")
	}
}

func TestDiscoverStates(t *testing.T) {
	m := byId(fixture(t).Discover())
	if m[idLive].State != StateBusy || m[idNamed].State != StateOffline {
		t.Errorf("states: live=%q named=%q", m[idLive].State, m[idNamed].State)
	}
}

func TestApplyBlockStates(t *testing.T) {
	mk := func(id, state, status string, statusTs int64) ClaudeSession {
		return ClaudeSession{SessionId: id, State: state, Status: status, StatusTs: statusTs}
	}
	sessions := []ClaudeSession{
		mk("a", StateIdle, StateIdle, 100),
		mk("b", StateOffline, "", 0),
		mk("c", StateIdle, StateIdle, 500),
		mk("d", StateBusy, StateBusy, 100),
		mk("e", StateIdle, StateIdle, 100),
	}
	ApplyBlockStates(sessions, []BlockClaude{
		{BlockId: "b1", SessionId: "a", State: StateWaiting, Ts: 200},
		{BlockId: "b2", SessionId: "b", State: StateWaiting, Ts: 200},
		{BlockId: "b3", SessionId: "c", State: StateWaiting, Ts: 200},
		{BlockId: "b4", SessionId: "d", State: StateIdle, Ts: 200},
		{BlockId: "old", SessionId: "e", State: StateBusy, Ts: 50},
		{BlockId: "new", SessionId: "e", State: StateWaiting, Ts: 150},
		{BlockId: "bad", SessionId: "x", State: "bogus", Ts: 1},
	})
	want := map[string][2]string{
		"a": {StateWaiting, "b1"},
		"b": {StateOffline, ""},
		"c": {StateIdle, "b3"},
		"d": {StateIdle, "b4"},
		"e": {StateWaiting, "new"},
	}
	for _, s := range sessions {
		if w := want[s.SessionId]; s.State != w[0] || s.BlockId != w[1] {
			t.Errorf("%s: got state=%q block=%q, want %v", s.SessionId, s.State, s.BlockId, w)
		}
	}
}

func TestRenameDoesNotMoveLastActive(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "projects", "-a", idNamed+".jsonl")
	write(t, path, `{"type":"user","cwd":"/a","timestamp":"2026-10-10T10:00:00.000Z"}`+"\n"+
		`{"type":"assistant","timestamp":"2026-10-10T10:05:00.000Z"}`+"\n"+
		`{"type":"custom-title","customTitle":"renamed"}`+"\n")
	got := MakeProvider(dir).Discover()
	want := time.Date(2026, 10, 10, 10, 5, 0, 0, time.UTC).UnixMilli()
	if len(got) != 1 || got[0].LastActive != want || got[0].Name != "renamed" {
		t.Errorf("last active should be the last message, got %+v (want %d)", got, want)
	}
}

func TestBlockOfPidReadsChildEnvironment(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("needs a unix sleep binary")
	}
	child := exec.Command("sleep", "5")
	child.Env = append(os.Environ(), "WAVETERM_BLOCKID=abc-123")
	if err := child.Start(); err != nil {
		t.Skipf("cannot start sleep: %v", err)
	}
	defer func() {
		_ = child.Process.Kill()
		_ = child.Wait()
	}()
	if got := blockOfPid(child.Process.Pid); got != "abc-123" {
		t.Errorf("got %q", got)
	}
	plain := exec.Command("sleep", "5")
	plain.Env = []string{"PATH=" + os.Getenv("PATH")}
	if err := plain.Start(); err != nil {
		t.Skipf("cannot start sleep: %v", err)
	}
	defer func() {
		_ = plain.Process.Kill()
		_ = plain.Wait()
	}()
	if got := blockOfPid(plain.Process.Pid); got != "" {
		t.Errorf("a process outside Bifrost should have no block, got %q", got)
	}
}
