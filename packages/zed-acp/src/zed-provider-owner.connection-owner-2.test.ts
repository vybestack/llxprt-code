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

  const ownerCredentials = useOwnedCredentials();

  it('closes one session without disposing another session or the connection owner', async () => {
    const owner = await openZedPreflightConnection(
      'one-connection',
      ownerCredentials().authority,
    );
    try {
      await owner.client.authenticate({ methodId: 'alpha' });
      const first = await owner.client.newSession({
        cwd: owner.root,
        mcpServers: [],
      });
      const second = await owner.client.newSession({
        cwd: owner.root,
        mcpServers: [],
      });
      await owner.client.closeSession({ sessionId: first.sessionId });
      await owner.client.closeSession({ sessionId: first.sessionId });
      expect(() => owner.route.preflight.captureInput()).not.toThrow();
      expect(
        (
          await owner.client.prompt({
            sessionId: second.sessionId,
            prompt: [{ type: 'text', text: 'surviving-session-marker' }],
          })
        ).stopReason,
      ).toBe('end_turn');
      const journalNames = await readdir(owner.route.config.projectChatsDir);
      const journals = await Promise.all(
        journalNames
          .filter((name) => name.endsWith('.jsonl'))
          .map((name) =>
            readFile(join(owner.route.config.projectChatsDir, name), 'utf8'),
          ),
      );
      expect(journals.join('\n')).toContain('surviving-session-marker');
    } finally {
      await owner.close();
    }
  });
});
