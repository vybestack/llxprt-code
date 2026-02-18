import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useState } from 'react';
import type { MessageRole } from '../ui/components/messages';
import type { ToolStatus, ToolConfirmationType } from '../types/events';
import type { ToolCallConfirmationDetails } from '@vybestack/llxprt-code-core';

type Role = MessageRole;
/**
 * Stream state represents whether the system is waiting for user input or busy with LLM operations.
 * - "idle": Ready for user input
 * - "busy": Processing (streaming from model, executing tools, or waiting for tool responses)
 */
type StreamState = 'idle' | 'busy';

interface ChatMessage {
  id: string;
  kind: 'message';
  role: Role;
  text: string;
  profileName?: string;
}

interface ToolBlockLegacy {
  id: string;
  kind: 'tool';
  lines: string[];
  isBatch: boolean;
  scrollable?: boolean;
  maxHeight?: number;
  streaming?: boolean;
}

interface ToolCall {
  id: string;
  kind: 'toolcall';
  /** The tool call ID from the backend */
  callId: string;
  name: string;
  params: Record<string, unknown>;
  status: ToolStatus;
  /** Tool output after execution */
  output?: string;
  /** Error message if failed */
  errorMessage?: string;
  /** Confirmation details if awaiting approval */
  confirmation?: {
    confirmationType: ToolConfirmationType;
    question: string;
    preview: string;
    canAllowAlways: boolean;
    /** Full confirmation details from CoreToolScheduler (includes diff for edits) */
    coreDetails?: ToolCallConfirmationDetails;
  };
}

type ToolBlock = ToolBlockLegacy | ToolCall;

type ChatEntry = ChatMessage | ToolBlock;

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type {
  Role,
  StreamState,
  ChatMessage,
  ToolBlock,
  ToolBlockLegacy,
  ToolCall,
  ChatEntry,
  StateSetter,
};

export interface UseChatStoreReturn {
  entries: ChatEntry[];
  appendMessage: (role: Role, text: string, profileName?: string) => string;
  appendToMessage: (id: string, text: string) => void;
  appendToolBlock: (tool: {
    lines: string[];
    isBatch: boolean;
    scrollable?: boolean;
    maxHeight?: number;
    streaming?: boolean;
  }) => string;
  appendToolCall: (
    callId: string,
    name: string,
    params: Record<string, unknown>,
  ) => string;
  updateToolCall: (
    callId: string,
    update: Partial<Omit<ToolCall, 'id' | 'kind' | 'callId'>>,
  ) => void;
  findToolCallByCallId: (callId: string) => ToolCall | undefined;
  clearEntries: () => void;
  promptCount: number;
  setPromptCount: StateSetter<number>;
  responderWordCount: number;
  setResponderWordCount: StateSetter<number>;
  streamState: StreamState;
  setStreamState: StateSetter<StreamState>;
  updateToolBlock: (
    id: string,
    mutate: (block: ToolBlock) => ToolBlock,
  ) => void;
}

export function useChatStore(makeId: () => string): UseChatStoreReturn {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [promptCount, setPromptCount] = useState(0);
  const [responderWordCount, setResponderWordCount] = useState(0);
  const [streamState, setStreamState] = useState<StreamState>('idle');

  const appendMessage = useCallback(
    (role: Role, text: string, profileName?: string): string => {
      const id = makeId();
      setEntries((prev) => [
        ...prev,
        {
          id,
          kind: 'message',
          role,
          text,
          ...(profileName !== undefined ? { profileName } : {}),
        },
      ]);
      return id;
    },
    [makeId],
  );

  const appendToMessage = useCallback((id: string, text: string): void => {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.kind !== 'message' || entry.id !== id) {
          return entry;
        }
        return { ...entry, text: entry.text + text };
      }),
    );
  }, []);

  const appendToolBlock = useCallback(
    (tool: {
      lines: string[];
      isBatch: boolean;
      scrollable?: boolean;
      maxHeight?: number;
      streaming?: boolean;
    }) => {
      const id = makeId();
      setEntries((prev) => [
        ...prev,
        {
          id,
          kind: 'tool',
          lines: tool.lines,
          isBatch: tool.isBatch,
          scrollable: tool.scrollable,
          maxHeight: tool.maxHeight,
          streaming: tool.streaming,
        },
      ]);
      return id;
    },
    [makeId],
  );

  const appendToolCall = useCallback(
    (callId: string, name: string, params: Record<string, unknown>): string => {
      const id = makeId();
      setEntries((prev) => [
        ...prev,
        {
          id,
          kind: 'toolcall',
          callId,
          name,
          params,
          status: 'pending' as const,
        },
      ]);
      return id;
    },
    [makeId],
  );

  const updateToolCall = useCallback(
    (
      callId: string,
      update: Partial<Omit<ToolCall, 'id' | 'kind' | 'callId'>>,
    ) => {
      setEntries((prev) =>
        prev.map((item) => {
          if (item.kind !== 'toolcall' || item.callId !== callId) {
            return item;
          }
          return { ...item, ...update };
        }),
      );
    },
    [],
  );

  const findToolCallByCallId = useCallback(
    (callId: string): ToolCall | undefined => {
      return entries.find(
        (entry): entry is ToolCall =>
          entry.kind === 'toolcall' && entry.callId === callId,
      );
    },
    [entries],
  );

  const updateToolBlock = useCallback(
    (id: string, mutate: (block: ToolBlock) => ToolBlock) => {
      setEntries((prev) =>
        prev.map((item) => {
          if (
            (item.kind !== 'tool' && item.kind !== 'toolcall') ||
            item.id !== id
          ) {
            return item;
          }
          return mutate(item);
        }),
      );
    },
    [],
  );

  const clearEntries = useCallback(() => {
    setEntries([]);
    setPromptCount(0);
    setResponderWordCount(0);
  }, []);

  return {
    entries,
    appendMessage,
    appendToMessage,
    appendToolBlock,
    appendToolCall,
    updateToolCall,
    findToolCallByCallId,
    clearEntries,
    promptCount,
    setPromptCount,
    responderWordCount,
    setResponderWordCount,
    streamState,
    setStreamState,
    updateToolBlock,
  };
}
