/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import {
  type DOMElement,
  type DOMNode,
  Range,
  comparePoints,
  getBoundingBox,
  hitTest,
  useApp,
  useStdout,
} from 'ink';
import { useMouse } from './useMouse.js';
import type { MouseEvent } from '../utils/mouse.js';
import { useScrollProvider } from '../contexts/ScrollProvider.js';
import { copyTextToClipboard } from '../utils/clipboard.js';

type SelectionPoint = {
  node: DOMNode;
  offset: number;
};

type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function isInsideBox(
  point: { x: number; y: number },
  box: BoundingBox,
): boolean {
  return (
    point.x >= box.x &&
    point.x < box.x + box.width &&
    point.y >= box.y &&
    point.y < box.y + box.height
  );
}

function getScrollOffsets(node: DOMElement): {
  scrollTop: number;
  scrollLeft: number;
} {
  const anyNode = node as unknown as {
    internal_scrollState?: { scrollTop?: number; scrollLeft?: number };
    style?: { scrollTop?: number; scrollLeft?: number };
  };
  return {
    scrollTop:
      anyNode.internal_scrollState?.scrollTop ?? anyNode.style?.scrollTop ?? 0,
    scrollLeft:
      anyNode.internal_scrollState?.scrollLeft ??
      anyNode.style?.scrollLeft ??
      0,
  };
}

function findInnermostScrollableAtPoint(
  root: DOMElement,
  point: { x: number; y: number },
): { node: DOMElement; box: BoundingBox } | null {
  const candidates: Array<{
    node: DOMElement;
    box: BoundingBox;
    area: number;
  }> = [];

  const visit = (node: DOMElement) => {
    const anyNode = node as unknown as {
      style?: { overflow?: string; overflowX?: string; overflowY?: string };
    };
    const overflow = anyNode.style?.overflow;
    const overflowX = anyNode.style?.overflowX ?? overflow;
    const overflowY = anyNode.style?.overflowY ?? overflow;
    const isScrollable = overflowX === 'scroll' || overflowY === 'scroll';

    if (isScrollable) {
      const box = getBoundingBox(node);
      if (isInsideBox(point, box)) {
        candidates.push({ node, box, area: box.width * box.height });
      }
    }

    for (const child of node.childNodes) {
      if (child.nodeName === 'ink-box' || child.nodeName === 'ink-root') {
        visit(child);
      }
    }
  };

  visit(root);

  candidates.sort((a, b) => a.area - b.area);
  return candidates[0] ?? null;
}

function findScrollableCandidateFromProvider(
  scrollProvider: ReturnType<typeof useScrollProvider>,
  point: { x: number; y: number },
): { node: DOMElement; box: BoundingBox } | null {
  const scrollableCandidates: Array<{
    node: DOMElement;
    box: BoundingBox;
    area: number;
  }> = [];

  for (const entry of scrollProvider.getScrollables()) {
    if (!entry.ref.current || !entry.hasFocus()) continue;
    const box = getBoundingBox(entry.ref.current);
    if (isInsideBox(point, box)) {
      scrollableCandidates.push({
        node: entry.ref.current,
        box,
        area: box.width * box.height,
      });
    }
  }

  if (scrollableCandidates.length === 0) return null;
  scrollableCandidates.sort((a, b) => a.area - b.area);
  return scrollableCandidates[0] ?? null;
}

function resolveTargetFromScrollable(
  scrollable: { node: DOMElement; box: BoundingBox },
  x: number,
  y: number,
): { node: DOMElement; point: { x: number; y: number } } | null {
  // Ignore clicks on the scrollbar column so scrollbar dragging still works.
  if (x === scrollable.box.x + scrollable.box.width - 1) {
    return null;
  }

  const innermostScrollable = findInnermostScrollableAtPoint(scrollable.node, {
    x,
    y,
  });

  if (innermostScrollable) {
    const { scrollTop, scrollLeft } = getScrollOffsets(
      innermostScrollable.node,
    );
    return {
      node: innermostScrollable.node,
      point: {
        x: x - innermostScrollable.box.x + scrollLeft,
        y: y - innermostScrollable.box.y + scrollTop,
      },
    };
  }

  return {
    node: scrollable.node,
    point: {
      x: x - scrollable.box.x,
      y: y - scrollable.box.y,
    },
  };
}

function useSelectionState(
  selection: ReturnType<typeof useApp>['selection'],
  enabled: boolean,
) {
  const selectionRangeRef = useRef<Range | null>(null);
  const anchorPointRef = useRef<SelectionPoint | null>(null);
  const isDraggingRef = useRef(false);

  const clearSelection = useCallback(() => {
    selection?.removeAllRanges();
    selectionRangeRef.current = null;
    anchorPointRef.current = null;
    isDraggingRef.current = false;
  }, [selection]);

  useEffect(() => {
    if (enabled === false) {
      clearSelection();
    }
  }, [enabled, clearSelection]);

  return {
    selectionRangeRef,
    anchorPointRef,
    isDraggingRef,
    clearSelection,
  };
}

function useHitTestTarget(
  rootRef: RefObject<DOMElement | null>,
  scrollProvider: ReturnType<typeof useScrollProvider>,
) {
  return useCallback(
    (
      event: MouseEvent,
    ): { node: DOMElement; point: { x: number; y: number } } | null => {
      const root = rootRef.current;
      if (!root) return null;

      const x = event.col - 1;
      const y = event.row - 1;
      const point = { x, y };

      const scrollable = findScrollableCandidateFromProvider(
        scrollProvider,
        point,
      );
      if (!scrollable) {
        return { node: root, point };
      }

      return resolveTargetFromScrollable(scrollable, x, y);
    },
    [rootRef, scrollProvider],
  );
}

function useSelectionPointResolver(
  enabled: boolean,
  selection: ReturnType<typeof useApp>['selection'],
  findHitTestTarget: ReturnType<typeof useHitTestTarget>,
) {
  return useCallback(
    (event: MouseEvent): SelectionPoint | null => {
      if (enabled === false) return null;
      if (!selection) return null;

      const target = findHitTestTarget(event);
      if (!target) return null;

      const hit = hitTest(target.node, target.point.x, target.point.y);
      if (!hit) return null;

      return { node: hit.node, offset: hit.offset };
    },
    [enabled, selection, findHitTestTarget],
  );
}

function useRangeUpdater(
  selection: ReturnType<typeof useApp>['selection'],
  selectionRangeRef: React.RefObject<Range | null>,
) {
  const notifySelectionChanged = useCallback(() => {
    (
      selection as unknown as { notifyChange?: () => void } | undefined
    )?.notifyChange?.();
  }, [selection]);

  const updateSelectionRange = useCallback(
    (anchor: SelectionPoint, focus: SelectionPoint) => {
      if (!selection) return;

      const ordering = comparePoints(
        anchor.node,
        anchor.offset,
        focus.node,
        focus.offset,
      );
      const start = ordering <= 0 ? anchor : focus;
      const end = ordering <= 0 ? focus : anchor;

      const range = selectionRangeRef.current ?? new Range();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);

      if (!selectionRangeRef.current) {
        selection.removeAllRanges();
        selection.addRange(range);
        selectionRangeRef.current = range;
      } else {
        notifySelectionChanged();
      }
    },
    [selection, selectionRangeRef, notifySelectionChanged],
  );

  return { updateSelectionRange };
}

function useClipboardCopy(
  onCopiedText: ((text: string) => void) | undefined,
  selection: ReturnType<typeof useApp>['selection'],
  stdout: ReturnType<typeof useStdout>['stdout'],
) {
  return useCallback(async () => {
    if (!selection || selection.rangeCount === 0) return;
    // Issue #885: Snapshot the text immediately before any async operations
    // to prevent race conditions where selection changes during copy
    const text = selection.toString();
    if (text.length === 0) return;

    // Call onCopiedText with the snapshotted text
    onCopiedText?.(text);

    // Issue #885: copyTextToClipboard now returns a result indicating success/failure
    // This allows callers to handle failures appropriately if needed
    await copyTextToClipboard(text, stdout);
  }, [onCopiedText, selection, stdout]);
}

function useMouseEventHandler(
  enabled: boolean,
  selection: ReturnType<typeof useApp>['selection'],
  resolveSelectionPoint: (event: MouseEvent) => SelectionPoint | null,
  updateSelectionRange: (anchor: SelectionPoint, focus: SelectionPoint) => void,
  copySelectionToClipboard: () => Promise<void>,
  anchorPointRef: React.RefObject<SelectionPoint | null>,
  isDraggingRef: React.RefObject<boolean>,
) {
  return useMemo(
    () => (event: MouseEvent) => {
      if (enabled === false) return;
      if (!selection) return;

      if (event.name === 'left-press') {
        const point = resolveSelectionPoint(event);
        if (!point) return;
        isDraggingRef.current = true;
        anchorPointRef.current = point;
        updateSelectionRange(point, point);
        return;
      }

      if (event.name === 'move') {
        if (isDraggingRef.current !== true) return;
        const anchor = anchorPointRef.current;
        if (!anchor) return;
        const point = resolveSelectionPoint(event);
        if (!point) return;
        updateSelectionRange(anchor, point);
        return;
      }

      if (event.name === 'left-release') {
        if (isDraggingRef.current !== true) return;
        const anchor = anchorPointRef.current;
        if (anchor) {
          const releasePoint = resolveSelectionPoint(event);
          if (releasePoint) {
            updateSelectionRange(anchor, releasePoint);
          }
        }
        isDraggingRef.current = false;
        void copySelectionToClipboard();
      }
    },
    [
      enabled,
      selection,
      resolveSelectionPoint,
      updateSelectionRange,
      copySelectionToClipboard,
      anchorPointRef,
      isDraggingRef,
    ],
  );
}

export function useMouseSelection({
  enabled,
  rootRef,
  onCopiedText,
}: {
  enabled: boolean;
  rootRef: RefObject<DOMElement | null>;
  onCopiedText?: (text: string) => void;
}) {
  const { stdout } = useStdout();
  const { selection } = useApp();
  const scrollProvider = useScrollProvider();

  const { selectionRangeRef, anchorPointRef, isDraggingRef, clearSelection } =
    useSelectionState(selection, enabled);

  const findHitTestTarget = useHitTestTarget(rootRef, scrollProvider);
  const resolveSelectionPoint = useSelectionPointResolver(
    enabled,
    selection,
    findHitTestTarget,
  );

  const { updateSelectionRange } = useRangeUpdater(
    selection,
    selectionRangeRef,
  );

  const copySelectionToClipboard = useClipboardCopy(
    onCopiedText,
    selection,
    stdout,
  );

  const mouseHandler = useMouseEventHandler(
    enabled,
    selection,
    resolveSelectionPoint,
    updateSelectionRange,
    copySelectionToClipboard,
    anchorPointRef,
    isDraggingRef,
  );

  useMouse(mouseHandler, { isActive: enabled });

  return { clearSelection, copySelectionToClipboard };
}
