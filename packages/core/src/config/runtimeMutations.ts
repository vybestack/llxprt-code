/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mutation surface for runtime state injection (issue #2615, P06b Gap 1).
 *
 * {@link RuntimeDependencies} is read-only, but several composition roots
 * (postConfigRuntime, providerSwitch, runtimeContextFactory) perform only
 * *setters* — they inject services into Config after construction. This
 * interface carries exactly those cross-package setters, kept deliberately
 * separate from RuntimeDependencies so a reader can see at a glance which call
 * sites mutate runtime state rather than read it.
 *
 * Member signatures match the concrete ConfigBaseCore / ConfigBase
 * declarations exactly.
 */

import type { Config } from './config.js';

import type { RuntimeProviderManager } from '../runtime/contracts/RuntimeProviderManager.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { OAuthManager } from '@vybestack/llxprt-code-auth';
import type { ImageOperationRunner } from '../services/image/imageCapability.js';
import type { BucketFailoverHandler } from './configTypes.js';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';
import type { SubagentManager } from './subagentManager.js';
import type { ToolSchedulerFactory } from '../core/toolSchedulerContract.js';
import type { AgentClientFactory } from '../core/clientContract.js';

export interface RuntimeMutations {
  setProviderManager(providerManager: RuntimeProviderManager): void;
  setRuntimeMessageBus(messageBus: MessageBus): void;
  setRuntimeOAuthManager(oauthManager: OAuthManager | undefined): void;
  setImageBackendResolver(resolver: (() => unknown) | null | undefined): void;
  setRunImageOperation(runner: ImageOperationRunner | undefined): void;
  setBucketFailoverHandler(handler: BucketFailoverHandler | undefined): void;
  setProfileManager(manager: ProfileManager | undefined): void;
  setSubagentManager(manager: SubagentManager | undefined): void;
  setToolSchedulerFactory(factory: ToolSchedulerFactory | undefined): void;
  setAgentClientFactory(factory: AgentClientFactory | undefined): void;
}

/**
 * Produces a {@link RuntimeMutations} view over a concrete Config.
 *
 * Config satisfies the interface structurally, so the adapter simply returns
 * the config itself — but going through the adapter (rather than casting at
 * each call site) keeps the mutation surface explicit and discoverable.
 */
export function runtimeMutationsFromConfig(config: Config): RuntimeMutations {
  return config;
}
