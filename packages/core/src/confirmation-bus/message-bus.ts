/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260609-ISSUE1591.P10d
 * @requirement REQ-008.2
 * Backward-compatible core adapter over the policy package MessageBus.
 *
 * The MessageBus implementation now lives in `@vybestack/llxprt-code-policy`
 * and accepts an injectable logger so it does not depend on core's telemetry
 * utilities. Core retains this thin subclass to preserve the historic
 * two-argument constructor `(policyEngine?, debugMode?)` and to inject core's
 * `debugLogger` as the policy logger.
 */
import {
  MessageBus as PolicyMessageBus,
  type PolicyEngine,
} from '@vybestack/llxprt-code-policy';
import { debugLogger } from '../utils/debugLogger.js';

export class MessageBus extends PolicyMessageBus {
  constructor(policyEngine?: PolicyEngine, debugMode = false) {
    super(policyEngine, debugMode, debugLogger);
  }
}

/**
 * Public factory for constructing a session-scoped {@link MessageBus} without
 * exposing the `MessageBus` constructor to consumers. CLI code and other
 * frontends use this instead of `new MessageBus(...)` so message-bus
 * construction stays behind the package boundary (#2378).
 */
export function createSessionMessageBus(
  policyEngine?: PolicyEngine,
  debugMode?: boolean,
): MessageBus {
  return new MessageBus(policyEngine, debugMode);
}
