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

describe('@vybestack/llxprt-plugin-google-mcp-auth manifest', () => {
  it('declares the runtime plugin marker the host discovery scans for', () => {
    expect(packageJson.llxprt).toStrictEqual({ runtimePlugin: true });
  });

  it('exports a manifest v1 whose id is the package name', () => {
    expect(llxprtRuntimePlugin.apiVersion).toBe(1);
    expect(packageJson.name).toBe(llxprtRuntimePlugin.id);
    expect(llxprtRuntimePlugin.providers.length).toBeGreaterThanOrEqual(1);
  });

  it('contributes the reserved google-mcp-auth stub factory', () => {
    const [contribution] = llxprtRuntimePlugin.providers;
    expect(contribution?.providerId).toBe('google-mcp-auth');
    expect(typeof contribution?.createProvider).toBe('function');
  });

  it('fails provider construction actionably as a reserved stub', () => {
    const createProvider = llxprtRuntimePlugin.providers[0]?.createProvider;
    expect(createProvider).toBeDefined();
    // The reserved stub contractually never reads its arguments; the context
    // arguments carry `never` for that reason.
    expect(() =>
      createProvider?.(undefined as never, undefined as never),
    ).toThrow(/google-mcp-auth|reserved/i);
  });
});
