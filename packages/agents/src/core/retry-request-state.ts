/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SendMessageParams } from './chatSession.js';

export function withRetryRequestState(
  params: SendMessageParams,
): SendMessageParams {
  return {
    ...params,
    config: {
      ...params.config,
      providerRequestContext: params.config?.providerRequestContext ?? {},
    },
  };
}
