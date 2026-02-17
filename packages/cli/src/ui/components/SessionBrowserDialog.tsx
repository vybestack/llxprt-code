/**
 * SessionBrowserDialog - Interactive session browser component
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P15
 * @plan PLAN-20260214-SESSIONBROWSER.P17
 * @requirement REQ-SB-012, REQ-RW-001, REQ-RN-001
 * @pseudocode session-browser-dialog.md
 */

import { Box, Text } from 'ink';
import React from 'react';

import type { SessionSummary } from '@vybestack/llxprt-code-core';

import { SemanticColors } from '../colors.js';
import type { PerformResumeResult } from '../../services/performResume.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { useSessionBrowser } from '../hooks/useSessionBrowser.js';
import type { EnrichedSessionSummary } from '../hooks/useSessionBrowser.js';
import { formatRelativeTime } from '../../utils/formatRelativeTime.js';
import { truncateEnd } from '../utils/responsive.js';

/**
 * Props for the SessionBrowserDialog component
 * @plan PLAN-20260214-SESSIONBROWSER.P15
 * @requirement REQ-SB-012
 */
export interface SessionBrowserDialogProps {
  chatsDir: string;
  projectHash: string;
  currentSessionId: string;
  hasActiveConversation: boolean;
  onSelect: (session: SessionSummary) => Promise<PerformResumeResult>;
  onClose: () => void;
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Interactive session browser dialog for selecting and resuming sessions
 * @plan PLAN-20260214-SESSIONBROWSER.P15
 */
export function SessionBrowserDialog(
  props: SessionBrowserDialogProps,
): React.ReactElement {
  const {
    chatsDir,
    projectHash,
    currentSessionId,
    hasActiveConversation,
    onSelect,
    onClose,
  } = props;
  const { isNarrow, width } = useResponsive();

  const state = useSessionBrowser({
    chatsDir,
    projectHash,
    currentSessionId,
    onSelect,
    onClose,
    hasActiveConversation,
  });

  // Register keypress handler
  useKeypress(
    (key) => {
      state.handleKeypress(key.sequence ?? '', key);
    },
    { isActive: true },
  );

  // Loading state
  if (state.isLoading) {
    if (isNarrow) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color={SemanticColors.text.primary}>
            Sessions
          </Text>
          <Text color={SemanticColors.text.secondary}>Loading sessions...</Text>
        </Box>
      );
    }
    return (
      <Box
        borderStyle="round"
        borderColor={SemanticColors.border.default}
        flexDirection="column"
        padding={1}
      >
        <Text bold color={SemanticColors.text.primary}>
          Session Browser
        </Text>
        <Text color={SemanticColors.text.secondary}>Loading sessions...</Text>
      </Box>
    );
  }

  // Empty state (no sessions)
  if (state.sessions.length === 0 && state.searchTerm === '') {
    if (isNarrow) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color={SemanticColors.text.primary}>
            Sessions
          </Text>
          <Text color={SemanticColors.text.primary}>
            No sessions found for this project.
          </Text>
          <Text color={SemanticColors.text.secondary}>
            Sessions are created automatically when you start a conversation.
          </Text>
          <Box marginTop={1}>
            <Text color={SemanticColors.text.secondary}>
              Press Esc to close
            </Text>
          </Box>
        </Box>
      );
    }
    return (
      <Box
        borderStyle="round"
        borderColor={SemanticColors.border.default}
        flexDirection="column"
        padding={1}
      >
        <Text bold color={SemanticColors.text.primary}>
          Session Browser
        </Text>
        <Text color={SemanticColors.text.primary}>
          No sessions found for this project.
        </Text>
        <Text color={SemanticColors.text.secondary}>
          Sessions are created automatically when you start a conversation.
        </Text>
        <Box marginTop={1}>
          <Text color={SemanticColors.text.secondary}>Press Esc to close</Text>
        </Box>
      </Box>
    );
  }

  // Render session preview text based on preview state
  const renderPreview = (session: EnrichedSessionSummary): React.ReactNode => {
    switch (session.previewState) {
      case 'loading':
        return (
          <Text color={SemanticColors.text.secondary} italic>
            Loading...
          </Text>
        );
      case 'none':
        return (
          <Text color={SemanticColors.text.secondary} italic>
            (no user message)
          </Text>
        );
      case 'error':
        return (
          <Text color={SemanticColors.text.secondary} italic>
            (preview unavailable)
          </Text>
        );
      case 'loaded':
      default: {
        const previewText = session.firstUserMessage ?? '';
        const maxLen = isNarrow ? 40 : 80;
        const truncated = truncateEnd(previewText.replace(/\n/g, ' '), maxLen);
        return <Text color={SemanticColors.text.secondary}>{truncated}</Text>;
      }
    }
  };

  // Render a session row
  const renderSessionRow = (
    session: EnrichedSessionSummary,
    index: number,
    isSelected: boolean,
  ): React.ReactNode => {
    const relTime = formatRelativeTime(session.lastModified, {
      mode: isNarrow ? 'short' : 'long',
    });

    if (isNarrow) {
      // Narrow mode: compact layout, no index, show session ID suffix for selected
      return (
        <Box key={session.sessionId} flexDirection="column">
          <Box>
            <Text
              color={
                isSelected
                  ? SemanticColors.text.accent
                  : SemanticColors.text.primary
              }
            >
              {isSelected ? '● ' : '○ '}
            </Text>
            <Text
              color={
                isSelected
                  ? SemanticColors.text.accent
                  : SemanticColors.text.primary
              }
            >
              {session.provider ?? 'unknown'}
            </Text>
            <Text color={SemanticColors.text.secondary}> · </Text>
            <Text color={SemanticColors.text.secondary}>{relTime}</Text>
            {session.isLocked ? (
              <Text color={SemanticColors.status.warning}> (in use)</Text>
            ) : null}
            {isSelected ? (
              <Text color={SemanticColors.text.secondary}>
                {' '}
                [{session.sessionId.slice(0, 8)}]
              </Text>
            ) : null}
          </Box>
          <Box marginLeft={2}>{renderPreview(session)}</Box>
        </Box>
      );
    }

    // Wide mode: full layout with index and file size
    const oneBasedIndex = state.page * 20 + index + 1;
    return (
      <Box key={session.sessionId} flexDirection="column">
        <Box>
          <Text
            color={
              isSelected
                ? SemanticColors.text.accent
                : SemanticColors.text.primary
            }
          >
            {isSelected ? '● ' : '○ '}
          </Text>
          <Text color={SemanticColors.text.secondary}>#{oneBasedIndex} </Text>
          <Text
            color={
              isSelected
                ? SemanticColors.text.accent
                : SemanticColors.text.primary
            }
          >
            {session.provider ?? 'unknown'}
          </Text>
          <Text color={SemanticColors.text.secondary}>/</Text>
          <Text color={SemanticColors.text.primary}>
            {truncateEnd(session.model ?? 'unknown', 30)}
          </Text>
          <Text color={SemanticColors.text.secondary}> · </Text>
          <Text color={SemanticColors.text.secondary}>{relTime}</Text>
          <Text color={SemanticColors.text.secondary}> · </Text>
          <Text color={SemanticColors.text.secondary}>
            {formatFileSize(session.fileSize ?? 0)}
          </Text>
          {session.isLocked ? (
            <Text color={SemanticColors.status.warning}> (in use)</Text>
          ) : null}
        </Box>
        <Box marginLeft={2}>{renderPreview(session)}</Box>
      </Box>
    );
  };

  // Render search bar
  const renderSearchBar = (): React.ReactNode => {
    const matchCount = state.filteredSessions.length;
    const hasSearch = state.searchTerm.length > 0;

    if (isNarrow) {
      return (
        <Box marginY={1}>
          <Text
            color={
              state.isSearching
                ? SemanticColors.text.primary
                : SemanticColors.text.secondary
            }
          >
            Search:{' '}
          </Text>
          {state.isSearching ? (
            <Text color={SemanticColors.text.accent}>▌</Text>
          ) : null}
          <Text color={SemanticColors.text.primary}>{state.searchTerm}</Text>
          {hasSearch ? (
            <Text color={SemanticColors.text.secondary}>
              {' '}
              ({matchCount} found)
            </Text>
          ) : null}
        </Box>
      );
    }

    return (
      <Box marginY={1}>
        <Text
          color={
            state.isSearching
              ? SemanticColors.text.primary
              : SemanticColors.text.secondary
          }
        >
          Search:{' '}
        </Text>
        {state.isSearching ? (
          <Text color={SemanticColors.text.accent}>▌</Text>
        ) : null}
        <Text color={SemanticColors.text.primary}>{state.searchTerm}</Text>
        <Text color={SemanticColors.text.secondary}>
          {' '}
          ({matchCount} {matchCount === 1 ? 'session' : 'sessions'} found)
          {state.isSearching ? ' (Tab to navigate)' : ''}
        </Text>
      </Box>
    );
  };

  // Render sort bar (wide mode only)
  const renderSortBar = (): React.ReactNode => {
    if (isNarrow) return null;

    return (
      <Box marginBottom={1}>
        <Text color={SemanticColors.text.secondary}>Sort: </Text>
        <Text
          color={
            state.sortOrder === 'newest'
              ? SemanticColors.text.primary
              : SemanticColors.text.secondary
          }
        >
          {state.sortOrder === 'newest' ? '[newest]' : 'newest'}
        </Text>
        <Text color={SemanticColors.text.secondary}> </Text>
        <Text
          color={
            state.sortOrder === 'oldest'
              ? SemanticColors.text.primary
              : SemanticColors.text.secondary
          }
        >
          {state.sortOrder === 'oldest' ? '[oldest]' : 'oldest'}
        </Text>
        <Text color={SemanticColors.text.secondary}> </Text>
        <Text
          color={
            state.sortOrder === 'size'
              ? SemanticColors.text.primary
              : SemanticColors.text.secondary
          }
        >
          {state.sortOrder === 'size' ? '[size]' : 'size'}
        </Text>
        <Text color={SemanticColors.text.secondary}> (press s to cycle)</Text>
      </Box>
    );
  };

  // Render page indicator
  const renderPageIndicator = (): React.ReactNode => {
    if (state.totalPages <= 1) return null;

    return (
      <Box marginY={1}>
        <Text color={SemanticColors.text.secondary}>
          Page {state.page + 1} of {state.totalPages} (PgUp/PgDn to navigate)
        </Text>
      </Box>
    );
  };

  // Render selection detail (wide mode only)
  const renderSelectionDetail = (): React.ReactNode => {
    if (isNarrow || !state.selectedSession) return null;

    const session = state.selectedSession;
    const relTime = formatRelativeTime(session.lastModified, { mode: 'long' });

    return (
      <Box marginTop={1}>
        <Text color={SemanticColors.text.secondary}>Selected: </Text>
        <Text color={SemanticColors.text.primary}>{session.sessionId}</Text>
        <Text color={SemanticColors.text.secondary}> · </Text>
        <Text color={SemanticColors.text.primary}>
          {session.provider}/{session.model}
        </Text>
        <Text color={SemanticColors.text.secondary}> · </Text>
        <Text color={SemanticColors.text.secondary}>{relTime}</Text>
      </Box>
    );
  };

  // Render controls bar
  const renderControlsBar = (): React.ReactNode => {
    const hasSessions = state.pageItems.length > 0;

    if (isNarrow) {
      return (
        <Box marginTop={1}>
          <Text color={SemanticColors.text.secondary}>
            Nav:↑↓ {hasSessions ? 'Enter ' : ''}s:{state.sortOrder} Esc
          </Text>
        </Box>
      );
    }

    return (
      <Box marginTop={1}>
        <Text color={SemanticColors.text.secondary}>
          Controls: ↑↓ Navigate
          {hasSessions ? ' [Enter] Resume [Del] Delete' : ''} [s] Sort [Tab]
          Toggle Mode [Esc] Close
        </Text>
      </Box>
    );
  };

  // Render error message
  const renderError = (): React.ReactNode => {
    if (!state.error) return null;

    return (
      <Box marginY={1}>
        <Text color={SemanticColors.status.error}>{state.error}</Text>
      </Box>
    );
  };

  // Render skipped notice
  const renderSkippedNotice = (): React.ReactNode => {
    if (state.skippedCount === 0) return null;

    return (
      <Box marginY={1}>
        <Text color={SemanticColors.status.warning}>
          Skipped {state.skippedCount} unreadable session(s).
        </Text>
      </Box>
    );
  };

  // Render resuming status
  const renderResumingStatus = (): React.ReactNode => {
    if (!state.isResuming) return null;

    return (
      <Box marginY={1}>
        <Text color={SemanticColors.text.accent}>Resuming...</Text>
      </Box>
    );
  };

  // Render delete confirmation
  const renderDeleteConfirmation = (): React.ReactNode => {
    if (state.deleteConfirmIndex === null) return null;

    return (
      <Box marginY={1}>
        <Text color={SemanticColors.status.warning}>
          Delete this session? Press Y to confirm, N or Esc to cancel.
        </Text>
      </Box>
    );
  };

  // Render conversation confirmation
  const renderConversationConfirmation = (): React.ReactNode => {
    if (!state.conversationConfirmActive) return null;

    return (
      <Box marginY={1}>
        <Text color={SemanticColors.status.warning}>
          This will replace your current conversation. Continue? Y/N
        </Text>
      </Box>
    );
  };

  // Render empty search results
  const renderEmptySearchResults = (): React.ReactNode => {
    if (state.pageItems.length > 0 || state.searchTerm === '') return null;

    return (
      <Box marginY={1}>
        <Text color={SemanticColors.text.secondary}>
          No sessions match &quot;{state.searchTerm}&quot;
        </Text>
      </Box>
    );
  };

  // Render session list
  const renderSessionList = (): React.ReactNode => {
    if (state.pageItems.length === 0) {
      return renderEmptySearchResults();
    }

    return (
      <Box flexDirection="column">
        {state.pageItems.map((session, index) =>
          renderSessionRow(session, index, index === state.selectedIndex),
        )}
      </Box>
    );
  };

  // Main content
  const content = (
    <>
      {/* Title */}
      <Text bold color={SemanticColors.text.primary}>
        {isNarrow ? 'Sessions' : 'Session Browser'}
      </Text>

      {/* Search bar */}
      {renderSearchBar()}

      {/* Sort bar (wide mode only) */}
      {renderSortBar()}

      {/* Skipped notice */}
      {renderSkippedNotice()}

      {/* Session list */}
      {renderSessionList()}

      {/* Page indicator */}
      {renderPageIndicator()}

      {/* Error message */}
      {renderError()}

      {/* Resuming status */}
      {renderResumingStatus()}

      {/* Delete confirmation */}
      {renderDeleteConfirmation()}

      {/* Conversation confirmation */}
      {renderConversationConfirmation()}

      {/* Selection detail (wide mode only) */}
      {renderSelectionDetail()}

      {/* Controls bar */}
      {renderControlsBar()}
    </>
  );

  // Wrap in box with border (wide mode) or borderless (narrow mode)
  if (isNarrow) {
    return (
      <Box flexDirection="column" padding={1}>
        {content}
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={SemanticColors.border.default}
      flexDirection="column"
      padding={1}
      width={Math.min(width, 120)}
    >
      {content}
    </Box>
  );
}
