/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { installZedDefinitionFixture } from './__tests__/definition-fixture.js';
import { unusedProfileApplication } from './test-profile-application.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import { Config } from '@vybestack/llxprt-code-core';
import { RecordingConnection } from './__tests__/zed-test-helpers.js';
const mockFromConfig = vi.fn();
const mockBuildZedTerminalSetup = vi.fn();
const actual = { ...(await import('@vybestack/llxprt-code-agents')) };
void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...actual,
  fromConfig: (...args: unknown[]) => mockFromConfig(...args),
}));
const actualActual = { ...(await import('./zed-terminal-setup.js')) };
void vi.mock('./zed-terminal-setup.js', () => ({
  ...actualActual,
  buildZedTerminalSetup: (...args: unknown[]) =>
    mockBuildZedTerminalSetup(...args),
}));
describe('isolated ACP session fixtures', () => {
  const credentials = useOwnedCredentials();
  const definitionFixture = installZedDefinitionFixture();

  function buildBaseConfig(): Config {
    return new Config({
      sessionId: 'base',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      model: 'test-model',
      debugMode: false,
    });
  }
  function buildTerminalCapableInit(): acp.InitializeRequest {
    return { protocolVersion: 1, clientCapabilities: { terminal: true } };
  }
  describe('ZedAgent.buildSessionAgent disposal on terminal-setup failure', () => {
    beforeEach(() => {
      mockFromConfig.mockReset();
      mockBuildZedTerminalSetup.mockReset();
    });

    afterEach(() => {
      mockFromConfig.mockImplementation(actual.fromConfig);
      mockBuildZedTerminalSetup.mockImplementation(
        actualActual.buildZedTerminalSetup,
      );
    });

    it('disposes the owned session Config when terminal setup fails during adoption', async () => {
      let dispose: ReturnType<typeof vi.spyOn> | undefined;
      mockFromConfig.mockImplementation(
        async (options: Parameters<typeof actual.fromConfig>[0]) => {
          dispose = vi.spyOn(options.config, 'dispose');
          options.prepareSessionTools?.(options.config, {} as never, {
            getAllTools: () => [],
            registerTool: () => {},
            unregisterTool: () => {},
          });
        },
      );
      mockBuildZedTerminalSetup.mockImplementation(() => {
        throw new Error('terminal registry construction failed');
      });

      const mod = await import('./zedIntegration.js');
      const config = buildBaseConfig();
      const settingsService = new SettingsService();
      const zedAgent = new mod.ZedAgent(
        config,
        new RecordingConnection() as unknown as acp.AgentSideConnection,
        unusedProfileApplication,
        () => new SettingsService({ sessionSource: settingsService }),
        undefined,
        definitionFixture(),
        undefined,
        { credentialAuthority: credentials().authority },
      );
      await zedAgent.initialize(buildTerminalCapableInit());

      await expect(
        zedAgent.newSession({ cwd: process.cwd(), mcpServers: [] }),
      ).rejects.toThrow('terminal registry construction failed');

      expect(dispose).toHaveBeenCalledTimes(1);
    });
  });
});
