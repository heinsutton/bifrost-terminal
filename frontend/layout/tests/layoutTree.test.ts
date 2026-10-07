// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { balanceNode, newLayoutNode, validateNode, walkNodes } from "../lib/layoutNode";
import { computeMoveNode, dockNode, moveNode } from "../lib/layoutTree";
import {
    DropDirection,
    FlexDirection,
    LayoutNode,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDockNodeAction,
    LayoutTreeMoveNodeAction,
    NavigateDirection,
} from "../lib/types";
import { newLayoutTreeState } from "./model";

test("layoutTreeStateReducer - compute move", () => {
    const nodeA = newLayoutNode(undefined, undefined, undefined, { blockId: "nodeA" });
    const node1 = newLayoutNode(undefined, undefined, undefined, { blockId: "node1" });
    const node2 = newLayoutNode(undefined, undefined, undefined, { blockId: "node2" });
    const treeState = newLayoutTreeState(newLayoutNode(undefined, undefined, [nodeA, node1, node2]));
    assert(treeState.rootNode.children!.length === 3, "root should have three children");
    let pendingAction = computeMoveNode(treeState, {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: treeState.rootNode.id,
        nodeToMoveId: node1.id,
        direction: DropDirection.Bottom,
    });
    const insertOperation = pendingAction as LayoutTreeMoveNodeAction;
    assert(insertOperation.node === node1, "insert operation node should equal node1");
    assert(!insertOperation.parentId, "insert operation parent should not be defined");
    assert(insertOperation.index === 1, "insert operation index should equal 1");
    assert(insertOperation.insertAtRoot, "insert operation insertAtRoot should be true");
    moveNode(treeState, insertOperation);
    assert(
        treeState.rootNode.data === undefined && treeState.rootNode.children!.length === 3,
        "root node should still have three children"
    );
    assert(treeState.rootNode.children![1].data!.blockId === "node1", "root's second child should be node1");

    pendingAction = computeMoveNode(treeState, {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: node1.id,
        nodeToMoveId: node2.id,
        direction: DropDirection.Bottom,
    });
    const insertOperation2 = pendingAction as LayoutTreeMoveNodeAction;
    assert(insertOperation2.node === node2, "insert operation node should equal node2");
    assert(insertOperation2.parentId === node1.id, "insert operation parent id should be node1 id");
    assert(insertOperation2.index === 1, "insert operation index should equal 1");
    assert(!insertOperation2.insertAtRoot, "insert operation insertAtRoot should be false");
    moveNode(treeState, insertOperation2);
    assert(
        treeState.rootNode.data === undefined && (treeState.rootNode.children!.length as number) === 2,
        "root node should now have two children after node2 moved into node1"
    );
    assert(treeState.rootNode.children![1].children!.length === 2, "root's second child should now have two children");
});

test("computeMove - noop action", () => {
    const nodeToMove = newLayoutNode(undefined, undefined, undefined, { blockId: "nodeToMove" });
    const treeState = newLayoutTreeState(
        newLayoutNode(undefined, undefined, [
            nodeToMove,
            newLayoutNode(undefined, undefined, undefined, { blockId: "otherNode" }),
        ])
    );
    let moveAction: LayoutTreeComputeMoveNodeAction = {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: treeState.rootNode.id,
        nodeToMoveId: nodeToMove.id,
        direction: DropDirection.Left,
    };
    let pendingAction = computeMoveNode(treeState, moveAction);

    assert(pendingAction === undefined, "inserting a node to the left of itself should not produce a pendingAction");

    moveAction = {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: treeState.rootNode.id,
        nodeToMoveId: nodeToMove.id,
        direction: DropDirection.Right,
    };

    pendingAction = computeMoveNode(treeState, moveAction);
    assert(pendingAction === undefined, "inserting a node to the right of itself should not produce a pendingAction");
});

function leafIds(node: LayoutNode): string[] {
    if (!node.children) {
        return [node.data!.blockId];
    }
    return node.children.flatMap(leafIds);
}

function dock(root: LayoutNode, nodeId: string, direction: NavigateDirection) {
    const treeState = newLayoutTreeState(root);
    dockNode(treeState, { type: LayoutTreeActionType.DockNode, nodeId, direction } as LayoutTreeDockNodeAction);
    treeState.rootNode = balanceNode(treeState.rootNode);
    walkNodes(treeState.rootNode, (n) => {
        assert(validateNode(n), "node should validate");
        assert(n.children?.length !== 1, "no single-child containers should remain");
    });
    return treeState.rootNode;
}

function leaf(id: string): LayoutNode {
    return newLayoutNode(undefined, undefined, undefined, { blockId: id });
}

test("dockNode - row root, perpendicular direction wraps", () => {
    const a = leaf("A");
    const b = leaf("B");
    let root = dock(newLayoutNode(FlexDirection.Row, undefined, [a, b]), a.id, NavigateDirection.Down);
    assert(root.flexDirection === FlexDirection.Column, "root should be a column");
    assert.deepEqual(leafIds(root), ["B", "A"]);
    assert(root.children!.length === 2, "root should have two children");

    const c = leaf("A");
    const d = leaf("B");
    root = dock(newLayoutNode(FlexDirection.Row, undefined, [c, d]), c.id, NavigateDirection.Up);
    assert(root.flexDirection === FlexDirection.Column, "root should be a column");
    assert.deepEqual(leafIds(root), ["A", "B"]);
});

test("dockNode - row root, matching direction moves to the end", () => {
    const a = leaf("A");
    const b = leaf("B");
    const c = leaf("C");
    const root = dock(newLayoutNode(FlexDirection.Row, undefined, [a, b, c]), a.id, NavigateDirection.Right);
    assert(root.flexDirection === FlexDirection.Row, "root should stay a row");
    assert.deepEqual(leafIds(root), ["B", "C", "A"]);
    const left = dock(root, c.id, NavigateDirection.Left);
    assert.deepEqual(leafIds(left), ["C", "B", "A"]);
});

test("dockNode - column root, both axes", () => {
    const a = leaf("A");
    const b = leaf("B");
    let root = dock(newLayoutNode(FlexDirection.Column, undefined, [a, b]), a.id, NavigateDirection.Right);
    assert(root.flexDirection === FlexDirection.Row, "root should be a row");
    assert.deepEqual(leafIds(root), ["B", "A"]);

    const c = leaf("A");
    const d = leaf("B");
    root = dock(newLayoutNode(FlexDirection.Column, undefined, [c, d]), d.id, NavigateDirection.Left);
    assert(root.flexDirection === FlexDirection.Row, "root should be a row");
    assert.deepEqual(leafIds(root), ["B", "A"]);
});

test("dockNode - nested node docks full width", () => {
    const a = leaf("A");
    const b = leaf("B");
    const c = leaf("C");
    const inner = newLayoutNode(FlexDirection.Column, undefined, [b, c]);
    const root = dock(newLayoutNode(FlexDirection.Row, undefined, [a, inner]), c.id, NavigateDirection.Down);
    assert(root.flexDirection === FlexDirection.Column, "root should be a column");
    assert(root.children![1].data?.blockId === "C", "C should be the full-width bottom pane");
    assert.deepEqual(leafIds(root), ["A", "B", "C"]);
});

test("dockNode - middle pane docks up", () => {
    const a = leaf("A");
    const b = leaf("B");
    const c = leaf("C");
    const root = dock(newLayoutNode(FlexDirection.Row, undefined, [a, b, c]), b.id, NavigateDirection.Up);
    assert(root.flexDirection === FlexDirection.Column, "root should be a column");
    assert(root.children![0].data?.blockId === "B", "B should be on top");
    assert.deepEqual(leafIds(root), ["B", "A", "C"]);
});

test("dockNode - already docked is a no-op", () => {
    const a = leaf("A");
    const b = leaf("B");
    const root = newLayoutNode(FlexDirection.Row, undefined, [a, b]);
    const before = JSON.stringify(root);
    const treeState = newLayoutTreeState(root);
    dockNode(treeState, {
        type: LayoutTreeActionType.DockNode,
        nodeId: a.id,
        direction: NavigateDirection.Left,
    } as LayoutTreeDockNodeAction);
    dockNode(treeState, {
        type: LayoutTreeActionType.DockNode,
        nodeId: b.id,
        direction: NavigateDirection.Right,
    } as LayoutTreeDockNodeAction);
    assert(JSON.stringify(treeState.rootNode) === before, "tree should be unchanged");
});
