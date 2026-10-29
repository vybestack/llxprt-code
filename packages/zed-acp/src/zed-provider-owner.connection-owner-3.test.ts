import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from '../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { openZedPreflightConnection } from './__tests__/zed-preflight-connection.js';

describe('Zed ACP provider ownership', () => {
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

  useFakeResponsesReplay('multi-turn-text.jsonl');

  const firstCredentials = useOwnedCredentials();

  const secondCredentials = useOwnedCredentials();

  it('drives two real ACP sessions and prompts with equal labels while one connection closes', async () => {
    const first = await openZedPreflightConnection(
      'same-label',
      firstCredentials().authority,
    );
    let firstClosed = false;
    let second: Awaited<ReturnType<typeof openZedPreflightConnection>>;
    try {
      second = await openZedPreflightConnection(
        'same-label',
        secondCredentials().authority,
      );
    } catch (primary) {
      await first.close();
      throw primary;
    }
    try {
      await first.client.authenticate({ methodId: 'alpha' });
      await second.client.authenticate({ methodId: 'beta' });
      const sessionA = await first.client.newSession({
        cwd: first.root,
        mcpServers: [],
      });
      const sessionB = await second.client.newSession({
        cwd: second.root,
        mcpServers: [],
      });
      const promptA = await first.client.prompt({
        sessionId: sessionA.sessionId,
        prompt: [{ type: 'text', text: 'first-owner-marker' }],
      });
      const promptB = await second.client.prompt({
        sessionId: sessionB.sessionId,
        prompt: [{ type: 'text', text: 'second-owner-marker' }],
      });
      expect(promptA.stopReason).toBe('end_turn');
      expect(promptB.stopReason).toBe('end_turn');
      expect(first.updates.length).toBeGreaterThan(1);
      expect(second.updates.length).toBeGreaterThan(1);
      const firstJournals = await readdir(first.route.config.projectChatsDir);
      const secondJournals = await readdir(second.route.config.projectChatsDir);
      expect(firstJournals.some((name) => name.endsWith('.jsonl'))).toBe(true);
      expect(secondJournals.some((name) => name.endsWith('.jsonl'))).toBe(true);
      const firstRecording = await Promise.all(
        firstJournals
          .filter((name) => name.endsWith('.jsonl'))
          .map((name) =>
            readFile(join(first.route.config.projectChatsDir, name), 'utf8'),
          ),
      );
      expect(firstRecording.join('\n')).toContain(sessionA.sessionId);
      expect(firstRecording.join('\n')).toContain('first-owner-marker');
      expect(firstRecording.join('\n')).not.toContain('second-owner-marker');
      await first.close();
      firstClosed = true;
      await second.route.preflight.setTrustedFolderLive(false);
      expect(second.route.preflight.isTrustedFolder()).toBe(false);
      expect(first.route.trust.isTrustedFolder()).toBe(true);
      await expect(
        second.client.setSessionMode({
          sessionId: sessionB.sessionId,
          modeId: 'yolo',
        }),
      ).rejects.toThrow('Internal error');
      await second.route.preflight.setTrustedFolderLive(true);
      expect(second.route.preflight.isTrustedFolder()).toBe(true);
      await second.route.preflight.whenSettled();
      await second.client.authenticate({ methodId: 'alpha' });
      await second.client.prompt({
        sessionId: sessionB.sessionId,
        prompt: [{ type: 'text', text: 'surviving-owner-marker' }],
      });
      const secondRecording = await Promise.all(
        secondJournals
          .filter((name) => name.endsWith('.jsonl'))
          .map((name) =>
            readFile(join(second.route.config.projectChatsDir, name), 'utf8'),
          ),
      );
      expect(secondRecording.join('\n')).toContain(sessionB.sessionId);
      expect(secondRecording.join('\n')).toContain('surviving-owner-marker');
      expect(secondRecording.join('\n')).not.toContain('first-owner-marker');
      await second.client.closeSession({ sessionId: sessionB.sessionId });
      await second.client.closeSession({ sessionId: sessionB.sessionId });
      expect(() => second.route.preflight.captureInput()).not.toThrow();
      await expect(
        second.client.prompt({
          sessionId: sessionB.sessionId,
          prompt: [{ type: 'text', text: 'closed-owner-marker' }],
        }),
      ).rejects.toThrow('Internal error');
    } finally {
      if (!firstClosed) await first.close();
      await second.close();
    }
  });
});
