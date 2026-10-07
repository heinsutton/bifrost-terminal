// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// sides of a target pane a moved pane can be dropped on (MoveBlockToTabAt)
const (
	PaneDropSide_Left   = "left"
	PaneDropSide_Right  = "right"
	PaneDropSide_Top    = "top"
	PaneDropSide_Bottom = "bottom"
)

func CreateSubBlock(ctx context.Context, blockId string, blockDef *waveobj.BlockDef) (*waveobj.Block, error) {
	if blockDef == nil {
		return nil, fmt.Errorf("blockDef is nil")
	}
	if blockDef.Meta == nil || blockDef.Meta.GetString(waveobj.MetaKey_View, "") == "" {
		return nil, fmt.Errorf("no view provided for new block")
	}
	blockData, err := createSubBlockObj(ctx, blockId, blockDef)
	if err != nil {
		return nil, fmt.Errorf("error creating sub block: %w", err)
	}
	blockView := blockDef.Meta.GetString(waveobj.MetaKey_View, "")
	blockController := blockDef.Meta.GetString(waveobj.MetaKey_Controller, "")
	go recordBlockCreationTelemetry(blockView, blockController, true)
	return blockData, nil
}

func createSubBlockObj(ctx context.Context, parentBlockId string, blockDef *waveobj.BlockDef) (*waveobj.Block, error) {
	return wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (*waveobj.Block, error) {
		parentBlock, _ := wstore.DBGet[*waveobj.Block](tx.Context(), parentBlockId)
		if parentBlock == nil {
			return nil, fmt.Errorf("parent block not found: %q", parentBlockId)
		}
		blockId := uuid.NewString()
		blockData := &waveobj.Block{
			OID:         blockId,
			ParentORef:  waveobj.MakeORef(waveobj.OType_Block, parentBlockId).String(),
			RuntimeOpts: nil,
			Meta:        blockDef.Meta,
		}
		wstore.DBInsert(tx.Context(), blockData)
		parentBlock.SubBlockIds = append(parentBlock.SubBlockIds, blockId)
		wstore.DBUpdate(tx.Context(), parentBlock)
		return blockData, nil
	})
}

func CreateBlock(ctx context.Context, tabId string, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts) (rtnBlock *waveobj.Block, rtnErr error) {
	return CreateBlockWithTelemetry(ctx, tabId, blockDef, rtOpts, true)
}

func CreateBlockWithTelemetry(ctx context.Context, tabId string, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts, recordTelemetry bool) (rtnBlock *waveobj.Block, rtnErr error) {
	var blockCreated bool
	var newBlockOID string
	defer func() {
		if rtnErr == nil {
			return
		}
		// if there was an error, and we created the block, clean it up since the function failed
		if blockCreated && newBlockOID != "" {
			deleteBlockObj(ctx, newBlockOID)
			filestore.WFS.DeleteZone(ctx, newBlockOID)
		}
	}()
	if blockDef == nil {
		return nil, fmt.Errorf("blockDef is nil")
	}
	if blockDef.Meta == nil || blockDef.Meta.GetString(waveobj.MetaKey_View, "") == "" {
		return nil, fmt.Errorf("no view provided for new block")
	}
	blockData, err := createBlockObj(ctx, tabId, blockDef, rtOpts)
	if err != nil {
		return nil, fmt.Errorf("error creating block: %w", err)
	}
	blockCreated = true
	newBlockOID = blockData.OID
	// upload the files if present
	if len(blockDef.Files) > 0 {
		for fileName, fileDef := range blockDef.Files {
			err := filestore.WFS.MakeFile(ctx, newBlockOID, fileName, fileDef.Meta, wshrpc.FileOpts{})
			if err != nil {
				return nil, fmt.Errorf("error making blockfile %q: %w", fileName, err)
			}
			err = filestore.WFS.WriteFile(ctx, newBlockOID, fileName, []byte(fileDef.Content))
			if err != nil {
				return nil, fmt.Errorf("error writing blockfile %q: %w", fileName, err)
			}
		}
	}
	if recordTelemetry {
		blockView := blockDef.Meta.GetString(waveobj.MetaKey_View, "")
		blockController := blockDef.Meta.GetString(waveobj.MetaKey_Controller, "")
		go recordBlockCreationTelemetry(blockView, blockController, false)
	}
	return blockData, nil
}

func recordBlockCreationTelemetry(blockView string, blockController string, subBlock bool) {
	defer func() {
		panichandler.PanicHandler("CreateBlock:telemetry", recover())
	}()
	if blockView == "" {
		return
	}
	tctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	telemetry.UpdateActivity(tctx, wshrpc.ActivityUpdate{
		Renderers: map[string]int{blockView: 1},
	})
	telemetry.RecordTEvent(tctx, &telemetrydata.TEvent{
		Event: "action:createblock",
		Props: telemetrydata.TEventProps{
			BlockView:       blockView,
			BlockController: blockController,
			BlockSubBlock:   subBlock,
		},
	})
}

func createBlockObj(ctx context.Context, tabId string, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts) (*waveobj.Block, error) {
	return wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (*waveobj.Block, error) {
		tab, _ := wstore.DBGet[*waveobj.Tab](tx.Context(), tabId)
		if tab == nil {
			return nil, fmt.Errorf("tab not found: %q", tabId)
		}
		blockId := uuid.NewString()
		blockData := &waveobj.Block{
			OID:         blockId,
			ParentORef:  waveobj.MakeORef(waveobj.OType_Tab, tabId).String(),
			RuntimeOpts: rtOpts,
			Meta:        blockDef.Meta,
		}
		wstore.DBInsert(tx.Context(), blockData)
		tab.BlockIds = append(tab.BlockIds, blockId)
		wstore.DBUpdate(tx.Context(), tab)
		return blockData, nil
	})
}

type MoveBlockRtn struct {
	SourceTabId    string `json:"sourcetabid"`
	DestTabId      string `json:"desttabid"`
	SourceTabEmpty bool   `json:"sourcetabempty"`
}

// Re-parents a block to another tab of the same workspace without touching its controller or data.
// destTabId == "" creates a new empty tab in the source tab's workspace.
func MoveBlockToTab(ctx context.Context, blockId string, destTabId string) (*MoveBlockRtn, error) {
	return MoveBlockToTabAt(ctx, blockId, destTabId, "", "")
}

// the layout action that places a moved block in its destination tab: a split next to
// targetBlockId on the given side, or (no target / unknown side) the default focused insert
func makeMovedBlockLayoutAction(blockId string, targetBlockId string, side string) waveobj.LayoutActionData {
	action := waveobj.LayoutActionData{BlockId: blockId, TargetBlockId: targetBlockId, Focused: true}
	switch {
	case targetBlockId != "" && side == PaneDropSide_Left:
		action.ActionType, action.Position = LayoutActionDataType_SplitHorizontal, "before"
	case targetBlockId != "" && side == PaneDropSide_Right:
		action.ActionType, action.Position = LayoutActionDataType_SplitHorizontal, "after"
	case targetBlockId != "" && side == PaneDropSide_Top:
		action.ActionType, action.Position = LayoutActionDataType_SplitVertical, "before"
	case targetBlockId != "" && side == PaneDropSide_Bottom:
		action.ActionType, action.Position = LayoutActionDataType_SplitVertical, "after"
	default:
		action = waveobj.LayoutActionData{ActionType: LayoutActionDataType_Insert, BlockId: blockId, Focused: true}
	}
	return action
}

// MoveBlockToTab that drops the block next to targetBlockId (a block of destTabId) on side
// (left/right/top/bottom). A target that is not in destTabId falls back to the default insert.
func MoveBlockToTabAt(ctx context.Context, blockId string, destTabId string, targetBlockId string, side string) (*MoveBlockRtn, error) {
	rtn, err := wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (*MoveBlockRtn, error) {
		txCtx := tx.Context()
		block, err := wstore.DBGet[*waveobj.Block](txCtx, blockId)
		if err != nil {
			return nil, fmt.Errorf("error getting block: %w", err)
		}
		if block == nil {
			return nil, fmt.Errorf("block not found: %q", blockId)
		}
		parentORef := waveobj.ParseORefNoErr(block.ParentORef)
		if parentORef == nil || parentORef.OType != waveobj.OType_Tab {
			return nil, fmt.Errorf("block %q is not a direct child of a tab", blockId)
		}
		sourceTabId := parentORef.OID
		sourceTab, err := wstore.DBGet[*waveobj.Tab](txCtx, sourceTabId)
		if err != nil || sourceTab == nil {
			return nil, fmt.Errorf("source tab not found: %q", sourceTabId)
		}
		if destTabId == sourceTabId {
			return nil, fmt.Errorf("block is already in tab %q", destTabId)
		}
		sourceWorkspaceId, err := wstore.DBFindWorkspaceForTabId(txCtx, sourceTabId)
		if err != nil {
			return nil, fmt.Errorf("error finding workspace for tab %s: %w", sourceTabId, err)
		}
		var destTab *waveobj.Tab
		if destTabId == "" {
			destTab, err = createEmptyTab(txCtx, sourceWorkspaceId)
			if err != nil {
				return nil, fmt.Errorf("error creating destination tab: %w", err)
			}
			destTabId = destTab.OID
			err = assignNewTabToSourceWindowTx(txCtx, sourceWorkspaceId, sourceTabId, destTabId)
			if err != nil {
				return nil, err
			}
		} else {
			destWorkspaceId, err := wstore.DBFindWorkspaceForTabId(txCtx, destTabId)
			if err != nil {
				return nil, fmt.Errorf("error finding workspace for tab %s: %w", destTabId, err)
			}
			if destWorkspaceId != sourceWorkspaceId {
				return nil, fmt.Errorf("cannot move a block to a tab in a different workspace")
			}
			destTab, err = wstore.DBGet[*waveobj.Tab](txCtx, destTabId)
			if err != nil || destTab == nil {
				return nil, fmt.Errorf("destination tab not found: %q", destTabId)
			}
		}
		if utilfn.FindStringInSlice(destTab.BlockIds, targetBlockId) == -1 {
			targetBlockId = ""
		}
		block.ParentORef = waveobj.MakeORef(waveobj.OType_Tab, destTabId).String()
		sourceTab.BlockIds = utilfn.RemoveElemFromSlice(sourceTab.BlockIds, blockId)
		destTab.BlockIds = append(destTab.BlockIds, blockId)
		for _, obj := range []waveobj.WaveObj{block, sourceTab, destTab} {
			if err := wstore.DBUpdate(txCtx, obj); err != nil {
				return nil, fmt.Errorf("error updating %s: %w", obj.GetOType(), err)
			}
		}
		return &MoveBlockRtn{
			SourceTabId:    sourceTabId,
			DestTabId:      destTabId,
			SourceTabEmpty: len(sourceTab.BlockIds) == 0,
		}, nil
	})
	if err != nil {
		return nil, err
	}
	err = QueueLayoutActionForTab(ctx, rtn.DestTabId, makeMovedBlockLayoutAction(blockId, targetBlockId, side))
	if err != nil {
		return nil, fmt.Errorf("error queuing insert layout action: %w", err)
	}
	if !rtn.SourceTabEmpty {
		err = QueueLayoutActionForTab(ctx, rtn.SourceTabId, waveobj.LayoutActionData{
			ActionType: LayoutActionDataType_RemoveNode,
			BlockId:    blockId,
		})
		if err != nil {
			return nil, fmt.Errorf("error queuing removenode layout action: %w", err)
		}
	}
	return rtn, nil
}

// keeps a tab created for a block move in the same (popped-out) window as the source tab
func assignNewTabToSourceWindowTx(ctx context.Context, workspaceId string, sourceTabId string, newTabId string) error {
	ws, err := wstore.DBMustGet[*waveobj.Workspace](ctx, workspaceId)
	if err != nil {
		return fmt.Errorf("error getting workspace: %w", err)
	}
	popOutWindowId := ws.PopOutTabs[sourceTabId]
	if popOutWindowId == "" {
		return nil
	}
	ws.PopOutTabs[newTabId] = popOutWindowId
	err = wstore.DBUpdate(ctx, ws)
	if err != nil {
		return fmt.Errorf("error updating workspace: %w", err)
	}
	return nil
}

// Must delete all blocks individually first.
// Also deletes LayoutState.
// recursive: if true, will recursively close parent tab, window, workspace, if they are empty.
// Returns new active tab id, error.
func DeleteBlock(ctx context.Context, blockId string, recursive bool) error {
	block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	if block == nil {
		return nil
	}
	if len(block.SubBlockIds) > 0 {
		for _, subBlockId := range block.SubBlockIds {
			err := DeleteBlock(ctx, subBlockId, recursive)
			if err != nil {
				return fmt.Errorf("error deleting subblock %s: %w", subBlockId, err)
			}
		}
	}
	parentBlockCount, err := deleteBlockObj(ctx, blockId)
	if err != nil {
		return fmt.Errorf("error deleting block: %w", err)
	}
	log.Printf("DeleteBlock: parentBlockCount: %d", parentBlockCount)
	parentORef := waveobj.ParseORefNoErr(block.ParentORef)

	if recursive && parentORef.OType == waveobj.OType_Tab && parentBlockCount == 0 {
		// if parent tab has no blocks, delete the tab
		log.Printf("DeleteBlock: parent tab has no blocks, deleting tab %s", parentORef.OID)
		parentWorkspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, parentORef.OID)
		if err != nil {
			return fmt.Errorf("error finding workspace for tab to delete %s: %w", parentORef.OID, err)
		}
		newActiveTabId, err := DeleteTab(ctx, parentWorkspaceId, parentORef.OID, true)
		if err != nil {
			return fmt.Errorf("error deleting tab %s: %w", parentORef.OID, err)
		}
		SendActiveTabUpdate(ctx, parentWorkspaceId, newActiveTabId)
	}
	sendBlockCloseEvent(blockId)
	return nil
}

// returns the updated block count for the parent object
func deleteBlockObj(ctx context.Context, blockId string) (int, error) {
	return wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (int, error) {
		block, err := wstore.DBGet[*waveobj.Block](tx.Context(), blockId)
		if err != nil {
			return -1, fmt.Errorf("error getting block: %w", err)
		}
		if block == nil {
			return -1, fmt.Errorf("block not found: %q", blockId)
		}
		if len(block.SubBlockIds) > 0 {
			return -1, fmt.Errorf("block has subblocks, must delete subblocks first")
		}
		parentORef := waveobj.ParseORefNoErr(block.ParentORef)
		parentBlockCount := -1
		if parentORef != nil {
			if parentORef.OType == waveobj.OType_Tab {
				tab, _ := wstore.DBGet[*waveobj.Tab](tx.Context(), parentORef.OID)
				if tab != nil {
					tab.BlockIds = utilfn.RemoveElemFromSlice(tab.BlockIds, blockId)
					wstore.DBUpdate(tx.Context(), tab)
					parentBlockCount = len(tab.BlockIds)
				}
			} else if parentORef.OType == waveobj.OType_Block {
				parentBlock, _ := wstore.DBGet[*waveobj.Block](tx.Context(), parentORef.OID)
				if parentBlock != nil {
					parentBlock.SubBlockIds = utilfn.RemoveElemFromSlice(parentBlock.SubBlockIds, blockId)
					wstore.DBUpdate(tx.Context(), parentBlock)
					parentBlockCount = len(parentBlock.SubBlockIds)
				}
			}
		}
		wstore.DBDelete(tx.Context(), waveobj.OType_Block, blockId)

		// Clean up block runtime info
		blockORef := waveobj.MakeORef(waveobj.OType_Block, blockId)
		wstore.DeleteRTInfo(blockORef)

		return parentBlockCount, nil
	})
}

func sendBlockCloseEvent(blockId string) {
	waveEvent := wps.WaveEvent{
		Event: wps.Event_BlockClose,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Block, blockId).String(),
		},
		Data: blockId,
	}
	wps.Broker.Publish(waveEvent)
}
