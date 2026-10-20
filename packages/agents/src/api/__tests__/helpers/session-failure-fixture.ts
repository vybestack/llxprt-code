import { capturedSessionClient } from './session-client-capture.js';
import { capturedActivation } from './activation-acquisition-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, vi } from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { captureActivationAcquisition as assembleAgentActivationBootstrap } from './activation-acquisition-capture.js';
export function installFailingSessionFixture(): (
  config: Config,
  failure: Error,
) => Promise<() => Promise<unknown[]>> {
  const managers: ProviderManager[] = [];
  afterEach(() => {
    const failures: unknown[] = [];
    for (const manager of managers.splice(0).reverse()) {
      try {
        manager.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Borrowed session manager cleanup failed',
      );
  });
  return (config, failure) =>
    createFailingSession(config, failure, (manager) => managers.push(manager));
}

async function createFailingSession(
  config: Config,
  failure: Error,
  retain: (manager: ProviderManager) => void,
): Promise<() => Promise<unknown[]>> {
  const settingsService = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settingsService.set(key, value);
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    settingsService,
    config,
  );
  retain(manager);
  const operation = await assembleAgentActivationBootstrap(
    config,
    settingsService,
    manager,
    null,
    () => undefined,
    'borrowed',
  );
  vi.spyOn(
    capturedSessionClient(capturedActivation(operation).owner),
    'dispose',
  ).mockImplementation(async () => {
    throw failure;
  });
  return async (): Promise<unknown[]> => {
    const failures = await Promise.resolve(operation.dispose()).then(
      () => {
        throw new Error('Expected session cleanup failure');
      },
      (error: unknown) => {
        if (!(error instanceof AggregateError)) throw error;
        const cause: unknown = error.errors[0];
        if (!(cause instanceof AggregateError) || error.errors.length !== 1)
          throw error;
        return cause.errors;
      },
    );
    return failures;
  };
}
