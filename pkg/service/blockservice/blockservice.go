// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type BlockService struct{}

const DefaultTimeout = 2 * time.Second

var BlockServiceInstance = &BlockService{}

func (bs *BlockService) SendCommand_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "send command to block",
		ArgNames: []string{"blockid", "cmd"},
	}
}

func (bs *BlockService) GetControllerStatus(ctx context.Context, blockId string) (*blockcontroller.BlockControllerRuntimeStatus, error) {
	return blockcontroller.GetBlockControllerRuntimeStatus(blockId), nil
}

func (*BlockService) SaveTerminalState_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "save the terminal state to a blockfile",
		ArgNames: []string{"ctx", "blockId", "state", "stateType", "ptyOffset", "termSize"},
	}
}

func (bs *BlockService) SaveTerminalState(ctx context.Context, blockId string, state string, stateType string, ptyOffset int64, termSize waveobj.TermSize) error {
	_, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return err
	}
	if stateType != "full" && stateType != "preview" {
		return fmt.Errorf("invalid state type: %q", stateType)
	}
	// ignore MakeFile error (already exists is ok)
	filestore.WFS.MakeFile(ctx, blockId, "cache:term:"+stateType, nil, wshrpc.FileOpts{})
	err = filestore.WFS.WriteFile(ctx, blockId, "cache:term:"+stateType, []byte(state))
	if err != nil {
		return fmt.Errorf("cannot save terminal state: %w", err)
	}
	fileMeta := wshrpc.FileMeta{
		"ptyoffset": ptyOffset,
		"termsize":  termSize,
	}
	err = filestore.WFS.WriteMeta(ctx, blockId, "cache:term:"+stateType, fileMeta, true)
	if err != nil {
		return fmt.Errorf("cannot save terminal state meta: %w", err)
	}
	return nil
}

func (*BlockService) MoveBlockToTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "move a block to another tab of the same workspace (empty destTabId creates a new tab)",
		ArgNames:   []string{"ctx", "blockId", "destTabId"},
		ReturnDesc: "MoveBlockRtn",
	}
}

func (bs *BlockService) MoveBlockToTab(ctx context.Context, blockId string, destTabId string) (*wcore.MoveBlockRtn, waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	rtn, err := wcore.MoveBlockToTab(ctx, blockId, destTabId)
	if err != nil {
		return nil, nil, fmt.Errorf("error moving block to tab: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("BlockService:MoveBlockToTab:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return rtn, updates, nil
}

func (*BlockService) MoveBlockToTabAt_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "move a block to another tab of the same workspace, split next to targetBlockId on side (left/right/top/bottom)",
		ArgNames:   []string{"ctx", "blockId", "destTabId", "targetBlockId", "side"},
		ReturnDesc: "MoveBlockRtn",
	}
}

func (bs *BlockService) MoveBlockToTabAt(ctx context.Context, blockId string, destTabId string, targetBlockId string, side string) (*wcore.MoveBlockRtn, waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	rtn, err := wcore.MoveBlockToTabAt(ctx, blockId, destTabId, targetBlockId, side)
	if err != nil {
		return nil, nil, fmt.Errorf("error moving block to tab: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("BlockService:MoveBlockToTabAt:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return rtn, updates, nil
}

func (*BlockService) CleanupOrphanedBlocks_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "queue a layout action to cleanup orphaned blocks in the tab",
		ArgNames: []string{"ctx", "tabId"},
	}
}

func (bs *BlockService) CleanupOrphanedBlocks(ctx context.Context, tabId string) (waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	layoutAction := waveobj.LayoutActionData{
		ActionType: wcore.LayoutActionDataType_CleanupOrphaned,
		ActionId:   uuid.NewString(),
	}
	err := wcore.QueueLayoutActionForTab(ctx, tabId, layoutAction)
	if err != nil {
		return nil, fmt.Errorf("error queuing cleanup layout action: %w", err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}
