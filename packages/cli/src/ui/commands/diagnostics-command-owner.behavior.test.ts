/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createDiagnosticsCommand } from './diagnosticsCommand.js';
import { bindDiagnosticsReads } from './diagnosticsCommandHost.js';
import {
  setupDiagnosticsTest,
  teardownDiagnosticsTest,
  type DiagnosticsTestSetup,
} from './__tests__/diagnosticsCommand-test-helpers.js';

describe('registered diagnostic session owner', () => {
  const makeOwner = useCommandOwners();
  let fixture: DiagnosticsTestSetup;
  beforeEach(() => {
    fixture = setupDiagnosticsTest();
  });
  afterEach(() => {
    teardownDiagnosticsTest(fixture);
  });
  it('reports the registered session model and working directory with a sibling invocation', async () => {
    const owner = await makeOwner('diagnostics-owner');
    const sibling = await makeOwner('diagnostics-sibling');
    const registration = createMockCommandContext({
      services: {
        ...fixture.mockContext.services,
        agent: owner,
        config: {
          ...fixture.mockContext.services.config,
          getWorkingDir: () => owner.workspace.getWorkingDirectory(),
        },
      },
      runtimeApi: {
        getRuntimeDiagnosticsSnapshot: () =>
          owner.getRuntimeDiagnosticsSnapshot(),
      },
    });
    const command = createDiagnosticsCommand(
      bindDiagnosticsReads(
        registration.services.config,
        registration.services.settings,
        owner.tools.list.bind(owner.tools),
        registration.runtimeApi.getLoadBalancerStats,
        registration.runtimeApi.getLoadBalancerTokenAccounting,
        registration.runtimeApi.getRuntimeDiagnosticsSnapshot,
        registration.runtimeApi.getSessionTokenUsage,
        registration.runtimeApi.providerStatus,
        registration.oauthControl,
        () => false,
        () => false,
      ),
    );
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), diagnosticsCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const action = registry
      .getCommands()
      .find((command) => command.name === 'diagnostics')?.action;
    if (!action) throw new Error('Diagnostics command unavailable');
    const invocation = createMockCommandContext({
      services: {
        ...fixture.mockContext.services,
        agent: sibling,
        config: {
          ...fixture.mockContext.services.config,
          getWorkingDir: () => sibling.workspace.getWorkingDirectory(),
        },
      },
      runtimeApi: {
        getRuntimeDiagnosticsSnapshot: () =>
          sibling.getRuntimeDiagnosticsSnapshot(),
      },
    });
    const result = await action(invocation, '');
    if (!result || result.type !== 'message')
      throw new Error('Expected diagnostics report');
    expect(result.content).toContain(
      `Model: ${owner.getRuntimeDiagnosticsSnapshot().modelName}`,
    );
    expect(result.content).toContain(
      `Working Directory: ${owner.workspace.getWorkingDirectory()}`,
    );
    expect(result.content).not.toContain(
      `Model: ${sibling.getRuntimeDiagnosticsSnapshot().modelName}`,
    );
    await owner.dispose();
    expect(await sibling.getHistory()).toStrictEqual([]);
  });
});
