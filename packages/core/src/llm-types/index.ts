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
 * Barrel for the neutral llm-types layer.
 *
 * The IContent content-model types are re-exported type-only here so that
 * consumers importing from this barrel get the complete picture in one place.
 * The type-only re-export avoids runtime symbol duplication with core's main
 * index.ts (which already does `export * from './services/history/IContent.js'`).
 *
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-013.1
 */

export * from './finishReasons.js';
export * from './jsonSchema.js';
export * from './toolDeclaration.js';
export * from './toolCall.js';
export * from './modelEnvelope.js';
export * from './modelRequest.js';
export * from './providerApiError.js';
export * from './tokensAndEmbeddings.js';
export * from './grounding.js';
export * from './geminiContent.js';

/**
 * Neutral tool-call/tool-response ID canonicalization contract.
 *
 * The canonical-ID helpers live in services/history/canonicalToolIds.ts and
 * are provider-independent; they are re-exported here so downstream packages
 * (policy, MCP, message-bus, scheduler paths) can consume the contract from
 * the neutral llm-types surface without reaching into history internals.
 *
 * @plan PLAN-20260702-LLMTYPES.P06
 * @requirement REQ-012.3
 */
export {
  canonicalizeToolCallId,
  canonicalizeToolResponseId,
  type CanonicalToolIdInput,
} from '../services/history/canonicalToolIds.js';

export type {
  IContent,
  ContentBlock,
  ContentMetadata,
  UsageStats,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
  MediaBlock,
  ThinkingBlock,
  CodeBlock,
} from '../services/history/IContent.js';
