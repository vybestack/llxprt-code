/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  afterAll,
  beforeAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import OpenAI from 'openai';
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  bootstrapRuntimeAndConfig,
  setupSessionRecording,
} from './cliSessionBootstrap.js';
import { activateConfiguredProvider } from './cliProviderInit.js';
import { loadSettings } from './config/settings.js';
import { parseArguments } from './config/cliArgParser.js';
import {
  runExitCleanup,
  __resetCleanupStateForTesting,
} from './utils/cleanup.js';

describe('CLI session client bootstrap ownership', () => {
  let suiteDirectory: string;
  let directory: string;
  beforeAll(async () => {
    // The repository tmp/ tree is gitignored, so a fresh checkout (CI) has
    // none of it; mkdtemp does not create missing parent directories.
    const suiteRoot = resolve(
      import.meta.dirname,
      '../../../tmp/session-client-frontend-migration',
    );
    await mkdir(suiteRoot, { recursive: true });
    suiteDirectory = await mkdtemp(join(suiteRoot, 'cli-lifetime-'));
  });
  afterAll(async () => {
    await rm(suiteDirectory, { recursive: true, force: true });
  });
  let previousArgv: string[];
  let previousEnv: NodeJS.ProcessEnv;
  let server: Server;
  let requests: string[];
  beforeEach(async () => {
    directory = await mkdtemp(join(suiteDirectory, 'case-'));
    previousArgv = process.argv;
    previousEnv = { ...process.env };
    requests = [];
    server = createServer((request, response) => {
      void serveRequest(request, response);
    });
    async function serveRequest(
      request: IncomingMessage,
      response: ServerResponse,
    ): Promise<void> {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(
        'data: ' +
          JSON.stringify({
            id: 'local-completion',
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: { content: 'local bootstrap reply' },
                finish_reason: null,
              },
            ],
          }) +
          '\n\ndata: ' +
          JSON.stringify({
            id: 'local-completion',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }) +
          '\n\ndata: [DONE]\n\n',
      );
    }
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing local address');
    process.env.LLXPRT_CONFIG_HOME = directory;
    process.env.LLXPRT_PROMPTS_DIR = join(suiteDirectory, 'prompts');
    process.argv = [
      'bun',
      'llxprt',
      '--provider',
      'openai',
      '--model',
      'gpt-4o-mini',
      '--key',
      'local-test-key',
      '--baseurl',
      `http://127.0.0.1:${address.port}/v1`,
      '--prompt',
      'hello',
    ];
    __resetCleanupStateForTesting();
  });
  afterEach(async () => {
    await runExitCleanup();
    __resetCleanupStateForTesting();
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    process.argv = previousArgv;
    process.env = previousEnv;
    await rm(directory, { recursive: true, force: true });
  });

  async function bootstrap() {
    const settings = loadSettings(directory);
    const argv = await parseArguments(settings.merged);
    const boot = await bootstrapRuntimeAndConfig(settings, argv, directory);
    const activation = await activateConfiguredProvider(
      boot.config,
      boot.providerManager,
      argv,
      boot.activationOperation,
    );
    if (activation.authFailed) throw new Error('Local activation failed');
    return { boot, activation, argv };
  }

  it('supplies the pre-Agent owner to raw recording without a Config client lookup', async () => {
    const { boot, argv } = await bootstrap();
    try {
      const recording = await setupSessionRecording(
        boot.config,
        argv,
        null,
        boot.activationOperation.sessionClient,
      );
      recording.recordingService.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'pre-agent content' }],
      });
      await recording.recordingService.flush();
      const transcript = await readFile(
        recording.recordingService.getFilePath() ?? '',
        'utf8',
      );
      expect(transcript).toContain('pre-agent content');
    } finally {
      await runExitCleanup();
      await boot.config.dispose();
    }
  });

  const eventSchema = z.object({
    type: z.string(),
    reason: z.string().optional(),
  });
  const resultSchema = z.object({
    headless: z.boolean(),
    path: z.string(),
    events: z.array(eventSchema),
    ownerClosed: z.boolean(),
    ownerAdopted: z.boolean().optional(),
    authFailed: z.boolean().optional(),
    mediaAdopted: z.boolean().optional(),
    providerAdopted: z.boolean().optional(),
    borrowedSurface: z.array(z.string()).optional(),
    runtimeHasManager: z.boolean().optional(),
    activeProvider: z.string().optional(),
    providers: z.array(z.string()).optional(),
    restoredHumanCount: z.number().optional(),
    historyHumanCount: z.number().optional(),
    firstEvents: z.array(eventSchema).optional(),
    firstOwnerClosed: z.boolean().optional(),
  });
  const contentSchema = z.object({
    type: z.string(),
    payload: z
      .object({ content: z.object({ speaker: z.string() }) })
      .optional(),
  });
  const requestSchema = z.object({
    model: z.string(),
    messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
  });

  async function runHeadless(scenario: 'record' | 'profile' | 'resume') {
    await promisify(execFile)(
      process.execPath,
      [
        resolve(
          import.meta.dirname,
          '__tests__/session-client-headless-fixture.ts',
        ),
        scenario,
        directory,
        JSON.stringify(process.argv),
      ],
      {
        cwd: resolve(import.meta.dirname, '../../..'),
        env: process.env,
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const result = resultSchema.parse(
      JSON.parse(
        await readFile(join(directory, 'headless-result.json'), 'utf8'),
      ),
    );
    expect(result.headless).toBe(true);
    expect(result.ownerClosed).toBe(true);
    expectStopped(result.events);
    return result;
  }

  async function transcript(path: string) {
    const text = await readFile(path, 'utf8');
    const speakers = text
      .trim()
      .split('\n')
      .map((line): unknown => JSON.parse(line))
      .filter((event) => eventSchema.parse(event).type === 'content')
      .map((event) => contentSchema.parse(event).payload?.content.speaker);
    return { text, speakers };
  }

  function expectStopped(
    events: ReadonlyArray<z.infer<typeof eventSchema>>,
  ): void {
    expect(events.filter((event) => event.type === 'done')).toStrictEqual([
      expect.objectContaining({ reason: 'stop' }),
    ]);
  }

  it('adopts the same owner and records a local HTTP turn through the Agent session writer', async () => {
    const result = await runHeadless('record');
    expect(result.ownerAdopted).toBe(true);
    expect(requests).toHaveLength(1);
    const payload = requestSchema.parse(JSON.parse(requests[0]));
    expect(payload.model).toBe('gpt-4o-mini');
    expect(
      payload.messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
    ).toStrictEqual(['local recorded prompt']);
    const recorded = await transcript(result.path);
    expect(recorded.text).toContain('local recorded prompt');
    expect(recorded.text).toContain('local bootstrap reply');
    expect(recorded.speakers).toStrictEqual(['human', 'ai']);
  });

  it('uses the bootstrap owner for pre-Agent profile activation and hands it into the foreground', async () => {
    const result = await runHeadless('profile');
    expect(result.authFailed).toBe(false);
    expect(result.ownerAdopted).toBe(true);
    expect(result.mediaAdopted).toBe(true);
    expect(result.providerAdopted).toBe(true);
    expect(result.borrowedSurface).toStrictEqual([]);
    expect(result.runtimeHasManager).toBe(false);
    expect(result.activeProvider).toBe('openai');
    expect(result.providers).toContain('openai');
    expect(requests).toHaveLength(1);
    const payload = requestSchema.parse(JSON.parse(requests[0]));
    expect(payload.model).toBe('gpt-4o-mini');
    expect(
      payload.messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
    ).toStrictEqual(['profile-controlled prompt']);
    const recorded = await transcript(result.path);
    expect(recorded.text).toContain('profile-controlled prompt');
    expect(recorded.text).toContain('local bootstrap reply');
    expect(recorded.speakers).toStrictEqual(['human', 'ai']);
  });

  it('resumes a recorded local HTTP session through a second actual CLI bootstrap without duplicate history', async () => {
    const result = await runHeadless('resume');
    expect(result.restoredHumanCount).toBe(1);
    expect(result.historyHumanCount).toBe(1);
    expect(result.firstOwnerClosed).toBe(true);
    if (!result.firstEvents) throw new Error('Missing first turn events');
    expectStopped(result.firstEvents);
    const recorded = await transcript(result.path);
    expect(recorded.speakers).toStrictEqual(['human', 'ai', 'human', 'ai']);
    expect(recorded.text).toContain('resume original prompt');
    expect(recorded.text).toContain('resumed next prompt');
    expect(requests).toHaveLength(2);
    const payloads = requests.map((request) =>
      requestSchema.parse(JSON.parse(request)),
    );
    expect(
      payloads[1].messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
    ).toStrictEqual(['resume original prompt', 'resumed next prompt']);
    expect(
      payloads[1].messages
        .filter((message) => message.role === 'assistant')
        .map((message) => message.content),
    ).toStrictEqual(['local bootstrap reply']);
  });

  it('retains the SDK credential environment guard in the parent runtime', () => {
    let outcome: { rejected: boolean; message?: string };
    try {
      new OpenAI({ apiKey: 'local-test-key' });
      outcome = { rejected: false };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      outcome = { rejected: true, message: error.message };
    }
    const browserDenial = {
      rejected: true,
      message: expect.stringMatching(/browser-like environment/),
    };
    expect(outcome).toStrictEqual(
      typeof window === 'undefined' ? { rejected: false } : browserDenial,
    );
    expect(requests).toHaveLength(0);
  });

  for (const failCleanup of [false, true]) {
    it(`joins pre-Agent client cleanup before closing media after ${failCleanup ? 'failed' : 'successful'} client disposal`, async () => {
      const { boot } = await bootstrap();
      const client = boot.activationOperation.sessionClient.getAgentClient();
      const store = client.mediaStore;
      if (!store) throw new Error('Missing owner media');
      let release: () => void = () => {};
      let entered: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entry = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const dispose = client.dispose.bind(client);
      const interception = spyOn(client, 'dispose').mockImplementation(
        async () => {
          entered();
          await gate;
          await dispose();
          if (failCleanup) throw new Error('client cleanup control');
        },
      );
      const closing = Promise.resolve(boot.activationOperation.dispose()).then(
        () => ({ success: true }),
        (error: unknown) => ({ error }),
      );
      try {
        await entry;
        expect(await store.getStoredByteLength()).toBe(0);
        release();
        const result = await closing;
        expect('error' in result).toBe(failCleanup);
        await expect(store.getStoredByteLength()).rejects.toThrow(/closed/i);
      } finally {
        release();
        await closing;
        interception.mockRestore();
        await boot.config.dispose();
        __resetCleanupStateForTesting();
      }
    });
  }
});
