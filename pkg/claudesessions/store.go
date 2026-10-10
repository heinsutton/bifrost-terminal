// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudesessions

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

const StoreFileName = "claude-sessions.json"

// storeData is the user's own data: folders to remember and a description per session. It lives in
// Bifrost's config dir, never in ~/.claude (owned by Claude Code) or the vault.
type storeData struct {
	Folders      []ClaudeFolder    `json:"folders"`
	Descriptions map[string]string `json:"descriptions"`
}

func loadStore(configDir string) storeData {
	sd := storeData{Folders: []ClaudeFolder{}, Descriptions: map[string]string{}}
	data, err := os.ReadFile(filepath.Join(configDir, StoreFileName))
	if err != nil {
		return sd
	}
	var loaded storeData
	if json.Unmarshal(data, &loaded) != nil {
		return sd
	}
	if loaded.Folders != nil {
		sd.Folders = loaded.Folders
	}
	if loaded.Descriptions != nil {
		sd.Descriptions = loaded.Descriptions
	}
	return sd
}

// List returns every session plus the user's folders and descriptions.
func List(p *Provider, configDir string) *ClaudeListResult {
	sd := loadStore(configDir)
	sessions := p.Discover()
	if sessions == nil {
		sessions = []ClaudeSession{}
	}
	return &ClaudeListResult{Sessions: sessions, Folders: sd.Folders, Descriptions: sd.Descriptions, Ts: time.Now().UnixMilli()}
}
