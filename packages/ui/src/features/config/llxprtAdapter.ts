import {
  GeminiEventType,
  type ServerGeminiStreamEvent,
  type ToolCallResponseInfo,
  type ServerToolCallConfirmationDetails,
} from '@vybestack/llxprt-code-core';
import { getLogger } from '../../lib/logger';
import type { AdapterEvent, ToolConfirmationType } from '../../types/events';
import type { ConfigSession } from './configSession';
import { createConfigSession } from './configSession';

export type {
  AdapterEvent,
  ToolPendingEvent,
  ToolConfirmationEvent,
} from '../../types/events';

/** Branded type for provider identifiers */
export type ProviderKey = string & { readonly __brand?: 'ProviderKey' };

export interface ProviderInfo {
  readonly id: ProviderKey;
  readonly label: string;
}

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
}

export interface SessionConfig {
  readonly provider: ProviderKey;
  readonly model?: string;
  readonly apiKey?: string;
  readonly keyFilePath?: string;
  readonly baseUrl?: string;
  readonly ephemeralSettings?: Record<string, unknown>;
}

const logger = getLogger('nui:llxprt-adapter');

/**
 * Extract display output from a tool result
 */
function getToolResultOutput(info: ToolCallResponseInfo): string {
  if (info.error) {
    return info.error.message;
  }
  if (info.resultDisplay === undefined) {
    return '(no output)';
  }
  if (typeof info.resultDisplay === 'string') {
    return info.resultDisplay;
  }
  // AnsiOutput (array of lines) - extract plain text
  if (Array.isArray(info.resultDisplay)) {
    return info.resultDisplay
      .map((line) => line.map((token) => token.text).join(''))
      .join('\n');
  }
  // FileDiff or FileRead object - format as diff
  const diff = info.resultDisplay;
  if ('fileDiff' in diff) {
    return `File: ${diff.fileName}\n${diff.fileDiff}`;
  }
  return `File: ${diff.fileName}`;
}

/**
 * Map confirmation details type to our simplified type
 */
function getConfirmationType(
  details: ServerToolCallConfirmationDetails,
): ToolConfirmationType {
  const type = details.details.type as string;
  if (type === 'edit') return 'edit';
  if (type === 'exec') return 'exec';
  if (type === 'mcp') return 'mcp';
  if (type === 'info') return 'info';
  return 'exec'; // fallback for unknown types
}

/**
 * Get the preview content for a confirmation dialog
 */
function getConfirmationPreview(
  details: ServerToolCallConfirmationDetails,
): string {
  const d = details.details;
  const type = d.type as string;
  if (type === 'edit' && 'fileDiff' in d) {
    return d.fileDiff || `Edit: ${d.filePath}`;
  }
  if (type === 'exec' && 'command' in d) {
    return d.command;
  }
  if (type === 'mcp' && 'toolDisplayName' in d) {
    return `MCP Tool: ${d.toolDisplayName} (server: ${d.serverName})`;
  }
  if (type === 'info' && 'prompt' in d) {
    const urls =
      'urls' in d && Array.isArray(d.urls) && d.urls.length > 0
        ? `\nURLs: ${d.urls.join(', ')}`
        : '';
    return d.prompt + urls;
  }
  return '';
}

/**
 * Get the question text for a confirmation dialog
 */
function getConfirmationQuestion(
  details: ServerToolCallConfirmationDetails,
): string {
  const d = details.details;
  const type = d.type as string;
  if (type === 'edit') {
    return 'Apply this change?';
  }
  if (type === 'exec' && 'rootCommand' in d) {
    return `Allow execution of: '${d.rootCommand}'?`;
  }
  if (type === 'mcp' && 'toolDisplayName' in d) {
    return `Allow ${d.toolDisplayName}?`;
  }
  if (type === 'info') {
    return 'Allow this fetch?';
  }
  return 'Allow this action?';
}

export function transformEvent(event: ServerGeminiStreamEvent): AdapterEvent {
  if (event.type === GeminiEventType.Content) {
    return { type: 'text_delta', text: event.value };
  }
  if (event.type === GeminiEventType.Thought) {
    return { type: 'thinking_delta', text: event.value.description };
  }
  if (event.type === GeminiEventType.ToolCallRequest) {
    return {
      type: 'tool_pending',
      id: event.value.callId,
      name: event.value.name,
      params: event.value.args,
    };
  }
  if (event.type === GeminiEventType.ToolCallResponse) {
    const info = event.value;
    return {
      type: 'tool_result',
      id: info.callId,
      success: !info.error,
      output: getToolResultOutput(info),
      errorMessage: info.error?.message,
    };
  }
  if (event.type === GeminiEventType.ToolCallConfirmation) {
    const details = event.value;
    // Extract correlationId from the details object
    const correlationId =
      (details.details as { correlationId?: string }).correlationId ??
      details.request.callId;
    return {
      type: 'tool_confirmation',
      id: details.request.callId,
      name: details.request.name,
      params: details.request.args,
      confirmationType: getConfirmationType(details),
      question: getConfirmationQuestion(details),
      preview: getConfirmationPreview(details),
      canAllowAlways: true, // Will be determined by trusted folder status in future
      correlationId,
    };
  }
  if (event.type === GeminiEventType.UserCancelled) {
    // This is a general cancellation, not tied to a specific tool
    return { type: 'complete' };
  }
  if (event.type === GeminiEventType.Finished) {
    return { type: 'complete' };
  }
  if (event.type === GeminiEventType.Error) {
    return { type: 'error', message: event.value.error.message };
  }
  logger.warn('Unhandled event type received', { eventType: event.type });
  return { type: 'unknown', raw: event };
}

export async function* transformStream(
  stream: AsyncIterable<ServerGeminiStreamEvent>,
): AsyncGenerator<AdapterEvent> {
  for await (const event of stream) {
    yield transformEvent(event);
  }
}

export async function* sendMessageWithSession(
  session: ConfigSession,
  prompt: string,
  signal?: AbortSignal,
): AsyncGenerator<AdapterEvent> {
  const client = session.getClient();
  const promptId = `nui-prompt-${Date.now()}`;
  const stream = client.sendMessageStream(
    prompt,
    signal ?? new AbortController().signal,
    promptId,
  );

  for await (const event of stream) {
    yield transformEvent(event);
  }
}

const PROVIDER_ENTRIES: ProviderInfo[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'openai-responses', label: 'OpenAI Responses' },
  { id: 'openai-vercel', label: 'OpenAI (Vercel)' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'synthetic', label: 'Synthetic' },
  { id: 'qwen', label: 'Qwen' },
  { id: 'qwen-openai', label: 'Qwen (OpenAI API)' },
];

export function listProviders(): ProviderInfo[] {
  // Deduplicate by id in case we add aliases dynamically later
  const seen = new Set<string>();
  return PROVIDER_ENTRIES.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}

export async function listModels(session: SessionConfig): Promise<ModelInfo[]> {
  // Model listing not currently implemented.
  // ConfigSession doesn't expose getProvider() directly.
  // Future implementation should use ConfigSession.config.getProviderManager()
  logger.debug('listModels called but not implemented', {
    provider: session.provider,
  });
  return Promise.resolve([]);
}

export async function* sendMessage(
  sessionConfig: SessionConfig,
  prompt: string,
  signal?: AbortSignal,
): AsyncGenerator<AdapterEvent> {
  const session = createConfigSession({
    model: sessionConfig.model ?? 'gemini-2.5-flash',
    workingDir: process.cwd(),
    provider: sessionConfig.provider,
    baseUrl: sessionConfig.baseUrl,
    authKeyfile: sessionConfig.keyFilePath,
    apiKey: sessionConfig.apiKey,
  });

  await session.initialize();

  yield* sendMessageWithSession(session, prompt, signal);
}
