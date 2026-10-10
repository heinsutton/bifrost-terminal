// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const (
	claudeStateBusy    = "busy"
	claudeStateIdle    = "idle"
	claudeStateWaiting = "waiting"
	claudeStateClear   = "clear"
	claudeHookMaxBytes = 1 << 20
)

var claudeStateCmd = &cobra.Command{
	Use:   "claudestate",
	Short: "record the state of the Claude Code session running in this block",
	Long: `Meant to be run as a Claude Code hook. Reads the hook's JSON from stdin and tags the current
block with the session id and its state (busy, idle or waiting for input), which the Claude Sessions
view shows. Add it to the UserPromptSubmit, PreToolUse (matcher AskUserQuestion), PostToolUse,
Notification (matchers permission_prompt and elicitation_dialog), Stop, SessionStart and SessionEnd
hooks.`,
	Args:                  cobra.NoArgs,
	RunE:                  claudeStateRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

func init() {
	rootCmd.AddCommand(claudeStateCmd)
}

type claudeHookInput struct {
	HookEventName    string `json:"hook_event_name"`
	SessionId        string `json:"session_id"`
	ToolName         string `json:"tool_name"`
	NotificationType string `json:"notification_type"`
}

// claudeStateForHook maps a hook event to a session state; "" means the event does not change it.
func claudeStateForHook(in claudeHookInput) string {
	switch in.HookEventName {
	case "UserPromptSubmit", "PostToolUse":
		return claudeStateBusy
	case "PreToolUse":
		if in.ToolName == "AskUserQuestion" {
			return claudeStateWaiting
		}
		return claudeStateBusy
	case "Notification":
		if in.NotificationType == "" || in.NotificationType == "permission_prompt" || in.NotificationType == "elicitation_dialog" {
			return claudeStateWaiting
		}
		return ""
	case "Stop", "SessionStart":
		return claudeStateIdle
	case "SessionEnd":
		return claudeStateClear
	}
	return ""
}

func claudeStateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("claudestate", rtnErr == nil)
	}()
	data, err := io.ReadAll(io.LimitReader(os.Stdin, claudeHookMaxBytes))
	if err != nil {
		return fmt.Errorf("reading hook input: %v", err)
	}
	var in claudeHookInput
	if err := json.Unmarshal(data, &in); err != nil {
		return fmt.Errorf("parsing hook input: %v", err)
	}
	state := claudeStateForHook(in)
	if state == "" || in.SessionId == "" {
		return nil
	}
	oref, err := resolveBlockArg()
	if err != nil {
		return fmt.Errorf("resolving block: %v", err)
	}
	if oref.OType != waveobj.OType_Block {
		return fmt.Errorf("claudestate needs a block (got %q)", oref.OType)
	}
	cur, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{ORef: *oref}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("reading block meta: %v", err)
	}
	var meta waveobj.MetaMapType
	if state == claudeStateClear {
		if !cur.HasKey(waveobj.MetaKey_ClaudeSession) {
			return nil
		}
		// A nil value deletes the key.
		meta = waveobj.MetaMapType{waveobj.MetaKey_ClaudeSession: nil, waveobj.MetaKey_ClaudeState: nil, waveobj.MetaKey_ClaudeStateTs: nil}
	} else {
		// Tool hooks fire constantly; skip the write when nothing changed.
		if cur.GetString(waveobj.MetaKey_ClaudeSession, "") == in.SessionId && cur.GetString(waveobj.MetaKey_ClaudeState, "") == state {
			return nil
		}
		meta = waveobj.MetaMapType{
			waveobj.MetaKey_ClaudeSession: in.SessionId,
			waveobj.MetaKey_ClaudeState:   state,
			waveobj.MetaKey_ClaudeStateTs: time.Now().UnixMilli(),
		}
	}
	err = wshclient.SetMetaCommand(RpcClient, wshrpc.CommandSetMetaData{ORef: *oref, Meta: meta}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("setting block meta: %v", err)
	}
	return nil
}
