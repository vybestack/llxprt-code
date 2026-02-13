/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for auth-key-name profile field and --key-name CLI flag.
 *
 * Bootstrap parsing tests run without runtime infrastructure.
 * Precedence/resolution tests use createIsolatedRuntimeContext with a
 * minimal stub provider so updateActiveProviderApiKey succeeds.
 *
 * @plan PLAN-20260211-SECURESTORE.P17
 * @requirement R21, R22, R23, R24, R25, R26, R27.3
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ProviderKeyStorage,
  SecureStore,
  clearActiveProviderRuntimeContext,
  type KeyringAdapter,
  type IProvider,
} from '@vybestack/llxprt-code-core';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockKeyring(): KeyringAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getPassword: async (service: string, account: string) =>
      store.get(`${service}:${account}`) ?? null,
    setPassword: async (service: string, account: string, password: string) => {
      store.set(`${service}:${account}`, password);
    },
    deletePassword: async (service: string, account: string) =>
      store.delete(`${service}:${account}`),
    findCredentials: async (service: string) => {
      const results: Array<{ account: string; password: string }> = [];
      for (const [key, value] of store.entries()) {
        if (key.startsWith(`${service}:`)) {
          results.push({
            account: key.slice(service.length + 1),
            password: value,
          });
        }
      }
      return results;
    },
  };
}

function createTestStorage(
  mockKeyring: KeyringAdapter,
  fallbackDir: string,
): ProviderKeyStorage {
  const secureStore = new SecureStore('llxprt-code-provider-keys', {
    keyringLoader: async () => mockKeyring,
    fallbackDir,
    fallbackPolicy: 'allow',
  });
  return new ProviderKeyStorage({ secureStore });
}

function createStubProvider(): IProvider {
  return {
    name: 'test-provider',
    isDefault: true,
    getModels: async () => [],
    async *generateChatCompletion() {},
    getDefaultModel: () => 'test-model',
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
    isPaidMode: () => false,
  } as IProvider;
}

// ─── Module-level mock for ProviderKeyStorage singleton ──────────────────────

let mockStorageRef: ProviderKeyStorage | null = null;

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    getProviderKeyStorage: () => mockStorageRef,
  };
});

const { parseBootstrapArgs } = await import('../../config/profileBootstrap.js');

// ─── Bootstrap Parsing Tests (R22.2) ────────────────────────────────────────

describe('--key-name bootstrap parsing @plan:PLAN-20260211-SECURESTORE.P17', () => {
  let savedArgv: string[];

  beforeEach(() => {
    savedArgv = process.argv;
  });

  afterEach(() => {
    process.argv = savedArgv;
  });

  /** @requirement R22.2 */
  it('parses --key-name flag and sets keyNameOverride', () => {
    process.argv = ['node', 'llxprt', '--key-name', 'myanthropic'];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.keyNameOverride).toBe('myanthropic');
  });

  /** @requirement R22.2 */
  it('sets keyNameOverride to null when --key-name is not provided', () => {
    process.argv = ['node', 'llxprt'];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.keyNameOverride).toBeNull();
  });

  /** @requirement R22.2 */
  it('throws when --key-name is provided without a value', () => {
    process.argv = ['node', 'llxprt', '--key-name'];
    expect(() => parseBootstrapArgs()).toThrow('--key-name requires a value');
  });

  /** @requirement R22.2 */
  it('parses --key-name alongside --profile-load and --model', () => {
    process.argv = [
      'node',
      'llxprt',
      '--profile-load',
      'myprofile',
      '--key-name',
      'work-key',
      '--model',
      'gpt-4o',
    ];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.keyNameOverride).toBe('work-key');
    expect(result.bootstrapArgs.profileName).toBe('myprofile');
    expect(result.bootstrapArgs.modelOverride).toBe('gpt-4o');
  });

  /** @requirement R21.3, R23.3 */
  it('bootstrap does NOT resolve the key — only stores metadata', () => {
    process.argv = ['node', 'llxprt', '--key-name', 'mykey'];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.keyNameOverride).toBe('mykey');
  });

  /** @requirement R26.1 */
  it('--key still works alongside --key-name', () => {
    process.argv = [
      'node',
      'llxprt',
      '--key',
      'raw-key',
      '--key-name',
      'named',
    ];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.keyOverride).toBe('raw-key');
    expect(result.bootstrapArgs.keyNameOverride).toBe('named');
  });

  /** @requirement R26.1 */
  it('--keyfile still works when --key-name is not present', () => {
    process.argv = ['node', 'llxprt', '--keyfile', '/path/to/key'];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.keyfileOverride).toBe('/path/to/key');
    expect(result.bootstrapArgs.keyNameOverride).toBeNull();
  });
});

// ─── Precedence & Resolution Tests (R21-R27) ────────────────────────────────

describe('API key precedence and named key resolution @plan:PLAN-20260211-SECURESTORE.P17', () => {
  let mockKeyring: KeyringAdapter & { store: Map<string, string> };
  let tempDir: string;
  let runtimeMod: typeof import('../runtimeSettings.js');
  let contextFactoryMod: typeof import('../runtimeContextFactory.js');
  let cleanupHandle: (() => Promise<void> | void) | null = null;

  beforeEach(async () => {
    mockKeyring = createMockKeyring();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-key-name-test-'));
    mockStorageRef = createTestStorage(mockKeyring, tempDir);

    runtimeMod = await import('../runtimeSettings.js');
    contextFactoryMod = await import('../runtimeContextFactory.js');
  });

  afterEach(async () => {
    if (cleanupHandle) {
      await Promise.resolve(cleanupHandle()).catch(() => {});
      cleanupHandle = null;
    }
    clearActiveProviderRuntimeContext();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  async function setupRuntime(): Promise<{
    config: {
      getEphemeralSetting: (key: string) => unknown;
      setEphemeralSetting: (key: string, value: unknown) => void;
    };
  }> {
    const handle = await contextFactoryMod.createIsolatedRuntimeContext({
      runtimeId: 'auth-key-test',
      workspaceDir: tempDir,
      prepare: async ({ providerManager }) => {
        const stub = createStubProvider();
        providerManager.registerProvider(stub);
        providerManager.setActiveProvider('test-provider');
      },
    });
    await handle.activate();
    cleanupHandle = handle.cleanup;

    return {
      config: handle.config as {
        getEphemeralSetting: (key: string) => unknown;
        setEphemeralSetting: (key: string, value: unknown) => void;
      },
    };
  }

  // ─── Precedence Tests (R23.1, R23.2, R27.3) ────────────────────────────

  /** @requirement R23.2 */
  it('--key beats --key-name: raw CLI key takes highest precedence', async () => {
    await mockStorageRef!.saveKey('mykey', 'stored-key-value');
    await setupRuntime();

    await runtimeMod.applyCliArgumentOverrides(
      {},
      { keyOverride: 'raw-cli-key', keyNameOverride: 'mykey' },
    );

    const { config: cfg } = runtimeMod.getCliRuntimeServices();
    expect(cfg.getEphemeralSetting('auth-key')).toBe('raw-cli-key');
  });

  /** @requirement R23.1 */
  it('--key-name beats auth-key-name: CLI flag beats profile field', async () => {
    await mockStorageRef!.saveKey('cli-named', 'cli-named-value');
    await mockStorageRef!.saveKey('profile-named', 'profile-named-value');
    const { config } = await setupRuntime();
    config.setEphemeralSetting('auth-key-name', 'profile-named');

    await runtimeMod.applyCliArgumentOverrides(
      {},
      { keyNameOverride: 'cli-named' },
    );

    const { config: cfg } = runtimeMod.getCliRuntimeServices();
    // auth-key-name stores the name reference; auth-key is cleared
    expect(cfg.getEphemeralSetting('auth-key-name')).toBe('cli-named');
    expect(cfg.getEphemeralSetting('auth-key')).toBeUndefined();
  });

  /** @requirement R23.1 */
  it('auth-key-name beats auth-key: named key beats inline profile key', async () => {
    await mockStorageRef!.saveKey('my-named', 'named-key-value');
    const { config } = await setupRuntime();
    config.setEphemeralSetting('auth-key-name', 'my-named');
    config.setEphemeralSetting('auth-key', 'inline-key-value');

    await runtimeMod.applyCliArgumentOverrides({}, {});

    const { config: cfg } = runtimeMod.getCliRuntimeServices();
    // auth-key-name kept; auth-key cleared to prevent raw key in snapshots
    expect(cfg.getEphemeralSetting('auth-key-name')).toBe('my-named');
    expect(cfg.getEphemeralSetting('auth-key')).toBeUndefined();
  });

  /** @requirement R23.1, R27.3 */
  it('--key beats all: raw key overrides key-name + auth-key-name', async () => {
    await mockStorageRef!.saveKey('named', 'named-value');
    const { config } = await setupRuntime();
    config.setEphemeralSetting('auth-key-name', 'named');

    await runtimeMod.applyCliArgumentOverrides(
      {},
      { keyOverride: 'raw-wins', keyNameOverride: 'named' },
    );

    const { config: cfg } = runtimeMod.getCliRuntimeServices();
    expect(cfg.getEphemeralSetting('auth-key')).toBe('raw-wins');
  });

  /** @requirement R23.1, R27.3 */
  it('--key-name beats keyfile: named key from CLI beats file-based auth', async () => {
    await mockStorageRef!.saveKey('cli-key', 'cli-key-value');
    await setupRuntime();
    const keyfilePath = path.join(tempDir, 'should-not-read.key');
    await fs.writeFile(keyfilePath, 'keyfile-content');

    await runtimeMod.applyCliArgumentOverrides(
      {},
      { keyNameOverride: 'cli-key', keyfileOverride: keyfilePath },
    );

    const { config: cfg } = runtimeMod.getCliRuntimeServices();
    // auth-key-name stores the name reference; auth-key is cleared
    expect(cfg.getEphemeralSetting('auth-key-name')).toBe('cli-key');
    expect(cfg.getEphemeralSetting('auth-key')).toBeUndefined();
  });

  // ─── Named Key Resolution (R21.1, R22.1) ──────────────────────────────

  /** @requirement R22.1 */
  it('--key-name resolves stored key via ProviderKeyStorage', async () => {
    await mockStorageRef!.saveKey('myanthropic', 'sk-ant-abc123');
    await setupRuntime();

    await runtimeMod.applyCliArgumentOverrides(
      {},
      { keyNameOverride: 'myanthropic' },
    );

    const { config: cfg } = runtimeMod.getCliRuntimeServices();
    // auth-key-name stores the name reference; auth-key is cleared
    expect(cfg.getEphemeralSetting('auth-key-name')).toBe('myanthropic');
    expect(cfg.getEphemeralSetting('auth-key')).toBeUndefined();
  });

  /** @requirement R21.1 */
  it('auth-key-name profile field resolves stored key', async () => {
    await mockStorageRef!.saveKey('work-gemini', 'AIzaSy-work-key');
    const { config } = await setupRuntime();
    config.setEphemeralSetting('auth-key-name', 'work-gemini');

    await runtimeMod.applyCliArgumentOverrides({}, {});

    const { config: cfg } = runtimeMod.getCliRuntimeServices();
    // auth-key-name preserved; auth-key cleared to prevent raw key in snapshots
    expect(cfg.getEphemeralSetting('auth-key-name')).toBe('work-gemini');
    expect(cfg.getEphemeralSetting('auth-key')).toBeUndefined();
  });

  // ─── Error Handling (R24.1, R24.2) ─────────────────────────────────────

  /** @requirement R24.1 */
  it('throws actionable error when --key-name references non-existent key', async () => {
    await setupRuntime();

    await expect(
      runtimeMod.applyCliArgumentOverrides({}, { keyNameOverride: 'notexist' }),
    ).rejects.toThrow("Named key 'notexist' not found");
  });

  /** @requirement R24.1 */
  it('error message includes /key save hint', async () => {
    await setupRuntime();

    await expect(
      runtimeMod.applyCliArgumentOverrides({}, { keyNameOverride: 'missing' }),
    ).rejects.toThrow('/key save missing');
  });

  /** @requirement R24.1 */
  it('does NOT fall through when named key is not found', async () => {
    await setupRuntime();

    await expect(
      runtimeMod.applyCliArgumentOverrides(
        {},
        { keyNameOverride: 'missing', keyfileOverride: '/tmp/fallback.key' },
      ),
    ).rejects.toThrow("Named key 'missing' not found");
  });

  /** @requirement R24.1 */
  it('throws when auth-key-name references non-existent key', async () => {
    const { config } = await setupRuntime();
    config.setEphemeralSetting('auth-key-name', 'ghost');

    await expect(runtimeMod.applyCliArgumentOverrides({}, {})).rejects.toThrow(
      "Named key 'ghost' not found",
    );
  });

  /** @requirement R24.1 */
  it('auth-key-name error does NOT fall through to lower-precedence sources', async () => {
    const { config } = await setupRuntime();
    config.setEphemeralSetting('auth-key-name', 'ghost');
    config.setEphemeralSetting('auth-key', 'inline-fallback');

    await expect(runtimeMod.applyCliArgumentOverrides({}, {})).rejects.toThrow(
      "Named key 'ghost' not found",
    );
  });

  // ─── No Deprecation (R26.1) ───────────────────────────────────────────

  /** @requirement R26.1 */
  it('--key raw value still works', async () => {
    await setupRuntime();

    await runtimeMod.applyCliArgumentOverrides({ key: 'direct-raw-key' }, {});

    const { config: cfg } = runtimeMod.getCliRuntimeServices();
    expect(cfg.getEphemeralSetting('auth-key')).toBe('direct-raw-key');
  });

  /** @requirement R26.1 */
  it('--key via bootstrapArgs still works', async () => {
    await setupRuntime();

    await runtimeMod.applyCliArgumentOverrides(
      {},
      { keyOverride: 'bootstrap-key' },
    );

    const { config: cfg } = runtimeMod.getCliRuntimeServices();
    expect(cfg.getEphemeralSetting('auth-key')).toBe('bootstrap-key');
  });

  /** @requirement R26.1 */
  it('--keyfile still reads and trims file content', async () => {
    await setupRuntime();
    const keyfilePath = path.join(tempDir, 'legacy.key');
    await fs.writeFile(keyfilePath, '  keyfile-value  \n');

    await runtimeMod.applyCliArgumentOverrides(
      {},
      { keyfileOverride: keyfilePath },
    );

    const { config: cfg } = runtimeMod.getCliRuntimeServices();
    expect(cfg.getEphemeralSetting('auth-keyfile')).toBe(keyfilePath);
  });

  // ─── Ephemeral Setting (R21.2) ────────────────────────────────────────

  /** @requirement R21.2 */
  it('auth-key-name is stored and retrieved as ephemeral setting', async () => {
    const { config } = await setupRuntime();
    config.setEphemeralSetting('auth-key-name', 'mykey');
    expect(config.getEphemeralSetting('auth-key-name')).toBe('mykey');
  });
});
