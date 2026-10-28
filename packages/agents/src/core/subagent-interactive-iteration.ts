/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { iContentFromBlocks } from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  checkOutputBudget,
  checkTerminationConditions,
  processInteractiveTextResponse,
  recordTurnOutputTokens,
  type ExecutionLoopContext,
} from './subagentExecution.js';
import type { ToolCallRequestInfo } from './turn.js';

interface InteractiveTurnResult {
  responseParts: ToolCallRequestInfo[];
  textResponse: string;
  currentTurn: number;
  reportedOutputTokens: number | undefined;
  outputCharacterCount: number;
}
interface InteractiveIterationOperations {
  runTurn: () => Promise<InteractiveTurnResult>;
  processTools: (calls: ToolCallRequestInfo[]) => Promise<IContent[] | null>;
  checkGoal: (
    turnCounter: number,
    currentTurn: number,
  ) => Promise<IContent[] | null>;
}
export async function runInteractiveIteration(
  turnCounter: number,
  startTime: number,
  execCtx: ExecutionLoopContext,
  signal: AbortSignal,
  operations: InteractiveIterationOperations,
): Promise<
  | { action: 'stop' }
  | { action: 'abort' }
  | { action: 'continue'; messages: IContent[]; turnCounter: number }
> {
  if (checkTerminationConditions(turnCounter, startTime, execCtx).shouldStop)
    return { action: 'stop' };
  const nextTurnCounter = turnCounter + 1;
  const {
    responseParts,
    textResponse,
    currentTurn,
    reportedOutputTokens,
    outputCharacterCount,
  } = await operations.runTurn();
  if (signal.aborted) return { action: 'abort' };
  recordTurnOutputTokens(execCtx, reportedOutputTokens, outputCharacterCount);
  if (checkOutputBudget(execCtx).shouldStop) return { action: 'stop' };
  processInteractiveTextResponse(textResponse, execCtx);
  const toolMessages = await operations.processTools(responseParts);
  if (toolMessages)
    return {
      action: 'continue',
      messages: toolMessages,
      turnCounter: nextTurnCounter,
    };
  const nextMessages = await operations.checkGoal(nextTurnCounter, currentTurn);
  if (!nextMessages) return { action: 'stop' };
  return {
    action: 'continue',
    messages: nextMessages,
    turnCounter: nextTurnCounter,
  };
}

export function buildSubagentInitialMessages(
  context: ContextState,
): IContent[] {
  const prompts = context.get('task_behaviour_prompts');
  const behaviourPrompts = Array.isArray(prompts)
    ? prompts.filter((prompt): prompt is string => typeof prompt === 'string')
    : [];
  const initialInstruction =
    behaviourPrompts.length > 0
      ? behaviourPrompts.join('\n')
      : 'Follow the task directives provided in the system prompt.';
  return [
    iContentFromBlocks([{ type: 'text', text: initialInstruction }], 'human'),
  ];
}
