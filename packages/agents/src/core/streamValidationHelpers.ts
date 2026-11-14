import { settleStreamUsage } from './streamUsageSettlement.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type {
  IContent,
  ContentBlock,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponseOutcome } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import {
  isSchemaDepthError,
  InvalidStreamError,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { isStructuredError } from '@vybestack/llxprt-code-core/utils/quotaErrorDetection.js';
import { hasCycleInSchema } from '@vybestack/llxprt-code-tools/tools/tools.js';
import { convertBlocksToParts } from './MessageConverter.js';
import { isMissingFinishReason } from './streamResponseHelpers.js';
import type { ConversationManager } from './ConversationManager.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { ToolRegistryView } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ReasoningInclusionPolicy } from './runtimePorts.js';

/**
 * Extracts visible text from ContentBlock[].
 * @plan:PLAN-20260707-AGENTNEUTRAL.P09
 */
export function extractResponseTextFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text' && block.text !== '')
    .map((block) => (block as { text: string }).text)
    .join('')
    .trim();
}

/**
 * Analyzes ContentBlock[] for outcome characteristics.
 * @plan:PLAN-20260707-AGENTNEUTRAL.P09
 */
export function analyzeBlocksOutcome(
  blocks: ContentBlock[],
  includeThoughts: boolean,
): ResponseOutcome {
  let hasVisibleText = false;
  let hasThinking = false;
  let hasToolCalls = false;
  for (const block of blocks) {
    if (block.type === 'text' && block.text !== '') {
      hasVisibleText = true;
    } else if (block.type === 'thinking' && includeThoughts) {
      hasThinking = true;
    } else if (block.type === 'tool_call') {
      hasToolCalls = true;
    }
  }
  return {
    hasVisibleText,
    hasThinking,
    hasToolCalls,
    isActionable: hasVisibleText || hasToolCalls,
  };
}

/**
 * Validates stream completion and throws on invalid responses.
 *
 * The canonical finishReason `'error'` maps from multiple raw provider stop
 * reasons (MALFORMED_FUNCTION_CALL, UNEXPECTED_TOOL_CALL, others). To avoid
 * mislabeling every `'error'` as MALFORMED_FUNCTION_CALL, the caller passes
 * `rawStopReason` from the accumulated ModelOutput. MALFORMED is retained
 * only when the raw reason is explicitly MALFORMED_FUNCTION_CALL (or absent
 * for backward compat). Other error sub-reasons are classified neutrally.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P09
 */
export function validateStreamCompletion(
  logger: DebugLogger,
  userInput: IContent | IContent[],
  outcome: ResponseOutcome,
  finishReason: string | undefined,
  responseText: string | number,
  rawStopReason?: string,
): void {
  const responseTextLength =
    typeof responseText === 'number' ? responseText : responseText.length;
  const inputArray = Array.isArray(userInput) ? userInput : [userInput];
  const isToolContinuationInput = inputArray.some((content) =>
    content.blocks.some((b) => b.type === 'tool_response'),
  );

  const hasMissingFinishAndNoText =
    isMissingFinishReason(finishReason) && !outcome.hasVisibleText;
  const isEmptyResponse = responseTextLength === 0;
  const noRelevantContent =
    !outcome.hasToolCalls && !isToolContinuationInput && !outcome.hasThinking;
  const isInvalidResponse =
    noRelevantContent && (hasMissingFinishAndNoText || isEmptyResponse);

  if (isInvalidResponse) {
    if (isMissingFinishReason(finishReason) && !outcome.hasVisibleText) {
      logger.warn(
        () =>
          `[stream:terminal] validation failed: missing finishReason and text`,
        {
          hasToolCall: outcome.hasToolCalls,
          hasTextResponse: outcome.hasVisibleText,
          hasThinkingResponse: outcome.hasThinking,
          finishReason,
          responseTextLength,
          isToolContinuationInput,
        },
      );
      throw new InvalidStreamError(
        'Model stream ended without a finish reason and no text response.',
        'NO_FINISH_REASON_NO_TEXT',
      );
    }
    logger.warn(
      () => `[stream:terminal] validation failed: empty response text`,
      {
        hasToolCall: outcome.hasToolCalls,
        hasTextResponse: outcome.hasVisibleText,
        hasThinkingResponse: outcome.hasThinking,
        finishReason,
        responseTextLength,
        isToolContinuationInput,
      },
    );
    throw new InvalidStreamError(
      'Model stream ended with empty response text.',
      'NO_RESPONSE_TEXT',
    );
  }

  const isMalformedError =
    rawStopReason === undefined || rawStopReason === 'MALFORMED_FUNCTION_CALL';

  if (finishReason === 'error' && isMalformedError) {
    logger.warn(
      () =>
        `[stream:terminal] validation failed: malformed function call finishReason`,
      {
        hasToolCall: outcome.hasToolCalls,
        hasTextResponse: outcome.hasVisibleText,
        hasThinkingResponse: outcome.hasThinking,
        finishReason,
        rawStopReason,
        responseTextLength,
        isToolContinuationInput,
      },
    );
    throw new InvalidStreamError(
      'Model stream ended with malformed function call.',
      'MALFORMED_FUNCTION_CALL',
    );
  }
}

/**
 * Records history with streaming usage stats.
 * @plan:PLAN-20260707-AGENTNEUTRAL.P09
 */
export async function recordHistoryWithUsage(
  logger: DebugLogger,
  conversationManager: ConversationManager,
  historyService: HistoryService,
  compressionHandler: CompressionHandler,
  reasoningInclusion: ReasoningInclusionPolicy,
  userInput: IContent | IContent[],
  acc: ModelOutput,
  userInputFlags?: {
    userInputWasArray?: boolean;
    userInputWasFunctionResponse?: boolean;
  },
  afterPublication?: () => void | Promise<void>,
  origin?: object,
  sealResponse?: () => Promise<void>,
): Promise<void> {
  const includeThoughts = reasoningInclusion.includeInContext();

  const outputBlocks = includeThoughts
    ? acc.content.blocks
    : acc.content.blocks.filter((block) => block.type !== 'thinking');

  const modelOutput: IContent[] = [
    {
      speaker: 'ai',
      blocks: convertBlocksToParts(outputBlocks),
    },
  ];

  const streamingUsage: UsageStats | null = acc.usage
    ? {
        promptTokens: acc.usage.promptTokens,
        completionTokens: acc.usage.completionTokens,
        totalTokens: acc.usage.totalTokens,
      }
    : null;

  const settle = (): Promise<void> =>
    settleStreamUsage(
      historyService,
      logger,
      streamingUsage?.promptTokens ?? null,
      compressionHandler.lastPromptTokenCount,
      afterPublication,
    );
  await conversationManager.recordHistory(
    userInput,
    modelOutput,
    acc.afcHistory,
    streamingUsage,
    { ...userInputFlags, responseAlreadyRecorded: sealResponse !== undefined },
    sealResponse === undefined ? settle : undefined,
    origin,
  );
  if (sealResponse !== undefined) {
    await sealResponse();
    await settle();
  }
}

/**
 * Enriches schema depth errors with diagnostic information.
 * @plan:PLAN-20260707-AGENTNEUTRAL.P09
 */
export function enrichSchemaDepthError(
  error: unknown,
  tools: ToolRegistryView,
): void {
  if (isStructuredError(error) && isSchemaDepthError(error.message)) {
    const toolNames = tools.listToolNames();
    const cyclicSchemaTools: string[] = [];

    for (const toolName of toolNames) {
      const metadata = tools.getToolMetadata(toolName);
      if (
        metadata?.parameterSchema &&
        hasCycleInSchema(metadata.parameterSchema)
      ) {
        cyclicSchemaTools.push(toolName);
      }
    }

    if (cyclicSchemaTools.length > 0) {
      const extraDetails =
        `\n\nThis error was probably caused by cyclic schema references in one of the following tools, try disabling them:\n\n - ` +
        cyclicSchemaTools.join(`\n - `) +
        `\n`;
      try {
        error.message += extraDetails;
      } catch {
        // Some framework errors expose a non-writable message; keep the original error.
      }
    }
  }
}
