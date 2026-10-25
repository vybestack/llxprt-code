import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
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

  const nextCredentials = useOwnedCredentials();

  it('supports successive connections with the same owner label', async () => {
    const first = await openZedPreflightConnection(
      'repeat-label',
      firstCredentials().authority,
    );
    try {
      await first.client.authenticate({ methodId: 'alpha' });
    } finally {
      await first.close();
    }
    const next = await openZedPreflightConnection(
      'repeat-label',
      nextCredentials().authority,
    );
    try {
      await next.client.authenticate({ methodId: 'beta' });
      expect(next.route.settings.getProviderSettings('fake').model).toBe(
        'beta-model',
      );
    } finally {
      await next.close();
    }
  });
});
