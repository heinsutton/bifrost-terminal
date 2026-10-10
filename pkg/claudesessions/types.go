// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudesessions

const HarnessClaude = "claude"

// ClaudeSession is one Claude Code session found under ~/.claude, open or closed.
type ClaudeSession struct {
	Harness    string `json:"harness"`
	SessionId  string `json:"sessionid"`
	Name       string `json:"name,omitempty"`
	Cwd        string `json:"cwd"`
	LastActive int64  `json:"lastactive"` // unix ms
	Preview    string `json:"preview,omitempty"`
	Pid        int    `json:"pid,omitempty"`    // only set while the process is alive
	Status     string `json:"status,omitempty"` // registry status of a live session: busy | idle
	Version    string `json:"version,omitempty"`
}

// ClaudeFolder is a directory the user asked to remember.
type ClaudeFolder struct {
	Path  string `json:"path"`
	Label string `json:"label,omitempty"`
}

// ClaudeListResult is what the pane shows: every session plus the user's own folders and descriptions.
type ClaudeListResult struct {
	Sessions     []ClaudeSession   `json:"sessions"`
	Folders      []ClaudeFolder    `json:"folders"`
	Descriptions map[string]string `json:"descriptions"`
	Ts           int64             `json:"ts"`
}
