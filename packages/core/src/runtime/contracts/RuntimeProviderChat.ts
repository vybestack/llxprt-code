/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned structural chat/tool contracts for runtime provider calls.
 *
 * These contracts intentionally mirror only what core passes to a provider.
 * They are not compatibility re-exports of provider APIs. Concrete providers
 * satisfy them through TypeScript structural typing.
 *
 * @plan:PLAN-20260603-ISSUE1584.P11
 * @requirement:REQ-DEP-001
 * @requirement:REQ-SHIM-001
 */

import type { Config } from '../../config/config.js';
import type { IContent } from '../../services/history/IContent.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderRuntimeContext } from '../providerRuntimeContext.js';
import type { RuntimeInvocationContext } from '../RuntimeInvocationContext.js';
import type { TelemetryContext } from './TelemetryContext.js';

export interface RuntimeProviderTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: object;
  };
}

export type RuntimeProviderToolset = Array<{
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
  }>;
}>;

export interface RuntimeAuthTokenProvider {
  provide: () => Promise<string | undefined> | string | undefined;
}

export type RuntimeResolvedAuthToken = string | RuntimeAuthTokenProvider;

export interface RuntimeGenerateChatOptions {
  contents: IContent[];
  tools?: RuntimeProviderToolset;
  settings?: SettingsService;
  config?: Config;
  runtime?: ProviderRuntimeContext;
  invocation?: RuntimeInvocationContext;
  metadata?: Record<string, unknown>;
  resolved?: {
    model?: string;
    baseURL?: string;
    authToken?: RuntimeResolvedAuthToken;
    telemetry?: TelemetryContext;
    temperature?: number;
    maxTokens?: number;
    streaming?: boolean;
  };
  userMemory?: unknown;
}
