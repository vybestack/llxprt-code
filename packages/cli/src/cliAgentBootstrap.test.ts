/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  Config,
  PolicyDecision,
  ToolConfirmationOutcome,
  WorkspaceTrustLifecycle,
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  prepareAgentPreflight,
  AgentProfilePreflight,
  type AgentActivationOperation,
  type ActivationPreflightToken,
  type ProviderActivationIntent,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { createForegroundAgent } from './cliAgentBootstrap.js';
import {
  registerCleanup,
  runExitCleanup,
  __resetCleanupStateForTesting,
} from './utils/cleanup.js';

describe('createForegroundAgent preferred construction and cleanup', () => {
  let directory: string;
  let config: Config;
  let preflight: AgentProfilePreflight;
  let activation: AgentActivationOperation;
  let token: ActivationPreflightToken;
  let intent: ProviderActivationIntent;
  let agent: Agent | undefined;
  const authority = new CredentialAuthority();
  const previousEnv = { ...process.env };

  beforeEach(async () => {
    __resetCleanupStateForTesting();
    directory = await mkdtemp(join(tmpdir(), 'foreground-composition-'));
    process.env.LLXPRT_CONFIG_HOME = directory;
    process.env.LLXPRT_FAKE_RESPONSES = resolve(
      import.meta.dir,
      '../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
    );
  });
  afterEach(async () => {
    await runExitCleanup();
    await preflight.dispose();
    await config.dispose();
    __resetCleanupStateForTesting();
    process.env = { ...previousEnv };
    await rm(directory, { recursive: true, force: true });
    agent = undefined;
  });

  async function prepare(
    provider?: string,
    model = 'gemini-2.5-pro',
    skillsSupport = false,
  ): Promise<void> {
    const settings = new SettingsService();
    preflight = await prepareAgentPreflight(
      { runtimeId: 'foreground-bootstrap-fixture' },
      authority,
      settings,
    );
    config = new Config({
      cwd: directory,
      targetDir: directory,
      debugMode: false,
      sessionId: 'foreground-bootstrap-fixture',
      provider,
      model,
      trustedFolder: true,
      mcpEnabled: false,
      skillsSupport,
    });
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => trust.isTrustedFolder(),
    });
    await preflight.preparePostConfiguration(
      config,
      filesystem,
      assembleWorkspaceMemory(config, filesystem, trust),
      trust,
      () => trust.dispose(),
      undefined,
    );
    preflight.transferActivation((operation) => {
      activation = operation;
    });
    intent = {
      ...(provider === undefined ? {} : { provider }),
      authMode: 'auto',
      ...(model === 'placeholder-model' ? {} : { model }),
    };
    const result = await activation.preflight(intent);
    if (result.token === undefined)
      throw new Error('Missing activation receipt');
    token = result.token;
  }
  async function create(): Promise<Agent> {
    agent = await createForegroundAgent(
      preflight,
      token,
      intent,
      authority,
      {},
    );
    return agent;
  }
  async function expectClosed(created: Agent): Promise<void> {
    await expect(created.chat('after cleanup')).rejects.toThrow(
      /closed|disposed/i,
    );
  }

  it('constructs once with the existing config and activation receipt and the one agents-owned bus', async () => {
    await prepare();
    const history = await activation.readHistory();
    const contentConfig = config.getContentGeneratorConfig();
    const created = await create();
    expect(await created.getHistory()).toStrictEqual(history);
    expect(config.getContentGeneratorConfig()).toBe(contentConfig);
    expect(created.getRuntimeId()).toBe(config.getSessionId());
    expect(created.tools.list().length).toBeGreaterThan(0);
    expect(created.getModel()).toBe('gemini-2.5-pro');
    expect((await activation.preflight(intent)).authFailed).toBe(true);
    await expect(create()).rejects.toThrow('already');
    await expect(created.getHistory()).resolves.toStrictEqual([]);
  });

  it('returns the exact ready agent retained by the owner and disposes it on cleanup', async () => {
    await prepare();
    const history = await activation.readHistory();
    const contentConfig = config.getContentGeneratorConfig();
    const created = await create();
    expect(await created.getHistory()).toStrictEqual(history);
    expect(config.getContentGeneratorConfig()).toBe(contentConfig);
    expect(created.getRuntimeId()).toBe(config.getSessionId());
    expect(created.tools.list().length).toBeGreaterThan(0);
    await runExitCleanup();
    await expectClosed(created);
    await created.dispose();
  });

  it('disposes the agent on normal exit alongside interactive UI cleanup', async () => {
    await prepare();
    const created = await create();
    let uiClosed = 0;
    registerCleanup(() => {
      uiClosed += 1;
    });
    expect(uiClosed).toBe(0);
    await runExitCleanup();
    await expectClosed(created);
    expect(uiClosed).toBe(1);
  });

  it('disposes the agent when startup is interrupted before UI cleanup registration', async () => {
    await prepare();
    const created = await create();
    await runExitCleanup();
    await expectClosed(created);
    expect((await activation.preflight(intent)).authFailed).toBe(true);
  });

  it('does not register agent cleanup when construction rejects', async () => {
    await prepare();
    const failure = new Error('foreground publication failed');
    await expect(
      createForegroundAgent(preflight, token, intent, authority, {
        onSkills: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    await runExitCleanup();
    expect(agent).toBeUndefined();
    expect((await activation.preflight(intent)).authFailed).toBe(true);
  });

  it('retains the exact existing Config without duplicate client construction', async () => {
    await prepare();
    const history = await activation.readHistory();
    const contentConfig = config.getContentGeneratorConfig();
    const created = await create();
    expect(await created.getHistory()).toStrictEqual(history);
    expect(config.getContentGeneratorConfig()).toBe(contentConfig);
    expect(created.getRuntimeId()).toBe(config.getSessionId());
  });

  it('retains the configured provider and model from activation', async () => {
    await prepare('fake', 'glm-4');
    const created = await create();
    expect(created.getModel()).toBe('glm-4');
    expect(created.getProvider()).toBe('fake');
    expect(created.getRuntimeId()).toBe(config.getSessionId());
  });

  it('does not publish the placeholder as an explicitly selected model', async () => {
    await prepare('fake', 'placeholder-model');
    await expect(
      AgentProfilePreflight.createForegroundAgent(
        preflight,
        token,
        { ...intent, model: 'placeholder-model' },
        {},
      ),
    ).rejects.toThrow(/intent|token|match/i);
    const created = await create();
    expect(intent).toStrictEqual({ provider: 'fake', authMode: 'auto' });
    expect(intent).not.toHaveProperty('model');
    expect(created.getProvider()).toBe('fake');
  });

  it('applies session policy updates through the exact foreground policy owner', async () => {
    const skillDirectory = join(directory, '.llxprt', 'skills', 'pr-creator');
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      join(skillDirectory, 'SKILL.md'),
      '---\nname: pr-creator\ndescription: The pr-creator skill\n---\n\npr-creator instructions\n',
    );
    await prepare(undefined, 'gemini-2.5-pro', true);
    const created = await create();
    const allows = (toolName: string): boolean =>
      created.policy
        .getRules()
        .some(
          (rule) =>
            rule.toolName === toolName &&
            rule.decision === PolicyDecision.ALLOW,
        );
    expect(allows(ACTIVATE_SKILL_TOOL_NAME)).toBe(false);
    const activationTool = created.tools.get(ACTIVATE_SKILL_TOOL_NAME);
    if (!activationTool) throw new Error('Missing published activation tool');
    const confirmation = await activationTool
      .build({ name: 'pr-creator' })
      .shouldConfirmExecute(new AbortController().signal);
    if (confirmation === false)
      throw new Error('Missing activation confirmation');
    await (
      confirmation as {
        onConfirm(outcome: ToolConfirmationOutcome): Promise<void>;
      }
    ).onConfirm(ToolConfirmationOutcome.ProceedAlways);
    expect(allows(ACTIVATE_SKILL_TOOL_NAME)).toBe(true);
    expect(allows('ast_edit')).toBe(false);
  });
});
