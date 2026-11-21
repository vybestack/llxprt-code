/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4128: the prompt installer keeps a customized compression.md, but a
 * kept file that still asks for a `<scratchpad>` makes Anthropic refuse every
 * compression. The installer's notice must reach the user at startup through
 * the same channel as the other startup warnings.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as coreModule from '@vybestack/llxprt-code-core';
import { OutputFormat } from '@vybestack/llxprt-code-core';
import { recordPromptInstallerWarnings } from './promptInstallerWarnings.js';
import { dispatchInteractiveOrNonInteractive } from './session/nonInteractiveSession.js';

const CUSTOM_COMPRESSION_PROMPT =
  'My compression prompt.\nFirst think in a private <scratchpad>, then write the <state_snapshot>.\n';

/**
 * The prompt service is a process-wide singleton that installs once, so one
 * prompts directory and one drain serve every case in this file.
 */
describe('prompt installer startup warnings (issue #4128)', () => {
  const originalPromptsDir = process.env.LLXPRT_PROMPTS_DIR;
  let promptsDir: string;
  let recordingWarnings: string[];

  beforeAll(async () => {
    promptsDir = mkdtempSync(join(tmpdir(), 'llxprt-4128-cli-prompts-'));
    writeFileSync(
      join(promptsDir, 'compression.md'),
      CUSTOM_COMPRESSION_PROMPT,
    );
    process.env.LLXPRT_PROMPTS_DIR = promptsDir;
    recordingWarnings = await startupWarnings();
  });

  afterAll(() => {
    if (originalPromptsDir === undefined) {
      delete process.env.LLXPRT_PROMPTS_DIR;
    } else {
      process.env.LLXPRT_PROMPTS_DIR = originalPromptsDir;
    }
    rmSync(promptsDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function isScratchpadWarning(warning: string): boolean {
    return (
      warning.includes(join(promptsDir, 'compression.md')) &&
      warning.includes('<scratchpad>')
    );
  }

  async function startupWarnings(): Promise<string[]> {
    const warnings: string[] = [];
    await recordPromptInstallerWarnings(warnings);
    return warnings;
  }

  it('interactive: a kept compression.md with a scratchpad is shown as a startup warning', async () => {
    let shown: string[] = [];

    await dispatchInteractiveOrNonInteractive(
      undefined,
      () => true,
      'agent',
      recordingWarnings,
      async () => [],
      async (warnings) => {
        shown = warnings;
      },
      () => OutputFormat.TEXT,
      async () => {
        throw new Error('headless session must not start');
      },
    );

    expect(shown.some(isScratchpadWarning)).toBe(true);
  });

  it('non-interactive: a kept compression.md with a scratchpad is written to stderr before the session runs', async () => {
    const events: string[] = [];
    vi.spyOn(coreModule, 'writeToStderr').mockImplementation(
      (chunk: string | Uint8Array) => {
        events.push(String(chunk));
        return true;
      },
    );

    await dispatchInteractiveOrNonInteractive(
      'prompt',
      () => false,
      'agent',
      recordingWarnings,
      async () => [],
      async () => {
        throw new Error('interactive UI must not start');
      },
      () => OutputFormat.TEXT,
      async () => {
        events.push('session');
      },
    );

    const warningIndex = events.findIndex(isScratchpadWarning);
    expect(warningIndex).toBeGreaterThan(-1);
    expect(warningIndex).toBeLessThan(events.indexOf('session'));
  });

  it('reports each installer notice only once', async () => {
    expect(await startupWarnings()).toStrictEqual([]);
  });
});
