// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiutil

import (
	"fmt"
	"net/http"
	"strings"
)

var blockedAIHostSuffixes = []string{"waveterm.dev", "commandline.dev"}

func CheckAIHostAllowed(host string) error {
	h := strings.ToLower(strings.TrimSuffix(host, "."))
	for _, suffix := range blockedAIHostSuffixes {
		if h == suffix || strings.HasSuffix(h, "."+suffix) {
			return fmt.Errorf("AI requests to %s are not allowed: this build does not use upstream Wave cloud services; configure your own AI provider", suffix)
		}
	}
	return nil
}

type hostGuardTransport struct {
	base http.RoundTripper
}

func (t *hostGuardTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if err := CheckAIHostAllowed(req.URL.Hostname()); err != nil {
		return nil, err
	}
	return t.base.RoundTrip(req)
}
