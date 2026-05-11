/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import {
  type HistoryItemWithoutId,
  type IndividualToolCallDisplay,
  ToolCallStatus,
} from '../types.js';
import { useCallback, useState } from 'react';
import {
  type Config,
  type GeminiClient,
  isBinary,
  type ShellExecutionResult,
  ShellExecutionService,
  DEFAULT_AGENT_ID,
  type AnsiOutput,
  type ShellOutputEvent,
} from '@vybestack/llxprt-code-core';
import { type PartListUnion } from '@google/genai';
import { type UseHistoryManagerReturn } from './useHistoryManager.js';
import { SHELL_COMMAND_NAME } from '../constants.js';
import { formatMemoryUsage } from '../utils/formatters.js';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Throttle interval for PTY output updates to avoid excessive re-renders.
// Using 100ms provides smooth visual updates without overwhelming React.
export const OUTPUT_UPDATE_INTERVAL_MS = 100;
const MAX_OUTPUT_LENGTH = 10000;

interface ShellExecutionParams {
  commandToExecute: string;
  targetDir: string;
  callId: string;
  initialToolDisplay: IndividualToolCallDisplay;
  userMessageTimestamp: number;
  pwdFilePath: string | undefined;
  config: Config;
  geminiClient: GeminiClient | undefined;
  rawQuery: string;
  abortSignal: AbortSignal;
  onDebugMessage: (message: string) => void;
  addItemToHistory: UseHistoryManagerReturn['addItem'];
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >;
  pendingHistoryItemRef:
    | React.MutableRefObject<HistoryItemWithoutId | null>
    | undefined;
  setLastShellOutputTime: React.Dispatch<React.SetStateAction<number>>;
  setActiveShellPtyId: React.Dispatch<React.SetStateAction<number | null>>;
  setShellInputFocused: (value: boolean) => void;
  terminalWidth: number | undefined;
  terminalHeight: number | undefined;
  resolve: (value: void | PromiseLike<void>) => void;
}

function addShellCommandToGeminiHistory(
  geminiClient: GeminiClient | undefined,
  rawQuery: string,
  resultText: string,
) {
  const modelContent =
    resultText.length > MAX_OUTPUT_LENGTH
      ? resultText.substring(0, MAX_OUTPUT_LENGTH) + '\n... (truncated)'
      : resultText;

  if (geminiClient) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    geminiClient.addHistory({
      role: 'user',
      parts: [
        {
          text: `I ran the following shell command:
\`\`\`sh
${rawQuery}
\`\`\`

This produced the following result:
\`\`\`
${modelContent}
\`\`\``,
        },
      ],
    });
  }
}

function prepareCommandWithPwd(rawQuery: string): {
  commandToExecute: string;
  pwdFilePath: string | undefined;
} {
  const isWindows = os.platform() === 'win32';
  if (isWindows) {
    return { commandToExecute: rawQuery, pwdFilePath: undefined };
  }
  let command = rawQuery.trim();
  const pwdFileName = `shell_pwd_${crypto.randomBytes(6).toString('hex')}.tmp`;
  const pwdFilePath = path.join(os.tmpdir(), pwdFileName);
  if (!command.endsWith(';') && !command.endsWith('&')) {
    command += ';';
  }
  const commandToExecute = `{ ${command} }; __code=$?; pwd > "${pwdFilePath}"; exit $__code`;
  return { commandToExecute, pwdFilePath };
}

function computeDisplayOutput(
  isBinaryStream: boolean,
  binaryBytesReceived: number,
  cumulativeStdout: string | AnsiOutput,
): string | AnsiOutput {
  if (isBinaryStream && binaryBytesReceived > 0) {
    return `[Receiving binary output... ${formatMemoryUsage(
      binaryBytesReceived,
    )} received]`;
  }
  if (isBinaryStream) {
    return '[Binary output detected. Halting stream...]';
  }
  return cumulativeStdout;
}

function updatePendingItemResultDisplay(
  baseItem: HistoryItemWithoutId | null,
  callId: string,
  currentDisplayOutput: string | AnsiOutput,
): HistoryItemWithoutId | null {
  return baseItem?.type === 'tool_group'
    ? {
        ...baseItem,
        tools: baseItem.tools.map((tool) =>
          tool.callId === callId
            ? { ...tool, resultDisplay: currentDisplayOutput }
            : tool,
        ),
      }
    : baseItem;
}

function applyResultDisplayUpdate(
  callId: string,
  currentDisplayOutput: string | AnsiOutput,
  pendingHistoryItemRef:
    | React.MutableRefObject<HistoryItemWithoutId | null>
    | undefined,
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
) {
  if (pendingHistoryItemRef?.current?.type === 'tool_group') {
    const nextItem = updatePendingItemResultDisplay(
      pendingHistoryItemRef.current,
      callId,
      currentDisplayOutput,
    );
    if (nextItem?.type === 'tool_group') {
      pendingHistoryItemRef.current = nextItem;
    }
    setPendingHistoryItem(nextItem);
  } else {
    setPendingHistoryItem((prevItem) =>
      updatePendingItemResultDisplay(prevItem, callId, currentDisplayOutput),
    );
  }
}

function processShellEvent(
  event: ShellOutputEvent,
  config: Config,
  state: {
    isBinaryStream: boolean;
    binaryBytesReceived: number;
    cumulativeStdout: string | AnsiOutput;
  },
): boolean {
  if (event.type === 'data' && state.isBinaryStream) return false;

  let shouldUpdate = false;
  switch (event.type) {
    case 'data':
      if (config.getShouldUseNodePtyShell()) {
        state.cumulativeStdout = event.chunk;
        shouldUpdate = true;
      } else if (
        typeof event.chunk === 'string' &&
        typeof state.cumulativeStdout === 'string'
      ) {
        state.cumulativeStdout += event.chunk;
        shouldUpdate = true;
      }
      break;
    case 'binary_detected':
      state.isBinaryStream = true;
      shouldUpdate = true;
      break;
    case 'binary_progress':
      state.isBinaryStream = true;
      state.binaryBytesReceived = event.bytesReceived;
      shouldUpdate = true;
      break;
    default: {
      throw new Error('An unhandled ShellOutputEvent was found.');
    }
  }
  return shouldUpdate;
}

function createShellEventHandler(
  callId: string,
  config: Config,
  pendingHistoryItemRef:
    | React.MutableRefObject<HistoryItemWithoutId | null>
    | undefined,
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  setLastShellOutputTime: React.Dispatch<React.SetStateAction<number>>,
  state: {
    isBinaryStream: boolean;
    binaryBytesReceived: number;
    cumulativeStdout: string | AnsiOutput;
    lastUpdateTime: number;
  },
) {
  return (event: ShellOutputEvent) => {
    const shouldUpdate = processShellEvent(event, config, state);
    if (!shouldUpdate) return;

    const currentDisplayOutput = computeDisplayOutput(
      state.isBinaryStream,
      state.binaryBytesReceived,
      state.cumulativeStdout,
    );

    const pastThrottle =
      Date.now() - state.lastUpdateTime > OUTPUT_UPDATE_INTERVAL_MS;
    const isPtyData =
      event.type === 'data' && config.getShouldUseNodePtyShell();
    if (!isPtyData && !pastThrottle) return;

    setLastShellOutputTime(Date.now());
    applyResultDisplayUpdate(
      callId,
      currentDisplayOutput,
      pendingHistoryItemRef,
      setPendingHistoryItem,
    );
    state.lastUpdateTime = Date.now();
  };
}

function computeFinalOutput(
  result: ShellExecutionResult,
  mainContent: string,
): { finalOutput: string; finalStatus: ToolCallStatus } {
  let finalOutput = mainContent;
  let finalStatus = ToolCallStatus.Success;

  if (result.error) {
    finalStatus = ToolCallStatus.Error;
    finalOutput = `${result.error.message}\n${finalOutput}`;
  } else if (result.aborted) {
    finalStatus = ToolCallStatus.Canceled;
    finalOutput = `Command was cancelled.\n${finalOutput}`;
  } else if (result.signal != null) {
    finalStatus = ToolCallStatus.Error;
    finalOutput = `Command terminated by signal: ${result.signal}.\n${finalOutput}`;
  } else if (result.exitCode !== 0) {
    finalStatus = ToolCallStatus.Error;
    finalOutput = `Command exited with code ${result.exitCode}.\n${finalOutput}`;
  }
  return { finalOutput, finalStatus };
}

function appendPwdWarning(
  finalOutput: string,
  pwdFilePath: string | undefined,
  targetDir: string,
): string {
  if (!pwdFilePath || !fs.existsSync(pwdFilePath)) return finalOutput;
  const finalPwd = fs.readFileSync(pwdFilePath, 'utf8').trim();
  if (finalPwd && finalPwd !== targetDir) {
    const warning = `WARNING: shell mode is stateless; the directory change to '${finalPwd}' will not persist.`;
    return `${warning}\n\n${finalOutput}`;
  }
  return finalOutput;
}

function handleShellResult(
  result: ShellExecutionResult,
  initialToolDisplay: IndividualToolCallDisplay,
  pwdFilePath: string | undefined,
  targetDir: string,
  userMessageTimestamp: number,
  addItemToHistory: UseHistoryManagerReturn['addItem'],
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  geminiClient: GeminiClient | undefined,
  rawQuery: string,
) {
  setPendingHistoryItem(null);

  let mainContent: string;
  if (isBinary(result.rawOutput)) {
    mainContent = '[Command produced binary output, which is not shown.]';
  } else {
    mainContent = result.output.trim() || '(Command produced no output)';
  }

  const { finalOutput: rawOutput, finalStatus } = computeFinalOutput(
    result,
    mainContent,
  );
  const finalOutput = appendPwdWarning(rawOutput, pwdFilePath, targetDir);

  const finalToolDisplay: IndividualToolCallDisplay = {
    ...initialToolDisplay,
    status: finalStatus,
    resultDisplay: finalOutput,
  };

  addItemToHistory(
    {
      type: 'tool_group',
      agentId: DEFAULT_AGENT_ID,
      tools: [finalToolDisplay],
    } as HistoryItemWithoutId,
    userMessageTimestamp,
  );

  addShellCommandToGeminiHistory(geminiClient, rawQuery, finalOutput);
}

function handleShellError(
  err: unknown,
  userMessageTimestamp: number,
  addItemToHistory: UseHistoryManagerReturn['addItem'],
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
) {
  setPendingHistoryItem(null);
  const errorMessage = err instanceof Error ? err.message : String(err);
  addItemToHistory(
    {
      type: 'error',
      text: `An unexpected error occurred: ${errorMessage}`,
    },
    userMessageTimestamp,
  );
}

function shellCleanup(
  abortSignal: AbortSignal,
  abortHandler: () => void,
  pwdFilePath: string | undefined,
  setActiveShellPtyId: React.Dispatch<React.SetStateAction<number | null>>,
  setShellInputFocused: (value: boolean) => void,
  resolve: (value: void | PromiseLike<void>) => void,
) {
  abortSignal.removeEventListener('abort', abortHandler);
  if (pwdFilePath && fs.existsSync(pwdFilePath)) {
    fs.unlinkSync(pwdFilePath);
  }
  setActiveShellPtyId(null);
  setShellInputFocused(false);
  resolve();
}

function attachPtyIdToPendingItem(
  pid: number,
  callId: string,
  initialToolDisplay: IndividualToolCallDisplay,
  pendingHistoryItemRef:
    | React.MutableRefObject<HistoryItemWithoutId | null>
    | undefined,
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  setActiveShellPtyId: React.Dispatch<React.SetStateAction<number | null>>,
) {
  setActiveShellPtyId(pid);
  setPendingHistoryItem((prevItem) => {
    const nextItem: HistoryItemWithoutId =
      prevItem?.type === 'tool_group'
        ? {
            ...prevItem,
            tools: prevItem.tools.map((tool) =>
              tool.callId === callId ? { ...tool, ptyId: pid } : tool,
            ),
          }
        : {
            type: 'tool_group',
            agentId: DEFAULT_AGENT_ID,
            tools: [{ ...initialToolDisplay, ptyId: pid }],
          };

    if (pendingHistoryItemRef) {
      pendingHistoryItemRef.current = nextItem;
    }

    return nextItem;
  });
}

function handleExecutionResult(
  result: Promise<ShellExecutionResult>,
  params: ShellExecutionParams,
  abortHandler: () => void,
) {
  result
    .then((shellResult: ShellExecutionResult) => {
      handleShellResult(
        shellResult,
        params.initialToolDisplay,
        params.pwdFilePath,
        params.targetDir,
        params.userMessageTimestamp,
        params.addItemToHistory,
        params.setPendingHistoryItem,
        params.geminiClient,
        params.rawQuery,
      );
    })
    .catch((err) => {
      handleShellError(
        err,
        params.userMessageTimestamp,
        params.addItemToHistory,
        params.setPendingHistoryItem,
      );
    })
    .finally(() => {
      shellCleanup(
        params.abortSignal,
        abortHandler,
        params.pwdFilePath,
        params.setActiveShellPtyId,
        params.setShellInputFocused,
        params.resolve,
      );
    });
}

async function initiateShellExecution(params: ShellExecutionParams) {
  const state: {
    isBinaryStream: boolean;
    binaryBytesReceived: number;
    cumulativeStdout: string | AnsiOutput;
    lastUpdateTime: number;
  } = {
    isBinaryStream: false,
    binaryBytesReceived: 0,
    cumulativeStdout: '',
    lastUpdateTime: -Infinity,
  };

  const eventHandler = createShellEventHandler(
    params.callId,
    params.config,
    params.pendingHistoryItemRef,
    params.setPendingHistoryItem,
    params.setLastShellOutputTime,
    state,
  );

  const effectiveTerminalWidth =
    params.config.getPtyTerminalWidth() ?? params.terminalWidth;
  const effectiveTerminalHeight =
    params.config.getPtyTerminalHeight() ?? params.terminalHeight;

  return ShellExecutionService.execute(
    params.commandToExecute,
    params.targetDir,
    eventHandler,
    params.abortSignal,
    params.config.getShouldUseNodePtyShell(),
    {
      ...params.config.getShellExecutionConfig(),
      terminalWidth: effectiveTerminalWidth,
      terminalHeight: effectiveTerminalHeight,
    },
  );
}

async function runShellExecution(params: ShellExecutionParams) {
  const initialPendingItem: HistoryItemWithoutId = {
    type: 'tool_group',
    agentId: DEFAULT_AGENT_ID,
    tools: [params.initialToolDisplay],
  };

  if (params.pendingHistoryItemRef) {
    params.pendingHistoryItemRef.current = initialPendingItem;
  }
  params.setPendingHistoryItem(initialPendingItem);

  let executionPid: number | undefined;

  const abortHandler = () => {
    params.onDebugMessage(
      `Aborting shell command (PID: ${executionPid ?? 'unknown'})`,
    );
  };
  params.abortSignal.addEventListener('abort', abortHandler, { once: true });

  params.onDebugMessage(
    `Executing in ${params.targetDir}: ${params.commandToExecute}`,
  );

  try {
    const { pid, result } = await initiateShellExecution(params);
    executionPid = pid;

    if (pid != null && pid > 0) {
      attachPtyIdToPendingItem(
        pid,
        params.callId,
        params.initialToolDisplay,
        params.pendingHistoryItemRef,
        params.setPendingHistoryItem,
        params.setActiveShellPtyId,
      );
    }

    handleExecutionResult(result, params, abortHandler);
  } catch (err) {
    handleShellError(
      err,
      params.userMessageTimestamp,
      params.addItemToHistory,
      params.setPendingHistoryItem,
    );
    shellCleanup(
      params.abortSignal,
      abortHandler,
      params.pwdFilePath,
      params.setActiveShellPtyId,
      params.setShellInputFocused,
      params.resolve,
    );
  }
}

function buildInitialToolDisplay(
  callId: string,
  rawQuery: string,
): IndividualToolCallDisplay {
  return {
    callId,
    name: SHELL_COMMAND_NAME,
    description: rawQuery,
    status: ToolCallStatus.Executing,
    resultDisplay: '',
    confirmationDetails: undefined,
  };
}

/**
 * Hook to process shell commands.
 * Orchestrates command execution and updates history and agent context.
 */
export const useShellCommandProcessor = (
  addItemToHistory: UseHistoryManagerReturn['addItem'],
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  onExec: (command: Promise<void>) => void | Promise<void>,
  onDebugMessage: (message: string) => void,
  config: Config,
  geminiClient: GeminiClient | undefined,
  setShellInputFocused: (value: boolean) => void,
  terminalWidth?: number,
  terminalHeight?: number,
  pendingHistoryItemRef?: React.MutableRefObject<HistoryItemWithoutId | null>,
) => {
  const [activeShellPtyId, setActiveShellPtyId] = useState<number | null>(null);
  const [lastShellOutputTime, setLastShellOutputTime] = useState(0);
  const handleShellCommand = useCallback(
    (rawQuery: PartListUnion, abortSignal: AbortSignal): boolean => {
      if (typeof rawQuery !== 'string' || rawQuery.trim() === '') {
        return false;
      }
      setShellInputFocused(true);

      const userMessageTimestamp = Date.now();
      const callId = `shell-${userMessageTimestamp}`;
      addItemToHistory(
        { type: 'user_shell', text: rawQuery },
        userMessageTimestamp,
      );

      const targetDir = config.getTargetDir();
      const { commandToExecute, pwdFilePath } = prepareCommandWithPwd(rawQuery);

      const initialToolDisplay = buildInitialToolDisplay(callId, rawQuery);

      const execPromise = new Promise<void>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        runShellExecution({
          commandToExecute,
          targetDir,
          callId,
          initialToolDisplay,
          userMessageTimestamp,
          pwdFilePath,
          config,
          geminiClient,
          rawQuery,
          abortSignal,
          onDebugMessage,
          addItemToHistory,
          setPendingHistoryItem,
          pendingHistoryItemRef,
          setLastShellOutputTime,
          setActiveShellPtyId,
          setShellInputFocused,
          terminalWidth,
          terminalHeight,
          resolve,
        });
      });

      void onExec(execPromise);
      return true;
    },
    [
      config,
      onDebugMessage,
      addItemToHistory,
      setPendingHistoryItem,
      onExec,
      geminiClient,
      setShellInputFocused,
      terminalWidth,
      terminalHeight,
      pendingHistoryItemRef,
    ],
  );

  return { handleShellCommand, activeShellPtyId, lastShellOutputTime };
};
