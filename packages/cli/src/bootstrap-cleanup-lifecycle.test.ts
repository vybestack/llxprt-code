/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionClientOwner } from '../../agents/src/session/session-client-owner.js';

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  access,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as agents from '@vybestack/llxprt-code-agents';
import * as stdio from '@vybestack/llxprt-code-core/utils/stdio.js';
import {
  assembleAgentActivationBootstrap,
  createAgent,
} from '@vybestack/llxprt-code-agents';
import commandExists from 'command-exists';
import {
  ApprovalMode,
  Config,
  ExitCodes,
  SessionRecordingService,
  getProjectHash,
} from '@vybestack/llxprt-code-core';
import * as acp from '@vybestack/llxprt-code-zed-acp';
import * as sandbox from './utils/sandbox.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  bootstrapRuntimeAndConfig,
  handleSessionListAndDelete,
} from './cliSessionBootstrap.js';
import { activateConfiguredProvider } from './cliProviderInit.js';
import { constructAgentWithSpinner } from './cliTerminalSession.js';
import { loadCliConfig } from './config/config.js';
import { loadSettings } from './config/settings.js';
import { parseArguments } from './config/cliArgParser.js';
import { ExtensionEnablementManager } from './config/extensions/extensionEnablement.js';
import { main, __resetUnhandledRejectionStateForTesting } from './cli.js';
import {
  runExitCleanup,
  __resetCleanupStateForTesting,
} from './utils/cleanup.js';

const repositoryRoot = resolve(import.meta.dir, '../../..');

type ObservedBootstrap = {
  config: Config;
  settingsService: Parameters<
    typeof agents.assembleAgentActivationBootstrap
  >[1];
  providerManager: agents.Agent['providerManager'];
  operation: agents.AgentActivationOperation;
  receipt?: agents.ActivationPreflight;
  intent?: agents.ProviderActivationIntent;
};

class StartupExit extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super(`startup exit ${code}`);
  }
}

describe('real startup activation owner cleanup', () => {
  let directory: string;
  let previousEnv: NodeJS.ProcessEnv;
  let previousArgv: string[];
  let previousCwd: string;
  let observed: ObservedBootstrap[];
  let probeReceipts = false;
  let exitReceiptChecks: Array<Promise<agents.Agent>>;
  const restore: Array<{ mockRestore(): void }> = [];

  beforeEach(async () => {
    previousEnv = { ...process.env };
    previousArgv = process.argv;
    previousCwd = process.cwd();
    const root = join(tmpdir(), 'llxprt-preflight-cleanup');
    await mkdir(root, { recursive: true });
    directory = await realpath(await mkdtemp(resolve(root, 'lifecycle-')));
    process.env.LLXPRT_CONFIG_HOME = directory;
    process.env.LLXPRT_FAKE_RESPONSES = resolve(
      repositoryRoot,
      'packages/agents/src/api/__tests__/fixtures/plain-text.jsonl',
    );
    process.env.LLXPRT_RUNTIME_ID = `cleanup-${directory}`;
    process.env.LLXPRT_CODE_SKIP_TERMINAL_CAPABILITY_DETECTION = 'true';
    delete process.env.LLXPRT_SANDBOX;
    delete process.env.SANDBOX;
    process.argv = [
      'bun',
      'llxprt',
      '--provider',
      'fake',
      '--model',
      'fake-model',
      '--prompt',
      'hello',
    ];
    process.chdir(directory);
    __resetCleanupStateForTesting();
    observed = [];
    exitReceiptChecks = [];
    probeReceipts = false;
    const assemble = assembleAgentActivationBootstrap;
    restore.push(
      spyOn(agents, 'assembleAgentActivationBootstrap').mockImplementation(
        (...args) => {
          const operation = assemble(...args);
          const observation: ObservedBootstrap = {
            config: args[0],
            settingsService: args[1],
            providerManager: args[2],
            operation,
          };
          observed.push(observation);
          const preflight = operation.preflight.bind(operation);
          restore.push(
            spyOn(operation, 'preflight').mockImplementation(async (intent) => {
              const result = await preflight(intent);
              if (result.token) {
                observation.receipt = { operation, token: result.token };
                observation.intent = intent;
              }
              return result;
            }),
          );
          return operation;
        },
      ),
    );
    restore.push(
      spyOn(process, 'exit').mockImplementation((code) => {
        for (const owner of observed) {
          expectNoForeground(owner.config);
          if (probeReceipts && owner.receipt) {
            const check = agents.fromConfig({
              settingsService: owner.settingsService,
              providerManager: owner.providerManager,
              config: owner.config,
              // Reject an accidentally live receipt before async adoption can
              // race main's finally after the simulated process exit.
              sessionId: '',
              ...requireReceipt(owner),
            });
            void check.catch(() => undefined);
            exitReceiptChecks.push(check);
          }
        }
        throw new StartupExit(code);
      }),
    );
  });

  afterEach(async () => {
    await runExitCleanup();
    for (const owner of observed) {
      await owner.operation.dispose();
      await owner.config.dispose();
    }
    for (const spy of restore.splice(0).reverse()) spy.mockRestore();
    __resetUnhandledRejectionStateForTesting();
    __resetCleanupStateForTesting();
    process.chdir(previousCwd);
    process.argv = previousArgv;
    process.env = previousEnv;
    await rm(directory, { recursive: true, force: true });
  });

  function expectNoForeground(config: Config): void {
    expect(config.hasInitializationStarted()).toBe(false);
  }

  function currentRuntimeId(): string {
    const runtimeId = process.env.LLXPRT_RUNTIME_ID;
    if (!runtimeId) throw new Error('Runtime id was not configured');
    return runtimeId;
  }

  function requireReceipt(owner: ObservedBootstrap): {
    activation: agents.ProviderActivationIntent;
    activationPreflight: agents.ActivationPreflight;
  } {
    if (!owner.receipt || !owner.intent)
      throw new Error('Missing preflight receipt');
    return { activation: owner.intent, activationPreflight: owner.receipt };
  }

  async function expectInvalidReceipt(owner: ObservedBootstrap): Promise<void> {
    await expect(
      agents.fromConfig({
        settingsService: owner.settingsService,
        providerManager: owner.providerManager,
        config: owner.config,
        ...requireReceipt(owner),
      }),
    ).rejects.toThrow('token is invalid or already consumed');
  }

  async function expectClosed(owner: ObservedBootstrap): Promise<void> {
    const result = await owner.operation.preflight({ authMode: 'none' });
    expect(result.authFailed).toBe(true);
    expect(result.authError).toBeInstanceOf(Error);
    if (!(result.authError instanceof Error))
      throw new Error('Missing disposal error');
    expect(result.authError.message).toContain('disposed');
    expect(result.token).toBeUndefined();
  }

  async function expectClosedAtExit(code: number): Promise<void> {
    await expect(main()).rejects.toMatchObject({ code });
    expect(observed.length).toBeGreaterThan(0);
    if (probeReceipts) expect(exitReceiptChecks.length).toBeGreaterThan(0);
    for (const check of exitReceiptChecks) {
      await expect(check).rejects.toThrow(
        'token is invalid or already consumed',
      );
    }
    for (const owner of observed) await expectClosed(owner);
  }

  it.each(['activation', 'receipt'])(
    'closes an untransferred owner when standalone loadCliConfig returns (%s)',
    async (probe) => {
      const settings = loadSettings(directory);
      const argv = await parseArguments(settings.merged);
      const config = await loadCliConfig(
        settings.merged,
        [],
        new ExtensionEnablementManager(directory, []),
        'standalone',
        argv,
        directory,
      );
      expect(observed).toHaveLength(1);
      const owner = observed[0];
      expect(owner.config).toBe(config);
      expect(owner.receipt).toBeDefined();
      if (probe === 'receipt') {
        await expectInvalidReceipt(owner);
      } else {
        await expectClosed(owner);
      }
    },
  );

  it('closes the owner when finalization fails before handoff', async () => {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    await expect(
      loadCliConfig(
        settings.merged,
        [],
        new ExtensionEnablementManager(directory, []),
        'finalization-failure',
        argv,
        directory,
        {
          onProviderSwitchReady: () => {
            throw new Error('finalization interrupted');
          },
        },
      ),
    ).rejects.toThrow('finalization interrupted');
    expect(observed).toHaveLength(1);
    await expectClosed(observed[0]);
  });

  it.each(['activation', 'receipt'])(
    'invalidates the receipt before list-extensions exits, without adopting a foreground Agent (%s)',
    async (probe) => {
      probeReceipts = probe === 'receipt';
      process.argv.push('--list-extensions');
      await expectClosedAtExit(0);
      expect(observed).toHaveLength(1);
    },
  );

  it('keeps the explicit activation owner usable during ACP and closes it when the protocol server returns', async () => {
    process.argv.push('--experimental-acp');
    let checked = false;
    restore.push(
      spyOn(acp, 'runZedIntegration').mockImplementation(async () => {
        expect(observed).toHaveLength(1);
        expect(observed[0].config.hasInitializationStarted()).toBe(false);
        expect(
          observed[0].operation.sessionClient.getAgentClient(),
        ).toBeDefined();
        const preflight = await observed[0].operation.preflight({
          authMode: 'none',
        });
        expect(preflight.authFailed).toBe(false);
        expect(preflight.token).toBeDefined();
        checked = true;
      }),
    );
    await main();
    expect(checked).toBe(true);
    await expectClosed(observed[0]);
  });

  it.each(['activation', 'receipt'])(
    'closes the transferred owner on direct-image failure before conversational dispatch (%s)',
    async (probe) => {
      probeReceipts = probe === 'receipt';
      process.argv = [
        ...process.argv.slice(0, 6),
        '--image-prompt',
        'a tree',
        '--image-output',
        'tree.png',
      ];
      await expectClosedAtExit(1);
      expect(observed).toHaveLength(1);
    },
  );

  it.each(['activation', 'receipt'])(
    'closes the owner on fatal authentication before foreground assembly (%s)',
    async (probe) => {
      probeReceipts = probe === 'receipt';
      restore.push(
        spyOn(SessionClientOwner.prototype, 'refreshAuth').mockRejectedValue(
          new Error('credential service unavailable'),
        ),
      );
      await expectClosedAtExit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
      expect(observed).toHaveLength(1);
    },
  );

  it.each(['activation', 'receipt'])(
    'closes parent and standalone sandbox owners when the sandbox child exits (%s)',
    async (probe) => {
      probeReceipts = probe === 'receipt';
      process.argv.push('--sandbox', '--sandbox-engine', 'docker');
      restore.push(spyOn(commandExists, 'sync').mockReturnValue(true));
      let launched = false;
      restore.push(
        spyOn(sandbox, 'start_sandbox').mockImplementation(async () => {
          expect(observed).toHaveLength(2);
          expect(observed[0].config.hasInitializationStarted()).toBe(false);
          expect(observed[1].config.hasInitializationStarted()).toBe(false);
          if (!probeReceipts) await expectClosed(observed[1]);
          launched = true;
          return 0;
        }),
      );
      await expectClosedAtExit(0);
      expect(launched).toBe(true);
    },
  );

  it('closes an untransferred owner when keyfile loading fails during finalization', async () => {
    process.argv.push('--keyfile', resolve(directory, 'missing-key'));
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    await expect(
      loadCliConfig(
        settings.merged,
        [],
        new ExtensionEnablementManager(directory, []),
        'keyfile-failure',
        argv,
        directory,
      ),
    ).rejects.toThrow('missing-key');
    expect(observed).toHaveLength(1);
    await expectClosed(observed[0]);
  });

  it('closes the transferred owner when the sandbox process cannot start', async () => {
    process.argv.push('--sandbox', '--sandbox-engine', 'docker');
    restore.push(spyOn(commandExists, 'sync').mockReturnValue(true));
    restore.push(
      spyOn(sandbox, 'start_sandbox').mockRejectedValue(
        new Error('sandbox spawn failed'),
      ),
    );
    await expect(main()).rejects.toThrow('sandbox spawn failed');
    expect(observed).toHaveLength(2);
    for (const owner of observed) {
      expectNoForeground(owner.config);
      await expectClosed(owner);
    }
  });

  it('fails authentication before launching a sandbox child or assembling a foreground Agent', async () => {
    process.argv.push('--sandbox', '--sandbox-engine', 'docker');
    restore.push(spyOn(commandExists, 'sync').mockReturnValue(true));
    restore.push(
      spyOn(SessionClientOwner.prototype, 'refreshAuth').mockRejectedValue(
        new Error('credential service unavailable'),
      ),
    );
    restore.push(
      spyOn(sandbox, 'start_sandbox').mockRejectedValue(
        new Error('sandbox must not start without credentials'),
      ),
    );
    await expectClosedAtExit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
    expect(observed).toHaveLength(1);
  });

  it('keeps the caller Config and manager usable while adopted foreground trust retires', async () => {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    const boot = await bootstrapRuntimeAndConfig(settings, argv, directory);
    const manager = boot.providerManager;

    const activation = await activateConfiguredProvider(
      boot.config,
      manager,
      argv,
      boot.activationOperation,
    );
    const agent = await constructAgentWithSpinner(
      boot.config,
      boot.providerManager,
      boot.runtimeSettingsService,
      boot.runtimeSettingsOwner,
      activation.activationPreflight,
      activation.intent,
      undefined,
      undefined,
      undefined,
      boot.policyOwner,
      boot.oauthManager,
      boot.providerFileLifecycle,
    );
    if (boot.policyOwner === undefined)
      throw new Error('Missing bootstrap policy owner');
    await boot.policyOwner.trust.setTrustedFolderLive(true);
    boot.config.setApprovalMode(ApprovalMode.YOLO);
    await boot.policyOwner.trust.setTrustedFolderLive(false);
    expect(agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
    await runExitCleanup();
    await expectClosed(observed[0]);
    await expect(
      boot.policyOwner.trust.setTrustedFolderLive(false),
    ).rejects.toThrow('disposed');
    await manager.setActiveProvider('fake');
    expect(boot.providerManager.getActiveProviderName()).toBe('fake');
    expect(manager.getActiveProviderName()).toBe('fake');
    await agent.dispose();
  });

  async function recordSession(
    root = directory,
  ): Promise<{ path: string; id: string }> {
    const id = crypto.randomUUID();
    const recording = new SessionRecordingService({
      sessionId: id,
      projectHash: getProjectHash(root),
      chatsDir: new Storage(root).getProjectChatsDir(),
      workspaceDirs: [root],
      provider: 'fake',
      model: 'fake-model',
    });
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'session seed' }],
    });
    await recording.flush();
    const path = recording.getFilePath();
    if (!path) throw new Error('Session file was not created');
    await recording.dispose();
    return { id, path };
  }

  it.each([
    'empty-list',
    'populated-list',
    'delete-success',
    'delete-index',
    'delete-failure',
  ])(
    'awaits exact owner and Config disposal before %s exits',
    async (caseName) => {
      const seeded =
        caseName === 'empty-list' || caseName === 'delete-failure'
          ? undefined
          : await recordSession();
      process.argv = [
        ...process.argv,
        ...(caseName.endsWith('list')
          ? ['--list-sessions']
          : [
              '--delete-session',
              caseName === 'delete-index'
                ? '1'
                : (seeded?.id ?? 'missing-session'),
            ]),
      ];
      const output: string[] = [];
      restore.push(
        spyOn(stdio, 'writeToStdout').mockImplementation((chunk) => {
          output.push(String(chunk));
          return true;
        }),
        spyOn(stdio, 'writeToStderr').mockImplementation((chunk) => {
          output.push(String(chunk));
          return true;
        }),
      );
      const disposed = new Set<Config>();
      const originalDispose = Config.prototype.dispose;
      restore.push(
        spyOn(Config.prototype, 'dispose').mockImplementation(async function (
          this: Config,
        ) {
          await originalDispose.call(this);
          disposed.add(this);
        }),
      );
      restore.push(
        spyOn(process, 'exit').mockImplementation((code) => {
          expect(observed).toHaveLength(1);
          const owner = observed[0].config;
          expect(disposed.has(owner)).toBe(true);
          expect(observed[0].providerManager).toBeDefined();
          throw new StartupExit(code);
        }),
      );
      await expect(main()).rejects.toMatchObject({
        code: caseName === 'delete-failure' ? 1 : 0,
      });
      const expectedOutput: Record<string, string> = {
        'empty-list': 'No recorded sessions for this project.',
        'populated-list': 'Sessions for this project (1):',
        'delete-success': `Deleted session ${seeded?.id.slice(0, 8)}`,
        'delete-index': `Deleted session ${seeded?.id.slice(0, 8)}`,
        'delete-failure': 'No sessions found for this project',
      };
      expect(output.join('\n')).toContain(expectedOutput[caseName]);
      const stillExists = seeded
        ? await access(seeded.path).then(
            () => true,
            () => false,
          )
        : false;
      expect(stillExists).toBe(caseName === 'populated-list');
    },
  );
  it.each(['list', 'delete'])(
    'does not %s a session belonging to another project root',
    async (action) => {
      const otherRoot = resolve(directory, 'other-project');
      await mkdir(otherRoot);
      const unrelated = await recordSession(otherRoot);
      const output: string[] = [];
      restore.push(
        spyOn(stdio, 'writeToStdout').mockImplementation((chunk) => {
          output.push(String(chunk));
          return true;
        }),
        spyOn(stdio, 'writeToStderr').mockImplementation((chunk) => {
          output.push(String(chunk));
          return true;
        }),
        spyOn(process, 'exit').mockImplementation((code) => {
          throw new StartupExit(code);
        }),
      );
      process.argv.push(
        ...(action === 'list'
          ? ['--list-sessions']
          : ['--delete-session', '1']),
      );
      await expect(main()).rejects.toMatchObject({
        code: action === 'list' ? 0 : 1,
      });
      expect(output.join('')).toContain(
        action === 'list'
          ? 'No recorded sessions for this project.'
          : 'No sessions found for this project',
      );
      expect(output.join('')).not.toContain(unrelated.id.slice(0, 8));
      await access(unrelated.path);
    },
  );

  it.each(['list', 'delete'])(
    'handles %s with piped stdin and no prompt',
    async (action) => {
      const seeded = await recordSession();
      process.argv = [
        'bun',
        'llxprt',
        '--provider',
        'fake',
        '--model',
        'fake-model',
        ...(action === 'list'
          ? ['--list-sessions']
          : ['--delete-session', seeded.id]),
      ];
      const output: string[] = [];
      restore.push(
        spyOn(stdio, 'writeToStdout').mockImplementation((chunk) => {
          output.push(String(chunk));
          return true;
        }),
        spyOn(process, 'exit').mockImplementation((code) => {
          throw new StartupExit(code);
        }),
      );
      await expect(main()).rejects.toMatchObject({ code: 0 });
      expect(output.join('')).toContain(
        action === 'list'
          ? 'Sessions for this project (1):'
          : `Deleted session ${seeded.id.slice(0, 8)}`,
      );
    },
  );

  it('releases the owner and Config when the session directory cannot be created', async () => {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    const boot = await bootstrapRuntimeAndConfig(settings, argv, directory);
    const invalidChatsDir = resolve(directory, 'not-a-directory');
    await writeFile(invalidChatsDir, 'a file');
    const disposed = new Set<Config>();
    const originalDispose = boot.config.dispose.bind(boot.config);
    restore.push(
      spyOn(boot.config, 'dispose').mockImplementation(async () => {
        await originalDispose();
        disposed.add(boot.config);
      }),
    );
    await expect(
      handleSessionListAndDelete(
        { listSessions: true, deleteSession: undefined },
        invalidChatsDir,
        getProjectHash(directory),
        boot.config,
      ),
    ).rejects.toThrow(/EEXIST|ENOTDIR/);
    expect(disposed.has(boot.config)).toBe(true);
  });

  it('leaves the owner active when the delete selection is empty', async () => {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    const boot = await bootstrapRuntimeAndConfig(settings, argv, directory);
    await handleSessionListAndDelete(
      { listSessions: false, deleteSession: '' },
      new Storage(directory).getProjectChatsDir(),
      getProjectHash(directory),
      boot.config,
    );
    expect(boot.providerManager).toBeDefined();
    await runExitCleanup();
    expect(boot.config.getProvider()).toBe('fake');
  });

  it('preserves a same-label Agent sibling after an early list exit', async () => {
    const runtimeId = currentRuntimeId();
    const sibling = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      sessionId: runtimeId,
    });
    process.argv.push('--list-sessions');
    restore.push(
      spyOn(process, 'exit').mockImplementation((code) => {
        expect(sibling.getProvider()).toBe('fake');
        throw new StartupExit(code);
      }),
    );
    try {
      await expect(main()).rejects.toMatchObject({ code: 0 });
      const events = [];
      for await (const event of sibling.stream('sibling-turn')) {
        events.push(event);
      }
      expect(events.some((event) => event.type === 'done')).toBe(true);
      expect(sibling.getRuntimeDiagnosticsSnapshot().providerName).toBe('fake');
    } finally {
      await sibling.dispose();
    }
  });

  it('preserves a same-label CLI sibling after an early list exit', async () => {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    let siblingActivation: agents.AgentActivationOperation | undefined;
    const sibling = await loadCliConfig(
      settings.merged,
      [],
      new ExtensionEnablementManager(directory, []),
      'standalone-sibling',
      argv,
      directory,
      {
        onActivationBootstrapReady: (operation) => {
          siblingActivation = operation;
        },
      },
    );
    const siblingManager = observed[observed.length - 1].providerManager;

    process.argv.push('--list-sessions');
    restore.push(
      spyOn(process, 'exit').mockImplementation((code) => {
        expect(siblingManager.listProviders()).toContain('fake');
        expect(observed).toHaveLength(2);
        throw new StartupExit(code);
      }),
    );
    try {
      await expect(main()).rejects.toMatchObject({ code: 0 });
      await siblingManager.setActiveProvider('fake');
      expect(siblingManager.getActiveProviderName()).toBe('fake');
      expect(sibling.getSessionId()).toBe('standalone-sibling');
    } finally {
      await siblingActivation?.dispose();
      await sibling.dispose();
    }
  });
});
