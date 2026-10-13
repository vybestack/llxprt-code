/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  RuntimeProviderManager,
  MessageBus,
} from '@vybestack/llxprt-code-core';
import { createSessionMessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { PolicyEngine } from '@vybestack/llxprt-code-core';
import { createOwnerPolicyEvaluation } from '@vybestack/llxprt-code-core/policy/owner-policy-evaluation.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { configureProviderRuntimeFactories } from '../composition/index.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { validateRuntimeId } from './runtimeIdValidation.js';

type PolicyDecisionPort = Pick<PolicyEngine, 'evaluate'>;

export interface CliRuntimeRegistrationHandle {
  readonly runtimeId: string;
  readonly settingsService: SettingsService;
  readonly config: Config | undefined;
  readonly registered: false;
  readonly providerFileLifecycle: ProviderFileLifecycle;
  readonly providerManager: RuntimeProviderManager | undefined;
  readonly messageBus: MessageBus;
  readonly decisions: PolicyDecisionPort;
  bindPolicyEvaluation(evaluate: PolicyDecisionPort['evaluate']): void;
  expectManager(manager: RuntimeProviderManager): void;
  adopt(config: Config): () => void;
  rollback(): void;
  dispose(): void;
}

export function beginCliRuntimeRegistration(
  settingsService: SettingsService,
  config: Config | undefined,
  options: { runtimeId: string },
): CliRuntimeRegistrationHandle {
  validateRuntimeId(options.runtimeId);
  const lifecycle = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  const decisions = createOwnerPolicyEvaluation();
  const messageBus = createSessionMessageBus(decisions);
  let owner = config;
  let failedOwner: Config | undefined;
  let manager: RuntimeProviderManager | undefined;
  let disposed = false;
  return {
    messageBus,
    decisions,
    bindPolicyEvaluation: (next) => {
      if (disposed)
        throw new Error('Cannot update a disposed runtime registration');
      decisions.bindPolicyEvaluation(next);
    },
    runtimeId: options.runtimeId,
    settingsService,
    registered: false,
    providerFileLifecycle: lifecycle,
    get config() {
      return owner;
    },
    get providerManager() {
      return manager;
    },
    expectManager: (next) => {
      if (disposed)
        throw new Error('Cannot update a disposed runtime registration');
      manager = next;
      if (owner) {
        configureProviderRuntimeFactories(owner, next);
        next.setConfig(owner);
      }
    },
    adopt: (next) => {
      if (disposed)
        throw new Error('Cannot adopt a disposed runtime registration');
      if ((owner && owner !== next) || (failedOwner && failedOwner !== next)) {
        throw new Error('Runtime registration belongs to another Config');
      }
      const previousOwner = owner;
      owner = next;
      return () => {
        if (disposed || owner !== next) return;
        owner = previousOwner;
        failedOwner = next;
      };
    },
    rollback: () => {
      if (disposed) return;
      messageBus.cancelPendingConfirmations();
      disposed = true;
      owner = undefined;
      manager = undefined;
    },
    dispose: () => {
      if (disposed) return;
      if (lifecycle.retainsScope('session', options.runtimeId)) {
        throw new Error(
          `Cannot deregister runtime ${options.runtimeId} while its provider-file lifecycle retains session files`,
        );
      }
      messageBus.cancelPendingConfirmations();
      disposed = true;
      owner = undefined;
      manager = undefined;
    },
  };
}
