/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime.js';
import { AggregateDisposeError } from '../api/disposeErrors.js';
import { createIsolatedRuntimeContext } from '@vybestack/llxprt-code-providers/runtime.js';
import type {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { buildIsolatedAgentConfig } from '../api/agentRuntimeAssembly.js';
import { registerProvidersOntoManager } from '../api/createAgent.js';

/** Assemble an agent-owned Config and its child runtime before activation. */
export function buildIsolatedSubagentHandle(options: {
  runtimeId: string;
  model: string;
  subagentName: string;
  settingsService: SettingsService;
  profileManager: ProfileManager;
  messageBus: MessageBus;
}): IsolatedRuntimeContextHandle {
  const config = buildIsolatedAgentConfig({
    sessionId: options.runtimeId,
    model: options.model,
    settingsService: options.settingsService,
    profileManager: options.profileManager,
  });
  return createIsolatedRuntimeContext({
    runtimeId: options.runtimeId,
    config,
    messageBus: options.messageBus,
    metadata: {
      source: 'SubagentOrchestrator',
      subagent: options.subagentName,
    },
    prepare: (context) => {
      registerProvidersOntoManager(
        context.providerManager,
        {
          settingsService: context.settingsService,
          runtimeId: context.runtimeId,
          metadata: context.metadata,
        },
        context.config,
      );
    },
  });
}

/** Own the Config with the handle so journal teardown closes children first. */
export function ownIsolatedConfig(
  handle: IsolatedRuntimeContextHandle,
): IsolatedRuntimeContextHandle {
  return {
    ...handle,
    cleanup: async () => {
      const errors: unknown[] = [];
      for (const dispose of [
        () => handle.cleanup(),
        () => handle.config.dispose(),
      ]) {
        try {
          await dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw new AggregateDisposeError(errors);
    },
  };
}
