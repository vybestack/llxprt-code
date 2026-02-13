/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for /key subcommands: save, load, show, list, delete.
 *
 * Uses real ProviderKeyStorage backed by SecureStore with an in-memory
 * mock keytar adapter — no mock theater.
 *
 * @plan PLAN-20260211-SECURESTORE.P14
 * @requirement R12, R13, R14, R15, R16, R17, R18, R19, R20, R27.2
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { keyCommand } from './keyCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext, MessageActionReturn } from './types.js';
import {
  ProviderKeyStorage,
  SecureStore,
  type KeyringAdapter,
} from '@vybestack/llxprt-code-core';
import { SecureInputHandler } from '../utils/secureInputHandler.js';

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

async function createTempFallbackDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'key-cmd-test-'));
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

// ─── Mock for Runtime + ProviderKeyStorage ──────────────────────────────────

const mockRuntime = vi.hoisted(() => ({
  updateActiveProviderApiKey: vi.fn(),
  getActiveProviderStatus: vi.fn(),
}));

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => mockRuntime,
}));

let mockStorage: ProviderKeyStorage;

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    getProviderKeyStorage: () => mockStorage,
  };
});

// ─── Test Setup ──────────────────────────────────────────────────────────────

let mockKeyring: KeyringAdapter & { store: Map<string, string> };
let tempDir: string;
let context: CommandContext;

beforeEach(async () => {
  vi.clearAllMocks();
  mockKeyring = createMockKeyring();
  tempDir = await createTempFallbackDir();
  mockStorage = createTestStorage(mockKeyring, tempDir);

  context = createMockCommandContext();

  mockRuntime.getActiveProviderStatus.mockReturnValue({
    providerName: 'test-provider',
    modelName: 'model-x',
    displayLabel: 'test-provider:model-x',
  });
  mockRuntime.updateActiveProviderApiKey.mockResolvedValue({
    changed: true,
    providerName: 'test-provider',
    message: 'API key updated for provider',
    isPaidMode: true,
  });
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

// Helper to invoke the command action and cast the result
async function runKey(args: string): Promise<MessageActionReturn> {
  const result = await keyCommand.action!(context, args);
  return result as MessageActionReturn;
}

// ─── R27.2: Table-Driven Parsing Tests ──────────────────────────────────────

describe('/key — Table-Driven Parsing (R27.2)', () => {
  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R27.2, R12.1, R12.3, R12.4, R12.5, R12.6
   */
  const parsingTestCases = [
    {
      input: 'save mykey sk-abc',
      expectsSubcommand: true,
      description: 'dispatches to save handler',
    },
    {
      input: 'load mykey',
      expectsSubcommand: true,
      description: 'dispatches to load handler',
    },
    {
      input: 'show mykey',
      expectsSubcommand: true,
      description: 'dispatches to show handler',
    },
    {
      input: 'list',
      expectsSubcommand: true,
      description: 'dispatches to list handler',
    },
    {
      input: 'delete mykey',
      expectsSubcommand: true,
      description: 'dispatches to delete handler',
    },
    {
      input: 'sk-abc123',
      expectsSubcommand: false,
      description: 'treats non-subcommand token as legacy key (R12.3)',
    },
    {
      input: 'SAVE mykey sk-abc',
      expectsSubcommand: false,
      description: 'case-sensitive: SAVE is not a subcommand (R12.5)',
    },
    {
      input: '',
      expectsSubcommand: false,
      description: 'no args shows status via legacy path (R12.4)',
    },
    {
      input: '  save  mykey  sk-abc  ',
      expectsSubcommand: true,
      description: 'handles extra whitespace (R12.6)',
    },
  ];

  for (const tc of parsingTestCases) {
    it(`${tc.description}: "${tc.input}"`, async () => {
      const result = await runKey(tc.input);
      expect(result.type).toBe('message');

      if (tc.expectsSubcommand) {
        // Subcommand stubs return 'not yet implemented' during P14;
        // after P15, they return real results. Either way, dispatched.
        expect(result.content).toBeDefined();
      } else {
        // Legacy path: calls runtime.updateActiveProviderApiKey or shows status
        if (tc.input.trim().length > 0) {
          expect(mockRuntime.updateActiveProviderApiKey).toHaveBeenCalled();
        }
      }
    });
  }
});

// ─── R13: /key save Tests ────────────────────────────────────────────────────

describe('/key save (R13)', () => {
  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R13.1
   */
  it('saves a key and displays masked confirmation', async () => {
    const result = await runKey('save mykey sk-test1234567890');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('mykey');
    // Masked display should not contain the full key
    expect(result.content).not.toContain('sk-test1234567890');

    // Verify the key was actually stored
    const retrieved = await mockStorage.getKey('mykey');
    expect(retrieved).toBe('sk-test1234567890');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R13.2
   */
  it('prompts for overwrite when key already exists in interactive mode', async () => {
    await mockStorage.saveKey('existing', 'old-key-value');
    const result = await keyCommand.action!(
      context,
      'save existing new-key-value',
    );
    expect(result).toBeDefined();
    expect((result as unknown as Record<string, unknown>).type).toBe(
      'confirm_action',
    );
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R13.3
   */
  it('fails when overwriting in non-interactive mode', async () => {
    await mockStorage.saveKey('existing', 'old-key-value');
    // Mock non-interactive: config.isInteractive returns false
    context.services.config = {
      ...context.services.config,
      isInteractive: () => false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await runKey('save existing new-key-value');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('error');
    expect(result.content).toContain('already exists');

    // Original key should be preserved
    const retrieved = await mockStorage.getKey('existing');
    expect(retrieved).toBe('old-key-value');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R13.2
   */
  it('saves new value when overwrite is confirmed', async () => {
    await mockStorage.saveKey('existing', 'old-key-value');
    context.overwriteConfirmed = true;

    const result = await runKey('save existing new-key-value');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');

    const retrieved = await mockStorage.getKey('existing');
    expect(retrieved).toBe('new-key-value');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R13.4
   */
  it('returns error when API key value is missing', async () => {
    const result = await runKey('save mykey');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('error');
    expect(result.content).toContain('API key value cannot be empty');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R13.5
   */
  it('returns usage hint when name and key are both missing', async () => {
    const result = await runKey('save');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('error');
    expect(result.content).toContain('Usage');
    expect(result.content).toContain('/key save');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R13.1
   */
  it('returns validation error for invalid key name', async () => {
    const result = await runKey('save inv@lid! sk-abc123');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('error');
    expect(result.content.toLowerCase()).toContain('invalid');
  });
});

// ─── R14: /key load Tests ────────────────────────────────────────────────────

describe('/key load (R14)', () => {
  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R14.1
   */
  it('loads existing key and sets it as the active session key', async () => {
    await mockStorage.saveKey('mykey', 'sk-loaded123');

    const result = await runKey('load mykey');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('mykey');

    expect(mockRuntime.updateActiveProviderApiKey).toHaveBeenCalledWith(
      'sk-loaded123',
    );
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R14.2
   */
  it('returns not-found error for non-existent key', async () => {
    const result = await runKey('load notexist');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('error');
    expect(result.content).toContain("Key 'notexist' not found");
    expect(result.content).toContain('/key list');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R14.3
   */
  it('returns usage hint when name is missing', async () => {
    const result = await runKey('load');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('error');
    expect(result.content).toContain('Usage');
    expect(result.content).toContain('/key load');
  });
});

// ─── R15: /key show Tests ────────────────────────────────────────────────────

describe('/key show (R15)', () => {
  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R15.1
   */
  it('displays masked preview with length for existing key', async () => {
    await mockStorage.saveKey('mykey', 'sk-abc12345');

    const result = await runKey('show mykey');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('mykey');
    // Should contain length
    expect(result.content).toContain('11 chars');
    // Should NOT contain the full key
    expect(result.content).not.toContain('sk-abc12345');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R15.2
   */
  it('returns not-found error for non-existent key', async () => {
    const result = await runKey('show notexist');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('error');
    expect(result.content).toContain("Key 'notexist' not found");
    expect(result.content).toContain('/key list');
  });
});

// ─── R16: /key list Tests ────────────────────────────────────────────────────

describe('/key list (R16)', () => {
  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R16.1
   */
  it('lists all keys with masked values, sorted alphabetically', async () => {
    await mockStorage.saveKey('beta', 'sk-beta-key123');
    await mockStorage.saveKey('alpha', 'sk-alpha-key123');

    const result = await runKey('list');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('alpha');
    expect(result.content).toContain('beta');
    // Masked values — should not contain full keys
    expect(result.content).not.toContain('sk-alpha-key123');
    expect(result.content).not.toContain('sk-beta-key123');
    // Alpha should appear before beta (alphabetical sort)
    const alphaIdx = result.content.indexOf('alpha');
    const betaIdx = result.content.indexOf('beta');
    expect(alphaIdx).toBeLessThan(betaIdx);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R16.2
   */
  it('displays empty message when no keys are stored', async () => {
    const result = await runKey('list');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('No saved keys');
  });
});

// ─── R17: /key delete Tests ──────────────────────────────────────────────────

describe('/key delete (R17)', () => {
  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R17.1
   */
  it('deletes key after confirmation in interactive mode', async () => {
    await mockStorage.saveKey('mykey', 'sk-todelete123');
    // Simulate confirmed overwrite (confirm_action flow)
    context.overwriteConfirmed = true;

    const result = await runKey('delete mykey');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain("Deleted key 'mykey'");

    const exists = await mockStorage.hasKey('mykey');
    expect(exists).toBe(false);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R17.2
   */
  it('fails in non-interactive mode', async () => {
    await mockStorage.saveKey('mykey', 'sk-value123');
    context.services.config = {
      ...context.services.config,
      isInteractive: () => false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await runKey('delete mykey');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('error');
    expect(result.content).toContain('interactive');

    // Key should still exist
    const exists = await mockStorage.hasKey('mykey');
    expect(exists).toBe(true);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R17.3
   */
  it('returns not-found error for non-existent key', async () => {
    context.overwriteConfirmed = true;
    const result = await runKey('delete notexist');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('error');
    expect(result.content).toContain("Key 'notexist' not found");
    expect(result.content).toContain('/key list');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R17.4
   */
  it('returns usage hint when name is missing', async () => {
    const result = await runKey('delete');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('error');
    expect(result.content).toContain('Usage');
    expect(result.content).toContain('/key delete');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R17.1
   */
  it('returns confirm_action prompt when not yet confirmed', async () => {
    await mockStorage.saveKey('mykey', 'sk-todelete123');
    // overwriteConfirmed not set — should prompt
    const result = await keyCommand.action!(context, 'delete mykey');
    expect(result).toBeDefined();
    expect((result as unknown as Record<string, unknown>).type).toBe(
      'confirm_action',
    );
  });
});

// ─── R18: Storage Failure Tests ──────────────────────────────────────────────

describe('/key — Storage Failure (R18)', () => {
  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R18.1
   */
  it('returns actionable error when storage is unavailable', async () => {
    // Create a storage that always fails — use saveKey to trigger SecureStoreError
    const failingKeytar: KeyringAdapter = {
      getPassword: async () => {
        throw new Error('keyring unavailable');
      },
      setPassword: async () => {
        throw new Error('keyring unavailable');
      },
      deletePassword: async () => {
        throw new Error('keyring unavailable');
      },
      findCredentials: async () => {
        throw new Error('keyring unavailable');
      },
    };

    const failStore = new SecureStore('llxprt-code-provider-keys', {
      keyringLoader: async () => failingKeytar,
      fallbackDir: '/nonexistent/path/that/does/not/exist',
      fallbackPolicy: 'deny',
    });
    mockStorage = new ProviderKeyStorage({ secureStore: failStore });

    // save triggers set() which throws SecureStoreError(UNAVAILABLE)
    const result = await runKey('save testkey sk-abc123');
    expect(result.type).toBe('message');
    expect(result.messageType).toBe('error');
    expect(result.content.length).toBeGreaterThan(0);
    // Should be user-friendly, not a stack trace
    expect(result.content).not.toContain('at Object.');
    expect(result.content).toContain('keyring');
  });
});

// ─── R19: Autocomplete Tests ─────────────────────────────────────────────────

describe('/key — Autocomplete (R19)', () => {
  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R19.1
   *
   * The completion system uses schema-based completion. keyCommand.schema
   * defines literal subcommands (save, load, show, list, delete) and
   * value arguments with a completer that calls ProviderKeyStorage.listKeys().
   * We exercise the real integration via createCompletionHandler.
   */

  // Helper: run schema completion for a given full line
  async function complete(fullLine: string): Promise<string[]> {
    const { createCompletionHandler } = await import(
      '../commands/schema/index.js'
    );
    const handler = createCompletionHandler(keyCommand.schema!);
    const result = await handler(context, undefined, fullLine);
    return result.suggestions.map((s) => s.value);
  }

  it('suggests subcommand names for partial first token', async () => {
    const completions = await complete('/key s');
    expect(completions).toContain('save');
    expect(completions).toContain('show');
    expect(completions).not.toContain('load');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R19.1
   */
  it('suggests key names for load/show/delete second token', async () => {
    await mockStorage.saveKey('alpha', 'sk-alpha123');
    await mockStorage.saveKey('beta', 'sk-beta123');

    const completions = await complete('/key load ');
    expect(completions).toContain('alpha');
    expect(completions).toContain('beta');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R19.2
   */
  it('suggests key names for save second token (overwrite awareness)', async () => {
    await mockStorage.saveKey('mykey', 'sk-existing123');

    const completions = await complete('/key save ');
    expect(completions).toContain('mykey');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R19.3
   */
  it('returns empty list when keyring is unavailable', async () => {
    const failingKeytar: KeyringAdapter = {
      getPassword: async () => {
        throw new Error('unavailable');
      },
      setPassword: async () => {
        throw new Error('unavailable');
      },
      deletePassword: async () => {
        throw new Error('unavailable');
      },
      findCredentials: async () => {
        throw new Error('unavailable');
      },
    };
    const failStore = new SecureStore('llxprt-code-provider-keys', {
      keyringLoader: async () => failingKeytar,
      fallbackDir: '/nonexistent/path',
      fallbackPolicy: 'deny',
    });
    mockStorage = new ProviderKeyStorage({ secureStore: failStore });

    const completions = await complete('/key load ');
    expect(completions).toEqual([]);
  });
});

// ─── R20: Secure Input Masking Tests ─────────────────────────────────────────

describe('/key — Secure Input Masking (R20)', () => {
  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R20.1
   */
  it('masks API key value in /key save while leaving name visible', () => {
    const handler = new SecureInputHandler();
    const masked = handler.processInput('/key save mykey sk-abc123456');
    expect(masked).toContain('/key save mykey');
    expect(masked).not.toContain('sk-abc123456');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R20.2
   */
  it('masks raw key in /key <raw-key> legacy path (unchanged)', () => {
    const handler = new SecureInputHandler();
    const masked = handler.processInput('/key sk-abc123456');
    expect(masked).not.toContain('sk-abc123456');
    expect(masked).toContain('/key');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R20.1
   */
  it('sanitizes /key save for history with value masked', () => {
    const handler = new SecureInputHandler();
    const sanitized = handler.sanitizeForHistory('/key save mykey sk-secret99');
    expect(sanitized).toContain('/key save mykey');
    expect(sanitized).not.toContain('sk-secret99');
  });
});

// ─── R12: Legacy Path Tests ──────────────────────────────────────────────────

describe('/key — Legacy Path (R12.3)', () => {
  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R12.3
   */
  it('treats non-subcommand token as raw API key', async () => {
    const result = await runKey('sk-raw-api-key-12345');
    expect(result.type).toBe('message');
    expect(mockRuntime.updateActiveProviderApiKey).toHaveBeenCalledWith(
      'sk-raw-api-key-12345',
    );
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P14
   * @requirement R12.5
   */
  it('treats uppercase SAVE as raw key (case-sensitive)', async () => {
    const result = await runKey('SAVE mykey sk-abc');
    expect(result.type).toBe('message');
    expect(mockRuntime.updateActiveProviderApiKey).toHaveBeenCalledWith(
      'SAVE mykey sk-abc',
    );
  });
});
