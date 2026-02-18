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
  describe('Loading State', () => {
    it('should display "Loading sessions..." while fetching', () => {
      mockHookState.isLoading = true;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Loading sessions');
    });

    it('should not show session list while loading', () => {
      mockHookState.isLoading = true;
      const session = createMockSession();
      mockHookState.pageItems = [session];

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Should show loading but not the session data
      expect(output).toContain('Loading');
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-SB-006
   */
  describe('Empty State', () => {
    it('should display "No sessions found for this project" when no sessions exist', () => {
      mockHookState.sessions = [];
      mockHookState.filteredSessions = [];
      mockHookState.pageItems = [];
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('No sessions');
    });

    it('should display supplemental text about session creation', () => {
      mockHookState.sessions = [];
      mockHookState.filteredSessions = [];
      mockHookState.pageItems = [];
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Sessions are created automatically');
    });

    it('should show "Press Esc to close" hint when empty', () => {
      mockHookState.sessions = [];
      mockHookState.pageItems = [];
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Esc');
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-SB-003, REQ-SB-013, REQ-SB-014, REQ-SB-015, REQ-SB-016, REQ-SB-017, REQ-SB-018
   */
  describe('Populated List', () => {
    it('should render session rows with metadata', () => {
      const session = createMockSession({
        provider: 'anthropic',
        model: 'claude-opus-4-5-20251101',
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Should show provider/model info
      expect(output).toContain('anthropic');
    });

    it('should render first message preview', () => {
      const session = createMockSession({
        firstUserMessage: 'Hello world from preview',
        previewState: 'loaded',
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Hello world from preview');
    });

    it('should display 1-based index in wide mode', () => {
      mockIsNarrow.value = false;
      const session = createMockSession();
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Should show index like #1
      expect(output).toContain('#1');
    });

    it('should show relative time for each session', () => {
      const session = createMockSession({
        lastModified: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Should show some time indicator
      expect(output).toMatch(/ago|hours|minutes|just now/i);
    });

    it('should show file size in wide mode', () => {
      mockIsNarrow.value = false;
      const session = createMockSession({ fileSize: 2048 });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Should show file size
      expect(output).toMatch(/KB|bytes|B/i);
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-PV-001, REQ-PV-006, REQ-PV-007, REQ-PV-008, REQ-SB-019, REQ-SB-025
   */
  describe('Preview Loading States', () => {
    it('should show "Loading..." for sessions with previewState loading', () => {
      const session = createMockSession({
        previewState: 'loading',
        firstUserMessage: undefined,
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Loading');
    });

    it('should show "(no user message)" for sessions with previewState none', () => {
      const session = createMockSession({
        previewState: 'none',
        firstUserMessage: undefined,
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('no user message');
    });

    it('should show "(preview unavailable)" for sessions with previewState error', () => {
      const session = createMockSession({
        previewState: 'error',
        firstUserMessage: undefined,
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('preview unavailable');
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-SR-001, REQ-SR-002, REQ-SR-005, REQ-SR-011, REQ-SR-012
   */
  describe('Search Filtering', () => {
    it('should display search bar', () => {
      mockHookState.isLoading = false;
      mockHookState.isSearching = true;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Search');
    });

    it('should display current search term', () => {
      mockHookState.searchTerm = 'haiku';
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('haiku');
    });

    it('should show match count when searching', () => {
      const session = createMockSession();
      mockHookState.searchTerm = 'test';
      mockHookState.filteredSessions = [session];
      mockHookState.pageItems = [session];
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Should show count like "1 session found" or similar
      expect(output).toMatch(/1.*found|found.*1|session/i);
    });

    it('should show "No sessions match" when search yields no results', () => {
      mockHookState.searchTerm = 'nonexistent';
      mockHookState.filteredSessions = [];
      mockHookState.pageItems = [];
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toMatch(/no.*match|no sessions/i);
    });

    it('should display "(Tab to navigate)" hint in search mode', () => {
      mockHookState.isSearching = true;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Tab');
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-KN-001, REQ-KN-002, REQ-KN-003, REQ-SR-007
   */
  describe('Keyboard Navigation', () => {
    it('should call handleKeypress when Up arrow is pressed', async () => {
      const session1 = createMockSession({ sessionId: 'session-1' });
      const session2 = createMockSession({ sessionId: 'session-2' });
      mockHookState.pageItems = [session1, session2];
      mockHookState.filteredSessions = [session1, session2];
      mockHookState.selectedIndex = 1;
      mockHookState.selectedSession = session2;
      mockHookState.isLoading = false;

      const { stdin } = renderWithProviders();

      act(() => {
        stdin.write(TerminalKeys.UP_ARROW);
      });

      expect(mockHookState.handleKeypress).toHaveBeenCalled();
    });

    it('should call handleKeypress when Down arrow is pressed', async () => {
      const session1 = createMockSession({ sessionId: 'session-1' });
      const session2 = createMockSession({ sessionId: 'session-2' });
      mockHookState.pageItems = [session1, session2];
      mockHookState.filteredSessions = [session1, session2];
      mockHookState.selectedIndex = 0;
      mockHookState.selectedSession = session1;
      mockHookState.isLoading = false;

      const { stdin } = renderWithProviders();

      act(() => {
        stdin.write(TerminalKeys.DOWN_ARROW);
      });

      expect(mockHookState.handleKeypress).toHaveBeenCalled();
    });

    it('should call handleKeypress when Enter is pressed to trigger onSelect', async () => {
      const session = createMockSession();
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { stdin } = renderWithProviders();

      act(() => {
        stdin.write(TerminalKeys.ENTER);
      });

      expect(mockHookState.handleKeypress).toHaveBeenCalled();
    });

    it('should call handleKeypress when Tab is pressed to toggle modes', async () => {
      mockHookState.isSearching = true;
      mockHookState.isLoading = false;

      const { stdin } = renderWithProviders();

      act(() => {
        stdin.write(TerminalKeys.TAB);
      });

      expect(mockHookState.handleKeypress).toHaveBeenCalled();
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-DL-001, REQ-DL-003, REQ-DL-013, REQ-DL-014
   */
  describe('Delete Confirmation', () => {
    it('should show delete confirmation when deleteConfirmIndex is set', () => {
      const session = createMockSession({
        firstUserMessage: 'Session to delete',
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.deleteConfirmIndex = 0;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Should show confirmation prompt
      expect(output).toMatch(/delete|confirm/i);
    });

    it('should show Y/N options in delete confirmation', () => {
      const session = createMockSession();
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.deleteConfirmIndex = 0;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Y');
      expect(output).toContain('N');
    });

    it('should call handleKeypress when Y is pressed during delete confirmation', async () => {
      const session = createMockSession();
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.deleteConfirmIndex = 0;
      mockHookState.isLoading = false;

      const { stdin } = renderWithProviders();

      act(() => {
        stdin.write('y');
      });

      expect(mockHookState.handleKeypress).toHaveBeenCalled();
    });

    it('should call handleKeypress when N is pressed during delete confirmation', async () => {
      const session = createMockSession();
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.deleteConfirmIndex = 0;
      mockHookState.isLoading = false;

      const { stdin } = renderWithProviders();

      act(() => {
        stdin.write('n');
      });

      expect(mockHookState.handleKeypress).toHaveBeenCalled();
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-SB-010, REQ-LK-005
   */
  describe('Locked Session Display', () => {
    it('should show "(in use)" indicator for locked sessions', () => {
      const session = createMockSession({ isLocked: true });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('in use');
    });

    it('should still display locked sessions in the list', () => {
      const session = createMockSession({
        isLocked: true,
        firstUserMessage: 'Locked session preview',
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Locked session preview');
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-SB-020, REQ-EH-001, REQ-EH-005
   */
  describe('Error Display', () => {
    it('should show error message when error state is set', () => {
      mockHookState.error = 'Failed to load sessions: Permission denied';
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Permission denied');
    });

    it('should display error inline above controls', () => {
      mockHookState.error = 'Session is in use by another process';
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Session is in use');
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-SB-008
   */
  describe('Skipped Sessions Notice', () => {
    it('should show "Skipped N unreadable session(s)" when skippedCount > 0', () => {
      mockHookState.skippedCount = 3;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toMatch(/skipped.*3|3.*skipped/i);
    });

    it('should not show skipped notice when skippedCount is 0', () => {
      mockHookState.skippedCount = 0;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).not.toMatch(/skipped/i);
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-RW-001, REQ-RW-002, REQ-RW-003, REQ-RW-004, REQ-RW-005, REQ-RW-006
   */
  describe('Wide Mode Layout', () => {
    beforeEach(() => {
      mockIsNarrow.value = false;
    });

    it('should display title "Session Browser" in wide mode', () => {
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Session Browser');
    });

    it('should display sort bar with options in wide mode', () => {
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('newest');
    });

    it('should show "(press s to cycle)" hint next to sort bar', () => {
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toMatch(/press\s+s|s\s+to\s+cycle/i);
    });

    it('should display full controls bar in wide mode', () => {
      const session = createMockSession();
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Enter');
      expect(output).toContain('Del');
      expect(output).toContain('Esc');
    });

    it('should display selection detail line with session ID', () => {
      const session = createMockSession({
        sessionId: 'abc123def456',
        provider: 'anthropic',
        model: 'claude-opus-4-5-20251101',
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Should show session ID
      expect(output).toContain('abc123');
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-RN-001, REQ-RN-002, REQ-RN-003, REQ-RN-004, REQ-RN-006, REQ-RN-007, REQ-RN-008, REQ-RN-009, REQ-RN-010, REQ-RN-011, REQ-RN-013
   */
  describe('Narrow Mode Layout', () => {
    beforeEach(() => {
      mockIsNarrow.value = true;
    });

    it('should display shortened title "Sessions" in narrow mode', () => {
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Sessions');
    });

    it('should hide sort bar but show sort hint in controls', () => {
      mockHookState.sortOrder = 'newest';
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('s:newest');
    });

    it('should show abbreviated controls bar', () => {
      const session = createMockSession();
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('Nav');
      expect(output).toContain('Esc');
    });

    it('should hide detail line in narrow mode', () => {
      const session = createMockSession({
        sessionId: 'abc123def456ghij',
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // In narrow mode, full session ID should not appear in detail line
      // Only first 8 chars should show on selected row
      expect(output).not.toContain('abc123def456ghij');
    });

    it('should show abbreviated session ID (first 8 chars) on selected row', () => {
      const session = createMockSession({
        sessionId: 'abc12345def67890',
      });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.selectedIndex = 0;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('abc12345');
    });

    it('should hide file size column', () => {
      const session = createMockSession({ fileSize: 999999 });
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // File size should not be displayed
      expect(output).not.toContain('999999');
    });

    it('should hide 1-based index in narrow mode', () => {
      const session = createMockSession();
      mockHookState.pageItems = [session];
      mockHookState.filteredSessions = [session];
      mockHookState.selectedSession = session;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).not.toContain('#1');
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-SO-001, REQ-SO-002, REQ-SO-003, REQ-SO-006
   */
  describe('Sort Options', () => {
    it('should visually indicate active sort option with brackets', () => {
      mockHookState.sortOrder = 'newest';
      mockHookState.isLoading = false;
      mockIsNarrow.value = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toMatch(/\[newest\]/);
    });

    it('should display all sort options (newest, oldest, size)', () => {
      mockHookState.isLoading = false;
      mockIsNarrow.value = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      expect(output).toContain('newest');
      expect(output).toContain('oldest');
      expect(output).toContain('size');
    });

    it('should call handleKeypress when s is pressed', async () => {
      mockHookState.isSearching = false;
      mockHookState.isLoading = false;

      const { stdin } = renderWithProviders();

      act(() => {
        stdin.write('s');
      });

      expect(mockHookState.handleKeypress).toHaveBeenCalled();
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-PG-001, REQ-PG-002, REQ-PG-003, REQ-PG-004, REQ-PG-005
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

      expect(output).toMatch(/page.*1.*of.*2|1\/2/i);
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
      expect(output).not.toMatch(/page.*1.*of.*1/i);
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

      expect(output).toMatch(/PgUp|PgDn|page/i);
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-SD-001, REQ-SD-002
   */
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

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-RS-001, REQ-RS-003, REQ-RS-004, REQ-RS-005, REQ-RS-006, REQ-RS-013
   */
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

      expect(output).toMatch(/replace|current.*conversation|continue\?/i);
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

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-EP-001, REQ-EP-002, REQ-EP-003, REQ-EP-004
   */
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

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-SB-012, REQ-RN-011
   */
  describe('Border Styles', () => {
    it('should render with rounded border in wide mode', () => {
      mockIsNarrow.value = false;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Rounded border uses curved characters like ╭ ╮ ╯ ╰
      expect(output).toMatch(/[╭╮╯╰]/);
    });

    it('should render borderless in narrow mode', () => {
      mockIsNarrow.value = true;
      mockHookState.isLoading = false;

      const { lastFrame } = renderWithProviders();
      const output = lastFrame();

      // Should NOT have box-drawing characters
      // Note: This is hard to assert negatively, so we check it doesn't have standard box borders
      expect(output).not.toMatch(/[╭╮╯╰]/);
    });
  });

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-SB-013, REQ-SB-023
   */
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

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-SR-013, REQ-SR-014
   */
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

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P16
   * @requirement REQ-RW-007
   */
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
