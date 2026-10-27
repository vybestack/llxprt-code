/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { observeRequestRepresentation } from '../utils/requestScopedBody.js';
import type { ModelMessage, ToolResultPart } from 'ai';
import {
  ProgressiveJsonBody,
  jsonValueBytes,
} from '../utils/progressive-json-body.js';
import { forwardPreconnect } from '../utils/fetchPreconnect.js';
import { reportRequestSize } from '../logging/requestSizeReport.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected SDK request envelope');
  return value;
}

function assistantWire(
  message: Extract<ModelMessage, { role: 'assistant' }>,
): unknown {
  const reasoning =
    'reasoning_content' in message &&
    typeof message.reasoning_content === 'string'
      ? { reasoning_content: message.reasoning_content }
      : {};
  if (typeof message.content === 'string')
    return { role: 'assistant', content: message.content, ...reasoning };
  const text = message.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('');
  const calls = message.content.flatMap((part) => {
    if (part.type !== 'tool-call') return [];
    return [
      {
        id: part.toolCallId,
        type: 'function',
        function: {
          name: part.toolName,
          arguments: JSON.stringify(isRecord(part.input) ? part.input : {}),
        },
      },
    ];
  });
  return {
    role: 'assistant',
    ...reasoning,
    content: calls.length > 0 ? text || null : text,
    ...(calls.length > 0 ? { tool_calls: calls } : {}),
  };
}

function toolOutput(output: ToolResultPart['output']): string {
  if (output.type === 'text' || output.type === 'error-text')
    return output.value;
  if (output.type === 'execution-denied')
    return output.reason ?? 'Tool call execution denied.';
  return JSON.stringify(output.value);
}

/** The subset produced by messageConversion, with the installed SDK's wire ordering. */
export function vercelWireMessages(
  message: ModelMessage,
  systemRole: string,
): unknown[] {
  switch (message.role) {
    case 'system':
      return [{ role: systemRole, content: message.content }];
    case 'user': {
      if (typeof message.content === 'string')
        return [{ role: 'user', content: message.content }];
      const content = message.content.map((part) => {
        if (part.type === 'text') return { type: 'text', text: part.text };
        if (part.type !== 'image' || typeof part.image !== 'string')
          throw new Error('Unexpected Vercel user part');
        return { type: 'image_url', image_url: { url: part.image } };
      });
      if (content.length === 1 && content[0].type === 'text')
        return [{ role: 'user', content: content[0].text }];
      return [{ role: 'user', content }];
    }
    case 'assistant':
      return [assistantWire(message)];
    case 'tool':
      return message.content.flatMap((part) =>
        part.type === 'tool-result'
          ? [
              {
                role: 'tool',
                tool_call_id: part.toolCallId,
                content: toolOutput(part.output),
              },
            ]
          : [],
      );
    default:
      throw new Error('Unexpected Vercel message role');
  }
}

async function* wireMessages(
  initial: unknown[],
  messages: () => AsyncIterable<ModelMessage>,
): AsyncIterable<unknown> {
  const first: unknown = initial[0];
  const systemRole =
    isRecord(first) && first['role'] === 'developer' ? 'developer' : 'system';
  // The final entry is the sentinel required by AI SDK prompt validation.
  yield* initial.slice(0, -1);
  for await (const message of messages())
    yield* vercelWireMessages(message, systemRole);
}

async function* envelopeBytes(
  envelope: Record<string, unknown>,
  messages: () => AsyncIterable<ModelMessage>,
  metadata: Record<string, unknown>,
): AsyncIterable<Uint8Array> {
  const initial = envelope['messages'];
  if (!Array.isArray(initial))
    throw new Error('Expected SDK messages envelope');
  yield Buffer.from('{');
  let field = false;
  for (const [key, value] of Object.entries(envelope)) {
    if (field) yield Buffer.from(',');
    field = true;
    yield Buffer.from(`${JSON.stringify(key)}:`);
    if (key !== 'messages') {
      yield* jsonValueBytes(value);
      continue;
    }
    yield Buffer.from('[');
    let comma = false;
    for await (const wire of wireMessages(initial, messages)) {
      if (comma) yield Buffer.from(',');
      comma = true;
      yield* jsonValueBytes(
        observeRequestRepresentation('wire', wire, metadata),
      );
    }
    yield Buffer.from(']');
  }
  yield Buffer.from('}');
}

/** Only the small SDK envelope is parsed. History is never handed to its builder. */
export function createStreamedVercelFetch(
  innerFetch: typeof fetch,
  messages: () => AsyncIterable<ModelMessage>,
  metadata: Record<string, unknown>,
): typeof fetch {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (typeof init?.body !== 'string')
        throw new Error('Expected SDK request envelope');
      observeRequestRepresentation('serialized', init.body, metadata);
      const envelope = observeRequestRepresentation(
        'envelope',
        record(JSON.parse(init.body)),
        metadata,
      );
      let bytes = 0;
      const body = new ProgressiveJsonBody(async function* () {
        for await (const chunk of envelopeBytes(envelope, messages, metadata)) {
          bytes += chunk.byteLength;
          yield observeRequestRepresentation('buffer', chunk, metadata);
        }
      });
      const handle = body.createStreamHandle();
      const headers = new Headers(init.headers);
      headers.delete('content-length');
      try {
        const requestInit = {
          ...init,
          headers,
          body: handle.stream,
          duplex: 'half',
        };
        return await innerFetch(input, requestInit);
      } finally {
        reportRequestSize(metadata, bytes);
        await body.dispose();
      }
    },
    forwardPreconnect(() => innerFetch),
  );
}
