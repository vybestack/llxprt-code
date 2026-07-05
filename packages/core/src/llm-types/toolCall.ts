/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Neutral tool-call and tool-result content types with legacy
 * PartListUnion conversion operating on structural `unknown` input.
 *
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-004
 * @pseudocode lines 60-78
 */

import type {
  ContentBlock,
  TextBlock,
  MediaBlock,
  ToolResponseBlock,
} from '../services/history/IContent.js';
import { isRecord } from './jsonSchema.js';

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-004.1
 * @pseudocode line 60
 */
export interface ToolCallRequest {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-004.2
 * @pseudocode line 61
 */
export type ToolResultContent = string | ContentBlock[];

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-004.3
 * @pseudocode line 62
 */
export type ConversionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Convert a legacy PartListUnion-shaped value (typed as `unknown` with
 * structural checks — no @google/genai import) to neutral
 * {@link ToolResultContent}.
 *
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-004.3
 * @pseudocode lines 63-71
 */
export function toolResultContentFromLegacyPartListUnion(
  input: unknown,
): ConversionResult<ToolResultContent> {
  if (typeof input === 'string') {
    return { ok: true, value: input };
  }

  if (Array.isArray(input)) {
    return convertArray(input);
  }

  const r = partLikeToBlock(input);
  if (!r.ok) {
    return r;
  }
  return { ok: true, value: [r.value] };
}

function convertArray(input: unknown[]): ConversionResult<ToolResultContent> {
  const blocks: ContentBlock[] = [];
  for (const item of input) {
    if (typeof item === 'string') {
      blocks.push(textBlock(item));
      continue;
    }
    const r = partLikeToBlock(item);
    if (!r.ok) {
      return r;
    }
    blocks.push(r.value);
  }
  return { ok: true, value: blocks };
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-004.3
 * @pseudocode lines 72-78
 */
function partLikeToBlock(item: unknown): ConversionResult<ContentBlock> {
  if (!isRecord(item)) {
    return {
      ok: false,
      error: `unsupported tool result part: ${describeValue(item)}`,
    };
  }

  if ('text' in item && typeof item['text'] === 'string') {
    return { ok: true, value: textBlock(item['text']) };
  }

  if ('inlineData' in item) {
    const inline = item['inlineData'];
    if (
      !isRecord(inline) ||
      typeof inline['mimeType'] !== 'string' ||
      typeof inline['data'] !== 'string'
    ) {
      return {
        ok: false,
        error:
          'malformed inlineData: expected { mimeType: string, data: string }',
      };
    }
    const block: MediaBlock = {
      type: 'media',
      mimeType: inline['mimeType'],
      data: inline['data'],
      encoding: 'base64',
    };
    return { ok: true, value: block };
  }

  if ('fileData' in item) {
    const fileData = item['fileData'];
    if (!isRecord(fileData) || typeof fileData['fileUri'] !== 'string') {
      return {
        ok: false,
        error: 'malformed fileData: expected { fileUri: string }',
      };
    }
    const mimeType =
      typeof fileData['mimeType'] === 'string'
        ? fileData['mimeType']
        : 'application/octet-stream';
    const block: MediaBlock = {
      type: 'media',
      mimeType,
      data: fileData['fileUri'],
      encoding: 'url',
    };
    return { ok: true, value: block };
  }

  if ('functionResponse' in item) {
    return functionResponseToBlock(item['functionResponse']);
  }

  return {
    ok: false,
    error: `unsupported tool result part shape: keys [${Object.keys(item).join(', ')}]`,
  };
}

function functionResponseToBlock(
  fnResp: unknown,
): ConversionResult<ContentBlock> {
  if (!isRecord(fnResp) || typeof fnResp['name'] !== 'string') {
    return {
      ok: false,
      error: 'malformed functionResponse: expected { name: string }',
    };
  }
  const rawResponse = 'response' in fnResp ? fnResp['response'] : {};
  // Top-level JSON-serializability guard: reject values whose typeof cannot
  // survive JSON serialization. This is intentionally a shallow check — it
  // does not attempt deep/circular validation. The absent-key case
  // (no 'response' property) defaults to {}; only an explicitly-present
  // undefined value is rejected.
  if (
    typeof rawResponse === 'function' ||
    typeof rawResponse === 'symbol' ||
    typeof rawResponse === 'bigint' ||
    typeof rawResponse === 'undefined'
  ) {
    return {
      ok: false,
      error: 'malformed functionResponse: response must be JSON-serializable',
    };
  }
  const block: ToolResponseBlock = {
    type: 'tool_response',
    callId: typeof fnResp['id'] === 'string' ? fnResp['id'] : '',
    toolName: fnResp['name'],
    result: rawResponse,
  };
  return { ok: true, value: block };
}

function textBlock(text: string): TextBlock {
  return { type: 'text', text };
}

function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
