/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MessageBus, PolicyEngine } from '@vybestack/llxprt-code-core';

export function withCliMessageBus<T>(config: T): {
  config: T;
  messageBus: MessageBus;
} {
  return { config, messageBus: new MessageBus(new PolicyEngine(), false) };
}
