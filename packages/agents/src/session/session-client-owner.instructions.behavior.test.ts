/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { useFakeResponsesReplay } from '../api/__tests__/helpers/fake-responses-replay.js';
import { useOwnedCredentials } from '../api/__tests__/helpers/owned-credential-fixture.js';
import { openSessionClientEngine } from '../api/__tests__/helpers/session-client-engine.js';

describe('SessionClientOwner workspace instructions', () => {
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
  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('does not re-read provided instructions when the bound workspace is bound again', async () => {
    const engine = await openSessionClientEngine(credentials().authority);
    try {
      let refuseInstructionReads = false;
      const providedInstructions = engine.config.getProvidedInstructions.bind(
        engine.config,
      );
      engine.config.getProvidedInstructions = () => {
        if (refuseInstructionReads)
          throw new Error('Redundant instruction read');
        return providedInstructions();
      };
      const { owner } = await engine.openStartedOwner();
      refuseInstructionReads = true;
      try {
        expect(() =>
          owner.bindWorkspaceInstructions(engine.mcp.workspaceMemory),
        ).not.toThrow();
      } finally {
        refuseInstructionReads = false;
      }
    } finally {
      await engine.close();
    }
  }, 30000);
});
