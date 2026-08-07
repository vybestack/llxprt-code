/**
 * @license
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

import type { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';

export interface StatefulConversation {
  enabled: boolean;
  parentId: string | undefined;
  content: IContent[];
}

const RESPONSES_STATEFUL_KEY = 'responses-stateful';

export function computeStatefulConversation(
  options: NormalizedGenerateChatOptions,
  content: IContent[],
  invocationEphemerals: Record<string, unknown>,
  explicitUserStore: boolean | undefined,
  isCodex: boolean,
  logger: DebugLogger,
): StatefulConversation {
  const ephemeralValue = invocationEphemerals[RESPONSES_STATEFUL_KEY];
  const requested =
    (typeof ephemeralValue === 'boolean'
      ? ephemeralValue
      : options.invocation.getModelBehavior<boolean>(
          RESPONSES_STATEFUL_KEY,
        )) === true;
  if (!requested || explicitUserStore === false || isCodex) {
    if (isCodex && requested) {
      logger.debug(
        () =>
          'responses-stateful ignored in Codex mode: Codex must remain stateless.',
      );
    }
    return { enabled: false, parentId: undefined, content };
  }

  let parentIndex = -1;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const entry = content[index];
    if (
      entry.speaker === 'ai' &&
      entry.metadata?.responsesStored === true &&
      typeof entry.metadata.id === 'string' &&
      entry.metadata.id !== ''
    ) {
      parentIndex = index;
      break;
    }
  }

  if (parentIndex === -1) {
    logger.debug(
      () => 'responses-stateful starting a new stored conversation.',
    );
    return { enabled: true, parentId: undefined, content };
  }

  const trimmedContent = content.slice(parentIndex + 1);
  if (trimmedContent.length === 0) {
    logger.debug(
      () =>
        'responses-stateful has no content after its parent; using full history.',
    );
    return { enabled: false, parentId: undefined, content };
  }

  return {
    enabled: true,
    parentId: content[parentIndex].metadata?.id,
    content: trimmedContent,
  };
}

export function applyStatefulConversation(
  request: OpenAIResponsesRequest,
  stateful: StatefulConversation,
  explicitUserStore: boolean | undefined,
  isCodex: boolean,
  logger: DebugLogger,
): void {
  if (explicitUserStore === false) {
    request.store = false;
    delete request.previous_response_id;
    logger.debug(
      () => 'responses-stateful disabled because the user set store=false.',
    );
    return;
  }
  if (isCodex) {
    logger.debug(
      () => 'responses-stateful ignored in Codex mode: preserving store=false.',
    );
    return;
  }
  if (!stateful.enabled) return;

  request.store = true;
  if (stateful.parentId !== undefined) {
    request.previous_response_id = stateful.parentId;
  }
  logger.debug(
    () =>
      `responses-stateful activated: previous_response_id=${stateful.parentId ?? 'none'}, store=true.`,
  );
}
