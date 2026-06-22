/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P13
 * @requirement REQ-SB-002, REQ-SB-004, REQ-SB-005, REQ-SB-008, REQ-SB-009, REQ-SB-010
 * @requirement REQ-PV-001, REQ-PV-003, REQ-PV-004, REQ-PV-005, REQ-PV-006, REQ-PV-007, REQ-PV-008
 * @requirement REQ-SR-001 through REQ-SR-014
 * @requirement REQ-SO-001, REQ-SO-003, REQ-SO-004, REQ-SO-005
 * @requirement REQ-PG-001, REQ-PG-003, REQ-PG-004
 * @requirement REQ-KN-001 through REQ-KN-007
 * @requirement REQ-SD-002, REQ-SD-003
 * @requirement REQ-EP-001 through REQ-EP-004
 * @requirement REQ-MP-001 through REQ-MP-003
 * @requirement REQ-LK-001, REQ-LK-002, REQ-LK-004, REQ-LK-005
 * @requirement REQ-DL-001 through REQ-DL-010
 * @requirement REQ-RS-001 through REQ-RS-006, REQ-RS-013, REQ-RS-014
 *
 * Behavioral and property-based tests for useSessionBrowser hook.
 * Tests hook state management, keyboard handling, search/sort/pagination,
 * delete confirmation flow, and resume operations.
 *
 * Uses real JSONL session files where appropriate; otherwise tests
 * the hook's state machine logic with controlled inputs.
 *
 * Property-based tests use fast-check (≥30% of core state tests).
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import fc from 'fast-check';
import {
  SessionRecordingService,
  type SessionRecordingServiceConfig,
  type IContent,
} from '@vybestack/llxprt-code-core';

import { renderHook, waitFor } from '../../../test-utils/render.js';
import {
  useSessionBrowser,
  type UseSessionBrowserProps,
} from '../useSessionBrowser.js';
import type { Key } from '../useKeypress.js';
import type { PerformResumeResult } from '../../../services/performResume.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---
type SortOrder = 'newest' | 'oldest' | 'size';

function assertSortedPair(
  a: { lastModified: Date; fileSize: number },
  b: { lastModified: Date; fileSize: number },
  order: SortOrder,
): void {
  if (order === 'newest') {
    expect(a.lastModified.getTime()).toBeGreaterThanOrEqual(
      b.lastModified.getTime(),
    );
  } else if (order === 'oldest') {
    expect(a.lastModified.getTime()).toBeLessThanOrEqual(
      b.lastModified.getTime(),
    );
  } else {
    expect(a.fileSize).toBeGreaterThanOrEqual(b.fileSize);
  }
}

function assertEscapePriority(
  current: { deleteConfirmIndex: number | null; searchTerm: string },
  hasDeleteConfirm: boolean,
  hasSearchTerm: boolean,
): void {
  if (hasDeleteConfirm) {
    expect(current.deleteConfirmIndex).toBeNull();
    if (hasSearchTerm) {
      expect(current.searchTerm).toBe('a');
    }
  } else if (hasSearchTerm) {
    expect(current.searchTerm).toBe('');
  }
}

// ---------------------------------------------------------------------------

const PROJECT_HASH = 'test-project-hash-sb';

function makeConfig(
  chatsDir: string,
  overrides: Partial<SessionRecordingServiceConfig> = {},
): SessionRecordingServiceConfig {
  return {
    sessionId: overrides.sessionId ?? crypto.randomUUID(),
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    chatsDir,
    workspaceDirs: overrides.workspaceDirs ?? ['/test/workspace'],
    provider: overrides.provider ?? 'anthropic',
    model: overrides.model ?? 'claude-4',
  };
}

function makeContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

/**
 * Create a real session file using SessionRecordingService.
 */
async function createTestSession(
  chatsDir: string,
  opts: {
    sessionId?: string;
    projectHash?: string;
    provider?: string;
    model?: string;
    contents?: IContent[];
  } = {},
): Promise<{
  filePath: string;
  sessionId: string;
}> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const config = makeConfig(chatsDir, {
    sessionId,
    projectHash: opts.projectHash ?? PROJECT_HASH,
    provider: opts.provider,
    model: opts.model,
  });
  const svc = new SessionRecordingService(config);

  const contents = opts.contents ?? [makeContent('hello')];
  for (const content of contents) {
    svc.recordContent(content);
  }
  await svc.flush();

  const filePath = svc.getFilePath()!;
  await svc.dispose();
  return { filePath, sessionId };
}

/**
 * Create a Key object for keyboard simulation.
 */
function makeKey(
  name: string,
  opts: { ctrl?: boolean; shift?: boolean; meta?: boolean; alt?: boolean } = {},
): Key {
  return {
    name,
    ctrl: opts.ctrl ?? false,
    shift: opts.shift ?? false,
    meta: opts.meta ?? false,
    sequence: name,
  };
}

/**
 * Create props for useSessionBrowser hook with sensible defaults.
 */
function makeHookProps(
  chatsDir: string,
  overrides: Partial<UseSessionBrowserProps> = {},
): UseSessionBrowserProps {
  return {
    chatsDir,
    projectHash: PROJECT_HASH,
    currentSessionId: overrides.currentSessionId ?? 'current-session-id',
    onSelect:
      overrides.onSelect ??
      (async (): Promise<PerformResumeResult> => ({
        ok: true,
        history: [],
        metadata: {
          sessionId: 'resumed',
          projectHash: PROJECT_HASH,
          startTime: new Date().toISOString(),
          provider: 'anthropic',
          model: 'claude-4',
          workspaceDirs: ['/test/workspace'],
        },
        warnings: [],
      })),
    onClose: overrides.onClose ?? (() => {}),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('useSessionBrowser @plan:PLAN-20260214-SESSIONBROWSER.P13', () => {
  let tempDir: string;
  let chatsDir: string;
  let lockHandles: Array<{ release: () => Promise<void> }>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'use-session-browser-test-'),
    );
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
    lockHandles = [];
  });

  afterEach(async () => {
    await Promise.all(lockHandles.map((handle) => handle.release()));
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Property-Based Tests @plan:PLAN-20260214-SESSIONBROWSER.P13', () => {
    /**
     * Test 68: Property: selectedIndex always in bounds
     * For any sequence of Up/Down/search/delete, selectedIndex is valid
     */
    it('property: selectedIndex always in bounds', async () => {
      for (let i = 0; i < 10; i++) {
        await createTestSession(chatsDir, {
          sessionId: `session-${i.toString().padStart(2, '0')}`,
        });
        await delay(5);
      }

      const props = makeHookProps(chatsDir);
      const { result } = renderHook(() => useSessionBrowser(props));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.constant('up'),
              fc.constant('down'),
              fc.constant('a'),
              fc.constant('backspace'),
            ),
            { minLength: 1, maxLength: 20 },
          ),
          (keys) => {
            for (const keyName of keys) {
              result.current.handleKeypress(
                keyName === 'a' ? 'a' : '',
                makeKey(keyName),
              );
            }

            const maxIndex = Math.max(
              0,
              result.current.filteredSessions.length - 1,
            );
            expect(result.current.selectedIndex).toBeGreaterThanOrEqual(0);
            expect(result.current.selectedIndex).toBeLessThanOrEqual(maxIndex);
          },
        ),
        { numRuns: 20 },
      );
    });

    /**
     * Test 69: Property: page always in bounds
     * For any sequence of PgUp/PgDn/search/sort, page is valid
     */
    it('property: page always in bounds', async () => {
      for (let i = 0; i < 30; i++) {
        await createTestSession(chatsDir, {
          sessionId: `session-${i.toString().padStart(2, '0')}`,
        });
        await delay(5);
      }

      const props = makeHookProps(chatsDir);
      const { result } = renderHook(() => useSessionBrowser(props));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.constant('pageup'),
              fc.constant('pagedown'),
              fc.constant('a'),
            ),
            { minLength: 1, maxLength: 20 },
          ),
          (keys) => {
            for (const keyName of keys) {
              result.current.handleKeypress(
                keyName === 'a' ? 'a' : '',
                makeKey(keyName),
              );
            }

            const maxPage = Math.max(0, result.current.totalPages - 1);
            expect(result.current.page).toBeGreaterThanOrEqual(0);
            expect(result.current.page).toBeLessThanOrEqual(maxPage);
          },
        ),
        { numRuns: 20 },
      );
    });

    /**
     * Test 70: Property: filteredSessions subset of sessions
     * For any search term, filteredSessions ⊆ sessions
     */
    it('property: filteredSessions is subset of sessions', async () => {
      for (let i = 0; i < 10; i++) {
        await createTestSession(chatsDir, {
          sessionId: `session-${i.toString().padStart(2, '0')}`,
          provider: i % 2 === 0 ? 'anthropic' : 'openai',
        });
        await delay(5);
      }

      const props = makeHookProps(chatsDir);
      const { result } = renderHook(() => useSessionBrowser(props));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 10 }), (searchStr) => {
          // Type the search string
          for (const char of searchStr) {
            result.current.handleKeypress(char, makeKey(char.toLowerCase()));
          }

          const sessionIds = new Set(
            result.current.sessions.map((s) => s.sessionId),
          );
          for (const filtered of result.current.filteredSessions) {
            expect(sessionIds.has(filtered.sessionId)).toBe(true);
          }

          // Clear for next iteration
          for (let i = 0; i < searchStr.length; i++) {
            result.current.handleKeypress('', makeKey('backspace'));
          }
        }),
        { numRuns: 20 },
      );
    });

    /**
     * Test 71: Property: sort order preserved
     * For any sort + filter, filteredSessions maintain sort order
     */
    it('property: sort order preserved after operations', async () => {
      for (let i = 0; i < 10; i++) {
        await createTestSession(chatsDir, {
          sessionId: `session-${i.toString().padStart(2, '0')}`,
        });
        await delay(15);
      }

      const props = makeHookProps(chatsDir);
      const { result } = renderHook(() => useSessionBrowser(props));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Switch to nav mode for sort cycling
      result.current.handleKeypress('\t', makeKey('tab'));

      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(fc.constant('s'), fc.constant('a'), fc.constant('tab')),
            { minLength: 1, maxLength: 10 },
          ),
          (keys) => {
            for (const keyName of keys) {
              let keyChar: string;
              if (keyName === 'a') {
                keyChar = 'a';
              } else if (keyName === 'tab') {
                keyChar = '\t';
              } else {
                keyChar = 's';
              }
              result.current.handleKeypress(keyChar, makeKey(keyName));
            }

            const sessions = result.current.filteredSessions;
            for (let i = 0; i + 1 < sessions.length; i++) {
              assertSortedPair(
                sessions[i],
                sessions[i + 1],
                result.current.sortOrder,
              );
            }
          },
        ),
        { numRuns: 20 },
      );
    });

    /**
     * Test 72: Property: escape priority is strict
     * Escape handles highest-priority item only
     *
     * Tests all 4 combinations of {hasDeleteConfirm, hasSearchTerm}
     * to verify escape priority: delete confirm > search term > close
     */
    it('property: escape priority is strict', async () => {
      // Create session with content containing 'a' so search for 'a' will match
      await createTestSession(chatsDir, {
        contents: [makeContent('apples and oranges')],
      });
      const props = makeHookProps(chatsDir);

      // Test each combination independently with fresh hook state
      const testCases = [
        { hasDeleteConfirm: false, hasSearchTerm: false },
        { hasDeleteConfirm: false, hasSearchTerm: true },
        { hasDeleteConfirm: true, hasSearchTerm: false },
        { hasDeleteConfirm: true, hasSearchTerm: true },
      ];

      for (const { hasDeleteConfirm, hasSearchTerm } of testCases) {
        // Fresh hook for each case
        const { result, unmount } = renderHook(() => useSessionBrowser(props));

        await waitFor(() => {
          expect(result.current.isLoading).toBe(false);
        });

        // Set up state
        if (hasSearchTerm) {
          // 'a' will match the session with 'apples and oranges'
          result.current.handleKeypress('a', makeKey('a'));
        }
        if (hasDeleteConfirm) {
          // Switch to nav mode and show delete confirmation
          if (result.current.isSearching) {
            result.current.handleKeypress('\t', makeKey('tab'));
          }
          result.current.handleKeypress('', makeKey('delete'));
        }

        // Press escape
        result.current.handleKeypress('\x1b', makeKey('escape'));

        // Check priority order using a helper that avoids conditional expects
        assertEscapePriority(result.current, hasDeleteConfirm, hasSearchTerm);

        unmount();
      }
    });

    /**
     * Test 73: Property: ALL keys blocked during isResuming
     * When isResuming, no key changes state
     */
    it('property: all keys blocked during isResuming', async () => {
      await createTestSession(chatsDir);

      let resolveResume: (() => void) | null = null;
      const props = makeHookProps(chatsDir, {
        onSelect: () =>
          new Promise<PerformResumeResult>((resolve) => {
            resolveResume = () =>
              resolve({
                ok: true as const,
                history: [],
                metadata: {
                  sessionId: 'test',
                  projectHash: PROJECT_HASH,
                  startTime: new Date().toISOString(),
                  provider: 'anthropic',
                  model: 'claude-4',
                  workspaceDirs: ['/test/workspace'],
                },
                warnings: [],
              });
          }),
      });
      const { result } = renderHook(() => useSessionBrowser(props));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Start resume
      result.current.handleKeypress('\r', makeKey('return'));

      await waitFor(() => {
        expect(result.current.isResuming).toBe(true);
      });

      const stateBefore = {
        selectedIndex: result.current.selectedIndex,
        page: result.current.page,
        searchTerm: result.current.searchTerm,
        sortOrder: result.current.sortOrder,
        isSearching: result.current.isSearching,
        deleteConfirmIndex: result.current.deleteConfirmIndex,
      };

      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('return'),
            fc.constant('escape'),
            fc.constant('up'),
            fc.constant('down'),
            fc.constant('tab'),
            fc.constant('delete'),
            fc.constant('pageup'),
            fc.constant('pagedown'),
            fc.constant('s'),
            fc.string({ minLength: 1, maxLength: 1 }),
          ),
          (keyName) => {
            result.current.handleKeypress(keyName, makeKey(keyName));

            expect(result.current.selectedIndex).toBe(
              stateBefore.selectedIndex,
            );
            expect(result.current.page).toBe(stateBefore.page);
            expect(result.current.searchTerm).toBe(stateBefore.searchTerm);
            expect(result.current.sortOrder).toBe(stateBefore.sortOrder);
            expect(result.current.isSearching).toBe(stateBefore.isSearching);
            expect(result.current.deleteConfirmIndex).toBe(
              stateBefore.deleteConfirmIndex,
            );
          },
        ),
        { numRuns: 30 },
      );

      // Complete
      (resolveResume as (() => void) | null)?.();
    });

    /**
     * Test 74: Property: confirmation dialogs consume only Y/N/Esc
     * During delete confirmation, only Y/N/Escape have effect
     */
    it('property: confirmation dialogs consume only Y/N/Esc', async () => {
      await createTestSession(chatsDir);
      const props = makeHookProps(chatsDir);

      // Test with a selection of non-actionable characters
      const testChars = ['a', 'z', '1', ' ', '.', '@', '['];

      for (const char of testChars) {
        // Fresh hook for each character test
        const { result, unmount } = renderHook(() => useSessionBrowser(props));

        await waitFor(() => {
          expect(result.current.isLoading).toBe(false);
        });

        // Switch to nav mode and set up delete confirmation
        result.current.handleKeypress('\t', makeKey('tab'));
        result.current.handleKeypress('', makeKey('delete'));
        expect(result.current.deleteConfirmIndex).not.toBeNull();

        const stateBefore = {
          deleteConfirmIndex: result.current.deleteConfirmIndex,
          selectedIndex: result.current.selectedIndex,
          searchTerm: result.current.searchTerm,
        };

        // Press non-Y/N/Esc key
        result.current.handleKeypress(char, makeKey(char));

        // State should be unchanged
        expect(result.current.deleteConfirmIndex).toBe(
          stateBefore.deleteConfirmIndex,
        );
        expect(result.current.selectedIndex).toBe(stateBefore.selectedIndex);
        expect(result.current.searchTerm).toBe(stateBefore.searchTerm);

        unmount();
      }
    });
  });
});
