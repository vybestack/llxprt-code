/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: startup --continue with an unreadable recording in the project,
 * and recordings written when the CLI started with no provider configured.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  SessionRecordingService,
  getProjectHash,
  type AgentClientContract,
  readSessionHeader,
  type SessionRecordingServiceConfig,
} from '@vybestack/llxprt-code-core';
import { LiveProviderConfig } from './__tests__/liveProviderConfig.js';
import {
  buildNewRecordingService,
  createOrResumeRecording,
  setupSessionRecording,
  type ResolvedRecording,
} from './cliSessionBootstrap.js';
import type { ParsedCliArgs } from './cliBootstrap.js';

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
): LiveProviderConfig {
  return new LiveProviderConfig({
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
class StartupConfig extends Config {
  constructor(
    private readonly chatsRoot: string,
    params: ConstructorParameters<typeof Config>[0],
  ) {
    super(params);
  }

  override getProjectTempDir(): string {
    return this.chatsRoot;
  }
}

/**
 * The session client the CLI hands recording bootstrap: the agent client that
 * records what the CLI restores into it, and the workspace directories.
 */
function sessionClientFor(root: string, restoreError?: Error) {
  const restored: unknown[][] = [];
  const client = {
    getAgentClient: () =>
      ({
        restoreHistory: async (history: readonly unknown[]) => {
          restored.push([...history]);
          if (restoreError) throw restoreError;
        },
        resetChat: async () => {},
      }) as unknown as AgentClientContract,
    workspaceDirectories: () => [root],
  };
  return { client, restored };
}

describe('startup recording with unreadable and no-provider sessions (issue #3732)', () => {
  let root: string;
  let chatsDir: string;
  let warnings: string[] = [];
  const resolved: ResolvedRecording[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recording-bootstrap-3732-'));
    chatsDir = join(root, 'chats');
    projectHash = getProjectHash(root);
    warnings = [];
  });

  afterEach(async () => {
    for (const entry of resolved.splice(0)) {
      await entry.recordingService.dispose();
      await entry.resumedLockHandle?.release();
    }
    await rm(root, { recursive: true, force: true });
  });

  async function startup(
    continueSession: boolean | string,
  ): Promise<ResolvedRecording> {
    const entry = await createOrResumeRecording(
      configFor(root, { continueSession, provider: 'test-provider' }),
      projectHash,
      chatsDir,
      sessionClientFor(root).client,
    );
    resolved.push(entry);
    warnings = entry.startupWarnings;
    return entry;
  }

  /** The real CLI startup path, with a Config rooted at the temp dir. */
  async function startupViaSetup(
    continueSession: boolean | string,
    restoreError?: Error,
  ): Promise<{
    setup: Awaited<ReturnType<typeof setupSessionRecording>>;
    restored: unknown[][];
  }> {
    const config = new StartupConfig(root, {
      cwd: root,
      targetDir: root,
      debugMode: false,
      question: undefined,
      userMemory: '',
      sessionId: 'fresh-session',
      model: 'test-model',
      provider: 'test-provider',
      continueSession,
    });
    const { client, restored } = sessionClientFor(root, restoreError);
    const setup = await setupSessionRecording(
      config,
      {} as ParsedCliArgs,
      null,
      client,
    );
    resolved.push(setup);
    return { setup, restored };
  }

  /**
   * What the CLI does when a profile is loaded: the live Config takes the new
   * provider/model and the switch is recorded as history.
   */
  function loadProfile(
    live: LiveProviderConfig,
    recording: SessionRecordingService,
    provider: string,
    model: string,
  ): void {
    live.setProvider(provider);
    live.setModel(model);
    recording.recordProviderSwitch(provider, model);
  }

  async function recordFirstMessage(
    recording: SessionRecordingService,
  ): Promise<string> {
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'first message' }],
    });
    await recording.flush();
    return recording.getFilePath()!;
  }

  it('resumes a session recorded after a no-provider start and a profile load', async () => {
    const noProviderConfig = configFor(root);
    const first = await buildNewRecordingService(
      noProviderConfig,
      projectHash,
      chatsDir,
      sessionClientFor(root).client,
    );
    let header: Awaited<ReturnType<typeof readSessionHeader>>;
    try {
      loadProfile(noProviderConfig, first, 'codex', 'gpt-6-luna');
      header = await readSessionHeader(await recordFirstMessage(first));
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
    const recording = await buildNewRecordingService(
      liveConfig,
      projectHash,
      chatsDir,
      sessionClientFor(root).client,
    );
    try {
      liveConfig.setProvider('anthropic');
      liveConfig.setModel('claude-opus-5-5');
      const header = await readSessionHeader(
        await recordFirstMessage(recording),
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
      newSessionId: setup.recordingService.getSessionId(),
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
      newSessionId: entry.recordingService.getSessionId(),
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
      newSessionId: entry.recordingService.getSessionId(),
      namesFile: warnings.some((warning) => warning.includes(corruptPath)),
    }).toStrictEqual({
      resumedSessionId: null,
      newSessionId: 'fresh-session',
      namesFile: true,
    });
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
          newSessionId: entry.recordingService.getSessionId(),
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
