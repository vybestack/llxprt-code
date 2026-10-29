/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  hookSessionRuntime,
  readHookDefinitions,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

/** Builds the session hook owner from the hooks registered on the config so far, with telemetry disabled. */
export function createSessionHookOwner(config: Config): SessionHookOwner {
  return new SessionHookOwner(
    readHookDefinitions(config),
    hookSessionRuntime(
      config,
      new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      }),
      RootTelemetry.prepare({
        enabled: false,
        sessionId: config.getSessionId(),
        maxBytes: 1024,
        maxFiles: 1,
      }),
    ),
    true,
    new MessageBus(),
  );
}
