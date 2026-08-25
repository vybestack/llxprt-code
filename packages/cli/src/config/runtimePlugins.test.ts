/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for issue #2758 AC1-AC3: the `runtimePlugins` setting is
 * read only from trusted layers, in a deterministic order, and every entry must
 * be a bare npm package root. Rejections are explicit and actionable.
 */

import { describe, expect, it } from 'bun:test';
import {
  normalizeRuntimePluginSpecifier,
  resolveRuntimePluginSpecifiers,
} from './runtimePlugins.js';
import { LoadedSettings, type Settings } from './settings.js';

const SYSTEM_DEFAULTS_PATH = '/etc/llxprt/system-defaults.json';
const SYSTEM_PATH = '/etc/llxprt/settings.json';
const USER_PATH = '/home/user/.llxprt/settings.json';
const WORKSPACE_PATH = '/project/.llxprt/settings.json';

interface LayerValues {
  readonly systemDefaults?: unknown;
  readonly system?: unknown;
  readonly user?: unknown;
  readonly workspace?: unknown;
}

function layer(
  path: string,
  runtimePlugins: unknown,
): { path: string; settings: Settings } {
  const settings = runtimePlugins === undefined ? {} : { runtimePlugins };
  return { path, settings: settings as Settings };
}

function makeSettings(values: LayerValues = {}): LoadedSettings {
  return new LoadedSettings(
    layer(SYSTEM_PATH, values.system),
    layer(SYSTEM_DEFAULTS_PATH, values.systemDefaults),
    layer(USER_PATH, values.user),
    layer(WORKSPACE_PATH, values.workspace),
    true,
  );
}

describe('resolveRuntimePluginSpecifiers', () => {
  it('returns no specifiers when runtimePlugins is configured nowhere', () => {
    expect(resolveRuntimePluginSpecifiers(makeSettings())).toEqual([]);
  });

  it('returns user-scope entries in their configured order', () => {
    const specifiers = resolveRuntimePluginSpecifiers(
      makeSettings({ user: ['zeta-plugin', 'alpha-plugin'] }),
    );

    expect(specifiers).toEqual(['zeta-plugin', 'alpha-plugin']);
  });

  it('orders system defaults, then system, then user entries', () => {
    const specifiers = resolveRuntimePluginSpecifiers(
      makeSettings({
        systemDefaults: ['defaults-a', 'defaults-b'],
        system: ['system-a'],
        user: ['user-a', 'user-b'],
      }),
    );

    expect(specifiers).toEqual([
      'defaults-a',
      'defaults-b',
      'system-a',
      'user-a',
      'user-b',
    ]);
  });

  it('deduplicates a package listed in more than one trusted layer', () => {
    // Listing the same package in system and user settings is a benign
    // misconfiguration; it must not surface as a duplicate-plugin-id failure.
    const specifiers = resolveRuntimePluginSpecifiers(
      makeSettings({
        system: ['shared-plugin', 'system-only'],
        user: ['shared-plugin', 'user-only'],
      }),
    );

    expect(specifiers).toEqual(['shared-plugin', 'system-only', 'user-only']);
  });

  it('trims surrounding whitespace on accepted entries', () => {
    expect(
      resolveRuntimePluginSpecifiers(
        makeSettings({ user: ['  spaced-plugin '] }),
      ),
    ).toEqual(['spaced-plugin']);
  });

  it('rejects runtimePlugins configured in workspace settings', () => {
    const settings = makeSettings({ workspace: ['sneaky-plugin'] });

    let thrown: unknown;
    try {
      resolveRuntimePluginSpecifiers(settings);
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) {
      throw new Error('expected resolveRuntimePluginSpecifiers to throw');
    }
    expect(thrown.message).toContain('runtimePlugins');
    expect(thrown.message).toContain('workspace');
    expect(thrown.message).toContain(WORKSPACE_PATH);
  });

  it('rejects a workspace value even when a trusted layer also configures the setting', () => {
    expect(() =>
      resolveRuntimePluginSpecifiers(
        makeSettings({ workspace: ['sneaky-plugin'], user: ['ok-plugin'] }),
      ),
    ).toThrow(/not allowed in workspace/);
  });

  it('rejects an empty workspace array, so provenance does not depend on the value', () => {
    expect(() =>
      resolveRuntimePluginSpecifiers(makeSettings({ workspace: [] })),
    ).toThrow(/not allowed in workspace/);
  });

  it('rejects a non-array value, naming the layer and its file', () => {
    let thrown: unknown;
    try {
      resolveRuntimePluginSpecifiers(makeSettings({ user: 'not-an-array' }));
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) {
      throw new Error('expected resolveRuntimePluginSpecifiers to throw');
    }
    expect(thrown.message).toContain('user');
    expect(thrown.message).toContain(USER_PATH);
    expect(thrown.message).toContain('not-an-array');
  });

  it('rejects an array containing a non-string, naming the offending value', () => {
    let thrown: unknown;
    try {
      resolveRuntimePluginSpecifiers(
        makeSettings({ system: ['good-plugin', 42] }),
      );
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) {
      throw new Error('expected resolveRuntimePluginSpecifiers to throw');
    }
    expect(thrown.message).toContain('system');
    expect(thrown.message).toContain(SYSTEM_PATH);
    expect(thrown.message).toContain('42');
  });

  it('propagates a specifier rejection from a trusted layer', () => {
    expect(() =>
      resolveRuntimePluginSpecifiers(makeSettings({ user: ['node:fs'] })),
    ).toThrow(/Node built-in module/);
  });
});

describe('normalizeRuntimePluginSpecifier', () => {
  it.each([
    ['my-plugin', 'my-plugin'],
    ['@scope/my-plugin', '@scope/my-plugin'],
    ['plugin.with.dots', 'plugin.with.dots'],
    ['  padded-plugin  ', 'padded-plugin'],
  ])('accepts the bare package root %p', (input, expected) => {
    expect(normalizeRuntimePluginSpecifier(input)).toBe(expected);
  });

  it.each([
    ['', 'the value is empty'],
    ['   ', 'the value is empty'],
    ['fs', 'Node built-in module'],
    ['path', 'Node built-in module'],
    ['node:fs', 'Node built-in module'],
    ['file:///x', 'a URL is not accepted'],
    ['http://x', 'a URL is not accepted'],
    ['https://x', 'a URL is not accepted'],
    ['data:text/plain,x', 'a URL is not accepted'],
    ['./p', 'a filesystem path is not accepted'],
    ['../p', 'a filesystem path is not accepted'],
    ['/abs/p', 'a filesystem path is not accepted'],
    ['~/p', 'a filesystem path is not accepted'],
    ['C:\\p', 'a filesystem path is not accepted'],
    ['a\\b', 'a filesystem path is not accepted'],
    ['pkg/sub', 'a package subpath is not accepted'],
    ['@scope/pkg/sub', 'a package subpath is not accepted'],
    ['@scope/pkg/a/b', 'a package subpath is not accepted'],
    ['.hidden', 'malformed npm package name'],
    ['_leading', 'malformed npm package name'],
    ['@scope', 'malformed npm package name'],
    ['@/x', 'malformed npm package name'],
    ['Upper', 'malformed npm package name'],
  ])('rejects %p because of %p', (specifier, reason) => {
    let thrown: unknown;
    try {
      normalizeRuntimePluginSpecifier(specifier);
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) {
      throw new Error(`expected '${specifier}' to be rejected`);
    }
    expect(thrown.message).toContain(reason);
    expect(thrown.message).toContain('runtimePlugins');
  });
});
