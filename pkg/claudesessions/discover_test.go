// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudesessions

import (
	"fmt"
	"os"
	"path/filepath"
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
	got := p.Discover()
	if len(got) != 1 || got[0].Cwd != "/a" || got[0].Pid != 7 {
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
