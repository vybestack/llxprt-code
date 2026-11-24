/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { PreparedUserTurn } from './mediaAdmissionSeam.js';

/** The views of a streamed send's user input and the turn it already belongs to. */
export interface StreamUserInput {
  readonly prepared: PreparedUserTurn | undefined;
  /** What the provider is sent. */
  readonly providerUserContent: IContent | IContent[];
  /** What history records. */
  readonly historyUserContent: IContent | IContent[];
  /** The turn identity the input already carries, if it carries one. */
  readonly establishedTurnId: string | undefined;
}

function isPreparedUserTurn(
  value: IContent | IContent[] | PreparedUserTurn,
): value is PreparedUserTurn {
  return !Array.isArray(value) && 'userContents' in value;
}

export function resolveStreamUserInput(
  userInput: IContent | IContent[] | PreparedUserTurn,
): StreamUserInput {
  const views = isPreparedUserTurn(userInput)
    ? {
        prepared: userInput,
        providerUserContent: userInput.userIContents,
        historyUserContent: userInput.userContents,
      }
    : {
        prepared: undefined,
        providerUserContent: userInput,
        historyUserContent: userInput,
      };
  const carried = (
    Array.isArray(views.providerUserContent)
      ? views.providerUserContent
      : [views.providerUserContent]
  ).find((content) => content.metadata?.turnId !== undefined)?.metadata?.turnId;
  return { ...views, establishedTurnId: views.prepared?.turnId ?? carried };
}
