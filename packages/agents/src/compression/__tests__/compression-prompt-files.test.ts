/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4128: every piece of compression prompt text comes from a prompt
 * file that a user can override, and the shipped defaults never ask the
 * summarizer for a scratchpad (Anthropic refuses such requests as
 * reasoning extraction).
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PromptResolutionError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  buildRecordingContext,
  createRecordingProvider,
  createStrategy,
  installShippedCompressionDefaults,
  requestText,
  usePromptsDir,
  writePromptFile,
  type StrategyName,
} from './compression-request-capture.js';
import { generateHistory, humanMsg } from './MiddleOutStrategy-test-helpers.js';

const SNAPSHOT = '<state_snapshot>initial summary</state_snapshot>';
const IMPROVED = '<state_snapshot>improved summary</state_snapshot>';
const STRATEGIES: readonly StrategyName[] = ['one-shot', 'middle-out'];

function historyWithPriorSnapshot(): IContent[] {
  return generateHistory(20).map((entry, index) =>
    index === 4
      ? humanMsg('<state_snapshot>prior summary</state_snapshot>')
      : entry,
  );
}

async function compressAndCapture(
  strategyName: StrategyName,
  history: IContent[],
  promptBaseDir?: string,
): Promise<string[]> {
  const provider = createRecordingProvider(SNAPSHOT, IMPROVED);
  const context = buildRecordingContext(provider, history, {
    promptBaseDir,
    verification: true,
  });
  const result = await createStrategy(strategyName).compress(context);
  expect(result.kind).toBe('applied');
  return provider.requests.map(requestText);
}

describe('compression requests with default prompts (issue #4128)', () => {
  const promptsDir = usePromptsDir();

  for (const strategyName of STRATEGIES) {
    it(`${strategyName}: shipped prompt files never mention a scratchpad`, async () => {
      installShippedCompressionDefaults(promptsDir());

      const requests = await compressAndCapture(
        strategyName,
        historyWithPriorSnapshot(),
        promptsDir(),
      );

      expect(requests).toHaveLength(2);
      for (const text of requests) {
        expect(text.toLowerCase()).not.toContain('scratchpad');
      }
    });

    it(`${strategyName}: built-in fallbacks never mention a scratchpad`, async () => {
      const requests = await compressAndCapture(
        strategyName,
        generateHistory(20),
      );

      expect(requests).toHaveLength(2);
      for (const text of requests) {
        expect(text.toLowerCase()).not.toContain('scratchpad');
      }
    });

    it(`${strategyName}: default trigger asks for the state snapshot`, async () => {
      const [compression] = await compressAndCapture(
        strategyName,
        generateHistory(20),
      );

      expect(compression.trimEnd()).toMatch(/Generate the <state_snapshot>\.$/);
    });
  }
});

describe('compression prompt file overrides (issue #4128)', () => {
  const promptsDir = usePromptsDir();

  function writeOverrides(dir: string): void {
    writePromptFile(dir, 'compression.md', 'OVERRIDE main prompt');
    writePromptFile(
      dir,
      'compression/security-preamble.md',
      'OVERRIDE security preamble',
    );
    writePromptFile(dir, 'compression/trigger.md', 'OVERRIDE trigger');
    writePromptFile(
      dir,
      'compression/trigger-with-prior-snapshot.md',
      'OVERRIDE trigger with prior snapshot',
    );
    writePromptFile(
      dir,
      'compression/verification-request.md',
      'OVERRIDE verification request',
    );
    writePromptFile(
      dir,
      'compression/verification-follow-up.md',
      'OVERRIDE verification follow-up',
    );
  }

  for (const strategyName of STRATEGIES) {
    it(`${strategyName}: overrides replace the preamble and trigger`, async () => {
      writeOverrides(promptsDir());

      const [compression] = await compressAndCapture(
        strategyName,
        generateHistory(20),
        promptsDir(),
      );

      expect(compression.startsWith('OVERRIDE security preamble\n')).toBe(true);
      expect(compression).toContain('OVERRIDE main prompt');
      expect(compression.endsWith('\nOVERRIDE trigger')).toBe(true);
      expect(compression).not.toContain('CRITICAL INSTRUCTION');
    });

    it(`${strategyName}: the prior-snapshot trigger override is used when a snapshot is compressed`, async () => {
      writeOverrides(promptsDir());

      const [compression] = await compressAndCapture(
        strategyName,
        historyWithPriorSnapshot(),
        promptsDir(),
      );

      expect(
        compression.endsWith('\nOVERRIDE trigger with prior snapshot'),
      ).toBe(true);
    });

    it(`${strategyName}: an empty override fails fast instead of sending an empty turn`, async () => {
      writePromptFile(promptsDir(), 'compression/trigger.md', ' \t ');
      const provider = createRecordingProvider(SNAPSHOT);
      const context = buildRecordingContext(provider, generateHistory(20), {
        promptBaseDir: promptsDir(),
      });

      await expect(
        createStrategy(strategyName).compress(context),
      ).rejects.toBeInstanceOf(PromptResolutionError);
      expect(provider.requests).toHaveLength(0);
    });

    it(`${strategyName}: overrides replace the verification messages`, async () => {
      writeOverrides(promptsDir());

      const [, verification] = await compressAndCapture(
        strategyName,
        generateHistory(20),
        promptsDir(),
      );

      expect(verification).toBe(
        [
          'OVERRIDE security preamble',
          'OVERRIDE verification request',
          SNAPSHOT,
          'OVERRIDE verification follow-up',
        ].join('\n'),
      );
    });
  }
});
