/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeKind } from '../providerRuntimeContext.js';

export interface InteractiveAuthPrompt {
  readonly provider: string;
  readonly bucket: string;
  readonly requester: {
    readonly runtimeKind: RuntimeKind | 'unregistered';
    readonly runtimeId?: string;
  };
  readonly reason: 'authentication-required' | 'reauthentication-required';
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export type InteractiveAuthPromptOperation = (
  prompt: InteractiveAuthPrompt,
) => Promise<void>;
