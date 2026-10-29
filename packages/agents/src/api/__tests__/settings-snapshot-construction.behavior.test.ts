/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { ProviderActivationIntent } from '../config-types.js';
import { createAgentFromSettingsSnapshot } from '../createAgent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

describe('preferred Agent required settings snapshot restoration', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => runCleanupSteps(cleanup.splice(0).reverse()));
  const credentials = useOwnedCredentials();
  let directory: string;
  let prompts: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    prompts = await mkdtemp(join(tmpdir(), 'snapshot-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = prompts;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(prompts, { recursive: true, force: true });
  });
  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'snapshot-agent-')),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    delete process.env.LLXPRT_FAKE_RESPONSES;
    cleanup.push(() => {
      if (previousReplay === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
    });
  });
  it('captures selection, credentials, tools and nested settings before awaiting, drives real HTTP, and isolates same-label peers', async () => {
    const requests: Array<{
      model: unknown;
      temperature: unknown;
      authorized: boolean;
    }> = [];
    const server = createServer((request, reply) => {
      request.setEncoding('utf8');
      let text = '';
      request.on('data', (chunk: string) => {
        text += chunk;
      });
      request.on('end', () => {
        if (request.method === 'GET') {
          reply.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              data: [{ id: 'snapshot-model', object: 'model' }],
            }),
          );
          return;
        }
        const body: unknown = JSON.parse(text);
        if (
          typeof body !== 'object' ||
          body === null ||
          !('model' in body) ||
          !('temperature' in body)
        )
          throw new Error('Missing restored request selection');
        requests.push({
          model: body.model,
          temperature: body.temperature,
          authorized:
            request.headers.authorization === 'Bearer snapshot-private-key',
        });
        reply
          .writeHead(200, { 'content-type': 'text/event-stream' })
          .end(
            `data: ${JSON.stringify({ id: 'snapshot-chat', object: 'chat.completion.chunk', created: 1, model: 'snapshot-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'restored HTTP response' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
          );
      });
    });
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          }),
        ),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing HTTP address');
    const endpoint = `http://127.0.0.1:${address.port}/v1`;
    const source = new SettingsService();
    source.set('activeProvider', 'openai');
    source.setProviderSetting('openai', 'model', 'snapshot-model');
    source.setProviderSetting('openai', 'auth-key', 'snapshot-private-key');
    source.setProviderSetting('openai', 'base-url', endpoint);
    source.setProviderSetting('openai', 'temperature', 0.37);
    source.set('context-limit', 8192);
    source.set('nested-caller-data', { values: ['original'] });
    source.setCurrentProfileName('captured-profile');
    source.set('tools.allowed', ['read_file']);
    source.set('tools.disabled', ['run_shell_command']);
    const input = source.exportForStateSnapshot();
    const nested = { values: ['original'] };
    const toolPolicy = {
      allowed: ['read_file'],
      disabled: ['run_shell_command'],
    };
    input.global.tools = toolPolicy;
    input.global['nested-caller-data'] = nested;
    const construction = createAgentFromSettingsSnapshot(
      {
        provider: 'gemini',
        model: 'declaration-fallback',
        sessionId: 'same-restored-label',
        workingDir: directory,
        credentialAuthority: credentials().authority,
        harness: { includeProcessCwd: false },
      },
      input,
    );
    cleanup.push(async () =>
      construction.then(
        (agent) => agent.dispose(),
        () => undefined,
      ),
    );
    input.providers.openai = undefined;
    input.global['context-limit'] = 2048;
    nested.values.push('changed');
    toolPolicy.allowed.push('run_shell_command');
    toolPolicy.disabled.length = 0;
    const agent = await construction;
    const peer = await createAgentFromSettingsSnapshot(
      {
        provider: 'gemini',
        model: 'declaration-fallback',
        sessionId: 'same-restored-label',
        workingDir: directory,
        credentialAuthority: credentials().authority,
        harness: { includeProcessCwd: false },
      },
      source.exportForStateSnapshot(),
    );
    cleanup.push(() => peer.dispose());
    expect([agent.getProvider(), agent.getModel()]).toStrictEqual([
      'openai',
      'snapshot-model',
    ]);
    expect(agent.getEphemeralSetting('context-limit')).toBe(8192);
    expect(agent.getEphemeralSetting('nested-caller-data')).toStrictEqual({
      values: ['original'],
    });
    expect(agent.getActiveProfileName()).toBe('captured-profile');
    expect(JSON.stringify(agent.getRuntimeDiagnosticsSnapshot())).not.toContain(
      'snapshot-private-key',
    );
    expect(agent.tools.get('run_shell_command')).toBeUndefined();
    const path = join(directory, 'restored.txt');
    await writeFile(path, 'physical restored read');
    const read = agent.tools.get('read_file');
    if (!read) throw new Error('Missing restored read tool');
    expect(
      String(
        (
          await read.buildAndExecute(
            { absolute_path: path },
            new AbortController().signal,
          )
        ).llmContent,
      ),
    ).toContain('physical restored read');
    expect((await agent.chat('Use restored settings')).text).toContain(
      'restored HTTP response',
    );
    agent.setEphemeralSetting('context-limit', 4096);
    await agent.dispose();
    expect(peer.getEphemeralSetting('context-limit')).toBe(8192);
    expect(source.get('context-limit')).toBe(8192);
    expect((await peer.chat('Continue after peer closes')).text).toContain(
      'restored HTTP response',
    );
    expect(requests).toStrictEqual([
      { model: 'snapshot-model', temperature: 0.37, authorized: true },
      { model: 'snapshot-model', temperature: 0.37, authorized: true },
    ]);
  }, 30000);
  it('restores independent persisted state while borrowing only live read-only session overrides', async () => {
    const source = new SettingsService();
    source.set('activeProvider', 'openai');
    source.setProviderSetting('openai', 'model', 'captured-model');
    source.set('dumpcontext', 'error');
    const agent = await createAgentFromSettingsSnapshot(
      {
        provider: 'openai',
        model: 'fallback-model',
        workingDir: directory,
        credentialAuthority: credentials().authority,
        sessionOverrides: source.readSessionOverrides(),
        harness: { includeProcessCwd: false },
      },
      source.exportForStateSnapshot(),
    );
    cleanup.push(() => agent.dispose());
    source.setProviderSetting('openai', 'model', 'later-host-model');
    source.setSessionScoped('dumpcontext', 'on');
    expect(agent.getEphemeralSetting('dumpcontext')).toBe('on');
    expect(agent.getModel()).toBe('captured-model');
    expect(agent.settings.getEphemeralSettings().dumpcontext).toBe('on');
    expect(() =>
      agent.settings.setSessionSetting('dumpcontext', 'off'),
    ).toThrow('read-only');
    expect(() => agent.settings.clearSessionSetting('dumpcontext')).toThrow(
      'read-only',
    );
    source.clearSessionScoped('dumpcontext');
    expect(agent.getEphemeralSetting('dumpcontext')).toBe('error');
    await agent.dispose();
    source.setSessionScoped('dumpcontext', 'off');
    expect(source.getSessionScoped('dumpcontext')).toBe('off');
  });

  it.each([
    {
      provider: undefined,
      model: undefined,
      activation: undefined,
      expectedModel: 'fallback-model',
    },
    {
      provider: 'fake',
      model: 'restored-model',
      activation: undefined,
      expectedModel: 'restored-model',
    },
    {
      provider: 'fake',
      model: 'restored-model',
      activation: {
        provider: 'fake',
        model: 'intent-model',
        authMode: 'auto',
      } satisfies ProviderActivationIntent,
      expectedModel: 'intent-model',
    },
    {
      provider: '   ',
      model: '   ',
      activation: undefined,
      expectedModel: 'fallback-model',
    },
  ])(
    'keeps valid snapshot selection ahead of declaration but respects explicit activation %#',
    async ({ provider, model, activation, expectedModel }) => {
      const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
      process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
        new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
      );
      cleanup.push(() => {
        if (previousReplay === undefined)
          delete process.env.LLXPRT_FAKE_RESPONSES;
        else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
      });
      const source = new SettingsService();
      source.set('activeProvider', provider);
      source.setProviderSetting('fake', 'model', model);
      source.set('streaming', 'disabled');
      const agent = await createAgentFromSettingsSnapshot(
        {
          provider: 'fake',
          model: 'fallback-model',
          activation,
          workingDir: directory,
          credentialAuthority: credentials().authority,
        },
        source.exportForStateSnapshot(),
      );
      cleanup.push(() => agent.dispose());
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe(expectedModel);
      expect(agent.getEphemeralSetting('streaming')).toBe('disabled');
      expect((await agent.chat('Exercise selected model')).text).toContain(
        'turn one reply',
      );
    },
  );
  it.each([
    null,
    { global: {}, providers: [] },
    { global: { execute: () => undefined }, providers: {} },
  ])(
    'rejects invalid snapshots before token/key acquisition %#',
    async (snapshot) => {
      const construction = Reflect.apply(
        createAgentFromSettingsSnapshot,
        undefined,
        [
          {
            provider: 'openai',
            model: 'not-acquired',
            workingDir: directory,
            credentialAuthority: credentials().authority,
          },
          snapshot,
        ],
      );
      cleanup.push(async () =>
        Promise.resolve(construction).then(
          (agent) => agent.dispose(),
          () => undefined,
        ),
      );
      await expect(construction).rejects.toThrow('Invalid settings snapshot');
      expect(credentials().snapshot()).toStrictEqual([]);
      expect(credentials().keySnapshot()).toStrictEqual([]);
    },
  );
});
