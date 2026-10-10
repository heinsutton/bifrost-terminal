// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudesessions

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

const (
	maxPromptLen    = 300
	maxPromptsLimit = 50
)

// bookkeeping commands that say nothing about what a session was doing
var noisePrompts = map[string]bool{"/exit": true, "/clear": true, "/resume": true, "clear": true, "exit": true}

// RecentPrompts returns the newest prompts typed in a session, read from Claude's prompt history
// (one line per prompt, much smaller than the transcripts).
func (p *Provider) RecentPrompts(sessionId string, limit int) ([]ClaudePrompt, error) {
	if !IsSessionId(sessionId) {
		return nil, fmt.Errorf("not a session id: %q", sessionId)
	}
	limit = min(max(limit, 1), maxPromptsLimit)
	f, err := os.Open(filepath.Join(p.claudeDir, "history.jsonl"))
	if err != nil {
		if os.IsNotExist(err) {
			return []ClaudePrompt{}, nil
		}
		return nil, err
	}
	defer f.Close()
	prompts := []ClaudePrompt{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for sc.Scan() {
		var he historyEntry
		if json.Unmarshal(sc.Bytes(), &he) != nil || he.SessionId != sessionId {
			continue
		}
		text := cleanText(he.Display, maxPromptLen)
		if text == "" || noisePrompts[text] {
			continue
		}
		prompts = append(prompts, ClaudePrompt{Ts: he.Timestamp, Text: text})
	}
	sort.SliceStable(prompts, func(i, j int) bool { return prompts[i].Ts > prompts[j].Ts })
	if len(prompts) > limit {
		prompts = prompts[:limit]
	}
	return prompts, nil
}
