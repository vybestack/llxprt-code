/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { observeRequestRepresentation } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import type { Content, Part } from './geminiWireTypes.js';

type FetchFunction = typeof globalThis.fetch;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected Gemini SDK envelope');
  return value;
}

/** Matches the installed Google SDK projection of the parts our converter emits. */
export function geminiWireContents(content: Content, model: string): Content[] {
  const parts = content.parts ?? [];
  const results = parts.filter((part) => part.functionResponse !== undefined);
  const rest = parts.filter((part) => part.functionResponse === undefined);
  const contents: Content[] = [];
  if (results.length > 0)
    contents.push({
      role: 'user',
      parts: results.map((part) => {
        const response = part.functionResponse;
        if (response === undefined)
          throw new Error('Missing Gemini function response');
        return {
          functionResponse: {
            id: response.id ?? response.name ?? '',
            name: response.name ?? '',
            response: {
              name: response.name ?? '',
              content: response.response ?? {},
            },
          },
        };
      }),
    });
  if (rest.length === 0) return contents;
  if (content.role !== 'model') {
    contents.push({
      role: 'user',
      parts: rest
        .filter(
          (part) =>
            part.text !== undefined ||
            part.inlineData !== undefined ||
            part.fileData !== undefined,
        )
        .map((part) => {
          if (part.fileData !== undefined)
            return {
              fileData: {
                mimeType: part.fileData.mimeType ?? 'application/octet-stream',
                fileUri: new URL(part.fileData.fileUri ?? '').toString(),
              },
            };
          if (part.inlineData !== undefined)
            return {
              inlineData: {
                mimeType:
                  part.inlineData.mimeType ?? 'application/octet-stream',
                data: part.inlineData.data ?? '',
              },
            };
          return { text: part.text ?? '' };
        }),
    });
    return contents;
  }
  const modern =
    /(^|\/)gemini-/i.test(model) &&
    !/(^|\/)gemini-(?:[12](?:[.-]|$)|pro(?:-vision)?$|robotics-er-1\.5(?:[.-]|$))/i.test(
      model,
    );
  let signed = false;
  const converted: Part[] = [];
  for (const part of rest) {
    if (part.functionCall !== undefined) {
      const call = part.functionCall;
      const signature =
        part.thoughtSignature ??
        (modern && !signed ? 'skip_thought_signature_validator' : undefined);
      if (part.thoughtSignature !== undefined) signed = true;
      converted.push({
        functionCall: {
          id: call.id ?? call.name ?? '',
          name: call.name ?? '',
          args: call.args ?? {},
        },
        ...(signature === undefined ? {} : { thoughtSignature: signature }),
      });
    } else if ((part.text ?? '').length > 0) {
      converted.push({
        text: part.text ?? '',
        ...(part.thought === true
          ? {
              thought: true,
              ...(part.thoughtSignature === undefined
                ? {}
                : { thoughtSignature: part.thoughtSignature }),
            }
          : {}),
      });
    }
  }
  contents.push({ role: 'model', parts: converted });
  return contents;
}

/** Replace only the SDK's empty contents field, preserving envelope key order. */
export function createStreamedGeminiFetch(
  contents: () => AsyncIterable<Content>,
  requestFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
  model: string,
  systemInstruction: string | undefined,
  onRequestBytes?: (bytes: number) => void,
  metadata?: Record<string, unknown>,
): FetchFunction {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (typeof init?.body !== 'string')
        throw new Error('Expected Gemini SDK envelope');
      observeRequestRepresentation('serialized', init.body, metadata);
      const envelope = observeRequestRepresentation(
        'envelope',
        record(JSON.parse(init.body)),
        metadata,
      );
      let bytes = 0;
      const pieces = async function* (): AsyncGenerator<Uint8Array> {
        yield Buffer.from('{');
        let field = false;
        for (const [key, value] of Object.entries(envelope)) {
          if (field) yield Buffer.from(',');
          field = true;
          yield Buffer.from(`${JSON.stringify(key)}:`);
          if (key !== 'contents') {
            yield Buffer.from(JSON.stringify(value));
            continue;
          }
          yield Buffer.from('[');
          let comma = false;
          for await (const content of contents()) {
            for (const wire of geminiWireContents(content, model)) {
              if (
                !comma &&
                model.toLowerCase().startsWith('gemma-') &&
                wire.role === 'user' &&
                systemInstruction
              )
                wire.parts?.unshift({ text: systemInstruction + '\n\n' });
              if (comma) yield Buffer.from(',');
              comma = true;
              observeRequestRepresentation('wire', wire, metadata);
              yield Buffer.from(
                observeRequestRepresentation(
                  'serialized',
                  JSON.stringify(wire),
                  metadata,
                ),
              );
            }
          }
          yield Buffer.from(']');
        }
        yield Buffer.from('}');
      };
      const iterator = pieces();
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller): Promise<void> {
            try {
              const next = await iterator.next();
              if (next.done) {
                controller.close();
                return;
              }
              bytes += next.value.byteLength;
              controller.enqueue(
                observeRequestRepresentation('buffer', next.value, metadata),
              );
            } catch (error) {
              controller.error(error);
            }
          },
          async cancel(): Promise<void> {
            await iterator.return(undefined);
          },
        },
        { highWaterMark: 0 },
      );
      const headers = new Headers(init.headers);
      headers.delete('content-length');
      const requestInit = { ...init, headers, body, duplex: 'half' };
      try {
        return await requestFetch(input, requestInit);
      } finally {
        await iterator.return(undefined);
        onRequestBytes?.(bytes);
      }
    },
    {
      preconnect: (url: string | URL) => {
        const preconnect: unknown = Reflect.get(requestFetch, 'preconnect');
        if (typeof preconnect === 'function')
          Reflect.apply(preconnect, requestFetch, [url]);
      },
    },
  );
}
