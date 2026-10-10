// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudesessions

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"strings"
)

const (
	headBytes      = 32 * 1024
	tailBytes      = 128 * 1024
	maxPreviewLen  = 200
	maxNameLen     = 200
	titleTypeName  = "custom-title"
	agentTypeName  = "agent-name"
	promptTypeName = "last-prompt"
)

// transcriptInfo is what the pane needs from one transcript file.
type transcriptInfo struct {
	Name    string
	Cwd     string
	Preview string
}

// transcriptLine holds the only fields read from a transcript line; the format is undocumented
// and everything else in it is ignored.
type transcriptLine struct {
	Type        string `json:"type"`
	CustomTitle string `json:"customTitle"`
	AgentName   string `json:"agentName"`
	LastPrompt  string `json:"lastPrompt"`
	Cwd         string `json:"cwd"`
}

func cleanText(s string, max int) string {
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	rs := []rune(s)
	if len(rs) > max {
		return string(rs[:max]) + "…"
	}
	return s
}

func (t *transcriptInfo) apply(line []byte) {
	// Cheap filter: most lines are large messages that carry none of the fields we want.
	if !bytes.Contains(line, []byte(`"cwd"`)) && !bytes.Contains(line, []byte(`"customTitle"`)) &&
		!bytes.Contains(line, []byte(`"agentName"`)) && !bytes.Contains(line, []byte(`"lastPrompt"`)) {
		return
	}
	var tl transcriptLine
	if json.Unmarshal(line, &tl) != nil {
		return
	}
	if tl.Cwd != "" && t.Cwd == "" {
		t.Cwd = tl.Cwd
	}
	switch tl.Type {
	case titleTypeName:
		if tl.CustomTitle != "" {
			t.Name = cleanText(tl.CustomTitle, maxNameLen)
		}
	case agentTypeName:
		if tl.AgentName != "" && t.Name == "" {
			t.Name = cleanText(tl.AgentName, maxNameLen)
		}
	case promptTypeName:
		if tl.LastPrompt != "" {
			t.Preview = cleanText(tl.LastPrompt, maxPreviewLen)
		}
	}
}

// completeLines splits buf into whole lines. A buffer cut at the start drops its first (partial)
// line; one cut at the end drops its last.
func completeLines(buf []byte, cutStart bool, cutEnd bool) [][]byte {
	lines := bytes.Split(buf, []byte("\n"))
	if cutStart && len(lines) > 0 {
		lines = lines[1:]
	}
	if cutEnd && len(lines) > 0 {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// readTranscript reads only the head and tail of a transcript, so a multi-megabyte session costs
// the same as a short one. Later lines win over earlier ones.
func readTranscript(path string, size int64) (transcriptInfo, error) {
	var info transcriptInfo
	f, err := os.Open(path)
	if err != nil {
		return info, err
	}
	defer f.Close()
	headLen := min(size, headBytes)
	head := make([]byte, headLen)
	if _, err := io.ReadFull(f, head); err != nil {
		return info, err
	}
	for _, line := range completeLines(head, false, size > headLen) {
		info.apply(line)
	}
	if size <= headLen {
		return info, nil
	}
	tailStart := max(size-tailBytes, headLen)
	tail := make([]byte, size-tailStart)
	if _, err := f.ReadAt(tail, tailStart); err != nil && err != io.EOF {
		return info, err
	}
	for _, line := range completeLines(tail, tailStart > headLen, false) {
		info.apply(line)
	}
	return info, nil
}
