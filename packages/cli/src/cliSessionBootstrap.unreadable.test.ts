/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: startup --continue with an unreadable recording in the project,
 * and recordings written when the CLI started with no provider configured.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
  beforeAll,
  afterAll,
} from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  SessionRecordingService,
  getProjectHash,
  type IContent,
  readSessionHeader,
  type SessionRecordingServiceConfig,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { buildAgentClientFactory } from '../../agents/src/api/agentBootstrap.js';
import {
  createCapturedSessionOwner,
  ownerClients,
} from '../../agents/src/api/__tests__/helpers/session-client-capture.js';
import type { SessionClientOwner } from '../../agents/src/session/session-client-owner.js';
import { readCurrentOwnerHistory } from './__tests__/session-owner-history-read.js';
import type { SessionControl } from '../../agents/src/api/control/sessionControl.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { buildTestMcpRuntime } from '../../agents/src/api/__tests__/helpers/mcp-owner-fixture.js';
import { FakeProvider } from '../../providers/src/fake/FakeProvider.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { LiveProviderConfig } from './__tests__/liveProviderConfig.js';
import { setupOwnerSessionRecording } from './cliSessionBootstrap.js';

let projectHash = '';
const CORRUPT_REASON =
  'Invalid session_start: missing or malformed required fields';

function recordingConfig(
  chatsDir: string,
  sessionId: string,
): SessionRecordingServiceConfig {
  return {
    chatsDir,
    sessionId,
    projectHash,
    workspaceDirs: [chatsDir],
    provider: 'test-provider',
    model: 'test-model',
  };
}

async function writeHealthySession(
  chatsDir: string,
  sessionId: string,
  modified: string,
): Promise<void> {
  const recording = new SessionRecordingService(
    recordingConfig(chatsDir, sessionId),
  );
  try {
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: `hello from ${sessionId}` }],
    });
    await recording.flush();
    const when = new Date(modified);
    await utimes(recording.getFilePath()!, when, when);
  } finally {
    await recording.dispose();
  }
}

async function writeCorruptSession(
  chatsDir: string,
  sessionId: string,
  modified: string,
): Promise<string> {
  await mkdir(chatsDir, { recursive: true });
  const filePath = join(
    chatsDir,
    `session-2026-10-08T21-18-08-${sessionId.slice(0, 12)}.jsonl`,
  );
  const header = {
    v: 1,
    seq: 1,
    ts: '2026-10-08T21:18:08.000Z',
    type: 'session_start',
    payload: {
      sessionId,
      projectHash,
      workspaceDirs: ['/x'],
      provider: 'anthropic',
      model: 42,
      startTime: '2026-10-08T21:18:08.000Z',
    },
  };
  await writeFile(filePath, `${JSON.stringify(header)}\n`, 'utf-8');
  const when = new Date(modified);
  await utimes(filePath, when, when);
  return filePath;
}

function configFor(
  root: string,
  overrides: { continueSession?: boolean | string; provider?: string } = {},
): StartupConfig {
  return new StartupConfig(root, {
    cwd: root,
    targetDir: root,
    debugMode: false,
    question: undefined,
    userMemory: '',
    sessionId: 'fresh-session',
    model: overrides.provider === undefined ? '' : 'test-model',
    ...(overrides.provider === undefined
      ? {}
      : { provider: overrides.provider }),
    ...(overrides.continueSession === undefined
      ? {}
      : { continueSession: overrides.continueSession }),
  });
}

/** A real Config whose chats directory is the test's temp dir (never the user's global temp). */
class StartupConfig extends LiveProviderConfig {
  override readonly projectTempDir: string;
  override readonly projectChatsDir: string;
  constructor(
    chatsRoot: string,
    params: ConstructorParameters<typeof Config>[0],
  ) {
    super(params);
    this.projectTempDir = join(chatsRoot, getProjectHash(params.targetDir));
    this.projectChatsDir = join(chatsRoot, 'chats');
  }
}

interface StartupResult {
  readonly resumedSessionId: string | null;
  readonly resumedHistory: IContent[] | null;
  readonly startupWarnings: string[];
  readonly session: SessionControl;
}

describe('startup recording with unreadable and no-provider sessions (issue #3732)', () => {
  let root: string;
  let chatsDir: string;
  let warnings: string[] = [];
  const sessions: SessionControl[] = [];
  const configs: Config[] = [];
  const restores: Array<() => void> = [];
  const workspaceClosers: Array<() => Promise<void>> = [];
  let prompts: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    prompts = await mkdtemp(join(tmpdir(), 'startup-owner-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = prompts;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(prompts, { recursive: true, force: true });
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recording-bootstrap-3732-'));
    chatsDir = join(root, 'chats');
    projectHash = getProjectHash(root);
    warnings = [];
  });

  afterEach(async () => {
    for (const session of sessions.splice(0)) await session.dispose();
    for (const restore of restores.splice(0)) restore();
    for (const close of workspaceClosers.splice(0).reverse()) await close();
    for (const config of configs.splice(0)) await config.dispose();
    await rm(root, { recursive: true, force: true });
  });

  async function acquireSession(
    config: StartupConfig,
    restoreError?: Error,
    restoreIdentities?: string[],
  ) {
    configs.push(config);
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settings.set(key, value);
    const settingsOwner = new SessionSettingsOwner(settings);
    settingsOwner.bindTelemetry(config);
    settingsOwner.initializeProviderSelection(
      config.getProvider(),
      config.getModel(),
    );
    workspaceClosers.push(() => settingsOwner.dispose());
    const policy = new RuntimePolicyOwner(config);
    workspaceClosers.push(() => policy.dispose());
    const mcp = await buildTestMcpRuntime(
      config,
      policy.session.messageBus,
      {},
      undefined,
      policy,
    );
    workspaceClosers.push(() => mcp.dispose());
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      config,
      undefined,
      undefined,
      settingsOwner,
    );
    workspaceClosers.push(async () => {
      manager.dispose();
    });
    const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
    workspaceClosers.push(() => media.dispose());
    const sessionClient = await createCapturedSessionOwner(
      config,
      assembleTaskSchemaPolicy(settings),
      manager,
      buildAgentClientFactory(media.store),
      media.store,
      mcp.readInstructions,
      mcp.workspacePaths,
      settingsOwner,
      createRuntimeContentGeneratorFactory(),
      configureProviderTokenizer(manager),
    );
    workspaceClosers.push(() => sessionClient.dispose());
    sessionClient.bindMcpRuntime(mcp);
    await mcp.initialize();
    await sessionClient.initializeTools();
    const provider = new FakeProvider(
      fileURLToPath(
        new URL(
          '../../agents/src/api/__tests__/fixtures/multi-turn-text.jsonl',
          import.meta.url,
        ),
      ),
      root,
    );
    provider.name = config.getProvider() ?? 'test-provider';
    manager.registerProvider(provider);
    manager.setActiveProvider(provider.name);
    if (config.getProvider() !== undefined)
      await sessionClient.clients.refreshAuth();
    sessionClient.clients.conversationBinding.initializeConversation();
    // The production path reaches the current client; every client the
    // owner's factory built carries the same instance spy.
    const clients = ownerClients(sessionClient);
    const restored: unknown[][] = [];
    for (const client of clients) {
      const restoreHistory = client.restoreHistory;
      const restore = spyOn(client, 'restoreHistory').mockImplementation(
        async (history, origin) => {
          restored.push([...history]);
          if (restoreError) throw restoreError;
          restoreIdentities?.push(config.getSessionId());
          await restoreHistory.call(client, history, origin);
          restoreIdentities?.push(config.getSessionId());
        },
      );
      restores.push(() => restore.mockRestore());
    }
    const session = sessionClient.createSessionControl(
      'config',
      () => config.getSessionId(),
      (operation) => operation(),
      () => {},
      () => {},
      () => config.getProvider() ?? 'unknown',
      () => config.getModel(),
    );
    sessions.push(session);
    return { session, restored, sessionClient, clients };
  }

  async function startup(
    continueSession: boolean | string,
  ): Promise<StartupResult> {
    const { setup } = await startupViaSetup(continueSession);
    warnings = setup.startupWarnings;
    return setup;
  }

  async function startupViaSetup(
    continueSession: boolean | string,
    restoreError?: Error,
  ) {
    const config = configFor(root, {
      continueSession,
      provider: 'test-provider',
    });
    const { session, restored } = await acquireSession(config, restoreError);
    const startupWarnings: string[] = [];
    const resumedHistory = await setupOwnerSessionRecording(
      config,
      session,
      session.listBrowserTargetsDetailed,
      { listSessions: false, deleteSession: undefined },
      null,
      startupWarnings,
    );
    const setup: StartupResult = {
      resumedSessionId: resumedHistory === null ? null : session.getSessionId(),
      resumedHistory,
      startupWarnings,
      session,
    };
    return { setup, restored };
  }

  /**
   * What the CLI does when a profile is loaded: the live Config takes the new
   * provider/model and the switch is recorded as history.
   */
  async function loadProfile(
    live: LiveProviderConfig,
    recording: SessionControl,
    provider: string,
    model: string,
  ): Promise<void> {
    live.setProvider(provider);
    live.setModel(model);
    await recording.flushRecording({
      type: 'provider_switch',
      provider,
      model,
    });
  }

  async function recordFirstMessage(
    session: SessionControl,
    sessionClient: SessionClientOwner,
  ): Promise<string> {
    const history = readCurrentOwnerHistory(sessionClient);
    if (history === null) throw new Error('Missing acquired startup history');
    history.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'first message' }],
    });
    await session.flushRecording();
    const path = session.getRecording().path;
    if (path === undefined) throw new Error('First message was not recorded');
    return path;
  }

  it('resumes a session recorded after a no-provider start and a profile load', async () => {
    const noProviderConfig = configFor(root);
    const { session: first, sessionClient } =
      await acquireSession(noProviderConfig);
    await setupOwnerSessionRecording(
      noProviderConfig,
      first,
      first.listBrowserTargetsDetailed,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    let header: Awaited<ReturnType<typeof readSessionHeader>>;
    try {
      await loadProfile(noProviderConfig, first, 'codex', 'gpt-6-luna');
      header = await readSessionHeader(
        await recordFirstMessage(first, sessionClient),
      );
    } finally {
      await first.dispose();
    }

    const entry = await startup(true);

    expect({
      header: { provider: header?.provider, model: header?.model },
      resumedSessionId: entry.resumedSessionId,
      historyLength: entry.resumedHistory?.length,
      warnings,
    }).toStrictEqual({
      header: { provider: 'codex', model: 'gpt-6-luna' },
      resumedSessionId: 'fresh-session',
      historyLength: 1,
      warnings: [],
    });
  });

  it('writes the live provider/model into the header when the change never reaches recordProviderSwitch', async () => {
    const liveConfig = configFor(root);
    const { session: recording, sessionClient } =
      await acquireSession(liveConfig);
    await setupOwnerSessionRecording(
      liveConfig,
      recording,
      recording.listBrowserTargetsDetailed,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    try {
      liveConfig.setProvider('anthropic');
      liveConfig.setModel('claude-opus-5-5');
      const header = await readSessionHeader(
        await recordFirstMessage(recording, sessionClient),
      );

      expect({
        provider: header?.provider,
        model: header?.model,
      }).toStrictEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
    } finally {
      await recording.dispose();
    }
  });

  it('setupSessionRecording returns one file-and-reason warning and resumes the healthy session when another recording is unreadable', async () => {
    await writeHealthySession(chatsDir, 'healthy-0008', '2026-10-01T00:00:00Z');
    const corruptPath = await writeCorruptSession(
      chatsDir,
      'corrupt-0008',
      '2026-10-08T00:00:00Z',
    );

    const { setup, restored } = await startupViaSetup(true);

    expect({
      resumedSessionId: setup.resumedSessionId,
      restoredCount: restored.length,
      warningCount: setup.startupWarnings.length,
      namesFile: setup.startupWarnings[0]?.includes(corruptPath),
      namesReason: setup.startupWarnings[0]?.includes(CORRUPT_REASON),
    }).toStrictEqual({
      resumedSessionId: 'healthy-0008',
      restoredCount: 1,
      warningCount: 1,
      namesFile: true,
      namesReason: true,
    });
  });

  it('setupSessionRecording returns the file-and-reason warning and starts a new session when the reference names only the unreadable recording', async () => {
    const corruptPath = await writeCorruptSession(
      chatsDir,
      'corrupt-0009',
      '2026-10-08T00:00:00Z',
    );

    const { setup } = await startupViaSetup('corrupt-0009');

    expect({
      resumedSessionId: setup.resumedSessionId,
      newSessionId: setup.session.getSessionId(),
      warningCount: setup.startupWarnings.length,
      namesFile: setup.startupWarnings[0]?.includes(corruptPath),
      namesReason: setup.startupWarnings[0]?.includes(CORRUPT_REASON),
    }).toStrictEqual({
      resumedSessionId: null,
      newSessionId: 'fresh-session',
      warningCount: 1,
      namesFile: true,
      namesReason: true,
    });
  });

  it('setupSessionRecording returns no warnings for a normal resume with no unreadable recordings', async () => {
    await writeHealthySession(chatsDir, 'healthy-0010', '2026-10-01T00:00:00Z');

    const { setup } = await startupViaSetup(true);

    expect({
      resumedSessionId: setup.resumedSessionId,
      startupWarnings: setup.startupWarnings,
    }).toStrictEqual({
      resumedSessionId: 'healthy-0010',
      startupWarnings: [],
    });
  });

  it('setupSessionRecording returns the restore-failure warning and falls back to a new session when history cannot be restored', async () => {
    await writeHealthySession(chatsDir, 'healthy-0011', '2026-10-01T00:00:00Z');

    const { setup } = await startupViaSetup(true, new Error('bad history'));

    expect({
      resumedSessionId: setup.resumedSessionId,
      warnings: setup.startupWarnings,
    }).toStrictEqual({
      resumedSessionId: null,
      warnings: [
        'Could not restore conversation history (session healthy-0011): bad history. Falling back to a new session.',
      ],
    });
  });

  it('resumes the older healthy session on bare continue and warns once about the skipped file', async () => {
    await writeHealthySession(chatsDir, 'healthy-0001', '2026-10-01T00:00:00Z');
    const corruptPath = await writeCorruptSession(
      chatsDir,
      'corrupt-0001',
      '2026-10-08T00:00:00Z',
    );

    const entry = await startup(true);

    expect({
      resumedSessionId: entry.resumedSessionId,
      warningCount: warnings.length,
      namesFile: warnings[0]?.includes(corruptPath),
      namesReason: warnings[0]?.includes(CORRUPT_REASON),
    }).toStrictEqual({
      resumedSessionId: 'healthy-0001',
      warningCount: 1,
      namesFile: true,
      namesReason: true,
    });
  });

  it('resumes a healthy session by id while another recording is unreadable', async () => {
    await writeHealthySession(chatsDir, 'healthy-0002', '2026-10-01T00:00:00Z');
    const corruptPath = await writeCorruptSession(
      chatsDir,
      'corrupt-0002',
      '2026-10-08T00:00:00Z',
    );

    const entry = await startup('healthy-0002');

    expect({
      resumedSessionId: entry.resumedSessionId,
      warningCount: warnings.length,
      namesFile: warnings[0]?.includes(corruptPath),
    }).toStrictEqual({
      resumedSessionId: 'healthy-0002',
      warningCount: 1,
      namesFile: true,
    });
  });

  it('resolves a numeric reference against readable sessions only', async () => {
    await writeHealthySession(chatsDir, 'healthy-0003', '2026-10-01T00:00:00Z');
    await writeCorruptSession(chatsDir, 'corrupt-0003', '2026-10-08T00:00:00Z');

    const entry = await startup('1');

    expect(entry.resumedSessionId).toBe('healthy-0003');
  });

  it('starts a new session with a clear file-and-reason warning when the reference names the unreadable recording', async () => {
    await writeHealthySession(chatsDir, 'healthy-0004', '2026-10-01T00:00:00Z');
    const corruptPath = await writeCorruptSession(
      chatsDir,
      'corrupt-0004',
      '2026-10-08T00:00:00Z',
    );

    const entry = await startup('corrupt-0004');

    expect({
      resumedSessionId: entry.resumedSessionId,
      resumedHistory: entry.resumedHistory,
      newSessionId: entry.session.getSessionId(),
      warningCount: warnings.length,
      namesRef: warnings[0]?.includes('corrupt-0004'),
      namesFile: warnings[0]?.includes(corruptPath),
      namesReason: warnings[0]?.includes(CORRUPT_REASON),
    }).toStrictEqual({
      resumedSessionId: null,
      resumedHistory: null,
      newSessionId: 'fresh-session',
      warningCount: 1,
      namesRef: true,
      namesFile: true,
      namesReason: true,
    });
  });

  it('starts a new session when every recording is unreadable and bare continue is requested', async () => {
    const corruptPath = await writeCorruptSession(
      chatsDir,
      'corrupt-0005',
      '2026-10-08T00:00:00Z',
    );

    const entry = await startup(true);

    expect({
      resumedSessionId: entry.resumedSessionId,
      newSessionId: entry.session.getSessionId(),
      namesFile: warnings.some((warning) => warning.includes(corruptPath)),
    }).toStrictEqual({
      resumedSessionId: null,
      newSessionId: 'fresh-session',
      namesFile: true,
    });
  });

  it('publishes the resumed identity only after native startup history restoration succeeds', async () => {
    await writeHealthySession(
      chatsDir,
      'identity-after-restore',
      '2026-10-08T00:00:00Z',
    );
    const config = configFor(root, {
      continueSession: true,
      provider: 'test-provider',
    });
    const identities: string[] = [];
    const { session } = await acquireSession(config, undefined, identities);
    const history = await setupOwnerSessionRecording(
      config,
      session,
      session.listBrowserTargetsDetailed,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    if (history === null) throw new Error('Expected restored startup history');
    expect(identities).toStrictEqual(['fresh-session', 'fresh-session']);
    expect(config.getSessionId()).toBe('identity-after-restore');
    expect(session.readHistorySnapshot()?.messages).toStrictEqual(history);
  });

  it('propagates native restore and rollback failures without starting a replacement recording', async () => {
    await writeHealthySession(
      chatsDir,
      'terminal-native-restore',
      '2026-10-08T00:00:00Z',
    );
    const config = configFor(root, {
      continueSession: true,
      provider: 'test-provider',
    });
    const primary = new Error('native startup restore failed');
    const rollback = new Error('native prior-history rollback failed');
    const { session, clients } = await acquireSession(config, primary);
    const resets: string[] = [];
    for (const client of clients) {
      const resetChat = client.resetChat;
      const reset = spyOn(client, 'resetChat').mockImplementation(async () => {
        resets.push(config.getSessionId());
        await resetChat.call(client);
      });
      const setHistory = spyOn(client, 'setHistory').mockRejectedValue(
        rollback,
      );
      restores.push(
        () => setHistory.mockRestore(),
        () => reset.mockRestore(),
      );
    }
    const outcome = await setupOwnerSessionRecording(
      config,
      session,
      session.listBrowserTargetsDetailed,
      { listSessions: false, deleteSession: undefined },
      null,
      warnings,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    if (!(outcome instanceof AggregateError)) throw outcome;
    expect(outcome.errors).toStrictEqual([primary, rollback]);
    expect(resets).toStrictEqual(['fresh-session']);
    expect(config.getSessionId()).toBe('fresh-session');
    expect(session.getRecording().enabled).toBe(false);
    expect(warnings).toStrictEqual([]);
    expect(
      (await readdir(chatsDir)).filter((name) => name.endsWith('.lock')),
    ).toStrictEqual([]);
  });

  describe('recordings whose first line is not a session_start', () => {
    interface MalformedCase {
      readonly label: string;
      readonly fileName: string;
      readonly text: string;
      readonly reason: string;
    }
    const MALFORMED: readonly MalformedCase[] = [
      {
        label: 'is not valid JSON',
        fileName: 'session-2026-10-08T21-18-08-badjson00001.jsonl',
        text: '{"type":"session_start", oops\n',
        reason:
          'Missing or corrupt session_start event: first line is not valid JSON',
      },
      {
        label: 'is empty',
        fileName: 'session-2026-10-08T21-18-08-emptyfile001.jsonl',
        text: '',
        reason: 'Empty file or unreadable first line',
      },
      {
        label: 'is another event type',
        fileName: 'session-2026-10-08T21-18-08-notstart0001.jsonl',
        text: `${JSON.stringify({ v: 1, seq: 1, ts: 'x', type: 'content', payload: {} })}\n`,
        reason:
          'Missing or corrupt session_start event: first line is not a session_start event',
      },
    ];

    async function writeMalformed(entry: MalformedCase): Promise<string> {
      await mkdir(chatsDir, { recursive: true });
      const filePath = join(chatsDir, entry.fileName);
      await writeFile(filePath, entry.text, 'utf-8');
      return filePath;
    }

    it('lists every malformed file with its reason in the one startup warning', async () => {
      await writeHealthySession(
        chatsDir,
        'healthy-0006',
        '2026-10-01T00:00:00Z',
      );
      const paths = await Promise.all(MALFORMED.map(writeMalformed));

      const entry = await startup(true);

      expect({
        resumedSessionId: entry.resumedSessionId,
        warningCount: warnings.length,
        listed: MALFORMED.map(
          (malformed, index) =>
            warnings[0]?.includes(`${paths[index]}: ${malformed.reason}`) ===
            true,
        ),
      }).toStrictEqual({
        resumedSessionId: 'healthy-0006',
        warningCount: 1,
        listed: [true, true, true],
      });
    });

    for (const malformed of MALFORMED) {
      it(`reports the reason when the reference names the file whose first line ${malformed.label}`, async () => {
        await writeHealthySession(
          chatsDir,
          'healthy-0007',
          '2026-10-01T00:00:00Z',
        );
        const filePath = await writeMalformed(malformed);

        const entry = await startup(malformed.fileName);

        expect({
          resumedSessionId: entry.resumedSessionId,
          newSessionId: entry.session.getSessionId(),
          warningCount: warnings.length,
          namesFile: warnings[0]?.includes(filePath),
          namesReason: warnings[0]?.includes(malformed.reason),
        }).toStrictEqual({
          resumedSessionId: null,
          newSessionId: 'fresh-session',
          warningCount: 1,
          namesFile: true,
          namesReason: true,
        });
      });
    }
  });
});
