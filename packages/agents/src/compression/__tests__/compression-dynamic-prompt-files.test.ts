/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4128: the compression request turns that carry runtime data (active
 * todos, the session journal path, an oversized last user prompt) come from
 * prompt files with a placeholder for that data, like every other part of the
 * request. The shipped text is unchanged.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PromptResolutionError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  buildRecordingContext,
  createRecordingProvider,
  createStrategy,
  requestText,
  usePromptsDir,
  writePromptFile,
  type StrategyName,
} from './compression-request-capture.js';
import {
  aiTextMsg,
  generateHistory,
  humanMsg,
} from './MiddleOutStrategy-test-helpers.js';

const SNAPSHOT = '<state_snapshot>summary</state_snapshot>';
const STRATEGIES: readonly StrategyName[] = ['one-shot', 'middle-out'];
const TODOS = '- [pending] Fix the auth bug\n- [in_progress] Refactor DB layer';
const JOURNAL = '/tmp/llxprt-chats/session-4128.jsonl';
const LONG_PROMPT = `Please fix this: ${'details '.repeat(800)}`;

/** The last human message sits in the compressed middle and is too long to keep. */
function historyWithLargeLastPrompt(): IContent[] {
  return Array.from({ length: 20 }, (_, index) => {
    if (index === 8) return humanMsg(LONG_PROMPT);
    if (index < 8 && index % 2 === 0) return humanMsg(`user message ${index}`);
    return aiTextMsg(`ai response ${index}`);
  });
}

async function captureCompressionRequest(
  strategyName: StrategyName,
  history: IContent[],
  options: {
    promptBaseDir?: string;
    activeTodos?: string;
    transcriptPath?: string;
  },
): Promise<string[]> {
  const provider = createRecordingProvider(SNAPSHOT);
  const context = buildRecordingContext(provider, history, options);
  await createStrategy(strategyName).compress(context);
  const [request] = provider.requests;
  return request.flatMap((content) => requestText([content]));
}

describe('compression request turns with runtime data use the shipped text by default (issue #4128)', () => {
  for (const strategyName of STRATEGIES) {
    it(`${strategyName}: active todos turn`, async () => {
      const turns = await captureCompressionRequest(
        strategyName,
        generateHistory(20),
        { activeTodos: TODOS },
      );

      expect(turns).toContain(
        `The following are the current active todo/task items. When summarizing, preserve context about why each task exists and what has been tried:\n\n${TODOS}`,
      );
    });

    it(`${strategyName}: session journal turn`, async () => {
      const turns = await captureCompressionRequest(
        strategyName,
        generateHistory(20),
        { transcriptPath: JOURNAL },
      );

      expect(turns).toContain(
        `Note: a JSONL journal of this session is being recorded at: ${JOURNAL}\n` +
          `The journal may be incomplete — recording can begin part way through a session and can stop on a write error. ` +
          `Preserve this path verbatim in your summary, and record that detail dropped by compression may be recoverable by ` +
          `searching that file for the specific text needed. The file holds full tool results and can be very large, so it ` +
          `should be searched, not read whole.`,
      );
    });
  }

  it('middle-out: oversized last user prompt turn', async () => {
    const turns = await captureCompressionRequest(
      'middle-out',
      historyWithLargeLastPrompt(),
      {},
    );

    expect(turns).toContain(
      `IMPORTANT — The user's most recent message (summarized because it was too long to preserve literally). Summarize this user request faithfully and completely, preserving their exact intent, problems described, and any specific instructions:\n\n${LONG_PROMPT}`,
    );
  });
});

describe('compression request turns with runtime data can be overridden (issue #4128)', () => {
  const promptsDir = usePromptsDir();

  for (const strategyName of STRATEGIES) {
    it(`${strategyName}: active todos override receives the todo list`, async () => {
      writePromptFile(
        promptsDir(),
        'compression/active-todos.md',
        'OVERRIDE todos follow:\n{{ACTIVE_TODOS}}\nend of todos\n',
      );

      const turns = await captureCompressionRequest(
        strategyName,
        generateHistory(20),
        { promptBaseDir: promptsDir(), activeTodos: TODOS },
      );

      expect(turns).toContain(`OVERRIDE todos follow:\n${TODOS}\nend of todos`);
    });

    it(`${strategyName}: session journal override receives the path`, async () => {
      writePromptFile(
        promptsDir(),
        'compression/transcript-path.md',
        'OVERRIDE journal at {{TRANSCRIPT_PATH}}',
      );

      const turns = await captureCompressionRequest(
        strategyName,
        generateHistory(20),
        { promptBaseDir: promptsDir(), transcriptPath: JOURNAL },
      );

      expect(turns).toContain(`OVERRIDE journal at ${JOURNAL}`);
    });

    it(`${strategyName}: an override without the placeholder fails fast`, async () => {
      writePromptFile(
        promptsDir(),
        'compression/active-todos.md',
        'OVERRIDE todos without a placeholder',
      );
      const provider = createRecordingProvider(SNAPSHOT);
      const context = buildRecordingContext(provider, generateHistory(20), {
        promptBaseDir: promptsDir(),
        activeTodos: TODOS,
      });

      await expect(
        createStrategy(strategyName).compress(context),
      ).rejects.toBeInstanceOf(PromptResolutionError);
      expect(provider.requests).toHaveLength(0);
    });
  }

  it('middle-out: oversized last user prompt override receives the prompt', async () => {
    writePromptFile(
      promptsDir(),
      'compression/large-last-prompt.md',
      'OVERRIDE keep this request:\n{{LAST_USER_PROMPT}}',
    );

    const turns = await captureCompressionRequest(
      'middle-out',
      historyWithLargeLastPrompt(),
      { promptBaseDir: promptsDir() },
    );

    expect(turns).toContain(`OVERRIDE keep this request:\n${LONG_PROMPT}`);
  });

  it('a placeholder inside the runtime data is sent literally', async () => {
    const todos = '- [pending] Document {{TRANSCRIPT_PATH}} usage';

    const turns = await captureCompressionRequest(
      'one-shot',
      generateHistory(20),
      { activeTodos: todos, transcriptPath: JOURNAL },
    );

    expect(turns.some((turn) => turn.endsWith(`\n\n${todos}`))).toBe(true);
  });
});
