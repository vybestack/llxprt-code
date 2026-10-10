/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { MemoryTokenStore } from './helpers/provider-auth-fixtures.js';
import { describe, expect, it } from 'bun:test';
import { assembleAgentActivationBootstrap } from '../providerSwitchAssembly.js';
import { AgentActivationBootstrap } from '../activationPreflightState.js';
import { fromConfig } from '../fromConfig.js';
import {
  buildCliStyleConfig,
  fixturesDir,
} from './helpers/buildCliStyleConfig.js';

async function setup() {
  const built = await buildCliStyleConfig('plain-text.jsonl');
  const manager = built.providerManager;

  const operation = assembleAgentActivationBootstrap(
    built.config,
    built.settingsService,
    manager,
    null,
    () => undefined,
    built.agentClient,
    built.mcpRuntime,
    built.mcpRuntime.workspaceFilesystem,
    built.mcpRuntime.workspaceMemory,
    built.settingsOwner,
  );
  return {
    ...built,
    get agentClient() {
      return built.agentClient;
    },
    operation,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class DelayedCredentialProvider extends FakeProvider {
  override name = 'claudecode';
  readonly entered = deferred();
  readonly released = deferred();
  async hasNonOAuthAuthentication(): Promise<boolean> {
    this.entered.resolve();
    await this.released.promise;
    return true;
  }
}

async function setupDelayed() {
  const built = await buildCliStyleConfig('plain-text.jsonl');
  const manager = built.providerManager;

  const provider = new DelayedCredentialProvider(
    join(fixturesDir, 'plain-text.jsonl'),
  );
  manager.registerProvider(provider);
  const oauth = new OAuthManager(new MemoryTokenStore(), undefined, {
    config: built.config,
    messageBus: built.messageBus,
  });
  const operation = assembleAgentActivationBootstrap(
    built.config,
    built.settingsService,
    manager,
    oauth,
    () => 'cli-interactive',
    built.agentClient,
    built.mcpRuntime,
    built.mcpRuntime.workspaceFilesystem,
    built.mcpRuntime.workspaceMemory,
    built.settingsOwner,
  );
  return {
    ...built,
    get agentClient() {
      return built.agentClient;
    },
    operation,
    provider,
  };
}

const intent = { provider: 'fake', authMode: 'auto' } as const;

describe('activation bootstrap receipts', () => {
  it('adopts the real Config once without repeating authentication', async () => {
    const built = await setup();
    try {
      const result = await built.operation.preflight(intent);
      if (!result.token) throw new Error('Missing receipt');
      const client = built.agentClient;
      const contentConfig = built.config.getContentGeneratorConfig();
      const agent = await fromConfig({
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation: intent,
        activationPreflight: {
          operation: built.operation,
          token: result.token,
        },
      });
      expect(agent.agentClient).toBe(client);
      expect(built.config.getContentGeneratorConfig()).toBe(contentConfig);
      await agent.dispose();
      await expect(
        fromConfig({
          settingsService: built.settingsService,
          agentClient: built.agentClient,
          providerManager: built.providerManager,
          config: built.config,
          mcpRuntime: built.mcpRuntime,
          activation: intent,
          activationPreflight: {
            operation: built.operation,
            token: result.token,
          },
        }),
      ).rejects.toThrow('Activation preflight');
    } finally {
      await built.operation.dispose();
      await built.cleanup();
    }
  });

  for (const mismatch of ['copy', 'foreign', 'intent', 'missing'] as const) {
    it(`rejects ${mismatch} before adoption`, async () => {
      const built = await setup();
      try {
        const result = await built.operation.preflight(intent);
        if (!result.token) throw new Error('Missing receipt');
        const invalidToken = mismatch === 'copy' ? { ...result.token } : {};
        const options = {
          settingsService: built.settingsService,
          config: built.config,
          mcpRuntime: built.mcpRuntime,
          activation:
            mismatch === 'intent' ? { ...intent, model: 'other' } : intent,
          activationPreflight: {
            operation: built.operation,
            token:
              mismatch === 'copy' || mismatch === 'foreign'
                ? invalidToken
                : result.token,
          },
        };
        if (mismatch === 'missing')
          Reflect.deleteProperty(options, 'activation');
        await expect(fromConfig(options)).rejects.toThrow(
          'Activation preflight',
        );
      } finally {
        await built.operation.dispose();
        await built.cleanup();
      }
    });
  }

  it('invalidates a receipt at retry start', async () => {
    const built = await setup();
    try {
      const first = await built.operation.preflight(intent);
      if (!first.token) throw new Error('Missing receipt');
      const retry = built.operation.preflight({ provider: 'not-registered' });
      await expect(
        fromConfig({
          settingsService: built.settingsService,
          agentClient: built.agentClient,
          providerManager: built.providerManager,
          config: built.config,
          mcpRuntime: built.mcpRuntime,
          activation: intent,
          activationPreflight: {
            operation: built.operation,
            token: first.token,
          },
        }),
      ).rejects.toThrow('Activation preflight');
      expect((await retry).token).toBeUndefined();
    } finally {
      await built.operation.dispose();
      await built.cleanup();
    }
  });

  it('serializes attempts and publishes only the latest receipt', async () => {
    const built = await setup();
    try {
      const first = built.operation.preflight({
        ...intent,
        model: 'first-model',
      });
      const second = built.operation.preflight({
        ...intent,
        model: 'second-model',
      });
      expect((await first).token).toBeUndefined();
      const result = await second;
      expect(result.token).toBeDefined();
      expect(built.settingsOwner.readSelectedModel()).toBe('second-model');
    } finally {
      await built.operation.dispose();
      await built.cleanup();
    }
  });

  it('captures intent before caller mutation and invalidates pending work on disposal', async () => {
    const built = await setup();
    try {
      const mutable = { ...intent, model: 'captured-model' };
      const pending = built.operation.preflight(mutable);
      mutable.model = 'mutated-model';
      const result = await pending;
      expect(built.settingsOwner.readSelectedModel()).toBe('captured-model');
      expect(result.token).toBeDefined();
      const disposed = built.operation.preflight(intent);
      await built.operation.dispose();
      expect((await disposed).token).toBeUndefined();
    } finally {
      await built.cleanup();
    }
  });
});

describe('activation bootstrap ownership and queued work', () => {
  it('rejects a caller-implemented operation without invoking its consume method', async () => {
    const built = await setup();
    try {
      const result = await built.operation.preflight(intent);
      if (!result.token) throw new Error('Missing receipt');
      const forged = {
        workspaceDefinitions: built.operation.workspaceDefinitions,
        workspaceTrust: built.operation.workspaceTrust,
        trustCleanup: built.operation.trustCleanup,
        workspaceMemory: built.operation.workspaceMemory,
        workspaceFilesystem: built.operation.workspaceFilesystem,
        sessionClient: built.operation.sessionClient,
        takeSessionClient: built.operation.takeSessionClient.bind(
          built.operation,
        ),
        takeMediaOwner: built.operation.takeMediaOwner.bind(built.operation),
        settingsOwnerOwnership: built.operation.settingsOwnerOwnership,
        takeSettingsOwner: built.operation.takeSettingsOwner.bind(
          built.operation,
        ),
        preflight: built.operation.preflight.bind(built.operation),
        dispose: () => {},
        consume: () => result,
      };
      await expect(
        fromConfig({
          settingsService: built.settingsService,
          agentClient: built.agentClient,
          providerManager: built.providerManager,
          config: built.config,
          mcpRuntime: built.mcpRuntime,
          activation: intent,
          activationPreflight: { operation: forged, token: result.token },
        }),
      ).rejects.toThrow('Invalid activation bootstrap');
    } finally {
      await built.operation.dispose();
      await built.cleanup();
    }
  });

  it('rejects a token from another operation', async () => {
    const built = await setup();
    const other = await setup();
    try {
      const result = await other.operation.preflight(intent);
      await built.operation.preflight(intent);
      if (!result.token) throw new Error('Missing receipt');
      await expect(
        fromConfig({
          settingsService: built.settingsService,
          agentClient: built.agentClient,
          providerManager: built.providerManager,
          config: built.config,
          mcpRuntime: built.mcpRuntime,
          activation: intent,
          activationPreflight: {
            operation: built.operation,
            token: result.token,
          },
        }),
      ).rejects.toThrow('Activation preflight token');
    } finally {
      await other.operation.dispose();
      await built.operation.dispose();
      await other.cleanup();
      await built.cleanup();
    }
  });

  for (const mismatch of ['config', 'manager'] as const) {
    it(`rejects a different ${mismatch}`, async () => {
      const built = await setup();
      const other = await setup();
      const manager = built.providerManager;
      try {
        const result = await built.operation.preflight(intent);
        if (!result.token) throw new Error('Missing receipt');
        const otherManager = other.providerManager;

        await expect(
          fromConfig({
            settingsService:
              mismatch === 'config'
                ? other.settingsService
                : built.settingsService,
            config: mismatch === 'config' ? other.config : built.config,
            providerManager: mismatch === 'manager' ? otherManager : manager,
            activation: intent,
            activationPreflight: {
              operation: built.operation,
              token: result.token,
            },
          }),
        ).rejects.toThrow('Activation preflight belongs');
      } finally {
        await other.operation.dispose();
        await built.operation.dispose();
        await other.cleanup();
        await built.cleanup();
      }
    });
  }

  it('permits a successful retry after a failed activation', async () => {
    const built = await setup();
    try {
      const failed = await built.operation.preflight({
        provider: 'missing-provider',
      });
      expect(failed.authFailed).toBe(true);
      expect(failed.authError).toBeDefined();
      expect(failed.token).toBeUndefined();
      const result = await built.operation.preflight(intent);
      expect(result.authFailed).toBe(false);
      expect(result.token).toBeDefined();
    } finally {
      await built.operation.dispose();
      await built.cleanup();
    }
  });

  it('does not publish a blocked stale attempt or let it overwrite the latest provider', async () => {
    const built = await setupDelayed();
    try {
      const first = built.operation.preflight({
        provider: 'claudecode',
        authMode: 'none',
        model: 'first-model',
      });
      await built.provider.entered.promise;
      const second = built.operation.preflight({
        provider: 'fake',
        authMode: 'none',
        model: 'second-model',
      });
      built.provider.released.resolve();
      expect((await first).token).toBeUndefined();
      const result = await second;
      expect(result.token).toBeDefined();
      expect(built.providerManager.getActiveProviderName()).toBe('fake');
      expect(built.settingsOwner.readSelectedModel()).toBe('second-model');
    } finally {
      built.provider.released.resolve();
      await built.operation.dispose();
      await built.cleanup();
    }
  });

  it('disposes a running preflight without disposing the caller Config', async () => {
    const built = await setupDelayed();
    try {
      const pending = built.operation.preflight({
        provider: 'claudecode',
        authMode: 'none',
      });
      await built.provider.entered.promise;
      built.operation.takeSettingsOwner(built.settingsService);
      built.operation.takeSessionClient(built.config);
      let closed = false;
      const closing = Promise.resolve(built.operation.dispose()).then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      built.provider.released.resolve();
      await closing;
      expect((await pending).token).toBeUndefined();
      await built.sessionClient.refreshAuth();
      const reply = await built.sessionClient
        .getAgentClient()
        .generateDirectMessage(
          { message: 'Caller remains usable after bootstrap disposal' },
          'caller-after-bootstrap-disposal',
        );
      expect(
        reply.content.blocks
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
      ).toBe('a plain text reply');
      expect((await built.operation.preflight(intent)).authFailed).toBe(true);
    } finally {
      built.provider.released.resolve();
      await built.cleanup();
    }
  });

  it('allows an independent owner to finish while another is blocked', async () => {
    const blocked = await setupDelayed();
    const independent = await setup();
    try {
      blocked.settingsOwner.writeUserParameter('auth-key', 'blocked-key');
      independent.settingsOwner.writeUserParameter(
        'auth-key',
        'independent-key',
      );
      blocked.settingsService.setProviderSetting('claudecode', 'top_p', 0.3);
      const first = blocked.operation.preflight({
        provider: 'claudecode',
        authMode: 'none',
        model: 'blocked-model',
        modelParams: { temperature: 0.2 },
      });
      await blocked.provider.entered.promise;
      const second = await independent.operation.preflight({
        ...intent,
        model: 'independent-model',
        modelParams: { temperature: 0.8, top_p: 0.9 },
      });
      expect(second.token).toBeDefined();
      expect(independent.settingsOwner.readSelectedModel()).toBe(
        'independent-model',
      );
      blocked.provider.released.resolve();
      expect((await first).token).toBeDefined();
      expect(blocked.providerManager.getActiveProviderName()).toBe(
        'claudecode',
      );
      expect(blocked.settingsOwner.readSelectedModel()).toBe('blocked-model');
      expect(independent.settingsOwner.readSelectedModel()).toBe(
        'independent-model',
      );
      const blockedSettings =
        blocked.settingsService.getProviderSettings('claudecode');
      const independentSettings =
        independent.settingsService.getProviderSettings('fake');
      expect(blockedSettings.temperature).toBe(0.2);
      expect(blockedSettings.top_p).toBeUndefined();
      expect(independentSettings.temperature).toBe(0.8);
      expect(independentSettings.top_p).toBe(0.9);
      expect(blockedSettings['auth-key']).toBe('blocked-key');
      expect(independent.settingsOwner.readNamedParameter('auth-key')).toBe(
        'independent-key',
      );
      expect(independentSettings['auth-key']).not.toBe('blocked-key');
    } finally {
      blocked.provider.released.resolve();
      await independent.operation.dispose();
      await blocked.operation.dispose();
      await independent.cleanup();
      await blocked.cleanup();
    }
  });
});

describe('preflight adoption boundaries', () => {
  it('closes the operation when malformed adoption options omit Config', async () => {
    const built = await setup();
    try {
      const result = await built.operation.preflight(intent);
      if (!result.token) throw new Error('Missing receipt');
      const options = {
        settingsService: built.settingsService,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation: intent,
        activationPreflight: {
          operation: built.operation,
          token: result.token,
        },
      };
      Reflect.deleteProperty(options, 'config');
      await expect(fromConfig(options)).rejects.toThrow(
        'requires an existing Config',
      );
      expect((await built.operation.preflight(intent)).authFailed).toBe(true);
    } finally {
      await built.operation.dispose();
      await built.cleanup();
    }
  });

  it('adopts a keyfile activation after the source keyfile is gone', async () => {
    const built = await setup();
    const directory = await mkdtemp(join(tmpdir(), 'preflight-owner-key-'));
    try {
      const keyfile = join(directory, 'provider.key');
      await writeFile(keyfile, 'local-test-key');
      const activation = { ...intent, cliOverrides: { keyfile } };
      const result = await built.operation.preflight(activation);
      if (!result.token) throw new Error('Missing receipt');
      const client = built.agentClient;
      await rm(keyfile);
      const agent = await fromConfig({
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation,
        activationPreflight: {
          operation: built.operation,
          token: result.token,
        },
      });
      expect(
        built.settingsService.getProviderSettings('fake')['auth-key'],
      ).toBe('local-test-key');
      expect(agent.agentClient).toBe(client);
      await agent.dispose();
    } finally {
      await built.operation.dispose();
      await built.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('recovers after an external keyfile read throws', async () => {
    const built = await setup();
    const directory = await mkdtemp(join(tmpdir(), 'preflight-owner-retry-'));
    try {
      const keyfile = join(directory, 'missing.key');
      const activation = { ...intent, cliOverrides: { keyfile } };
      const failed = await built.operation.preflight(activation);
      expect(failed.authFailed).toBe(true);
      expect(failed.authError).toBeInstanceOf(Error);
      expect(failed.token).toBeUndefined();
      await writeFile(keyfile, 'recovered-local-key');
      const result = await built.operation.preflight(activation);
      if (!result.token) throw new Error('Missing retry receipt');
      const agent = await fromConfig({
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation,
        activationPreflight: {
          operation: built.operation,
          token: result.token,
        },
      });
      expect(
        built.settingsService.getProviderSettings('fake')['auth-key'],
      ).toBe('recovered-local-key');
      await agent.dispose();
    } finally {
      await built.operation.dispose();
      await built.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts equivalent intent snapshots with reordered object keys', async () => {
    const built = await setup();
    try {
      const activation = {
        ...intent,
        modelParams: { nested: { a: 1, b: 2 }, temperature: 0.3 },
      };
      const result = await built.operation.preflight(activation);
      if (!result.token) throw new Error('Missing receipt');
      const agent = await fromConfig({
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation: {
          authMode: 'auto',
          provider: 'fake',
          modelParams: { temperature: 0.3, nested: { b: 2, a: 1 } },
        },
        activationPreflight: {
          operation: built.operation,
          token: result.token,
        },
      });
      expect(agent.getProvider()).toBe('fake');
      await agent.dispose();
    } finally {
      await built.operation.dispose();
      await built.cleanup();
    }
  });

  it('rechecks the actual adopted manager at consumption', async () => {
    const built = await setup();
    const other = await setup();
    try {
      const result = await built.operation.preflight(intent);
      if (!result.token) throw new Error('Missing receipt');
      const preflight = { operation: built.operation, token: result.token };
      expect(() =>
        AgentActivationBootstrap.consume(
          preflight,
          built.config,
          intent,
          other.providerManager,
        ),
      ).toThrow('different ProviderManager');
      const agent = await fromConfig({
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation: intent,
        activationPreflight: preflight,
      });
      expect(agent.getProvider()).toBe('fake');
      await agent.dispose();
    } finally {
      await other.operation.dispose();
      await built.operation.dispose();
      await other.cleanup();
      await built.cleanup();
    }
  });

  it('invalidates an old receipt while a retry waits at an external credential boundary', async () => {
    const built = await setupDelayed();
    try {
      const previous = await built.operation.preflight(intent);
      if (!previous.token) throw new Error('Missing receipt');
      const retry = built.operation.preflight({
        provider: 'claudecode',
        authMode: 'none',
      });
      await built.provider.entered.promise;
      const rejection = fromConfig({
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation: intent,
        activationPreflight: {
          operation: built.operation,
          token: previous.token,
        },
      });
      built.provider.released.resolve();
      await expect(rejection).rejects.toThrow('Activation preflight token');
      expect((await retry).token).toBeUndefined();
    } finally {
      built.provider.released.resolve();
      await built.operation.dispose();
      await built.cleanup();
    }
  });
});
