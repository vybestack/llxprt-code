/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';

function gate(): { readonly promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface InstructionCountHold {
  /** Resolves when the instruction text reaches the held `countTokens` call. */
  readonly entered: Promise<void>;
  readonly release: () => void;
  /** Length of the instruction text the held call received, 0 until released. */
  readonly countedCharacters: () => number;
}

/**
 * A tokenizer factory supplied through the public `tokenizerFactory` input.
 * `updateSystemInstruction` ends by counting the system instruction's tokens,
 * so holding the next `countTokens` call after `hold()` holds exactly the
 * in-flight instruction publication.
 */
function createHoldableTokenizer(): {
  readonly factory: RuntimeTokenizerFactory;
  readonly hold: () => InstructionCountHold;
} {
  let armed:
    | { entered: ReturnType<typeof gate>; release: ReturnType<typeof gate> }
    | undefined;
  let counted = 0;
  const factory: RuntimeTokenizerFactory = {
    getTokenizer: () => ({
      fallbackPolicy: 'deny',
      countTokens: async (content: unknown): Promise<number> => {
        const text = String(content);
        const held = armed;
        if (held === undefined) return text.length;
        armed = undefined;
        held.entered.release();
        await held.release.promise;
        counted = text.length;
        return text.length;
      },
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'calibrated',
      family: 'test-holdable',
      estimatorVersion: 'test-holdable-v1',
      assetRevision: 'none',
      projectionRevision: request.projectionRevision,
    }),
  };
  return {
    factory,
    hold: () => {
      const held = { entered: gate(), release: gate() };
      armed = held;
      return {
        entered: held.entered.promise,
        release: () => held.release.release(),
        countedCharacters: () => counted,
      };
    },
  };
}

async function exercise(
  survivor: Agent,
): Promise<{ error: unknown; maxOutputTokens: unknown }> {
  const result = await survivor.chat('peer after admitted disposal');
  survivor.setModelParam('maxOutputTokens', 79);
  return {
    error: result.error,
    maxOutputTokens: survivor.getModelParams().maxOutputTokens,
  };
}

describe('admitted instruction publication disposal', () => {
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

  it.each([false, true])(
    'joins asynchronous assembly and retains the borrowed caller reader (peer closes first: %s)',
    async (peerFirst) => {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'instruction-drain-')),
      );
      await writeFile(
        join(directory, 'LLXPRT.md'),
        'Physical admitted instructions.',
      );
      const tokenizer = createHoldableTokenizer();
      let agent: Agent | undefined;
      let peer: Agent | undefined;
      let hold: InstructionCountHold | undefined;
      let closed = false;
      let publication: Promise<unknown> | undefined;
      let closing: Promise<void> | undefined;
      try {
        agent = await createAgent({
          provider: 'fake',
          model: 'fake-model',
          workingDir: directory,
          credentialAuthority: credentials().authority,
          tokenizerFactory: tokenizer.factory,
        });
        peer = await createAgent({
          provider: 'fake',
          model: 'fake-model',
          workingDir: directory,
          credentialAuthority: credentials().authority,
        });
        await agent.chat('open the chat before publishing');
        hold = tokenizer.hold();
        publication = agent.memory.refresh();
        await hold.entered;
        if (peerFirst) await peer.dispose();
        closing = agent.dispose().then(() => {
          closed = true;
        });
        await Promise.resolve();
        expect(closed).toBe(false);
        hold.release();
        await publication;
        await closing;
        expect(hold.countedCharacters()).toBeGreaterThan(0);
        const survivor = peerFirst ? undefined : await exercise(peer);
        expect(survivor?.error).toBeUndefined();
        expect(survivor?.maxOutputTokens).toBe(peerFirst ? undefined : 79);
      } finally {
        hold?.release();
        await Promise.allSettled([publication, closing]);
        await agent?.dispose();
        await peer?.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    },
    30000,
  );
});
