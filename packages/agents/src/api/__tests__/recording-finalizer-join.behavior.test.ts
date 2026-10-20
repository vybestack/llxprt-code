import { fixtureAgentResources } from './helpers/agent-resource-capture.js';
import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it, spyOn } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import {
  createAgentRuntimeFactoryBindings,
  AgentRuntimeFactoryBindings,
} from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig, ProviderActivationIntent } from '../config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { type Agent } from '../index.js';
import { promises as fs } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { SessionLockManager } from '@vybestack/llxprt-code-core/recording/SessionLockManager.js';
import { drain } from './helpers/agentHarness.js';
import { gate } from './helpers/recording-finalizer-join-fixture.js';
import * as recordingFs from 'node:fs/promises';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function containsCause(error: unknown, cause: Error): boolean {
  if (error === cause) return true;
  if (!(error instanceof Error)) return false;
  if (containsCause(error.cause, cause)) return true;
  return (
    'errors' in error &&
    Array.isArray(error.errors) &&
    error.errors.some((nested: unknown) => containsCause(nested, cause))
  );
}

const recordingEvents = [
  'contentAdded',
  'compressionStarted',
  'compressionLockReleased',
  'compressionEnded',
];

describe('public Agent recording finalizer join', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  const credentials = useOwnedCredentials();
  let callerConfig: Config;
  let callerSettings: SettingsService;
  let callerSettingsOwner: SessionSettingsOwner;
  let callerPolicy: RuntimePolicyOwner;
  let callerMcp: McpRuntimeOwner;
  let callerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let callerOwner: SessionClientOwner;
  let callerClose: () => Promise<void>;
  let callerFactories: AgentRuntimeFactoryBindings;
  let callerRelease: AcquisitionRelease;
  let callerFiles: ProviderFileLifecycle;
  let callerRuntimeId: string;
  let callerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let callerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let callerContent: ReturnType<typeof createRuntimeContentGeneratorFactory>;

  async function openCaller(
    fixture: string,
    overrides: Readonly<Partial<AgentConfig>> = {},
    suppliedFactories: Readonly<Partial<AgentRuntimeFactoryBindings>> = {},
    skillSettings: Pick<
      ConfigParameters,
      'enableExtensionReloading' | 'storageRoot'
    > = {},
    extensionLoader?: ExtensionLoader,
    skillOperations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'caller-adoption-')),
    );
    const selection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...overrides,
      workingDir:
        overrides.workingDir === undefined
          ? directory
          : await realpath(overrides.workingDir),
    };
    const parameters = { ...toConfigParameters(selection), ...skillSettings };
    parameters.interactive = true;
    if (overrides.hooks !== undefined) parameters.enableHooks = true;
    if (
      overrides.filesystemOwner === undefined &&
      (overrides.harness?.includeProcessCwd ?? true)
    )
      parameters.includeDirectories = [
        ...(parameters.includeDirectories ?? []),
        process.cwd(),
      ];
    callerConfig = new Config(parameters);
    callerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    callerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      callerConfig.getInitialSettings(),
    ))
      callerSettings.set(key, value);
    callerPolicy = new RuntimePolicyOwner(callerConfig);
    injectConfirmationForcingPolicy(callerPolicy.session.confirmation);
    callerMcp = await buildTestMcpRuntime(
      callerConfig,
      callerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      callerPolicy,
      skillOperations,
    );
    acquireCallerProviders();
    const media = new SessionMediaOwner(
      callerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    callerOwner = await createCapturedSessionOwner(
      callerConfig,
      assembleTaskSchemaPolicy(callerSettings),
      callerManager,
      callerFactories.agentClientFactory,
      media.store,
      callerMcp.readInstructions,
      callerMcp.workspacePaths,
      callerSettingsOwner,
      callerContent,
      callerTokenizer,
    );
    callerOwner.bindMcpRuntime(callerMcp);
    callerOwner.bindProviderFiles(callerFiles, (provider) =>
      callerOAuth.composeRetryOperations(provider),
    );
    callerOwner.bindHooks();
    callerClose = settleEngineRelease.bind(
      undefined,
      [
        () => callerOwner.dispose(),
        () => callerRelease.close(),
        () => media.dispose(),
        () => callerMcp.dispose(),
        () => callerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        callerConfig,
        callerSettings,
        callerSettingsOwner,
        callerManager,
        callerOAuth,
        callerRuntimeId,
        callerTokenizer,
        undefined,
      );
      await callerMcp.initialize();
      await activateCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, callerClose);
    }
  }
  function acquireCallerProviders(): void {
    callerRuntimeId = 'caller-' + randomUUID();
    callerRelease = new AcquisitionRelease();
    callerSettingsOwner = new SessionSettingsOwner(callerSettings);
    callerRelease.acquire('settings', () => callerSettingsOwner.dispose());
    callerSettingsOwner.initializeProviderSelection(
      callerConfig.getProvider(),
      callerConfig.getModel(),
    );
    callerSettingsOwner.bindTelemetry(callerConfig);
    callerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [callerRuntimeId, callerConfig.getSessionId()])
      callerRelease.acquire('files', () =>
        releaseAdoptedFileScope(callerFiles, scope),
      );
    callerManager = acquirePreferredProviderManager(
      callerConfig,
      callerSettings,
      callerSettingsOwner,
      callerFiles,
      callerRuntimeId,
      credentials().authority,
      callerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(callerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    callerTokenizer = factoriesTokenizer;
    callerContent = factoriesContent;
    callerOAuth = acquirePreferredOAuth(
      undefined,
      callerPolicy.session.messageBus,
      callerConfig,
      callerSettings,
      callerManager,
      callerRuntimeId,
      callerMcp.profileDefinitions,
      credentials().authority,
      callerRelease,
      undefined,
    );
  }
  async function activateCallerClient(
    intent: ProviderActivationIntent = {
      provider: callerConfig.getProvider(),
      model: callerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      callerConfig,
      intent,
      assembleProviderSwitch(
        callerConfig,
        callerSettings,
        callerManager,
        callerOAuth,
        () => 'agent',
        () => callerOwner.refreshAuth(),
        callerSettingsOwner,
      ),
      callerSettings,
      callerManager,
      (method) => callerOwner.refreshAuth(method),
      assembleModelSelection(callerSettingsOwner),
    );
    requireCallerActivation(activation);
    await callerOwner.initializeTools();
    await capturedSessionClient(callerOwner).startChat();
  }

  async function withRecordingFinalizerFixture(
    scenario: (
      agent: Agent,
      chatsDir: string,
      sessionId: string,
    ) => Promise<void>,
  ): Promise<void> {
    await openCaller('multi-turn-text.jsonl');
    const sessionId = 'recording-finalizer-' + randomUUID();
    const agent = await fromConfig(
      callerConfig,
      callerSettings,
      { sessionId },
      callerSettingsOwner,
      callerManager,
      undefined,
      callerPolicy.session.messageBus,
      callerMcp,
      undefined,
      capturedSessionClient(callerOwner),
      undefined,
      undefined,
      undefined,
      callerFactories,
    );
    try {
      await scenario(agent, callerConfig.projectChatsDir, sessionId);
    } finally {
      try {
        await Promise.allSettled([agent.dispose()]);
      } finally {
        await runCleanupSteps([
          callerClose,
          () =>
            rm(callerConfig.projectTempDir, { recursive: true, force: true }),
        ]);
      }
    }
  }

  it('joins the final public-turn journal append before releasing its real lock', async () => {
    await withRecordingFinalizerFixture(async (agent, chatsDir, sessionId) => {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'journal-seed' }],
        },
      ]);
      await agent.session.setRecording({ enabled: true });
      const journal = agent.session.getRecording().path;
      if (!journal) throw new Error('Recording journal missing');
      const entered = gate();
      const release = gate();
      const append = recordingFs.appendFile;
      const boundary = spyOn(recordingFs, 'appendFile').mockImplementation(
        async (...args) => {
          if (
            args[0] === journal &&
            String(args[1]).includes('turn one reply')
          ) {
            entered.release();
            await release.promise;
          }
          return append(...args);
        },
      );
      let disposal: Promise<void> | undefined;
      const turn = drain(agent.stream('public-turn-before-final-append'));
      try {
        await entered.promise;
        await turn;
        let settled = false;
        disposal = agent.dispose();
        void disposal.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        await setImmediate();
        expect(settled).toBe(false);
        expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
          true,
        );
        expect(await fs.readFile(journal, 'utf8')).not.toContain(
          'turn one reply',
        );
        release.release();
        await disposal;
        const transcript = await fs.readFile(journal, 'utf8');
        expect(transcript).toContain('public-turn-before-final-append');
        expect(transcript).toContain('turn one reply');
        expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
          false,
        );
      } finally {
        release.release();
        try {
          await Promise.allSettled([turn, disposal ?? agent.dispose()]);
        } finally {
          boundary.mockRestore();
        }
      }
    });
  }, 30000);

  for (const failWrite of [false, true]) {
    it(`joins accepted persistence before releasing recording ownership${failWrite ? ' and retains its original failure' : ''}`, async () => {
      await withRecordingFinalizerFixture(
        async (agent, chatsDir, sessionId) => {
          const history = fixtureAgentResources(agent)
            .publishedClient(agent)
            .getHistoryService();
          if (!history) throw new Error('Missing real history service');
          const baseline = recordingEvents.map((event) =>
            history.listenerCount(event),
          );
          await agent.setHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'finalizer-seed' }],
            },
          ]);
          await agent.session.setRecording({ enabled: true });
          const journal = agent.session.getRecording().path;
          if (!journal) throw new Error('Recording journal missing');
          expect(await fs.readFile(journal, 'utf8')).toContain(
            'finalizer-seed',
          );
          expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
            true,
          );
          expect(
            recordingEvents.map((event) => history.listenerCount(event)),
          ).toStrictEqual(baseline.map((count) => count + 1));

          await drain(agent.stream('public-turn-before-recording-finalizer'));
          const entered = gate();
          const release = gate();
          const retired = gate();
          const failure = new Error(
            'Accepted recording persistence rename failed',
          );
          const rename = fs.rename;
          let destination: string | undefined;
          let source: string | undefined;
          const boundary = spyOn(fs, 'rename').mockImplementation(
            async (from, to) => {
              if (
                typeof to === 'string' &&
                to.startsWith(`${chatsDir}/`) &&
                to.endsWith('.json')
              ) {
                destination = to;
                source = String(from);
                entered.release();
                await release.promise;
                if (failWrite) throw failure;
              }
              return rename(from, to);
            },
          );
          const onRemoval = (): void => {
            if (
              recordingEvents.every(
                (event, index) =>
                  history.listenerCount(event) === baseline[index],
              )
            ) {
              retired.release();
            }
          };
          history.on('removeListener', onRemoval);
          let disposal: Promise<unknown> | undefined;
          try {
            history.add({
              speaker: 'human',
              blocks: [
                { type: 'text', text: 'accepted-history-before-finalizer' },
              ],
            });
            await entered.promise;
            if (!source) throw new Error('Persistence did not reach rename');
            expect(await fs.readFile(source, 'utf8')).toContain(
              'accepted-history-before-finalizer',
            );
            let settled = false;
            const terminal = agent.dispose();
            expect(agent.dispose()).toBe(terminal);
            disposal = terminal.then(
              () => {
                settled = true;
                return undefined;
              },
              (error: unknown) => {
                settled = true;
                return error;
              },
            );
            await Promise.race([
              retired.promise,
              disposal.then(() => {
                throw new Error(
                  'Agent disposed before retiring recording listeners',
                );
              }),
            ]);
            await setImmediate();
            expect(settled).toBe(false);
            expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
              true,
            );
            expect(
              recordingEvents.map((event) => history.listenerCount(event)),
            ).toStrictEqual(baseline);
            release.release();
            const result = await disposal;
            expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
              false,
            );
            const transcript = await fs.readFile(journal, 'utf8');
            expect(transcript).toContain('accepted-history-before-finalizer');
            expect(transcript).toContain('turn one reply');
            expect(containsCause(result, failure)).toBe(failWrite);
            expect(result === undefined).toBe(!failWrite);
            const repeated = await agent.dispose().then(
              () => undefined,
              (error: unknown) => error,
            );
            expect(repeated).toBe(result);
            if (!destination)
              throw new Error('Persistence destination missing');
            const persisted = await fs.readFile(destination, 'utf8');
            expect(persisted).toContain('turn one reply');
            expect(
              persisted.includes('accepted-history-before-finalizer'),
            ).toBe(!failWrite);
            const filesBefore = (await fs.readdir(chatsDir)).sort();
            history.add({
              speaker: 'human',
              blocks: [
                { type: 'text', text: 'late-history-after-agent-disposal' },
              ],
            });
            await setImmediate();
            expect(await fs.readFile(journal, 'utf8')).toBe(transcript);
            expect(await fs.readFile(destination, 'utf8')).toBe(persisted);
            expect((await fs.readdir(chatsDir)).sort()).toStrictEqual(
              filesBefore,
            );
            expect(
              recordingEvents.map((event) => history.listenerCount(event)),
            ).toStrictEqual(baseline);
          } finally {
            release.release();
            try {
              await Promise.allSettled([disposal ?? agent.dispose()]);
            } finally {
              boundary.mockRestore();
              history.off('removeListener', onRemoval);
            }
          }
        },
      );
    }, 30000);
  }
});

async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
