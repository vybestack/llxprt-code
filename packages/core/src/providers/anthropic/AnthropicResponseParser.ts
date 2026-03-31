/**
 * Anthropic Response Parser Module
 * Parses non-streaming responses from the Anthropic API
 *
 * @issue #1572 - Decomposing AnthropicProvider (Step 4 - Part B)
 */

import type Anthropic from '@anthropic-ai/sdk';
import type {
  IContent,
  ContentBlock,
  TextBlock,
  ToolCallBlock,
  ThinkingBlock,
} from '../../services/history/IContent.js';
import type { ProviderToolset } from '../IProvider.js';
import { normalizeToHistoryToolId } from '../utils/toolIdNormalization.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';
import { coerceParametersToSchema } from '../../utils/parameterCoercion.js';

export type ResponseParserOptions = {
  isOAuth: boolean;
  tools: ProviderToolset | undefined;
  unprefixToolName: (name: string, isOAuth: boolean) => string;
  findToolSchema: (
    tools: ProviderToolset | undefined,
    name: string,
    isOAuth: boolean,
  ) => unknown;
  cacheLogger: { debug: (fn: () => string) => void };
};

function parseContentBlocks(
  content: Anthropic.Message['content'],
  options: ResponseParserOptions,
): ContentBlock[] {
  const { isOAuth, tools, unprefixToolName, findToolSchema } = options;
  const blocks: ContentBlock[] = [];

  for (const contentBlock of content) {
    if (contentBlock.type === 'text') {
      blocks.push({ type: 'text', text: contentBlock.text } as TextBlock);
    } else if (contentBlock.type === 'tool_use') {
      const unprefixName = unprefixToolName(contentBlock.name, isOAuth);

      let processedParameters =
        typeof contentBlock.input === 'string'
          ? processToolParameters(contentBlock.input, unprefixName, 'anthropic')
          : (contentBlock.input as Record<string, unknown>);

      const toolSchema = findToolSchema(tools, unprefixName, isOAuth);
      if (
        toolSchema &&
        processedParameters &&
        typeof processedParameters === 'object' &&
        typeof toolSchema === 'object'
      ) {
        processedParameters = coerceParametersToSchema(
          processedParameters,
          toolSchema as Record<string, unknown>,
        );
      }

      blocks.push({
        type: 'tool_call',
        id: normalizeToHistoryToolId(contentBlock.id),
        name: unprefixName,
        parameters: processedParameters,
      } as ToolCallBlock);
    } else if (contentBlock.type === 'thinking') {
      const thinkingContentBlock = contentBlock as {
        type: 'thinking';
        thinking: string;
        signature?: string;
      };
      blocks.push({
        type: 'thinking',
        thought: thinkingContentBlock.thinking,
        sourceField: 'thinking',
        signature: thinkingContentBlock.signature,
      } as ThinkingBlock);
    } else if (contentBlock.type === 'redacted_thinking') {
      const redactedBlock = contentBlock as {
        type: 'redacted_thinking';
        data: string;
      };
      blocks.push({
        type: 'thinking',
        thought: '[redacted]',
        sourceField: 'thinking',
        signature: redactedBlock.data,
      } as ThinkingBlock);
    }
  }

  return blocks;
}

function extractUsageMetadata(
  usage:
    | {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      }
    | undefined,
  cacheLogger: { debug: (fn: () => string) => void },
): IContent['metadata'] {
  if (!usage) {
    return undefined;
  }

  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;

  cacheLogger.debug(
    () =>
      `[AnthropicProvider non-streaming] Setting usage metadata: cacheRead=${cacheRead}, cacheCreation=${cacheCreation}, raw values: cache_read_input_tokens=${usage.cache_read_input_tokens}, cache_creation_input_tokens=${usage.cache_creation_input_tokens}`,
  );

  if (cacheRead > 0 || cacheCreation > 0) {
    cacheLogger.debug(() => {
      const hitRate =
        cacheRead + usage.input_tokens > 0
          ? (cacheRead / (cacheRead + usage.input_tokens)) * 100
          : 0;
      return `Cache metrics: read=${cacheRead}, creation=${cacheCreation}, hit_rate=${hitRate.toFixed(1)}%`;
    });
  }

  return {
    usage: {
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens,
      totalTokens: usage.input_tokens + usage.output_tokens,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheCreation,
    },
  };
}

/**
 * Parses a non-streaming Anthropic response into IContent
 * Processes text, tool calls, and thinking blocks
 */
export function parseAnthropicResponse(
  message: Anthropic.Message,
  options: ResponseParserOptions,
): IContent {
  const blocks = parseContentBlocks(message.content, options);

  const result: IContent = {
    speaker: 'ai',
    blocks,
  };

  const metadata = extractUsageMetadata(
    message.usage as
      | {
          input_tokens: number;
          output_tokens: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        }
      | undefined,
    options.cacheLogger,
  );

  if (metadata) {
    result.metadata = metadata;
  }

  // Propagate stop_reason so downstream turn handling and telemetry
  // receive a terminal signal (issue #1844).
  if (message.stop_reason) {
    if (!result.metadata) {
      result.metadata = {};
    }
    result.metadata.stopReason = message.stop_reason;
  }

  return result;
}
