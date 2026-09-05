/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  initializeParser,
  resetParser,
  detectTrailingBackgroundOperator,
} from './shell-parser.js';

describe('detectTrailingBackgroundOperator', () => {
  beforeAll(async () => {
    await initializeParser();
  });

  // #3542 (run B) C2: web-tree-sitter's Parser/Language/Query keep the WASM
  // module (and on win32 a live transfer-buffer/fd) referenced for the life of
  // this bun process. resetParser() deterministically delete()s the two Parser
  // instances it published and drops the published Language/Query references, so nothing
  // the suite initialized outlives the suite (bun then exits promptly after the
  // last test on the dispatched Windows run instead of hanging to the job timeout).
  afterAll(() => {
    resetParser();
  });

  describe('promotes a genuine trailing &', () => {
    const promoteCases: ReadonlyArray<{ input: string; stripped: string }> = [
      { input: 'sleep 1 &', stripped: 'sleep 1' },
      { input: 'npm run dev &', stripped: 'npm run dev' },
      { input: 'echo hello &', stripped: 'echo hello' },
      { input: 'sleep 1 &  ', stripped: 'sleep 1' },
    ];

    for (const { input, stripped } of promoteCases) {
      it(`promotes ${JSON.stringify(input)} -> ${JSON.stringify(stripped)}`, () => {
        const result = detectTrailingBackgroundOperator(input);
        expect(result.promoted).toBe(true);
        expect(result.command).toBe(stripped);
      });
    }
  });

  describe('does NOT promote ampersands that are not a trailing background operator', () => {
    const noPromoteCases: ReadonlyArray<{
      label: string;
      input: string;
    }> = [
      { label: 'quoted ampersand in echo', input: 'echo "&"' },
      { label: 'escaped ampersand in printf', input: 'printf foo\\&' },
      { label: 'logical AND operator', input: 'a && b' },
      {
        label: 'trailing & followed by a comment',
        input: 'sleep 1 & # run in background',
      },
      { label: 'plain command without &', input: 'echo hello' },
      { label: 'internal background list', input: 'a & b' },
      {
        label: 'command list with && only',
        input: 'cmd1 && cmd2',
      },
      { label: 'heredoc body', input: 'cat <<EOF\nhello &\nEOF' },
      { label: 'single & with no command', input: '&' },
      { label: 'empty string', input: '' },
    ];

    for (const { label, input } of noPromoteCases) {
      it(`does not promote ${label} (${JSON.stringify(input)})`, () => {
        const result = detectTrailingBackgroundOperator(input);
        expect(result.promoted).toBe(false);
        expect(result.command).toBe(input);
      });
    }
  });
});
