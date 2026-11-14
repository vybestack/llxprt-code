/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  StartupExit,
  expectClosed,
  expectPreflightRetired,
  transferActivation,
  type StartupReceipt,
} from './__tests__/startup-activation-fixture.js';
import {
  SessionSettingsOwner,
  getProjectHash,
  ApprovalMode,
  Config,
  ExitCodes,
} from '@vybestack/llxprt-code-core';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
} from './config/profileBootstrap.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { recordStartupSession } from './__tests__/startup-recording-fixture.js';

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
  AgentProfilePreflight,
  createAgent,
} from '@vybestack/llxprt-code-agents';
import commandExists from 'command-exists';
import * as acp from '@vybestack/llxprt-code-zed-acp';
import * as sandbox from './utils/sandbox.js';
import {
  bootstrapRuntimeAndConfig,
  handleSessionListAndDelete,
} from './cliSessionBootstrap.js';
import { maybeHopIntoSandbox } from './cliSandbox.js';
import { activateConfiguredProvider } from './cliProviderInit.js';
import { createForegroundAgent } from './cliAgentBootstrap.js';
import { ignoreReady, loadCliConfig } from './config/config.js';
import { loadSettings } from './config/settings.js';
import { parseArguments } from './config/cliArgParser.js';
import { ExtensionEnablementManager } from './config/extensions/extensionEnablement.js';
import { main, __resetUnhandledRejectionStateForTesting } from './cli.js';
import {
  runExitCleanup,
  registerCleanup,
  __resetCleanupStateForTesting,
} from './utils/cleanup.js';
import { loadCliConfigWithPreflight } from './__tests__/load-cli-config-fixture.js';

const repositoryRoot = resolve(import.meta.dir, '../../..');

describe('real startup activation owner cleanup', () => {
  let directory: string;
  let previousEnv: NodeJS.ProcessEnv;
  let previousArgv: string[];
  let previousCwd: string;
  let configs: Config[];
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
    configs = [];
    restore.push(
      spyOn(process, 'exit').mockImplementation((code) => {
        throw new StartupExit(code);
      }),
    );
  });

  afterEach(async () => {
    await runExitCleanup();
    for (const config of configs) await config.dispose();
    for (const spy of restore.splice(0).reverse()) spy.mockRestore();
    __resetUnhandledRejectionStateForTesting();
    __resetCleanupStateForTesting();
    process.chdir(previousCwd);
    process.argv = previousArgv;
    process.env = previousEnv;
    await rm(directory, { recursive: true, force: true });
  });

  function currentRuntimeId(): string {
    const runtimeId = process.env.LLXPRT_RUNTIME_ID;
    if (!runtimeId) throw new Error('Runtime id was not configured');
    return runtimeId;
  }

  /**
   * The startup steps `main()` composes before any Agent exists: the
   * preflight `prepareRuntimeForProfile` returns and the Config
   * `bootstrapRuntimeAndConfig` resolves over it (which registers the
   * preflight's disposal as an exit cleanup).
   */
  async function bootstrapStartup() {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    const authority = new CredentialAuthority();
    const parsed = parseBootstrapArgs();
    const preflight = await prepareRuntimeForProfile(
      { ...parsed, runtimeMetadata: { ...parsed.runtimeMetadata } },
      authority,
      new SettingsService(),
      undefined,
      undefined,
    );
    const config = await bootstrapRuntimeAndConfig(
      settings,
      argv,
      directory,
      preflight,
    );
    configs.push(config);
    return { settings, argv, authority, preflight, config };
  }

  async function receiptFor(
    startup: Awaited<ReturnType<typeof bootstrapStartup>>,
  ): Promise<StartupReceipt> {
    const activation = await activateConfiguredProvider(
      startup.config,
      startup.preflight,
      startup.argv,
      startup.preflight,
    );
    expect(activation.authFailed).toBe(false);
    if (activation.token === undefined)
      throw new Error('Missing foreground receipt');
    return { token: activation.token, intent: activation.intent ?? {} };
  }

  /**
   * Standalone `loadCliConfig` through the fixture. The untransferred
   * activation is the preflight itself (`onPreflightReady` hands it out before
   * finalization); a wrapped `preflight` on that instance keeps the receipt
   * loadCliConfig issues.
   */
  async function loadStandalone(
    sessionId: string,
    extra: Partial<Parameters<typeof loadCliConfigWithPreflight>[0]> = {},
  ) {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    const captured: {
      preflight?: AgentProfilePreflight;
      receipt?: StartupReceipt;
    } = {};
    const load = loadCliConfigWithPreflight({
      settings: settings.merged,
      extensions: [],
      extensionEnablementManager: new ExtensionEnablementManager(directory, {
        enabledOverride: [],
      }),
      sessionId,
      argv,
      cwd: directory,
      authority: new CredentialAuthority(),
      onPreflightReady: (preflight) => {
        captured.preflight = preflight;
        const original = preflight.preflight.bind(preflight);
        restore.push(
          spyOn(preflight, 'preflight').mockImplementation(async (intent) => {
            const result = await original(intent);
            if (result.token)
              captured.receipt = { token: result.token, intent };
            return result;
          }),
        );
      },
      ...extra,
    });
    return { captured, load };
  }

  function requirePreflight(captured: {
    preflight?: AgentProfilePreflight;
  }): AgentProfilePreflight {
    if (captured.preflight === undefined)
      throw new Error('Missing standalone preflight');
    return captured.preflight;
  }

  it('closes an untransferred owner when standalone loadCliConfig returns (activation)', async () => {
    const { captured, load } = await loadStandalone('standalone');
    configs.push(await load);
    expect(captured.receipt).toBeDefined();
    await expectClosed(requirePreflight(captured));
  });

  it('retires the receipt of an untransferred owner when standalone loadCliConfig returns (receipt)', async () => {
    const { captured, load } = await loadStandalone('standalone-receipt');
    configs.push(await load);
    if (!captured.receipt) throw new Error('Missing standalone receipt');
    await expect(
      AgentProfilePreflight.createForegroundAgent(
        requirePreflight(captured),
        captured.receipt.token,
        captured.receipt.intent,
        {},
      ),
    ).rejects.toThrow('disposed');
  });

  it('closes the owner when finalization fails before handoff', async () => {
    const { captured, load } = await loadStandalone('finalization-failure', {
      onProviderSwitchReady: () => {
        throw new Error('finalization interrupted');
      },
    });
    await expect(load).rejects.toThrow('finalization interrupted');
    await expectClosed(requirePreflight(captured));
  });

  // main() part: the list-extensions exit code. Domain part: the startup exits
  // main() composes (exitAfterExtensionList disposes the preflight;
  // exitIfDirectImage, exitIfAuthenticationFailed and maybeHopIntoSandbox run
  // the exit cleanup that bootstrapRuntimeAndConfig registered) retire the
  // preflight and any receipt it issued.
  it('exits 0 for list-extensions without adopting a foreground Agent', async () => {
    process.argv.push('--list-extensions');
    await expect(main()).rejects.toMatchObject({ code: 0 });
  });

  it.each([
    [
      'exitAfterExtensionList',
      (preflight: AgentProfilePreflight) => preflight.dispose(),
    ],
    [
      'the exit cleanup of exitIfDirectImage and exitIfAuthenticationFailed',
      () => runExitCleanup(),
    ],
  ])('retires the preflight and its receipt on %s', async (_name, exit) => {
    const startup = await bootstrapStartup();
    const receipt = await receiptFor(startup);
    expect(receipt.token).toBeDefined();
    await exit(startup.preflight);
    await expectPreflightRetired(startup.preflight, receipt);
  });

  // main() part: the ACP route runs the protocol server and returns. Domain
  // part: over the startup main() composes for ACP (bootstrapRuntimeAndConfig,
  // then the activation preflight handleActivatedZedIntegration leaves
  // usable), the preflight stays usable until the exit cleanup retires it.
  it('runs the ACP protocol server once and returns', async () => {
    process.argv.push('--experimental-acp');
    let served = 0;
    restore.push(
      spyOn(acp, 'runZedIntegration').mockImplementation(async (config) => {
        expect(config.getExperimentalZedIntegration()).toBe(true);
        served += 1;
      }),
    );
    await main();
    expect(served).toBe(1);
  });

  it('keeps the explicit activation preflight usable during ACP and retires it with the exit cleanup', async () => {
    process.argv.push('--experimental-acp');
    const startup = await bootstrapStartup();
    expect(startup.config.getExperimentalZedIntegration()).toBe(true);
    const result = await startup.preflight.preflight({ authMode: 'none' });
    expect(result.authFailed).toBe(false);
    expect(result.token).toBeDefined();
    await runExitCleanup();
    expect(() => startup.preflight.preflight({ authMode: 'none' })).toThrow(
      'disposed',
    );
  });

  it('exits 1 on direct-image failure before conversational dispatch', async () => {
    process.argv = [
      ...process.argv.slice(0, 6),
      '--image-prompt',
      'a tree',
      '--image-output',
      'tree.png',
    ];
    await expect(main()).rejects.toMatchObject({ code: 1 });
  });

  // exitBeforeAgent (exitIfAuthenticationFailed) runs the exit cleanup and
  // exits ExitCodes.FATAL_AUTHENTICATION_ERROR when the activation preflight
  // reports authFailed. No input to main() makes the fake provider's
  // authentication fail (tried: a missing replay file throws ENOENT, an
  // unconfigured or empty-keyfile openai provider authenticates lazily and
  // fails later with exit 1), so the failed preflight is driven directly.
  it('reports a failed activation without a receipt and retires the preflight on the exit cleanup', async () => {
    const startup = await bootstrapStartup();
    const failed = await startup.preflight.preflight({
      provider: 'no-such-provider',
      authMode: 'auto',
    });
    expect(failed.authFailed).toBe(true);
    expect(failed.token).toBeUndefined();
    await runExitCleanup();
    expect(() => startup.preflight.preflight({ authMode: 'none' })).toThrow(
      'disposed',
    );
  });

  it('closes an untransferred owner when keyfile loading fails during finalization', async () => {
    delete process.env.LLXPRT_FAKE_RESPONSES;
    process.argv[3] = 'openai';
    process.argv.push('--keyfile', resolve(directory, 'missing-key'));
    const { captured, load } = await loadStandalone('keyfile-failure');
    await expect(load).rejects.toThrow('missing-key');
    await expectClosed(requirePreflight(captured));
  });

  // main() parts of the sandbox hop: the exit code and spawn failure it
  // surfaces. Domain part: maybeHopIntoSandbox over a bootstrapped startup,
  // with the forked sandbox preflight it is handed.
  describe('sandbox hop', () => {
    function enableSandbox(): void {
      process.argv.push('--sandbox', '--sandbox-engine', 'docker');
      restore.push(spyOn(commandExists, 'sync').mockReturnValue(true));
    }

    async function hop(
      startup: Awaited<ReturnType<typeof bootstrapStartup>>,
    ): Promise<{ forked: () => AgentProfilePreflight; done: Promise<void> }> {
      let forked: AgentProfilePreflight | undefined;
      const done = maybeHopIntoSandbox({
        config: startup.config,
        settings: startup.settings,
        argv: startup.argv,
        workspaceRoot: directory,
        prepareSandboxPreflight: async () => {
          forked = await startup.preflight.forkSandboxPreflight();
          return forked;
        },
        initialAuthFailed: false,
        readStdin: async () => '',
        hasPipedInput: false,
        bootstrapSelection: null,
      });
      return {
        done,
        forked: () => {
          if (forked === undefined)
            throw new Error('Missing sandbox preflight');
          return forked;
        },
      };
    }

    it('exits 0 when the sandbox child exits', async () => {
      enableSandbox();
      let launched = false;
      restore.push(
        spyOn(sandbox, 'start_sandbox').mockImplementation(async () => {
          launched = true;
          return 0;
        }),
      );
      await expect(main()).rejects.toMatchObject({ code: 0 });
      expect(launched).toBe(true);
    });

    it('closes the forked sandbox preflight before the child runs and the parent when the child exits', async () => {
      enableSandbox();
      const startup = await bootstrapStartup();
      const receipt = await receiptFor(startup);
      const hopped: { forked?: () => AgentProfilePreflight } = {};
      let launched = false;
      restore.push(
        spyOn(sandbox, 'start_sandbox').mockImplementation(async () => {
          const forked = hopped.forked?.();
          if (forked === undefined)
            throw new Error('Missing sandbox preflight');
          expect(() => forked.preflight({ authMode: 'none' })).toThrow(
            'disposed',
          );
          expect(forked.captureSettingsSnapshot()).toStrictEqual(
            startup.preflight.captureSettingsSnapshot(),
          );
          expect(
            await Array.fromAsync(startup.preflight.captureHistory()),
          ).toStrictEqual([]);
          launched = true;
          return 0;
        }),
      );
      const started = await hop(startup);
      hopped.forked = started.forked;
      await expect(started.done).rejects.toMatchObject({ code: 0 });
      expect(launched).toBe(true);
      await runExitCleanup();
      await expectPreflightRetired(startup.preflight, receipt);
    });

    it('rejects with the spawn failure from main() when the sandbox process cannot start', async () => {
      enableSandbox();
      restore.push(
        spyOn(sandbox, 'start_sandbox').mockRejectedValue(
          new Error('sandbox spawn failed'),
        ),
      );
      await expect(main()).rejects.toThrow('sandbox spawn failed');
    });

    it('closes the forked and parent preflights when the sandbox process cannot start', async () => {
      enableSandbox();
      const startup = await bootstrapStartup();
      const receipt = await receiptFor(startup);
      restore.push(
        spyOn(sandbox, 'start_sandbox').mockRejectedValue(
          new Error('sandbox spawn failed'),
        ),
      );
      const started = await hop(startup);
      await expect(started.done).rejects.toThrow('sandbox spawn failed');
      expect(() => started.forked().preflight({ authMode: 'none' })).toThrow(
        'disposed',
      );
      await runExitCleanup();
      await expectPreflightRetired(startup.preflight, receipt);
    });

    it('exits fatal authentication before launching a sandbox child or forking a sandbox preflight', async () => {
      enableSandbox();
      const startup = await bootstrapStartup();
      const receipt = await receiptFor(startup);
      let launched = false;
      let forked = false;
      restore.push(
        spyOn(sandbox, 'start_sandbox').mockImplementation(async () => {
          launched = true;
          return 0;
        }),
      );
      await expect(
        maybeHopIntoSandbox({
          config: startup.config,
          settings: startup.settings,
          argv: startup.argv,
          workspaceRoot: directory,
          prepareSandboxPreflight: async () => {
            forked = true;
            return startup.preflight.forkSandboxPreflight();
          },
          initialAuthFailed: true,
          readStdin: async () => '',
          hasPipedInput: false,
          bootstrapSelection: null,
        }),
      ).rejects.toMatchObject({ code: ExitCodes.FATAL_AUTHENTICATION_ERROR });
      expect(launched).toBe(false);
      expect(forked).toBe(false);
      await expectPreflightRetired(startup.preflight, receipt);
    });
  });

  it('keeps the caller Config usable while adopted foreground trust retires', async () => {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    const credentialAuthority = new CredentialAuthority();
    const callerSettings = new SettingsService();
    const callerOwner = new SessionSettingsOwner(callerSettings);
    try {
      const parsed = parseBootstrapArgs();
      const preflight = await prepareRuntimeForProfile(
        {
          ...parsed,
          runtimeMetadata: {
            ...parsed.runtimeMetadata,
          },
        },
        credentialAuthority,
        callerSettings,
        callerOwner,
        undefined,
      );
      registerCleanup(() => preflight.dispose());
      const config = await loadCliConfig(
        {
          settings: settings.merged,
          extensions: [],
          extensionEnablementManager: new ExtensionEnablementManager(
            directory,
            { enabledOverride: [] },
          ),
          sessionId: 'borrowed-startup',
          argv,
          cwd: directory,
          preflight,
          settingsOwner: callerOwner,
        },
        ignoreReady,
      );
      configs.push(config);

      const activationOperation = transferActivation(preflight);
      registerCleanup(() => activationOperation.dispose());
      const activation = await activateConfiguredProvider(
        config,
        preflight,
        argv,
        activationOperation,
      );
      if (activation.token === undefined)
        throw new Error('Missing activation token');
      const agent = await createForegroundAgent(
        preflight,
        activation.token,
        activation.intent ?? {},
        credentialAuthority,
        {},
      );
      registerCleanup(() => agent.dispose());
      await preflight.setTrustedFolderLive(true);
      config.setApprovalMode(ApprovalMode.YOLO);
      await preflight.setTrustedFolderLive(false);
      expect(agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      expect(preflight.getActiveProviderName()).toBe('fake');
      await runExitCleanup();
      await expectClosed(activationOperation);
      expect(() => preflight.setTrustedFolderLive(false)).toThrow('disposed');
      expect(config.getProvider()).toBe('fake');
      await agent.dispose();
    } finally {
      await callerOwner.dispose();
    }
  });

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
          : await recordStartupSession(directory);
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
        spyOn(stdio, 'writeToStdout').mockImplementation((chunk, ...args) => {
          output.push(String(chunk));
          for (const argument of args) {
            if (typeof argument === 'function') argument();
          }
          return true;
        }),
        spyOn(stdio, 'writeToStderr').mockImplementation((chunk, ...args) => {
          output.push(String(chunk));
          for (const argument of args) {
            if (typeof argument === 'function') argument();
          }
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
          expect(disposed.size).toBe(1);
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
      const unrelated = await recordStartupSession(otherRoot);
      const output: string[] = [];
      restore.push(
        spyOn(stdio, 'writeToStdout').mockImplementation((chunk, ...args) => {
          output.push(String(chunk));
          for (const argument of args) {
            if (typeof argument === 'function') argument();
          }
          return true;
        }),
        spyOn(stdio, 'writeToStderr').mockImplementation((chunk, ...args) => {
          output.push(String(chunk));
          for (const argument of args) {
            if (typeof argument === 'function') argument();
          }
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
      const seeded = await recordStartupSession(directory);
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
        spyOn(stdio, 'writeToStdout').mockImplementation((chunk, ...args) => {
          output.push(String(chunk));
          for (const argument of args) {
            if (typeof argument === 'function') argument();
          }
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
    const { preflight, config } = await bootstrapStartup();
    transferActivation(preflight);
    const invalidChatsDir = resolve(directory, 'not-a-directory');
    await writeFile(invalidChatsDir, 'a file');
    const disposed = new Set<Config>();
    const originalDispose = config.dispose.bind(config);
    restore.push(
      spyOn(config, 'dispose').mockImplementation(async () => {
        await originalDispose();
        disposed.add(config);
      }),
    );
    await expect(
      handleSessionListAndDelete(
        { listSessions: true, deleteSession: undefined },
        invalidChatsDir,
        getProjectHash(directory),
        config,
      ),
    ).rejects.toThrow(/EEXIST|ENOTDIR/);
    expect(disposed.has(config)).toBe(true);
  });

  it('leaves the owner active when the delete selection is empty', async () => {
    const { preflight, config } = await bootstrapStartup();
    transferActivation(preflight);
    await handleSessionListAndDelete(
      { listSessions: false, deleteSession: '' },
      new Storage(directory).getProjectChatsDir(),
      getProjectHash(directory),
      config,
    );
    expect(preflight.getActiveProviderName()).toBe('fake');
    await runExitCleanup();
    expect(config.getProvider()).toBe('fake');
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
    let siblingActivation: agents.AgentActivationOperation | undefined;
    const { captured, load } = await loadStandalone('standalone-sibling', {
      onActivationBootstrapReady: (operation) => {
        siblingActivation = operation;
      },
    });
    const sibling = await load;
    const siblingPreflight = captured.preflight;
    if (siblingPreflight === undefined)
      throw new Error('Missing sibling preflight');

    process.argv.push('--list-sessions');
    restore.push(
      spyOn(process, 'exit').mockImplementation((code) => {
        expect(siblingPreflight.getActiveProviderName()).toBe('fake');
        throw new StartupExit(code);
      }),
    );
    try {
      await expect(main()).rejects.toMatchObject({ code: 0 });
      await siblingPreflight.setActiveProvider('fake');
      expect(siblingPreflight.getActiveProviderName()).toBe('fake');
      expect(sibling.getSessionId()).toBe('standalone-sibling');
    } finally {
      await siblingActivation?.dispose();
      await siblingPreflight.dispose();
      await sibling.dispose();
    }
  });
});
