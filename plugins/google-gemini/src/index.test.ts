/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { llxprtRuntimePlugin } from './index.js';

interface PluginManifest {
  name?: string;
  version?: string;
  llxprt?: { runtimePlugin?: boolean };
}

const packageJson = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../package.json', import.meta.url)),
    'utf8',
  ),
) as PluginManifest;

describe('@vybestack/llxprt-plugin-google-gemini manifest', () => {
  it('declares the runtime plugin marker the host discovery scans for', () => {
    expect(packageJson.llxprt).toStrictEqual({ runtimePlugin: true });
  });

  it('exports a manifest v1 whose id is the package name', () => {
    expect(llxprtRuntimePlugin.apiVersion).toBe(1);
    expect(packageJson.name).toBe(llxprtRuntimePlugin.id);
    expect(llxprtRuntimePlugin.providers.length).toBeGreaterThanOrEqual(1);
  });

  it('contributes the placeholder google-gemini provider factory', () => {
    const [contribution] = llxprtRuntimePlugin.providers;
    expect(contribution?.providerId).toBe('google-gemini');
    expect(typeof contribution?.createProvider).toBe('function');
  });

  it('fails provider construction actionably while the implementation is not extracted', () => {
    const createProvider = llxprtRuntimePlugin.providers[0]?.createProvider;
    expect(createProvider).toBeDefined();
    // The placeholder factory contractually never reads its arguments: it
    // exists so the manifest passes host validation while the Gemini
    // production extraction is pending. The unusable arguments carry `never`
    // for that reason.
    expect(() => createProvider?.(undefined as never, undefined as never)).toThrow(
      /gemini/i,
    );
  });
});
