/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-COREAPIGAP.P15
 * @requirement:REQ-007
 *
 * Behavioral RED suite for the NEW built-in tool-key control
 * (`agent.tools.keys`), DISTINCT from `agent.auth.keys` (R-KEYS-DISTINCT).
 * Backed by a REAL hermetic `ToolKeyStorage` over a temp dir + a real
 * Map-backed `KeyringAdapter` (no spies/stubs). Raw key material never crosses
 * the API boundary (R-NO-RAW-SECRETS).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import fc from 'fast-check';
import { ToolKeyStorage } from '@vybestack/llxprt-code-core';
import { buildAgent } from './helpers/agentHarness.js';

// A real Map-backed KeyringAdapter (structural type — NOT a spy/stub).
function memoryKeyring() {
  const store = new Map<string, string>();
  return {
    getPassword: async (service: string, account: string) =>
      store.get(`${service}:${account}`) ?? null,
    setPassword: async (service: string, account: string, password: string) => {
      store.set(`${service}:${account}`, password);
    },
    deletePassword: async (service: string, account: string) =>
      store.delete(`${service}:${account}`),
  };
}

async function hermeticStorage(): Promise<{
  storage: ToolKeyStorage;
  dir: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'toolkeys-behavior-'));
  const storage = new ToolKeyStorage({
    toolsDir: dir,
    keyringLoader: async () => memoryKeyring(),
  });
  return { storage, dir };
}

async function makeKeys() {
  const { storage, dir } = await hermeticStorage();
  const { ToolKeysControl } = await import('../control/toolKeysControl.js');
  const keys = new ToolKeysControl({ getStorage: () => storage });
  return { keys, dir };
}

describe('agent.tools.keys — built-in tool-key control (REQ-007)', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) {
      await fs.rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  // T17a — supported() projects the static registry.
  it('supported() includes the exa entry with toolName, displayName, description', async () => {
    const { keys, dir: d } = await makeKeys();
    dir = d;
    const entries = keys.supported();
    const exa = entries.find((e) => e.toolName === 'exa');
    expect(exa).toBeDefined();
    expect(typeof exa!.displayName).toBe('string');
    expect(exa!.displayName.length).toBeGreaterThan(0);
    expect(typeof exa!.description).toBe('string');
  });

  // T18 — status() masks a length>8 key and never leaks the raw key.
  it('status() returns a masked key (len>8) and never the raw key', async () => {
    const { keys, dir: d } = await makeKeys();
    dir = d;
    await keys.save('exa', 'abcd1234efgh');
    const status = await keys.status('exa');
    expect(status).toStrictEqual({
      toolName: 'exa',
      hasKey: true,
      maskedKey: 'ab********gh',
    });
    expect(JSON.stringify(status)).not.toContain('abcd1234efgh');
    const keyNames = Object.keys(status);
    expect(keyNames).not.toContain('rawKey');
    expect(keyNames).not.toContain('key');
    expect(keyNames).not.toContain('access_token');
  });

  // T18a — status() fully masks a short key (len<=8).
  it('status() fully masks a short key (len<=8)', async () => {
    const { keys, dir: d } = await makeKeys();
    dir = d;
    await keys.save('exa', 'short');
    const status = await keys.status('exa');
    expect(status.maskedKey).toBe('*****');
    expect(status.maskedKey).not.toBe('short');
  });

  // T18b — an invalid tool name rejects (storage assertValidToolName propagates).
  it('save() with an unregistered tool name rejects (throw propagates)', async () => {
    const { keys, dir: d } = await makeKeys();
    dir = d;
    await expect(keys.save('not-a-tool', 'k')).rejects.toThrow(
      'Invalid tool key name',
    );
  });

  it('status() with an unregistered tool name rejects (throw propagates)', async () => {
    const { keys, dir: d } = await makeKeys();
    dir = d;
    await expect(keys.status('not-a-tool')).rejects.toThrow(
      'Invalid tool key name',
    );
  });

  // T18c — no key, no keyfile → { toolName, hasKey:false } only.
  it('status() with no key and no keyfile omits maskedKey', async () => {
    const { keys, dir: d } = await makeKeys();
    dir = d;
    const status = await keys.status('exa');
    expect(status).toStrictEqual({ toolName: 'exa', hasKey: false });
    expect(Object.keys(status)).not.toContain('maskedKey');
  });

  // T18d — keyfile round-trip; status carries keyFile when configured.
  it('setKeyFile/getKeyFile round-trips set, clear, and surfaces keyFile in status', async () => {
    const { keys, dir: d } = await makeKeys();
    dir = d;
    await keys.setKeyFile('exa', '/tmp/exa.key');
    expect(await keys.getKeyFile('exa')).toBe('/tmp/exa.key');
    const status = await keys.status('exa');
    expect(status.toolName).toBe('exa');
    expect(status.hasKey).toBe(false);
    expect(status.keyFile).toBe('/tmp/exa.key');
    await keys.setKeyFile('exa', null);
    expect(await keys.getKeyFile('exa')).toBe(null);
  });

  // T19 — the PUBLIC agent exposes agent.tools.keys DISTINCT from agent.auth.keys.
  it('agent.tools.keys is exposed on the public agent and distinct from agent.auth.keys', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const supportedNames = agent.tools.keys
        .supported()
        .map((e) => e.toolName);
      expect(supportedNames).toContain('exa');
      expect(agent.tools.keys !== agent.auth.keys).toBe(true);
    } finally {
      await cleanup();
    }
  });

  // PROP — save/delete round-trip over real storage.
  it('save then delete round-trips hasKey true then false (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((s) => s.length > 0),
        async (key) => {
          const { keys, dir: d } = await makeKeys();
          await keys.save('exa', key);
          expect((await keys.status('exa')).hasKey).toBe(true);
          await keys.delete('exa');
          expect((await keys.status('exa')).hasKey).toBe(false);
          await fs.rm(d, { recursive: true, force: true });
        },
      ),
      { numRuns: 8 },
    );
  });

  // PROP — mask no-leak for length>8 keys.
  it('mask never leaks the raw key for length>8 keys (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 9, maxLength: 40 })
          .filter((s) => !s.includes('*') && s.length > 8),
        async (key) => {
          const { keys, dir: d } = await makeKeys();
          await keys.save('exa', key);
          const status = await keys.status('exa');
          expect(status.maskedKey?.length).toBe(key.length);
          expect(status.maskedKey?.startsWith(key.slice(0, 2))).toBe(true);
          expect(status.maskedKey?.endsWith(key.slice(-2))).toBe(true);
          expect(status.maskedKey).not.toBe(key);
          // The raw key must not appear within the masked value.
          expect(status.maskedKey).not.toContain(key);
          await fs.rm(d, { recursive: true, force: true });
        },
      ),
      { numRuns: 8 },
    );
  });

  // PROP — mask fully masks length<=8 keys.
  it('mask fully masks length<=8 keys (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 8 })
          .filter((s) => !s.includes('*')),
        async (key) => {
          const { keys, dir: d } = await makeKeys();
          await keys.save('exa', key);
          const status = await keys.status('exa');
          expect(status.maskedKey).toBe('*'.repeat(key.length));
          expect(status.maskedKey).not.toBe(key);
          // The raw key must not appear within the masked value.
          expect(status.maskedKey).not.toContain(key);
          await fs.rm(d, { recursive: true, force: true });
        },
      ),
      { numRuns: 8 },
    );
  });

  // PROP — supported() is a registry projection invariant.
  it('supported() projects every registry name with toolName+displayName (property)', async () => {
    const { keys, dir: d } = await makeKeys();
    dir = d;
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const entries = keys.supported();
        for (const e of entries) {
          expect(typeof e.toolName).toBe('string');
          expect(e.toolName.length).toBeGreaterThan(0);
          expect(typeof e.displayName).toBe('string');
          expect(e.displayName.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 5 },
    );
  });
});
