// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiutil

import (
	"net/http"
	"testing"
)

func TestCheckAIHostAllowed(t *testing.T) {
	blocked := []string{"cfapi.waveterm.dev", "WAVETERM.DEV", "api.waveterm.dev.", "x.commandline.dev"}
	for _, h := range blocked {
		if err := CheckAIHostAllowed(h); err == nil {
			t.Errorf("expected %q to be blocked", h)
		}
	}
	allowed := []string{"api.openai.com", "localhost", "notwaveterm.dev", "waveterm.dev.example.com", ""}
	for _, h := range allowed {
		if err := CheckAIHostAllowed(h); err != nil {
			t.Errorf("expected %q to be allowed: %v", h, err)
		}
	}
}

func TestMakeHTTPClientBlocksUpstreamHosts(t *testing.T) {
	for _, proxyURL := range []string{"", "http://127.0.0.1:1"} {
		client, err := MakeHTTPClient(proxyURL)
		if err != nil {
			t.Fatal(err)
		}
		req, _ := http.NewRequest("POST", "https://cfapi.waveterm.dev/api/waveai", nil)
		if _, err := client.Do(req); err == nil {
			t.Errorf("expected request to be blocked (proxy %q)", proxyURL)
		}
	}
}
