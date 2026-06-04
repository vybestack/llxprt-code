/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

/**
 * React hook for session browser state management and keyboard handling.
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P12
 * @plan PLAN-20260214-SESSIONBROWSER.P14
 * @requirement REQ-SB-002, REQ-SR-001, REQ-SO-001, REQ-PG-001, REQ-KN-001
 * @pseudocode use-session-browser.md
 */

import type { SessionSummary } from '@vybestack/llxprt-code-core';
import type { PerformResumeResult } from '../../services/performResume.js';
import type { Key } from './useKeypress.js';
import { useSessionBrowserController } from './useSessionBrowserHelpers.js';

/**
 * Preview loading state for session first message.
 */
export type PreviewState = 'loading' | 'loaded' | 'none' | 'error';

/**
 * Extended session summary with browser-specific enrichments.
 */
export interface EnrichedSessionSummary extends SessionSummary {
  /** First user message extracted from session, if available */
  firstUserMessage?: string;
  /** Current state of preview loading */
  previewState: PreviewState;
  /** Whether this session is currently locked by another process */
  isLocked: boolean;
}

/**
 * Props for the useSessionBrowser hook.
 */
export interface UseSessionBrowserProps {
  /** Directory containing chat session files */
  chatsDir: string;
  /** Hash identifying the current project */
  projectHash: string;
  /** ID of the currently active session (to exclude from list) */
  currentSessionId: string;
  /** Callback to handle session selection/resume */
  onSelect: (session: SessionSummary) => Promise<PerformResumeResult>;
  /** Callback to close the browser */
  onClose: () => void;
  /** Whether there's an active conversation that would be abandoned */
  hasActiveConversation?: boolean;
}

/**
 * Result returned by the useSessionBrowser hook.
 */
export interface UseSessionBrowserResult {
  // State
  sessions: EnrichedSessionSummary[];
  filteredSessions: EnrichedSessionSummary[];
  searchTerm: string;
  sortOrder: 'newest' | 'oldest' | 'size';
  selectedIndex: number;
  page: number;
  isSearching: boolean;
  isLoading: boolean;
  isResuming: boolean;
  deleteConfirmIndex: number | null;
  conversationConfirmActive: boolean;
  error: string | null;
  skippedCount: number;

  // Derived
  totalPages: number;
  pageItems: EnrichedSessionSummary[];
  selectedSession: EnrichedSessionSummary | null;

  // Actions
  handleKeypress: (input: string, key: Key) => void;
}

/**
 * React hook for managing session browser state and interactions.
 */
export function useSessionBrowser(
  props: UseSessionBrowserProps,
): UseSessionBrowserResult {
  return useSessionBrowserController(props);
}
