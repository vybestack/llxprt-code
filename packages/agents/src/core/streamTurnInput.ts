/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { PreparedUserTurn } from './mediaAdmissionSeam.js';

function isPreparedUserTurn(
  value: IContent | IContent[] | PreparedUserTurn,
): value is PreparedUserTurn {
  return !Array.isArray(value) && 'userContents' in value;
}

export interface SplitUserTurnInput {
  readonly prepared: PreparedUserTurn | undefined;
  /** Content sent to the provider for this attempt. */
  readonly providerUserContent: IContent | IContent[];
  /** Content committed to history when the attempt succeeds. */
  readonly historyUserContent: IContent | IContent[];
  /** Turn id already carried by the input (prepared turn first, then content metadata). */
  readonly inputTurnId: string | undefined;
}

/** Separates the provider-facing and history-facing user content of one send. */
export function splitUserTurnInput(
  userInput: IContent | IContent[] | PreparedUserTurn,
): SplitUserTurnInput {
  if (isPreparedUserTurn(userInput)) {
    return {
      prepared: userInput,
      providerUserContent: userInput.userIContents,
      historyUserContent: userInput.userContents,
      inputTurnId: userInput.turnId,
    };
  }
  const contents = Array.isArray(userInput) ? userInput : [userInput];
  return {
    prepared: undefined,
    providerUserContent: userInput,
    historyUserContent: userInput,
    inputTurnId: contents.find(
      (content) => content.metadata?.turnId !== undefined,
    )?.metadata?.turnId,
  };
}
