/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';
import { createRuntimeSettingsService } from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import type { Profile } from '@vybestack/llxprt-code-settings';
import {
  populatePreActivationSettings,
  populatePostActivationSettings,
} from './subagentSettingsPopulation.js';

function createTempKeyfile(content: string): {
  keyPath: string;
  cleanup: () => void;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-auth-'));
  const keyPath = path.join(tempDir, 'key.txt');
  fs.writeFileSync(keyPath, content, 'utf8');
  return {
    keyPath,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}

function createProfile(
  ephemeralSettings: Profile['ephemeralSettings'],
): Profile {
  return {
    version: 1,
    provider: 'anthropic',
    model: 'claude-fable-5',
    modelParams: {},
    ephemeralSettings,
  };
}

describe('populatePreActivationSettings and populatePostActivationSettings', () => {
  it('loads keyfile auth into both generic and provider-scoped settings', () => {
    const { keyPath, cleanup } = createTempKeyfile(' key-from-file \n');
    try {
      const service = createRuntimeSettingsService();

      const profile = createProfile({ 'auth-keyfile': keyPath });
      populatePreActivationSettings(service, profile, 'keyfile-profile');
      populatePostActivationSettings(
        service,
        profile,
        'keyfile-profile',
        new Set(),
      );

      expect(service.get('auth-key')).toBe('key-from-file');
      expect(service.get('providers.anthropic.auth-key')).toBe('key-from-file');
      expect(service.get('auth-keyfile')).toBe(keyPath);
      expect(service.get('providers.anthropic.auth-keyfile')).toBe(keyPath);
    } finally {
      cleanup();
    }
  });

  it('prefers explicit auth-key over keyfile when both are present', () => {
    const { keyPath, cleanup } = createTempKeyfile('key-from-file');
    const warn = vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});
    try {
      const service = createRuntimeSettingsService();

      const profile = createProfile({
        'auth-key': 'explicit-key',
        'auth-keyfile': keyPath,
      });
      populatePreActivationSettings(service, profile, 'auth-profile');
      populatePostActivationSettings(
        service,
        profile,
        'auth-profile',
        new Set(),
      );

      expect(service.get('auth-key')).toBe('explicit-key');
      expect(service.get('providers.anthropic.auth-key')).toBe('explicit-key');
      expect(service.get('auth-keyfile')).toBe(keyPath);
      expect(service.get('providers.anthropic.auth-keyfile')).toBe(keyPath);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      cleanup();
    }
  });

  it.each(['   \n\t\n', ''])(
    'does not set auth-key when keyfile is empty after trimming',
    (content) => {
      const warn = vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});
      const { keyPath, cleanup } = createTempKeyfile(content);
      try {
        const service = createRuntimeSettingsService();

        const profile = createProfile({ 'auth-keyfile': keyPath });
        populatePreActivationSettings(
          service,
          profile,
          'empty-keyfile-profile',
        );
        populatePostActivationSettings(
          service,
          profile,
          'empty-keyfile-profile',
          new Set(),
        );

        expect(service.get('auth-key')).toBeUndefined();
        expect(service.get('providers.anthropic.auth-key')).toBeUndefined();
        expect(service.get('auth-keyfile')).toBe(keyPath);
        expect(service.get('providers.anthropic.auth-keyfile')).toBe(keyPath);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('auth key file'),
        );
      } finally {
        warn.mockRestore();
        cleanup();
      }
    },
  );

  it('does not set auth-key when keyfile path does not exist', () => {
    const service = createRuntimeSettingsService();
    const warn = vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});
    const keyPath = path.join(os.tmpdir(), 'subagent-auth-missing', 'key.txt');
    const profile = createProfile({ 'auth-keyfile': keyPath });

    try {
      populatePreActivationSettings(
        service,
        profile,
        'missing-keyfile-profile',
      );
      populatePostActivationSettings(
        service,
        profile,
        'missing-keyfile-profile',
        new Set(),
      );

      expect(service.get('auth-key')).toBeUndefined();
      expect(service.get('providers.anthropic.auth-key')).toBeUndefined();
      expect(service.get('auth-keyfile')).toBe(keyPath);
      expect(service.get('providers.anthropic.auth-keyfile')).toBe(keyPath);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('unable to read auth key file'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('logs the resolved path (not the raw relative path) when keyfile is missing', () => {
    const service = createRuntimeSettingsService();
    const warn = vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-keyfile-'));
    const missingKeyfile = path.join(tempDir, 'nonexistent-key.txt');
    const relativeKeyfile = path.relative(process.cwd(), missingKeyfile);
    const profile = createProfile({ 'auth-keyfile': relativeKeyfile });

    try {
      populatePreActivationSettings(
        service,
        profile,
        'relative-missing-keyfile-profile',
      );
      populatePostActivationSettings(
        service,
        profile,
        'relative-missing-keyfile-profile',
        new Set(),
      );

      expect(warn).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(missingKeyfile),
      );
    } finally {
      warn.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('logs the resolved path when keyfile exists but is empty', () => {
    const warn = vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-keyfile-'));

    try {
      const emptyKeyfile = path.join(tempDir, 'empty-key.txt');
      fs.writeFileSync(emptyKeyfile, '', 'utf8');
      const relativeKeyfile = path.relative(process.cwd(), emptyKeyfile);
      const profile = createProfile({ 'auth-keyfile': relativeKeyfile });
      const service = createRuntimeSettingsService();
      populatePreActivationSettings(
        service,
        profile,
        'relative-empty-keyfile-profile',
      );
      populatePostActivationSettings(
        service,
        profile,
        'relative-empty-keyfile-profile',
        new Set(),
      );

      expect(warn).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(emptyKeyfile),
      );
    } finally {
      warn.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('populates auth-key-name in both generic and provider-scoped settings', () => {
    const service = createRuntimeSettingsService();
    const profile = createProfile({ 'auth-key-name': 'MY_API_KEY' });

    populatePreActivationSettings(service, profile, 'keyname-profile');
    populatePostActivationSettings(
      service,
      profile,
      'keyname-profile',
      new Set(),
    );

    expect(service.get('auth-key-name')).toBe('MY_API_KEY');
    expect(service.get('providers.anthropic.auth-key-name')).toBe('MY_API_KEY');
  });

  it('populates provider, compression, GCP, and misc specialized settings', () => {
    const service = createRuntimeSettingsService();
    const profile: Profile = {
      ...createProfile({
        'base-url': 'https://anthropic.example/v1',
        'compression-preserve-threshold': 0.25,
        'compression-threshold': 0.5,
        'context-limit': 12345,
        GOOGLE_CLOUD_LOCATION: 'us-central1',
        GOOGLE_CLOUD_PROJECT: 'project-a',
        'tool-format': 'xml',
        'user-agent': 'subagent-test',
      }),
      modelParams: {
        max_tokens: 4096,
        temperature: 0.7,
      },
    };

    populatePreActivationSettings(service, profile, 'specialized-profile');
    populatePostActivationSettings(
      service,
      profile,
      'specialized-profile',
      new Set(),
    );

    expect(service.get('providers.anthropic.base-url')).toBe(
      'https://anthropic.example/v1',
    );
    expect(service.get('providers.anthropic.maxTokens')).toBe(4096);
    expect(service.get('providers.anthropic.temperature')).toBe(0.7);
    expect(service.get('compression-preserve-threshold')).toBe(0.25);
    expect(service.get('compression-threshold')).toBe(0.5);
    expect(service.get('context-limit')).toBe(12345);
    expect(service.get('GOOGLE_CLOUD_LOCATION')).toBe('us-central1');
    expect(service.get('GOOGLE_CLOUD_PROJECT')).toBe('project-a');
    expect(service.get('tool-format-override')).toBe('xml');
    expect(service.get('user-agent')).toBe('subagent-test');
  });

  it('merges default-disabled tools with profile-disabled tools', () => {
    const service = createRuntimeSettingsService();
    const profile = createProfile({ 'tools.disabled': ['write_file'] });

    populatePreActivationSettings(service, profile, 'tool-profile');
    populatePostActivationSettings(
      service,
      profile,
      'tool-profile',
      new Set(['read_file']),
    );

    expect(service.get('tools.disabled')).toStrictEqual([
      'write_file',
      'read_file',
    ]);
  });

  it('de-duplicates overlapping profile-disabled and default-disabled tools', () => {
    const service = createRuntimeSettingsService();
    const profile = createProfile({
      'tools.disabled': ['write_file', 'read_file'],
    });

    populatePreActivationSettings(service, profile, 'dedup-tool-profile');
    populatePostActivationSettings(
      service,
      profile,
      'dedup-tool-profile',
      new Set(['read_file']),
    );

    expect(service.get('tools.disabled')).toStrictEqual([
      'write_file',
      'read_file',
    ]);
  });

  it('excludes default-disabled tools that appear in the profile allowlist', () => {
    const service = createRuntimeSettingsService();
    const profile = createProfile({
      'tools.allowed': ['read_file'],
      'tools.disabled': ['write_file'],
    });

    populatePreActivationSettings(service, profile, 'allow-tool-profile');
    populatePostActivationSettings(
      service,
      profile,
      'allow-tool-profile',
      new Set(['read_file']),
    );

    expect(service.get('tools.allowed')).toStrictEqual(['read_file']);
    expect(service.get('tools.disabled')).toStrictEqual(['write_file']);
  });

  it('skips non-cloneable ephemerals instead of aborting population', () => {
    const service = createRuntimeSettingsService();
    const warn = vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});

    try {
      expect(() => {
        const profile = createProfile({
          'custom.valid': { enabled: true },
          'custom.uncloneable': { fn: () => 'not cloneable' },
        });
        populatePreActivationSettings(service, profile, 'custom-profile');
        populatePostActivationSettings(
          service,
          profile,
          'custom-profile',
          new Set(),
        );
      }).not.toThrow();

      expect(service.get('custom.valid')).toStrictEqual({ enabled: true });
      expect(service.get('custom.uncloneable')).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'SubagentOrchestrator: skipping non-cloneable ephemeral setting',
        ),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
