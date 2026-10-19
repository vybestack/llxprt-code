/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../../../services/history/IContent.js';
/** Wire shapes mirroring the provider encoder's Content/Part output. */
interface WireToolCallPart {
  functionCall: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
}
interface WireToolResponsePart {
  functionResponse: {
    id?: string;
    name?: string;
    response?: Record<string, unknown>;
  };
}
interface WireTextPart {
  text: string;
}
type WirePart = WireTextPart | WireToolCallPart | WireToolResponsePart;
interface WireContent {
  role: string;
  parts: WirePart[];
}
/**
 * Tool parameters are `unknown` on IContent; the wire shape requires a JSON
 * object (the same invariant the deleted encoder asserted). Guarded
 * narrowing with an empty-object fallback for non-object values.
 */
function argsAsRecord(parameters: unknown): Record<string, unknown> {
  if (typeof parameters === 'object' && parameters !== null) {
    return Object.fromEntries(Object.entries(parameters));
  }
  return {};
}
/** Encode one IContent into the provider wire shape (mirrors the deleted outbound encoder). */
function encodeContentForProvider(content: IContent): WireContent | null {
  const parts: WirePart[] = [];
  for (const block of content.blocks) {
    if (block.type === 'text') {
      parts.push({ text: block.text });
    } else if (block.type === 'tool_call') {
      parts.push({
        functionCall: {
          id: block.id,
          name: block.name,
          args: argsAsRecord(block.parameters),
        },
      });
    } else if (block.type === 'tool_response') {
      parts.push({
        functionResponse: {
          id: block.callId,
          name: block.toolName,
          response: { status: 'success', result: block.result },
        },
      });
    }
  }
  if (parts.length === 0) {
    return null;
  }
  return {
    role: content.speaker === 'ai' ? 'model' : 'user',
    parts,
  };
}
/** Encode curated history into the provider wire shape. */
export function encodeForProvider(contents: IContent[]): WireContent[] {
  const encoded: WireContent[] = [];
  for (const content of contents) {
    const wire = encodeContentForProvider(content);
    if (wire !== null) {
      encoded.push(wire);
    }
  }
  return encoded;
}
