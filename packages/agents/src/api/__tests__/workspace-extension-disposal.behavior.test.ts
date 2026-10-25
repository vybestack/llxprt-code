/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SimpleExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import type { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';

interface FakeExtension {
  readonly name: string;
  readonly version: string;
  readonly isActive: boolean;
  readonly path: string;
  readonly contextFiles: readonly string[];
}

interface ExtensionDisposal {
  readonly mcp: McpRuntimeOwner;
  readonly recorder: { readonly unloaded: readonly string[] };
  readonly close: () => Promise<void>;
}

/**
 * Domain-level subject: the production `McpRuntimeOwner` (settled route 2 for
 * extension scenarios) over a loader the test owns. The recorder reads which of
 * the loader's extensions it has dropped.
 */
async function openExtensionOwner(
  extensions: readonly FakeExtension[],
  missingUnload = false,
): Promise<ExtensionDisposal> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'extension-disposal-')),
  );
  const config = new Config({
    ...toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      workingDir: directory,
    }),
    enableExtensionReloading: true,
    interactive: true,
    includeDirectories: [process.cwd()],
  });
  const policy = new RuntimePolicyOwner(config);
  injectConfirmationForcingPolicy(policy.session.confirmation);
  const data = extensions.map((extension) => ({
    ...extension,
    contextFiles: [...extension.contextFiles],
  }));
  const loader = new SimpleExtensionLoader([...data]);
  const mcp = await buildTestMcpRuntime(
    config,
    policy.session.messageBus,
    {},
    loader,
    policy,
  );
  const close = (): Promise<void> =>
    runCleanupSteps([
      () => mcp.dispose(),
      () => policy.dispose(),
      () => config.dispose(),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  try {
    await mcp.initialize();
  } catch (primary) {
    await close().catch(() => undefined);
    throw primary;
  }
  if (missingUnload)
    Object.defineProperty(loader, 'unloadExtension', { value: undefined });
  return {
    mcp,
    recorder: {
      get unloaded(): readonly string[] {
        return data
          .filter((extension) => !loader.getExtensions().includes(extension))
          .map((extension) => extension.name);
      },
    },
    close,
  };
}

function nestedMessages(error: unknown): string[] {
  if (!(error instanceof Error)) return [String(error)];
  const nested =
    error instanceof AggregateError
      ? error.errors.flatMap((item: unknown) => nestedMessages(item))
      : [];
  return [error.message, ...nested];
}

describe('workspace extension teardown at runtime disposal', () => {
  it('T13e extension teardown unloads ONLY the active extensions (inactive ones are filtered out), in encounter order', async () => {
    const extensions: readonly FakeExtension[] = [
      {
        name: 'alpha',
        version: '1.0.0',
        isActive: true,
        path: '/ext/alpha',
        contextFiles: [],
      },
      {
        name: 'beta-inactive',
        version: '1.0.0',
        isActive: false,
        path: '/ext/beta',
        contextFiles: [],
      },
      {
        name: 'gamma',
        version: '2.0.0',
        isActive: true,
        path: '/ext/gamma',
        contextFiles: [],
      },
    ];
    const { mcp, close, recorder } = await openExtensionOwner(extensions);
    try {
      // The recorder names the extensions the loader actually dropped, so the
      // assertion verifies the real filtering output: inactive extensions are
      // never unloaded, active ones are unloaded in encounter order.
      expect(recorder.unloaded).toStrictEqual([]);

      await mcp.dispose();

      expect(recorder.unloaded).toStrictEqual(['alpha', 'gamma']);
    } finally {
      await close();
    }
  });

  it('T13e when every extension is inactive, NONE are unloaded yet teardown still completes', async () => {
    const extensions: readonly FakeExtension[] = [
      {
        name: 'idle-one',
        version: '1.0.0',
        isActive: false,
        path: '/ext/one',
        contextFiles: [],
      },
      {
        name: 'idle-two',
        version: '1.0.0',
        isActive: false,
        path: '/ext/two',
        contextFiles: [],
      },
    ];
    const { mcp, close, recorder } = await openExtensionOwner(extensions);
    try {
      await mcp.dispose();

      expect(recorder.unloaded).toStrictEqual([]);
    } finally {
      await close();
    }
  });

  it('T13e a loader lacking the required unloadExtension method reports failure while other teardown completes', async () => {
    const extensions: readonly FakeExtension[] = [
      {
        name: 'active-but-unloadless',
        version: '1.0.0',
        isActive: true,
        path: '/ext/x',
        contextFiles: [],
      },
    ];
    const { mcp, close, recorder } = await openExtensionOwner(extensions, true);
    try {
      const failure = await mcp.dispose().then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(
        nestedMessages(failure).some((message) =>
          message.includes('this.unloadExtension is not a function'),
        ),
      ).toBe(true);
      expect(recorder.unloaded).toStrictEqual([]);
    } finally {
      await close().catch(() => undefined);
    }
  });
});
