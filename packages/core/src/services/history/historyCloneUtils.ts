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

import type { IContent, ContentBlock } from './IContent.js';
import type { DebugLogger } from '../../debug/index.js';

/**
 * Sanitize provider history for serialization while cloning its top-level data.
 * The copy isolates content and block references because getCurated() returns
 * stored contents directly and in-process BeforeModel hooks may mutate them.
 * Metadata retains its existing shallow-copy behavior.
 */
export function sanitizeProviderHistoryForSerialization(
  contents: IContent[],
): IContent[] {
  return contents.map((content) => ({
    speaker: content.speaker,
    blocks: content.blocks.map(cloneBlock),
    metadata: content.metadata ? { ...content.metadata } : {},
  }));
}

/** Clone a single block, sanitizing tool_call/tool_response payloads. */
function cloneBlock(block: ContentBlock): ContentBlock {
  if (block.type === 'tool_call') {
    return {
      ...block,
      parameters: sanitizeParams(block.parameters),
      ...(block.providerMetadata === undefined
        ? {}
        : { providerMetadata: structuredClone(block.providerMetadata) }),
    };
  }
  if (block.type === 'tool_response') {
    return {
      ...block,
      result: sanitizeParams(block.result),
      ...(block.providerMetadata === undefined
        ? {}
        : { providerMetadata: structuredClone(block.providerMetadata) }),
    };
  }
  if (block.type === 'media') {
    return {
      ...block,
      ...(block.providerMetadata !== undefined
        ? { providerMetadata: structuredClone(block.providerMetadata) }
        : {}),
    };
  }
  return cloneGenericBlock(block);
}

/** Clone non-tool blocks via structured clone with spread fallback. */
function cloneGenericBlock(block: ContentBlock): ContentBlock {
  try {
    return JSON.parse(JSON.stringify(block)) as ContentBlock;
  } catch {
    return { ...block };
  }
}

/**
 * Sanitize a value to remove circular references.
 */
export function sanitizeParams(params: unknown): unknown {
  const seen = new WeakSet();

  const sanitize = (obj: unknown): unknown => {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (seen.has(obj)) {
      return { _circular: true };
    }
    seen.add(obj);
    if (Array.isArray(obj)) {
      return obj.map((item) => sanitize(item));
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitize(value);
    }
    return result;
  };

  try {
    return sanitize(params);
  } catch {
    return {
      _note: 'Parameters contained circular references and were sanitized',
    };
  }
}

export function sanitizeParamsWithLogger(
  params: unknown,
  logger: DebugLogger,
): unknown {
  const sanitized = sanitizeParams(params);
  if (
    typeof sanitized === 'object' &&
    sanitized !== null &&
    '_note' in sanitized
  ) {
    logger.debug('Parameters were sanitized due to serialization issues');
  }
  return sanitized;
}
