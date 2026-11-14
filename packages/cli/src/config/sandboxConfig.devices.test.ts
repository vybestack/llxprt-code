/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sandbox-profile `devices` grants, driven through real profile JSON files in
 * the isolated config directory and the real `loadSandboxConfig`. Only the
 * engine-presence probes (`command-exists`, the bwrap capability probe) are
 * substituted, as in the neighbouring precedence suites.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import type { Settings } from './settings.js';

const availableEngines = new Set<string>();

void vi.mock('command-exists', () => ({
  default: { sync: (command: string) => availableEngines.has(command) },
}));
void vi.mock('../utils/sandbox-bwrap-capability.js', () => ({
  probeBwrapCapability: vi.fn(),
}));

const { loadSandboxConfig } = await import('./sandboxConfig.js');
const { ensureDefaultSandboxProfiles, getSandboxProfilesDir } = await import(
  './sandboxProfiles.js'
);

const ORIGINAL_ENV = { ...process.env };
const settings: Settings = {};
const missingDevice = '/dev/phase1c-missing-device';

async function writeProfile(name: string, profile: unknown): Promise<void> {
  const directory = getSandboxProfilesDir();
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, `${name}.json`),
    JSON.stringify(profile),
  );
}

async function fatalFrom(action: Promise<unknown>): Promise<FatalSandboxError> {
  try {
    await action;
  } catch (error) {
    if (error instanceof FatalSandboxError) return error;
    throw error;
  }
  throw new Error('expected a FatalSandboxError');
}

const notLinux = process.platform !== 'linux';

describe('sandbox profile devices', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    for (const key of [
      'SANDBOX',
      'LLXPRT_SANDBOX',
      'LLXPRT_SANDBOX_IMAGE',
      'LLXPRT_SANDBOX_NETWORK',
      'SANDBOX_NETWORK',
      'LLXPRT_SANDBOX_SSH_AGENT',
      'SANDBOX_SSH_AGENT',
      'LLXPRT_SANDBOX_MOUNTS',
      'SANDBOX_MOUNTS',
      'DBUS_SESSION_BUS_ADDRESS',
      'DBUS_SYSTEM_BUS_ADDRESS',
    ]) {
      delete process.env[key];
    }
    availableEngines.clear();
    availableEngines.add('bwrap');
    availableEngines.add('docker');
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it.skipIf(notLinux)(
    'treats absent and empty devices as the same default confinement',
    async () => {
      await writeProfile('none-granted', { engine: 'bwrap' });
      await writeProfile('empty-granted', { engine: 'bwrap', devices: [] });

      const absent = await loadSandboxConfig(settings, {
        sandboxProfileLoad: 'none-granted',
      });
      const empty = await loadSandboxConfig(settings, {
        sandboxProfileLoad: 'empty-granted',
      });

      expect(absent?.command).toBe('bwrap');
      expect(empty).toStrictEqual(absent);
      expect(absent).not.toHaveProperty('devices');
    },
  );

  it.skipIf(notLinux)(
    'leaves a customized default profile untouched when defaults are ensured',
    async () => {
      await writeProfile('dev', { engine: 'bwrap', devices: ['/dev/null'] });

      await ensureDefaultSandboxProfiles(undefined);

      const stored: unknown = JSON.parse(
        await fs.readFile(
          path.join(getSandboxProfilesDir(), 'dev.json'),
          'utf8',
        ),
      );
      expect(stored).toStrictEqual({ engine: 'bwrap', devices: ['/dev/null'] });
    },
  );

  it.skipIf(notLinux)(
    'carries canonical device grants into the bwrap configuration',
    async () => {
      await writeProfile('granted', {
        engine: 'bwrap',
        devices: ['/dev//null', '/dev/null'],
      });

      const config = await loadSandboxConfig(settings, {
        sandboxProfileLoad: 'granted',
      });

      expect(config).toMatchObject({
        command: 'bwrap',
        devices: ['/dev/null'],
      });
    },
  );

  it.skipIf(notLinux)(
    'carries device grants into the container configuration',
    async () => {
      await writeProfile('granted-container', {
        engine: 'docker',
        image: 'example/sandbox:1',
        devices: ['/dev/null'],
      });

      const config = await loadSandboxConfig(settings, {
        sandboxProfileLoad: 'granted-container',
      });

      expect(config).toStrictEqual({
        command: 'docker',
        image: 'example/sandbox:1',
        devices: ['/dev/null'],
      });
    },
  );

  it.skipIf(notLinux)(
    'rejects malformed devices with the profile name and indexed field',
    async () => {
      await writeProfile('malformed', {
        engine: 'bwrap',
        devices: ['/dev/null', 7],
      });

      const error = await fatalFrom(
        loadSandboxConfig(settings, { sandboxProfileLoad: 'malformed' }),
      );

      expect(error.message).toContain("sandbox profile 'malformed'");
      expect(error.message).toContain('devices[1]');
    },
  );

  it.skipIf(notLinux)(
    'rejects device paths outside the /dev namespace',
    async () => {
      await writeProfile('escaping', {
        engine: 'bwrap',
        devices: ['/etc/passwd'],
      });

      const error = await fatalFrom(
        loadSandboxConfig(settings, { sandboxProfileLoad: 'escaping' }),
      );

      expect(error.message).toContain('/etc/passwd');
    },
  );

  it.skipIf(notLinux)(
    'rejects a device that does not exist on this host',
    async () => {
      await writeProfile('absent-hardware', {
        engine: 'bwrap',
        devices: [missingDevice],
      });

      const error = await fatalFrom(
        loadSandboxConfig(settings, { sandboxProfileLoad: 'absent-hardware' }),
      );

      expect(error.message).toContain(missingDevice);
    },
  );

  it.skipIf(notLinux)(
    'rejects a missing device for a container engine even when its image is missing',
    async () => {
      await writeProfile('absent-container-hardware', {
        engine: 'docker',
        devices: [missingDevice],
      });

      const error = await fatalFrom(
        loadSandboxConfig(settings, {
          sandboxProfileLoad: 'absent-container-hardware',
          sandboxImage: '',
        }),
      );

      expect(error.message).toContain(missingDevice);
    },
  );

  it.skipIf(notLinux)(
    'rejects devices for Seatbelt even when its image is missing',
    async () => {
      availableEngines.add('sandbox-exec');
      await writeProfile('seatbelt-gpu', { devices: ['/dev/null'] });

      const error = await fatalFrom(
        loadSandboxConfig(settings, {
          sandbox: 'sandbox-exec',
          sandboxProfileLoad: 'seatbelt-gpu',
          sandboxImage: '',
        }),
      );

      expect(error.message).toMatch(/sandbox-exec does not support/);
    },
  );

  it.skipIf(notLinux)(
    'does not probe the host again inside an existing sandbox',
    async () => {
      process.env.SANDBOX = 'bwrap';
      vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
      await writeProfile('nested-granted', {
        engine: 'bwrap',
        devices: [missingDevice],
      });

      const config = await loadSandboxConfig(settings, {
        sandboxProfileLoad: 'nested-granted',
      });

      expect(config).toBeUndefined();
    },
  );

  it.skipIf(notLinux)(
    'still validates devices shape inside an existing sandbox',
    async () => {
      process.env.SANDBOX = 'bwrap';
      vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
      await writeProfile('nested-malformed', {
        engine: 'bwrap',
        devices: 'not-an-array',
      });

      const error = await fatalFrom(
        loadSandboxConfig(settings, { sandboxProfileLoad: 'nested-malformed' }),
      );

      expect(error.message).toContain('devices');
    },
  );

  it.skipIf(notLinux)(
    'keeps explicit engine none sandbox-free without inspecting devices',
    async () => {
      await writeProfile('disabled', {
        engine: 'none',
        devices: [missingDevice],
      });

      await expect(
        loadSandboxConfig(settings, { sandboxProfileLoad: 'disabled' }),
      ).resolves.toBeUndefined();
      await expect(
        loadSandboxConfig(settings, {
          sandboxProfileLoad: 'disabled',
          sandboxEngine: 'none',
        }),
      ).resolves.toBeUndefined();
    },
  );
});
