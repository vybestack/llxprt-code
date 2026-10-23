import {
  MessageBusType,
  type BucketAuthConfirmationRequest,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthControl } from '../../../agents/src/api/control/authControl.js';
import { createAgentAuthState } from '../../../agents/src/api/control/authState.js';
import { createHookControlDeps } from '../../../agents/src/api/__tests__/helpers/fakeHookControlDeps.js';
import type { MessageBus } from '@vybestack/llxprt-code-core';

export function createConsentOwner(bus: MessageBus): AuthControl {
  return new AuthControl(
    createAgentAuthState(),
    () => 'fixture',
    () => 'unauthenticated',
    undefined,
    async () => {},
    () => undefined,
    () => {},
    async () => ({
      changed: false,
      providerName: 'fixture',
      message: 'unused',
    }),
    () => false,
    async () => false,
    async () => undefined,
    async () => null,
    async () => [],
    (listener) =>
      bus.subscribe<BucketAuthConfirmationRequest>(
        MessageBusType.BUCKET_AUTH_CONFIRMATION_REQUEST,
        listener,
      ),
    (correlationId, confirmed) =>
      bus.respondToBucketAuthConfirmation(correlationId, confirmed),
  );
}

export { createHookControlDeps };
