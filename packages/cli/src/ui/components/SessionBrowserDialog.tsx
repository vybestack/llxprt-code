/**
 * SessionBrowserDialog - Interactive session browser component
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P15
 * @plan PLAN-20260214-SESSIONBROWSER.P17
 * @requirement REQ-SB-012, REQ-RW-001, REQ-RN-001
 * @pseudocode session-browser-dialog.md
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useCallback } from 'react';

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

type PersistedSessionDisplay = {
  provider: string;
  model: string;
  fileSize: number;
};

function getSessionDisplay(
  session: EnrichedSessionSummary,
): PersistedSessionDisplay {
  const boundarySession = session as {
    provider?: unknown;
    model?: unknown;
    fileSize?: unknown;
  };

  return {
    provider:
      typeof boundarySession.provider === 'string'
        ? boundarySession.provider
        : 'unknown',
    model:
      typeof boundarySession.model === 'string'
        ? boundarySession.model
        : 'unknown',
    fileSize:
      typeof boundarySession.fileSize === 'number'
        ? boundarySession.fileSize
        : 0,
  };
}

const SessionPreview: React.FC<{
  session: EnrichedSessionSummary;
  isNarrow: boolean;
}> = ({ session, isNarrow }) => {
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

const NarrowSessionRow: React.FC<{
  session: EnrichedSessionSummary;
  isSelected: boolean;
  display: PersistedSessionDisplay;
  relTime: string;
  isNarrow: boolean;
}> = ({ session, isSelected, display, relTime, isNarrow }) => (
  <Box key={session.sessionId} flexDirection="column">
    <Box>
      <Text
        color={
          isSelected ? SemanticColors.text.accent : SemanticColors.text.primary
        }
      >
        {isSelected ? '● ' : '○ '}
      </Text>
      <Text
        color={
          isSelected ? SemanticColors.text.accent : SemanticColors.text.primary
        }
      >
        {display.provider}
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
    <Box marginLeft={2}>
      <SessionPreview session={session} isNarrow={isNarrow} />
    </Box>
  </Box>
);

const WideSessionRow: React.FC<{
  session: EnrichedSessionSummary;
  isSelected: boolean;
  display: PersistedSessionDisplay;
  relTime: string;
  oneBasedIndex: number;
  isNarrow: boolean;
}> = ({ session, isSelected, display, relTime, oneBasedIndex, isNarrow }) => (
  <Box key={session.sessionId} flexDirection="column">
    <Box>
      <Text
        color={
          isSelected ? SemanticColors.text.accent : SemanticColors.text.primary
        }
      >
        {isSelected ? '● ' : '○ '}
      </Text>
      <Text color={SemanticColors.text.secondary}>#{oneBasedIndex} </Text>
      <Text
        color={
          isSelected ? SemanticColors.text.accent : SemanticColors.text.primary
        }
      >
        {display.provider}
      </Text>
      <Text color={SemanticColors.text.secondary}>/</Text>
      <Text color={SemanticColors.text.primary}>
        {truncateEnd(display.model, 30)}
      </Text>
      <Text color={SemanticColors.text.secondary}> · </Text>
      <Text color={SemanticColors.text.secondary}>{relTime}</Text>
      <Text color={SemanticColors.text.secondary}> · </Text>
      <Text color={SemanticColors.text.secondary}>
        {formatFileSize(display.fileSize)}
      </Text>
      {session.isLocked ? (
        <Text color={SemanticColors.status.warning}> (in use)</Text>
      ) : null}
    </Box>
    <Box marginLeft={2}>
      <SessionPreview session={session} isNarrow={isNarrow} />
    </Box>
  </Box>
);

const LoadingState: React.FC<{ isNarrow: boolean }> = ({ isNarrow }) => {
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
};

const EmptyState: React.FC<{ isNarrow: boolean }> = ({ isNarrow }) => {
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
          <Text color={SemanticColors.text.secondary}>Press Esc to close</Text>
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
};

const SearchBarNarrow: React.FC<{
  state: ReturnType<typeof useSessionBrowser>;
}> = ({ state }) => (
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
    {state.searchTerm.length > 0 ? (
      <Text color={SemanticColors.text.secondary}>
        {' '}
        ({state.filteredSessions.length} found)
      </Text>
    ) : null}
  </Box>
);

const SearchBarWide: React.FC<{
  state: ReturnType<typeof useSessionBrowser>;
}> = ({ state }) => {
  const matchCount = state.filteredSessions.length;
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

const SortBar: React.FC<{
  sortOrder: string;
}> = ({ sortOrder }) => (
  <Box marginBottom={1}>
    <Text color={SemanticColors.text.secondary}>Sort: </Text>
    <Text
      color={
        sortOrder === 'newest'
          ? SemanticColors.text.primary
          : SemanticColors.text.secondary
      }
    >
      {sortOrder === 'newest' ? '[newest]' : 'newest'}
    </Text>
    <Text color={SemanticColors.text.secondary}> </Text>
    <Text
      color={
        sortOrder === 'oldest'
          ? SemanticColors.text.primary
          : SemanticColors.text.secondary
      }
    >
      {sortOrder === 'oldest' ? '[oldest]' : 'oldest'}
    </Text>
    <Text color={SemanticColors.text.secondary}> </Text>
    <Text
      color={
        sortOrder === 'size'
          ? SemanticColors.text.primary
          : SemanticColors.text.secondary
      }
    >
      {sortOrder === 'size' ? '[size]' : 'size'}
    </Text>
    <Text color={SemanticColors.text.secondary}> (press s to cycle)</Text>
  </Box>
);

const PageIndicator: React.FC<{
  page: number;
  totalPages: number;
}> = ({ page, totalPages }) => {
  if (totalPages <= 1) return null;

  return (
    <Box marginY={1}>
      <Text color={SemanticColors.text.secondary}>
        Page {page + 1} of {totalPages} (PgUp/PgDn to navigate)
      </Text>
    </Box>
  );
};

const SelectionDetail: React.FC<{
  session: EnrichedSessionSummary | null;
}> = ({ session }) => {
  if (!session) return null;

  const relTime = formatRelativeTime(session.lastModified, { mode: 'long' });
  const display = getSessionDisplay(session);

  return (
    <Box marginTop={1}>
      <Text color={SemanticColors.text.secondary}>Selected: </Text>
      <Text color={SemanticColors.text.primary}>{session.sessionId}</Text>
      <Text color={SemanticColors.text.secondary}> · </Text>
      <Text color={SemanticColors.text.primary}>
        {display.provider}/{display.model}
      </Text>
      <Text color={SemanticColors.text.secondary}> · </Text>
      <Text color={SemanticColors.text.secondary}>{relTime}</Text>
    </Box>
  );
};

const ControlsBarNarrow: React.FC<{
  hasSessions: boolean;
  sortOrder: string;
}> = ({ hasSessions, sortOrder }) => (
  <Box marginTop={1}>
    <Text color={SemanticColors.text.secondary}>
      Nav:↑↓ {hasSessions ? 'Enter ' : ''}s:{sortOrder} Esc
    </Text>
  </Box>
);

const ControlsBarWide: React.FC<{
  hasSessions: boolean;
}> = ({ hasSessions }) => (
  <Box marginTop={1}>
    <Text color={SemanticColors.text.secondary}>
      Controls: ↑↓ Navigate
      {hasSessions ? ' [Enter] Resume [Del] Delete' : ''} [s] Sort [Tab] Toggle
      Mode [Esc] Close
    </Text>
  </Box>
);

const ErrorMessage: React.FC<{ error: string | null }> = ({ error }) => {
  if (error === null) return null;

  return (
    <Box marginY={1}>
      <Text color={SemanticColors.status.error}>{error}</Text>
    </Box>
  );
};

const SkippedNotice: React.FC<{ skippedCount: number }> = ({
  skippedCount,
}) => {
  if (skippedCount === 0) return null;

  return (
    <Box marginY={1}>
      <Text color={SemanticColors.status.warning}>
        Skipped {skippedCount} unreadable session(s).
      </Text>
    </Box>
  );
};

const ResumingStatus: React.FC<{ isResuming: boolean }> = ({ isResuming }) => {
  if (isResuming !== true) return null;

  return (
    <Box marginY={1}>
      <Text color={SemanticColors.text.accent}>Resuming...</Text>
    </Box>
  );
};

const DeleteConfirmation: React.FC<{
  deleteConfirmIndex: number | null;
}> = ({ deleteConfirmIndex }) => {
  if (deleteConfirmIndex === null) return null;

  return (
    <Box marginY={1}>
      <Text color={SemanticColors.status.warning}>
        Delete this session? Press Y to confirm, N or Esc to cancel.
      </Text>
    </Box>
  );
};

const ConversationConfirmation: React.FC<{
  conversationConfirmActive: boolean;
}> = ({ conversationConfirmActive }) => {
  if (conversationConfirmActive !== true) return null;

  return (
    <Box marginY={1}>
      <Text color={SemanticColors.status.warning}>
        This will replace your current conversation. Continue? Y/N
      </Text>
    </Box>
  );
};

const EmptySearchResults: React.FC<{
  pageItemsLength: number;
  searchTerm: string;
}> = ({ pageItemsLength, searchTerm }) => {
  if (pageItemsLength > 0 || searchTerm === '') return null;

  return (
    <Box marginY={1}>
      <Text color={SemanticColors.text.secondary}>
        No sessions match &quot;{searchTerm}&quot;
      </Text>
    </Box>
  );
};

const SessionList: React.FC<{
  state: ReturnType<typeof useSessionBrowser>;
  isNarrow: boolean;
}> = ({ state, isNarrow }) => {
  if (state.pageItems.length === 0) {
    return (
      <EmptySearchResults pageItemsLength={0} searchTerm={state.searchTerm} />
    );
  }

  return (
    <Box flexDirection="column">
      {state.pageItems.map((session, index) => {
        const isSelected = index === state.selectedIndex;
        const relTime = formatRelativeTime(session.lastModified, {
          mode: isNarrow ? 'short' : 'long',
        });
        const display = getSessionDisplay(session);

        if (isNarrow) {
          return (
            <NarrowSessionRow
              key={session.sessionId}
              session={session}
              isSelected={isSelected}
              display={display}
              relTime={relTime}
              isNarrow={isNarrow}
            />
          );
        }

        const oneBasedIndex = state.page * 20 + index + 1;
        return (
          <WideSessionRow
            key={session.sessionId}
            session={session}
            isSelected={isSelected}
            display={display}
            relTime={relTime}
            oneBasedIndex={oneBasedIndex}
            isNarrow={isNarrow}
          />
        );
      })}
    </Box>
  );
};

const SessionContent: React.FC<{
  isNarrow: boolean;
  state: ReturnType<typeof useSessionBrowser>;
}> = ({ isNarrow, state }) => (
  <>
    {/* Title */}
    <Text bold color={SemanticColors.text.primary}>
      {isNarrow ? 'Sessions' : 'Session Browser'}
    </Text>

    {/* Search bar */}
    {isNarrow ? (
      <SearchBarNarrow state={state} />
    ) : (
      <SearchBarWide state={state} />
    )}

    {/* Sort bar (wide mode only) */}
    {!isNarrow && <SortBar sortOrder={state.sortOrder} />}

    {/* Skipped notice */}
    <SkippedNotice skippedCount={state.skippedCount} />

    {/* Session list */}
    <SessionList state={state} isNarrow={isNarrow} />

    {/* Page indicator */}
    <PageIndicator page={state.page} totalPages={state.totalPages} />

    {/* Error message */}
    <ErrorMessage error={state.error} />

    {/* Resuming status */}
    <ResumingStatus isResuming={state.isResuming} />

    {/* Delete confirmation */}
    <DeleteConfirmation deleteConfirmIndex={state.deleteConfirmIndex} />

    {/* Conversation confirmation */}
    <ConversationConfirmation
      conversationConfirmActive={state.conversationConfirmActive}
    />

    {/* Selection detail (wide mode only) */}
    {!isNarrow && <SelectionDetail session={state.selectedSession} />}

    {/* Controls bar */}
    {isNarrow ? (
      <ControlsBarNarrow
        hasSessions={state.pageItems.length > 0}
        sortOrder={state.sortOrder}
      />
    ) : (
      <ControlsBarWide hasSessions={state.pageItems.length > 0} />
    )}
  </>
);

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

  const handleKeypress = useCallback(
    (key: Parameters<Parameters<typeof useKeypress>[0]>[0]) => {
      state.handleKeypress(key.sequence, key);
    },
    [state],
  );

  useKeypress(handleKeypress, { isActive: true });

  if (state.isLoading) {
    return <LoadingState isNarrow={isNarrow} />;
  }

  if (state.sessions.length === 0 && state.searchTerm === '') {
    return <EmptyState isNarrow={isNarrow} />;
  }

  const content = <SessionContent isNarrow={isNarrow} state={state} />;

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
