/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef } from 'react';
import {
  type Config,
  type EditorType,
  type GeminiClient,
  type MessageBus,
  type RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import { type PartListUnion } from '@google/genai';
import { type LoadedSettings } from '../../../config/settings.js';
import {
  type HistoryItemWithoutId,
  type SlashCommandProcessorResult,
} from '../../types.js';
import { type UseHistoryManagerReturn } from '../useHistoryManager.js';
import { type TrackedToolCall } from '../useReactToolScheduler.js';
import { mapToDisplay as mapTrackedToolCallsToDisplay } from '../toolMapping.js';
import { useToolCompletionHandler } from './toolCompletionHandler.js';
import { useStreamState } from './useStreamState.js';
import { useSubmitQuery, type UseSubmitQueryDeps } from './useSubmitQuery.js';
import {
  useCancellation,
  useShellCommandSetup,
  useStreamingState,
  useToolSchedulerSetup,
} from './useGeminiStreamLifecycle.js';

export interface GeminiStreamOrchestrationDeps {
  geminiClient: GeminiClient;
  addItem: UseHistoryManagerReturn['addItem'];
  config: Config;
  settings: LoadedSettings;
  onDebugMessage: (message: string) => void;
  handleSlashCommand: (
    cmd: PartListUnion,
  ) => Promise<SlashCommandProcessorResult | false>;
  shellModeActive: boolean;
  getPreferredEditor: () => EditorType | undefined;
  onAuthError: () => void;
  performMemoryRefresh: () => Promise<void>;
  onEditorClose: () => void;
  onCancelSubmit: (shouldRestorePrompt?: boolean) => void;
  setShellInputFocused: (value: boolean) => void;
  terminalWidth?: number;
  terminalHeight?: number;
  onTodoPause?: () => void;
  onEditorOpen: () => void;
  recordingIntegration?: RecordingIntegration;
  runtimeMessageBus?: MessageBus;
}

export interface GeminiStreamOrchestrationResult {
  st: ReturnType<typeof useStreamState>;
  streamingState: ReturnType<typeof useStreamingState>;
  submitQuery: ReturnType<typeof useSubmitQuery>['submitQuery'];
  pendingToolCallGroupDisplay: HistoryItemWithoutId | undefined;
  toolCalls: TrackedToolCall[];
  lastToolOutputTime: number;
  lastShellOutputTime: number;
  cancelOngoingRequest: () => void;
  activeShellPtyId: number | null;
}

interface ToolSchedulerState {
  scheduler: ReturnType<typeof useToolSchedulerSetup>;
  toolCalls: TrackedToolCall[];
  scheduleToolCalls: UseSubmitQueryDeps['scheduleToolCalls'];
  markToolsAsSubmitted: (callIds: string[]) => void;
  cancelAllToolCalls: () => void;
  lastToolOutputTime: number;
}

export function useGeminiStreamOrchestration(
  args: GeminiStreamOrchestrationDeps,
): GeminiStreamOrchestrationResult {
  const st = useStreamState(args.addItem, args.config);
  const loopDetectedRef = useRef(false);
  const scheduler = useToolSchedulerState(args, st);
  const pendingToolCallGroupDisplay = usePendingToolGroupDisplay(
    scheduler.toolCalls,
  );
  const shell = useShell(args, st);
  const streamingState = useStreamingState(
    st.isResponding,
    scheduler.toolCalls,
  );
  const { cancelOngoingRequest } = useCancellation(
    streamingState,
    st.turnCancelledRef,
    st.abortControllerRef,
    scheduler.cancelAllToolCalls,
    st.pendingHistoryItemRef,
    st.flushPendingHistoryItem,
    args.addItem,
    st.setPendingHistoryItem,
    args.onCancelSubmit,
    st.setIsResponding,
    st.queuedSubmissionsRef,
  );
  const submitQuery = useSubmitForStream(
    args,
    st,
    scheduler.scheduleToolCalls,
    shell.handleShellCommand,
    loopDetectedRef,
    streamingState,
  );
  const { handleCompletedTools } = useToolCompletionHandler(
    st.isResponding,
    st.turnCancelledRef,
    st.submitQueryRef,
    args.geminiClient,
    scheduler.markToolsAsSubmitted,
    args.performMemoryRefresh,
    args.onTodoPause,
  );
  scheduler.scheduler.handleCompletedToolsRef.current = handleCompletedTools;
  return buildResult(
    st,
    streamingState,
    submitQuery,
    scheduler,
    shell,
    pendingToolCallGroupDisplay,
    cancelOngoingRequest,
  );
}

function useToolSchedulerState(
  args: GeminiStreamOrchestrationDeps,
  st: ReturnType<typeof useStreamState>,
): ToolSchedulerState {
  const scheduler = useToolSchedulerSetup(
    args.config,
    st.setPendingHistoryItem,
    args.getPreferredEditor,
    args.onEditorClose,
    args.onEditorOpen,
    args.runtimeMessageBus,
    args.addItem,
    args.geminiClient,
  );
  const [
    toolCalls,
    scheduleToolCalls,
    markToolsAsSubmitted,
    cancelAllToolCalls,
    lastToolOutputTime,
  ] = scheduler.toolSchedulerResult;
  return {
    scheduler,
    toolCalls,
    scheduleToolCalls,
    markToolsAsSubmitted,
    cancelAllToolCalls,
    lastToolOutputTime,
  };
}

function useShell(
  args: GeminiStreamOrchestrationDeps,
  st: ReturnType<typeof useStreamState>,
) {
  return useShellCommandSetup({
    addItem: args.addItem,
    setPendingHistoryItem: st.setPendingHistoryItem,
    setIsResponding: st.setIsResponding,
    onDebugMessage: args.onDebugMessage,
    config: args.config,
    geminiClient: args.geminiClient,
    setShellInputFocused: args.setShellInputFocused,
    terminalWidth: args.terminalWidth,
    terminalHeight: args.terminalHeight,
    pendingHistoryItemRef: st.pendingHistoryItemRef,
  });
}

function useSubmitForStream(
  args: GeminiStreamOrchestrationDeps,
  st: ReturnType<typeof useStreamState>,
  scheduleToolCalls: UseSubmitQueryDeps['scheduleToolCalls'],
  handleShellCommand: (query: string, signal: AbortSignal) => boolean,
  loopDetectedRef: React.MutableRefObject<boolean>,
  streamingState: ReturnType<typeof useStreamingState>,
) {
  const { submitQuery } = useSubmitQuery(
    buildSubmitQueryDeps({
      args,
      st,
      scheduleToolCalls,
      handleShellCommand,
      loopDetectedRef,
      streamingState,
    }),
  );
  return submitQuery;
}

function usePendingToolGroupDisplay(toolCalls: TrackedToolCall[]) {
  return useMemo(
    () =>
      toolCalls.length > 0
        ? mapTrackedToolCallsToDisplay(toolCalls)
        : undefined,
    [toolCalls],
  );
}

function buildResult(
  st: ReturnType<typeof useStreamState>,
  streamingState: ReturnType<typeof useStreamingState>,
  submitQuery: ReturnType<typeof useSubmitQuery>['submitQuery'],
  scheduler: ToolSchedulerState,
  shell: ReturnType<typeof useShell>,
  pendingToolCallGroupDisplay: HistoryItemWithoutId | undefined,
  cancelOngoingRequest: () => void,
): GeminiStreamOrchestrationResult {
  return {
    st,
    streamingState,
    submitQuery,
    pendingToolCallGroupDisplay,
    toolCalls: scheduler.toolCalls,
    lastToolOutputTime: scheduler.lastToolOutputTime,
    lastShellOutputTime: shell.lastShellOutputTime,
    cancelOngoingRequest,
    activeShellPtyId: shell.activeShellPtyId,
  };
}

interface BuildSubmitQueryDepsArgs {
  args: GeminiStreamOrchestrationDeps;
  st: ReturnType<typeof useStreamState>;
  scheduleToolCalls: UseSubmitQueryDeps['scheduleToolCalls'];
  handleShellCommand: (query: string, signal: AbortSignal) => boolean;
  loopDetectedRef: React.MutableRefObject<boolean>;
  streamingState: ReturnType<typeof useStreamingState>;
}

function buildSubmitQueryDeps({
  args,
  st,
  scheduleToolCalls,
  handleShellCommand,
  loopDetectedRef,
  streamingState,
}: BuildSubmitQueryDepsArgs): UseSubmitQueryDeps {
  return {
    config: args.config,
    geminiClient: args.geminiClient,
    addItem: args.addItem,
    settings: args.settings,
    onDebugMessage: args.onDebugMessage,
    onCancelSubmit: args.onCancelSubmit,
    onAuthError: args.onAuthError,
    recordingIntegration: args.recordingIntegration,
    sanitizeContent: st.sanitizeContent,
    flushPendingHistoryItem: st.flushPendingHistoryItem,
    pendingHistoryItemRef: st.pendingHistoryItemRef,
    thinkingBlocksRef: st.thinkingBlocksRef,
    turnCancelledRef: st.turnCancelledRef,
    queuedSubmissionsRef: st.queuedSubmissionsRef,
    setPendingHistoryItem: st.setPendingHistoryItem,
    setIsResponding: st.setIsResponding,
    setInitError: st.setInitError,
    setThought: st.setThought,
    setLastGeminiActivityTime: st.setLastGeminiActivityTime,
    scheduleToolCalls,
    abortActiveStream: st.abortActiveStream,
    handleShellCommand,
    handleSlashCommand: args.handleSlashCommand,
    logger: st.logger,
    shellModeActive: args.shellModeActive,
    loopDetectedRef,
    lastProfileNameRef: st.lastProfileNameRef,
    abortControllerRef: st.abortControllerRef,
    submitQueryRef: st.submitQueryRef,
    isResponding: st.isResponding,
    streamingState,
  };
}
