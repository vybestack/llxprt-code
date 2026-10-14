/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { createDetachedAutoPromptClient } from './autoPromptDetachedClient.js';

describe('detached auto prompt client', () => {
  const credentials = useOwnedCredentials();
  let root: string;
  let previousFake: string | undefined;
  let agent: Agent | undefined;

  beforeEach(async () => {
    previousFake = process.env.LLXPRT_FAKE_RESPONSES;
    root = await mkdtemp(join(tmpdir(), 'auto-prompt-detached-'));
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../agents/src/api/__tests__/fixtures/multi-turn-text.jsonl',
        import.meta.url,
      ),
    );
    agent = undefined;
  });

  afterEach(async () => {
    try {
      await agent?.dispose();
    } finally {
      if (previousFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousFake;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('initializes an owner-tracked client without adding to primary history', async () => {
    const created = await createAgent({
      credentialAuthority: credentials().authority,
      provider: 'fake',
      model: 'fake-model',
      workingDir: root,
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
      skillsSupport: false,
    });
    agent = created;
    const primary = created.agentClient;
    const media = primary.mediaStore;
    if (media === undefined)
      throw new Error('Missing owned session media store');
    await primary.startChat();
    const client = await createDetachedAutoPromptClient(
      () => created.sessionClient.createDetachedAgentClient(),
      primary.getContentGeneratorConfig(),
    );
    const output = await client.generateDirectMessage(
      { message: 'detached prompt' },
      'detached-owner-control',
    );
    expect(output.content.blocks.some((block) => block.type === 'text')).toBe(
      true,
    );
    expect(client).not.toBe(primary);
    expect(client.mediaStore).toBe(media);
    expect(primary.getHistoryService()?.getRawHistory()).toHaveLength(0);
    await client.dispose();
    await created.dispose();
  });

  it('rejects missing content generator configuration without constructing an implicit client', async () => {
    const created = await createAgent({
      credentialAuthority: credentials().authority,
      provider: 'fake',
      model: 'fake-model',
      workingDir: root,
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
      skillsSupport: false,
    });
    agent = created;
    const primary = created.agentClient;
    await primary.startChat();
    await expect(
      createDetachedAutoPromptClient(
        () => created.sessionClient.createDetachedAgentClient(),
        undefined,
      ),
    ).rejects.toThrow('Content generator configuration is unavailable');
    await primary.addHistory({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'still usable' }],
    });
    expect(primary.getHistoryService()?.getRawHistory()).toHaveLength(1);
    await created.dispose();
  });
});
