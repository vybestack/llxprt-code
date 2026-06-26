/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for SessionBrowserDialog component.
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P16
 * @requirement REQ-SB-001 through REQ-SB-026 (Listing & Display)
 * @requirement REQ-PV-001 through REQ-PV-010 (Preview Loading)
 * @requirement REQ-SR-001 through REQ-SR-014 (Search)
 * @requirement REQ-SO-001 through REQ-SO-007 (Sort)
 * @requirement REQ-PG-001 through REQ-PG-005 (Pagination)
 * @requirement REQ-KN-001 through REQ-KN-007 (Keyboard Navigation)
 * @requirement REQ-SD-001 through REQ-SD-003 (Selection/Detail)
 * @requirement REQ-RS-001 through REQ-RS-014 (Resume Flow)
 * @requirement REQ-DL-001 through REQ-DL-014 (Delete Flow)
 * @requirement REQ-RW-001 through REQ-RW-007 (Wide Mode)
 * @requirement REQ-RN-001 through REQ-RN-013 (Narrow Mode)
 */

import { render } from 'ink-testing-library';
import { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Unmock ink to use real Ink with ink-testing-library
// The global mock in test-setup.ts conflicts with ink-testing-library's reconciler
vi.unmock('ink');

import { SessionBrowserDialog } from '../SessionBrowserDialog.js';
import type { SessionBrowserDialogProps } from '../SessionBrowserDialog.js';
import { KeypressProvider } from '../../contexts/KeypressContext.js';
import type {
  EnrichedSessionSummary,
  PreviewState,
} from '../../hooks/useSessionBrowser.js';
import { testRegex } from '../../../test-utils/regex.js';

// Terminal key codes
enum TerminalKeys {
  ENTER = '\u000D',
  TAB = '\t',
  UP_ARROW = '\u001B[A',
  DOWN_ARROW = '\u001B[B',
  ESCAPE = '\u001B',
  DELETE = '\u001B[3~',
  PAGE_UP = '\u001B[5~',
  PAGE_DOWN = '\u001B[6~',
  BACKSPACE = '\u007F',
}

// Mock useResponsive hook to control narrow/wide mode
const mockIsNarrow = vi.hoisted(() => ({ value: false }));
vi.mock('../../hooks/useResponsive.js', () => ({
  useResponsive: () => ({
    width: mockIsNarrow.value ? 60 : 120,
    breakpoint: mockIsNarrow.value ? 'NARROW' : 'WIDE',
    isNarrow: mockIsNarrow.value,
    isStandard: !mockIsNarrow.value,
    isWide: !mockIsNarrow.value,
  }),
}));

// Mock useSessionBrowser hook to control state
const mockHookState = vi.hoisted(() => ({
  sessions: [] as EnrichedSessionSummary[],
  filteredSessions: [] as EnrichedSessionSummary[],
  searchTerm: '',
  sortOrder: 'newest' as 'newest' | 'oldest' | 'size',
  selectedIndex: 0,
  page: 0,
  isSearching: true,
  isLoading: false,
  isResuming: false,
  deleteConfirmIndex: null as number | null,
  conversationConfirmActive: false,
  error: null as string | null,
  skippedCount: 0,
  totalPages: 1,
  pageItems: [] as EnrichedSessionSummary[],
  selectedSession: null as EnrichedSessionSummary | null,
  handleKeypress: vi.fn(),
}));

vi.mock('../../hooks/useSessionBrowser.js', () => ({
  useSessionBrowser: () => mockHookState,
}));

// Helper to create mock sessions
function createMockSession(
  overrides: Partial<EnrichedSessionSummary> = {},
): EnrichedSessionSummary {
  const defaults: EnrichedSessionSummary = {
    sessionId: `session-${Math.random().toString(36).slice(2, 10)}`,
    filePath: '/test/chats/test-session.jsonl',
    projectHash: 'test-project-hash',
    startTime: '2025-02-14T10:00:00Z',
    lastModified: new Date('2025-02-14T12:00:00Z'),
    fileSize: 1024,
    provider: 'anthropic',
    model: 'claude-opus-4-5-20251101',
    previewState: 'loaded' as PreviewState,
    firstUserMessage: 'Write me a haiku about coding',
    isLocked: false,
  };
  return { ...defaults, ...overrides };
}

// Track active render instances for cleanup
let activeRender: ReturnType<typeof render> | null = null;

// Helper to render with providers
const renderWithProviders = (
  props: Partial<SessionBrowserDialogProps> = {},
) => {
  // Cleanup previous render if any
  if (activeRender) {
    activeRender.unmount();
    activeRender = null;
  }

  const defaultProps: SessionBrowserDialogProps = {
    chatsDir: '/test/chats',
    projectHash: 'test-project-hash',
    currentSessionId: 'current-session-id',
    hasActiveConversation: false,
    onSelect: vi
      .fn()
      .mockResolvedValue({ ok: true, history: [], metadata: {}, warnings: [] }),
    onClose: vi.fn(),
  };

  activeRender = render(
    <KeypressProvider>
      <SessionBrowserDialog {...defaultProps} {...props} />
    </KeypressProvider>,
  );
  return activeRender;
};

describe('SessionBrowserDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock state
    mockIsNarrow.value = false;
    mockHookState.sessions = [];
    mockHookState.filteredSessions = [];
    mockHookState.searchTerm = '';
    mockHookState.sortOrder = 'newest';
    mockHookState.selectedIndex = 0;
    mockHookState.page = 0;
    mockHookState.isSearching = true;
    mockHookState.isLoading = false;
    mockHookState.isResuming = false;
    mockHookState.deleteConfirmIndex = null;
    mockHookState.conversationConfirmActive = false;
    mockHookState.error = null;
    mockHookState.skippedCount = 0;
    mockHookState.totalPages = 1;
    mockHookState.pageItems = [];
    mockHookState.selectedSession = null;
    mockHookState.handleKeypress = vi.fn();
  });

  afterEach(() => {
    // Cleanup render instance
    if (activeRender) {
      activeRender.unmount();
      activeRender = null;
    }
    vi.restoreAllMocks();
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-SB-009
   */
  describe('Pagination', () => {
    it('should display page indicator for multi-page lists', () => {
      const sessions = Array.from({ length: 25 }, (_, i) =>
        createMockSession({ sessionId: `session-${i}` }),
      );
      mockHookState.sessions = sessions;
      mockHookState.filteredSessions = sessions;
      mockHookState.pageItems = sessions.slice(0, 20);
      mockHookState.selectedSession = sessions[0];
      mockHookState.totalPages = 2;
      mockHookState.page = 0;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toMatch(testRegex('page.*1.*of.*2|1\\/2', 'i'));
    });

    it('should hide page indicator for single-page lists', () => {
      const sessions = [createMockSession()];
      mockHookState.sessions = sessions;
      mockHookState.filteredSessions = sessions;
      mockHookState.pageItems = sessions;
      mockHookState.selectedSession = sessions[0];
      mockHookState.totalPages = 1;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Single page should not show page indicator
      expect(output).not.toMatch(testRegex('page.*1.*of.*1', 'i'));
    });

    it('should call handleKeypress when PageDown is pressed', async () => {
      mockHookState.totalPages = 2;
      mockHookState.page = 0;
      mockHookState.isLoading = false;

      const { stdin } = renderWithProviders();

      act(() => {
        stdin.write(TerminalKeys.PAGE_DOWN);
      });

      expect(mockHookState.handleKeypress).toHaveBeenCalled();
    });

    it('should call handleKeypress when PageUp is pressed', async () => {
      mockHookState.totalPages = 2;
      mockHookState.page = 1;
      mockHookState.isLoading = false;

      const { stdin } = renderWithProviders();

      act(() => {
        stdin.write(TerminalKeys.PAGE_UP);
      });

      expect(mockHookState.handleKeypress).toHaveBeenCalled();
    });

    it('should show PgUp/PgDn hint for multi-page lists', () => {
      mockHookState.totalPages = 2;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toMatch(testRegex('PgUp|PgDn|page', 'i'));
    });
  });
  describe('Selection Detail', () => {
    it('should display selected session full ID in detail line (wide mode)', () => {
      mockIsNarrow.value = false;
      const session = createMockSession({
        sessionId: 'session-full-id-display-test',
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('session-full');
    });

    it('should display provider/model in detail line', () => {
      mockIsNarrow.value = false;
      const session = createMockSession({
        provider: 'google',
        model: 'gemini-pro',
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('google');
      expect(output).toContain('gemini');
    });
  });
  describe('Resume Flow', () => {
    it('should display "Resuming..." status when isResuming is true', () => {
      const session = createMockSession();
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isResuming = true;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Resuming');
    });

    it('should show active conversation confirmation when conversationConfirmActive is true', () => {
      const session = createMockSession();
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.conversationConfirmActive = true;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toMatch(
        testRegex('replace|current.*conversation|continue\\?', 'i'),
      );
    });

    it('should show Y/N options in conversation confirmation', () => {
      mockHookState.conversationConfirmActive = true;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Y');
      expect(output).toContain('N');
    });
  });
  describe('Escape Key Precedence', () => {
    it('should call handleKeypress when Escape is pressed', async () => {
      mockHookState.isLoading = false;

      const { stdin } = renderWithProviders();

      act(() => {
        stdin.write(TerminalKeys.ESCAPE);
      });

      expect(mockHookState.handleKeypress).toHaveBeenCalled();
    });
  });
  describe('Border Styles', () => {
    it('should render with rounded border in wide mode', () => {
      mockIsNarrow.value = false;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Rounded border uses curved characters like ╭ ╮ ╯ ╰
      expect(output).toMatch(testRegex('[╭╮╯╰]', ''));
    });

    it('should render borderless in narrow mode', () => {
      mockIsNarrow.value = true;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Should NOT have box-drawing characters
      // Note: This is hard to assert negatively, so we check it doesn't have standard box borders
      expect(output).not.toMatch(testRegex('[╭╮╯╰]', ''));
    });
  });
  describe('Visual Indicators', () => {
    it('should show selected item bullet (●) for highlighted session', () => {
      const session = createMockSession();
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.selectedIndex = 0;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('●');
    });

    it('should show unselected item bullet (○) for non-highlighted sessions', () => {
      const session1 = createMockSession({ sessionId: 'session-1' });
      const session2 = createMockSession({ sessionId: 'session-2' });
      mockHookState.pageItems = [session1, session2];
      mockHookState.filteredSessions = [session1, session2];
      mockHookState.selectedSession = session1;
      mockHookState.selectedIndex = 0;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('○');
    });

    it('should show search cursor (▌) in search mode', () => {
      mockHookState.isSearching = true;
      mockHookState.searchTerm = 'test';
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('▌');
    });
  });
  describe('Search Input', () => {
    it('should call handleKeypress when typing characters in search mode', async () => {
      mockHookState.isSearching = true;
      mockHookState.isLoading = false;

      const { stdin } = renderWithProviders();

      act(() => {
        stdin.write('a');
      });

      expect(mockHookState.handleKeypress).toHaveBeenCalled();
    });

    it('should call handleKeypress when Backspace is pressed in search mode', async () => {
      mockHookState.isSearching = true;
      mockHookState.searchTerm = 'test';
      mockHookState.isLoading = false;

      const { stdin } = renderWithProviders();

      act(() => {
        stdin.write(TerminalKeys.BACKSPACE);
      });

      expect(mockHookState.handleKeypress).toHaveBeenCalled();
    });
  });
  describe('Empty List Controls', () => {
    it('should show reduced controls bar when list is empty', () => {
      mockHookState.sessions = [];
      mockHookState.filteredSessions = [];
      mockHookState.pageItems = [];
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Should show Esc Close but not Resume/Delete options
      expect(output).toContain('Esc');
    });
  });
});
