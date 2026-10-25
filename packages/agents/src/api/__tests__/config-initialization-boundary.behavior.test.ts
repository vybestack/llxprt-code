import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Config, MessageBus } from '@vybestack/llxprt-code-core';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { IdeClient } from '@vybestack/llxprt-code-ide-integration';
import { McpClientManager } from '@vybestack/llxprt-code-mcp';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';

import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('explicit workspace startup ownership boundary', () => {
  const credentials = useOwnedCredentials();
  let directory: string;
  let config: Config;
  let policy: RuntimePolicyOwner;
  const cleanup: Array<() => void | Promise<void>> = [];
  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'workspace-startup-')),
    );
    config = new Config({
      sessionId: 'startup-boundary',
      cwd: directory,
      targetDir: directory,
      model: 'workspace-test',
      debugMode: false,
      trustedFolder: true,
      skillsSupport: true,
      telemetry: { enabled: false },
    });
    const skill = join(directory, '.agents', 'skills', 'startup-skill');
    await mkdir(skill, { recursive: true });
    await writeFile(
      join(skill, 'SKILL.md'),
      '---\nname: startup-skill\ndescription: startup publication\n---\nexplicit workspace bytes',
    );
    policy = new RuntimePolicyOwner(config);
    cleanup.push(
      () => rm(directory, { recursive: true, force: true }),
      () => config.dispose(),
      () => policy.dispose(),
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    const failures: unknown[] = [];
    for (const close of cleanup.splice(0).reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Workspace fixture cleanup failed');
  });

  async function acquire(): Promise<McpRuntimeOwner> {
    const owner = await createTestMcpRuntime(
      {
        oauth: createTestOAuthBinding(),
        config,
        policy: { owner: policy, ownership: 'caller' },
      },
      {},
    );
    cleanup.push(() => owner.dispose());
    return owner;
  }

  async function readPhysicalFile(owner: McpRuntimeOwner): Promise<string> {
    const tool = owner.toolSelection.getTool('activate_skill');
    if (tool === undefined)
      throw new Error('Workspace owner did not publish activate_skill');
    const result = await tool.buildAndExecute(
      { name: 'startup-skill' },
      new AbortController().signal,
    );
    return String(result.llmContent);
  }

  it('keeps Config declarative while shorthand bus selection initializes real workspace tools', async () => {
    const messageBus = policy.session.messageBus;
    const owner = await acquire();
    await owner.initialize();
    expect('initialize' in config).toBe(false);
    expect('ensureInitialized' in config).toBe(false);
    expect('hasInitializationStarted' in config).toBe(false);
    expect(owner.messageBus).toBe(messageBus);
    expect(await readPhysicalFile(owner)).toContain('explicit workspace bytes');
  });

  it('resolves a narrow bus read at the owning acquisition seam without a dependency graph factory', async () => {
    const owner = await acquire();
    await owner.initialize();
    owner.assertConfig(config, policy.session.messageBus);
    expect(await readPhysicalFile(owner)).toContain('explicit workspace bytes');
    const original = owner.initialize();
    const repeated = owner.initialize();
    expect(repeated).toBe(original);
    expect(owner.messageBus).toBe(policy.session.messageBus);
  });

  it('rejects a missing bus from a handoff read without replacing or closing the live owner', async () => {
    const owner = await acquire();
    await owner.initialize();
    const readBus = (): undefined => undefined;
    expect(() =>
      Reflect.apply(owner.assertConfig, owner, [config, readBus()]),
    ).toThrow('MCP runtime handoff must retain its Config and MessageBus');
    expect(await readPhysicalFile(owner)).toContain('explicit workspace bytes');
  });

  it('rejects an undefined bus field while preserving the original exact Config and bus', async () => {
    const owner = await acquire();
    await owner.initialize();
    const handoff = { config, messageBus: undefined };
    expect(() =>
      Reflect.apply(owner.assertConfig, owner, [
        handoff.config,
        handoff.messageBus,
      ]),
    ).toThrow('MCP runtime handoff must retain its Config and MessageBus');
    owner.assertConfig(config, policy.session.messageBus);
    expect(await readPhysicalFile(owner)).toContain('explicit workspace bytes');
  });

  it('refuses caller-owned startup without its actual owner before credential acquisition', async () => {
    const settings = new SettingsService();
    const settingsOwner = new SessionSettingsOwner(settings);
    cleanup.push(() => settingsOwner.dispose());
    await expect(
      Reflect.apply(fromConfig, undefined, [
        config,
        settings,
        { mcpOwnership: 'caller' },
        settingsOwner,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        credentials().authority,
      ]),
    ).rejects.toThrow('Caller-owned MCP requires an explicit runtime handoff');
    expect(credentials().snapshot()).toStrictEqual([]);
    expect(credentials().keySnapshot()).toStrictEqual([]);
  });

  it('shares the exact concurrent startup promise and one real tool publication', async () => {
    const owner = await acquire();
    const first = owner.initialize();
    const second = owner.initialize();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    const names = owner.toolSelection.getAllToolNames();
    expect(names.filter((name) => name === 'activate_skill')).toHaveLength(1);
    expect(await readPhysicalFile(owner)).toContain('explicit workspace bytes');
  });

  it('caches an exact failed infrastructure acquisition and never silently retries it', async () => {
    const owner = await createTestMcpRuntime(
      {
        oauth: createTestOAuthBinding(),
        config,
        policy: { owner: policy, ownership: 'caller' },
      },
      {},
    );
    const primary = new Error('IDE infrastructure acquisition failed');
    const connection = vi.spyOn(IdeClient, 'create').mockRejectedValue(primary);
    try {
      const first = owner.initialize();
      await expect(first).rejects.toBe(primary);
      connection.mockRestore();
      const retried = owner.initialize();
      expect(retried).toBe(first);
      await expect(retried).rejects.toBe(primary);
      expect(owner.toolSelection.getAllToolNames()).not.toContain(
        'activate_skill',
      );
      expect(owner.workspaceSkills.operations.list()).toStrictEqual([]);
    } finally {
      const retirement = await owner.dispose().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(retirement).toBeInstanceOf(AggregateError);
      const causes = (error: unknown): unknown[] =>
        error instanceof AggregateError
          ? error.errors.flatMap(causes)
          : [error];
      expect(causes(retirement)).toContain(primary);
    }
  });

  it('refuses a new startup after the owning workspace has stopped instead of reconstructing it', async () => {
    const owner = await acquire();
    await owner.initialize();
    await owner.dispose();
    expect(() => owner.initialize()).toThrow(
      'Cannot initialize a stopped MCP runtime',
    );
    expect(() => owner.toolSelection.getTool('activate_skill')).toThrow(
      'Workspace tool selection is closed',
    );
  });

  it('retains the original successful promise when startup is requested again', async () => {
    const owner = await acquire();
    const original = owner.initialize();
    await original;
    expect(await readPhysicalFile(owner)).toContain('explicit workspace bytes');
    await rm(join(directory, '.agents', 'skills', 'startup-skill'), {
      recursive: true,
    });
    const replacement = join(directory, '.agents', 'skills', 'not-admitted');
    await mkdir(replacement);
    await writeFile(
      join(replacement, 'SKILL.md'),
      '---\nname: not-admitted\ndescription: changed physical inputs\n---\nnot yet initialized',
    );
    const repeated = owner.initialize();
    expect(repeated).toBe(original);
    await repeated;
    expect(
      owner.workspaceSkills.operations.list().map((skill) => skill.name),
    ).toStrictEqual(['startup-skill']);
    expect(
      owner.toolSelection
        .getAllToolNames()
        .filter((name) => name === 'activate_skill'),
    ).toHaveLength(1);
  });

  it('rejects another concrete bus at handoff and continues on the original bus', async () => {
    const owner = await acquire();
    await owner.initialize();
    const wrong = new MessageBus();
    expect(() => owner.assertConfig(config, wrong)).toThrow(
      'MCP runtime handoff must retain its Config and MessageBus',
    );
    expect(owner.messageBus).toBe(policy.session.messageBus);
    expect(await readPhysicalFile(owner)).toContain('explicit workspace bytes');
  });

  it('accepts an aliased bus variable without changing workspace identity or tool effects', async () => {
    const renamed = policy.session.messageBus;
    const owner = await acquire();
    await owner.initialize();
    expect(owner.messageBus).toBe(renamed);
    expect(await readPhysicalFile(owner)).toContain('explicit workspace bytes');
  });
  it('releases the first trust subscription when later subscription acquisition fails and preserves borrowed authority', async () => {
    const primary = new Error('second trust subscription failed');
    let disposal: Promise<unknown> | undefined;
    class FailingTrust extends WorkspaceTrustLifecycle {
      override subscribeTrustTransition(): () => void {
        disposal = owner.dispose().then(
          () => undefined,
          (error: unknown) => error,
        );
        throw primary;
      }
    }
    const trust = new FailingTrust({ localTrust: true });
    cleanup.push(() => trust.dispose());
    const borrowedPolicy = new RuntimePolicyOwner(config, trust);
    cleanup.push(() => borrowedPolicy.dispose());
    const owner = await createTestMcpRuntime(
      {
        oauth: createTestOAuthBinding(),
        config,
        policy: { owner: borrowedPolicy, ownership: 'caller' },
      },
      {},
    );
    await expect(owner.initialize()).rejects.toBe(primary);
    const failed = await disposal;
    expect(failed).toBeInstanceOf(AggregateError);
    vi.spyOn(
      McpClientManager.prototype,
      'quarantineForTrustRevocation',
    ).mockImplementation(() => {
      throw new Error('orphaned manager subscription survived failed startup');
    });
    await expect(trust.setTrustedFolderLive(false)).resolves.toBeUndefined();
    expect(trust.isTrustedFolder()).toBe(false);
    await expect(trust.setTrustedFolderLive(true)).resolves.toBeUndefined();
    expect(trust.isTrustedFolder()).toBe(true);
  });
});
