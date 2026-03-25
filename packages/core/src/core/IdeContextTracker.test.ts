/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdeContextTracker } from './IdeContextTracker.js';
import type { IdeContext } from '../ide/ideContext.js';

// Mock the ideContext module
vi.mock('../ide/ideContext.js', () => ({
  ideContext: {
    getIdeContext: vi.fn(),
  },
}));

import { ideContext } from '../ide/ideContext.js';

function makeConfig(debugMode = false): { getDebugMode: () => boolean } {
  return { getDebugMode: () => debugMode };
}

function makeIdeContext(
  opts: {
    activeFilePath?: string;
    cursorLine?: number;
    cursorCharacter?: number;
    selectedText?: string;
    otherFiles?: string[];
  } = {},
): IdeContext {
  const openFiles = [];
  if (opts.activeFilePath) {
    openFiles.push({
      path: opts.activeFilePath,
      timestamp: Date.now(),
      isActive: true,
      cursor:
        opts.cursorLine !== undefined
          ? { line: opts.cursorLine, character: opts.cursorCharacter ?? 0 }
          : undefined,
      selectedText: opts.selectedText,
    });
  }
  for (const path of opts.otherFiles ?? []) {
    openFiles.push({ path, timestamp: Date.now(), isActive: false });
  }
  return { workspaceState: { openFiles } };
}

describe('IdeContextTracker', () => {
  let tracker: IdeContextTracker;
  const mockGetIdeContext = ideContext.getIdeContext as ReturnType<
    typeof vi.fn
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    tracker = new IdeContextTracker(
      makeConfig() as Parameters<typeof IdeContextTracker>[0],
    );
  });

  describe('buildFullContext', () => {
    it('returns empty array when no IDE context available', () => {
      mockGetIdeContext.mockReturnValue(undefined);
      const result = tracker.buildFullContext();
      expect(result.contextParts).toEqual([]);
      expect(result.newIdeContext).toBeUndefined();
    });

    it('returns empty array when no open files', () => {
      mockGetIdeContext.mockReturnValue({ workspaceState: { openFiles: [] } });
      const result = tracker.buildFullContext();
      expect(result.contextParts).toEqual([]);
    });

    it('includes active file in context', () => {
      mockGetIdeContext.mockReturnValue(
        makeIdeContext({
          activeFilePath: 'src/app.ts',
          cursorLine: 10,
          cursorCharacter: 5,
        }),
      );
      const result = tracker.buildFullContext();
      expect(result.contextParts.length).toBeGreaterThan(0);
      const joined = result.contextParts.join('\n');
      expect(joined).toContain('src/app.ts');
    });

    it('includes cursor position in active file context', () => {
      mockGetIdeContext.mockReturnValue(
        makeIdeContext({
          activeFilePath: 'main.ts',
          cursorLine: 42,
          cursorCharacter: 7,
        }),
      );
      const { contextParts } = tracker.buildFullContext();
      const joined = contextParts.join('\n');
      expect(joined).toContain('"line": 42');
      expect(joined).toContain('"character": 7');
    });

    it('includes selected text when present', () => {
      mockGetIdeContext.mockReturnValue(
        makeIdeContext({
          activeFilePath: 'foo.ts',
          selectedText: 'const x = 1;',
        }),
      );
      const { contextParts } = tracker.buildFullContext();
      expect(contextParts.join('\n')).toContain('const x = 1;');
    });

    it('includes other open files', () => {
      mockGetIdeContext.mockReturnValue(
        makeIdeContext({
          activeFilePath: 'main.ts',
          otherFiles: ['utils.ts', 'types.ts'],
        }),
      );
      const { contextParts } = tracker.buildFullContext();
      const joined = contextParts.join('\n');
      expect(joined).toContain('utils.ts');
      expect(joined).toContain('types.ts');
    });

    it('produces well-formed JSON context string', () => {
      mockGetIdeContext.mockReturnValue(
        makeIdeContext({
          activeFilePath: 'index.ts',
          cursorLine: 1,
          cursorCharacter: 0,
        }),
      );
      const { contextParts } = tracker.buildFullContext();
      const jsonIndex = contextParts.indexOf('```json');
      expect(jsonIndex).toBeGreaterThanOrEqual(0);
      const jsonString = contextParts[jsonIndex + 1];
      expect(() => JSON.parse(jsonString)).not.toThrow();
    });
  });

  describe('buildIncrementalDelta', () => {
    it('returns empty array when no current IDE context', () => {
      mockGetIdeContext.mockReturnValue(undefined);
      const result = tracker.buildIncrementalDelta();
      expect(result.contextParts).toEqual([]);
    });

    it('returns empty array when no lastSentIdeContext', () => {
      mockGetIdeContext.mockReturnValue(
        makeIdeContext({ activeFilePath: 'a.ts' }),
      );
      // fresh tracker has no lastSentIdeContext — delta returns empty
      const result = tracker.buildIncrementalDelta();
      expect(result.contextParts).toEqual([]);
    });

    it('returns empty array when nothing changed', () => {
      const ctx = makeIdeContext({ activeFilePath: 'a.ts', cursorLine: 0 });
      mockGetIdeContext.mockReturnValue(ctx);
      tracker.recordSentContext(ctx);
      const result = tracker.buildIncrementalDelta();
      expect(result.contextParts).toEqual([]);
    });

    it('detects opened files', () => {
      const last = makeIdeContext({ activeFilePath: 'a.ts' });
      const current = makeIdeContext({
        activeFilePath: 'a.ts',
        otherFiles: ['b.ts'],
      });
      mockGetIdeContext.mockReturnValue(current);
      tracker.recordSentContext(last);
      const { contextParts } = tracker.buildIncrementalDelta();
      expect(contextParts.join('\n')).toContain('b.ts');
      expect(contextParts.join('\n')).toContain('filesOpened');
    });

    it('detects closed files', () => {
      const last = makeIdeContext({
        activeFilePath: 'a.ts',
        otherFiles: ['b.ts'],
      });
      const current = makeIdeContext({ activeFilePath: 'a.ts' });
      mockGetIdeContext.mockReturnValue(current);
      tracker.recordSentContext(last);
      const { contextParts } = tracker.buildIncrementalDelta();
      expect(contextParts.join('\n')).toContain('b.ts');
      expect(contextParts.join('\n')).toContain('filesClosed');
    });

    it('detects active file change', () => {
      const last = makeIdeContext({ activeFilePath: 'a.ts' });
      const current = makeIdeContext({ activeFilePath: 'b.ts' });
      mockGetIdeContext.mockReturnValue(current);
      tracker.recordSentContext(last);
      const { contextParts } = tracker.buildIncrementalDelta();
      expect(contextParts.join('\n')).toContain('activeFileChanged');
      expect(contextParts.join('\n')).toContain('b.ts');
    });

    it('detects cursor movement', () => {
      const last = makeIdeContext({
        activeFilePath: 'a.ts',
        cursorLine: 1,
        cursorCharacter: 0,
      });
      const current = makeIdeContext({
        activeFilePath: 'a.ts',
        cursorLine: 10,
        cursorCharacter: 5,
      });
      mockGetIdeContext.mockReturnValue(current);
      tracker.recordSentContext(last);
      const { contextParts } = tracker.buildIncrementalDelta();
      expect(contextParts.join('\n')).toContain('cursorMoved');
      expect(contextParts.join('\n')).toContain('"line": 10');
    });

    it('detects selection change', () => {
      const last = makeIdeContext({ activeFilePath: 'a.ts', selectedText: '' });
      const current = makeIdeContext({
        activeFilePath: 'a.ts',
        selectedText: 'hello world',
      });
      mockGetIdeContext.mockReturnValue(current);
      tracker.recordSentContext(last);
      const { contextParts } = tracker.buildIncrementalDelta();
      expect(contextParts.join('\n')).toContain('selectionChanged');
      expect(contextParts.join('\n')).toContain('hello world');
    });
  });

  describe('getContextParts', () => {
    it('returns full context on first call (forceFullContext=true)', () => {
      mockGetIdeContext.mockReturnValue(
        makeIdeContext({ activeFilePath: 'main.ts' }),
      );
      const result = tracker.getContextParts(true);
      expect(result.contextParts.length).toBeGreaterThan(0);
      expect(result.contextParts.join('\n')).toContain('editor context');
    });

    it('returns full context when forceFullIdeContext is set (first creation)', () => {
      mockGetIdeContext.mockReturnValue(
        makeIdeContext({ activeFilePath: 'main.ts' }),
      );
      // On a fresh tracker, forceFullIdeContext = true
      const result = tracker.getContextParts(false);
      expect(result.contextParts.join('\n')).toContain('editor context');
    });

    it('returns delta on subsequent calls after recordSentContext', () => {
      const ctx = makeIdeContext({ activeFilePath: 'main.ts', cursorLine: 0 });
      mockGetIdeContext.mockReturnValue(ctx);
      tracker.recordSentContext(ctx); // clears forceFullIdeContext flag
      // No changes => empty delta
      const result = tracker.getContextParts(false);
      expect(result.contextParts).toEqual([]);
    });

    it('returns full context after reset', () => {
      const ctx = makeIdeContext({ activeFilePath: 'main.ts' });
      mockGetIdeContext.mockReturnValue(ctx);
      tracker.recordSentContext(ctx);
      tracker.resetContext();
      const result = tracker.getContextParts(false);
      // resetContext forces full context
      expect(result.contextParts.join('\n')).toContain('editor context');
    });
  });

  describe('resetContext', () => {
    it('forces full context on next getContextParts call', () => {
      const ctx = makeIdeContext({ activeFilePath: 'a.ts', cursorLine: 1 });
      mockGetIdeContext.mockReturnValue(ctx);
      tracker.recordSentContext(ctx);

      // Without reset, no delta
      expect(tracker.getContextParts(false).contextParts).toEqual([]);

      // After reset, should get full context
      tracker.resetContext();
      expect(
        tracker.getContextParts(false).contextParts.length,
      ).toBeGreaterThan(0);
    });
  });

  describe('recordSentContext', () => {
    it('clears the forceFullIdeContext flag', () => {
      const ctx = makeIdeContext({ activeFilePath: 'a.ts', cursorLine: 0 });
      mockGetIdeContext.mockReturnValue(ctx);
      // Initially forceFullIdeContext=true, should return full
      expect(
        tracker.getContextParts(false).contextParts.length,
      ).toBeGreaterThan(0);
      // After recording, delta (no change) = empty
      tracker.recordSentContext(ctx);
      expect(tracker.getContextParts(false).contextParts).toEqual([]);
    });
  });
});
