/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4084: the code mode limit settings reach each script run. A real
 * agent runs three scripts under lowered limits and each ends with the
 * named limit failure.
 */

import { afterEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import {
  buildScriptAgent,
  runTurn,
  scratchDir,
  scriptResponse,
  type ScriptAgent,
} from './__tests__/script-agent.js';
import { assertNoLiveWrappers } from './__tests__/runtime-test-helpers.js';
import { boundWallTimeout } from './code-mode-settings.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';

setDefaultTimeout(60_000);

let built: ScriptAgent | undefined;

async function cleanUp(): Promise<void> {
  await built?.cleanup();
  built = undefined;
  assertNoLiveWrappers();
}

describe('code mode limit settings (issue #4084)', () => {
  afterEach(cleanUp);

  it('ends runs with CALL_LIMIT, RESULT_TOO_LARGE and TIMEOUT under the configured limits', async () => {
    built = await buildScriptAgent(
      [
        {
          id: 'calls',
          source:
            'for (let i = 0; i < 3; i++) await tools["glob"]({ pattern: "*.none" }); return 1;',
          tools: ['glob'],
        },
        { id: 'size', source: 'return "x".repeat(100);', tools: ['glob'] },
        {
          id: 'wall',
          source:
            'await tools["run_shell_command"]({ command: "sleep 5" }); return 1;',
          tools: ['run_shell_command'],
        },
      ],
      {
        workspace: scratchDir('code-mode-limits-'),
        rules: [
          {
            toolName: 'run_shell_command',
            decision: PolicyDecision.ALLOW,
            priority: 2,
          },
        ],
      },
    );
    built.agent.setEphemeralSetting('code-mode-max-calls', 2);
    built.agent.setEphemeralSetting('code-mode-max-result-bytes', 64);
    built.agent.setEphemeralSetting('code-mode-wall-timeout-ms', 1500);
    const started = Date.now();
    await runTurn(built.agent);

    expect((await scriptResponse(built.agent, 'calls')).error?.code).toBe(
      'CALL_LIMIT',
    );
    expect((await scriptResponse(built.agent, 'size')).error?.code).toBe(
      'RESULT_TOO_LARGE',
    );
    expect((await scriptResponse(built.agent, 'wall')).error?.code).toBe(
      'TIMEOUT',
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('never lets a run outlast the caller deadline', () => {
    const now = 1_000_000;
    expect(boundWallTimeout(300_000, undefined, now)).toBe(300_000);
    expect(boundWallTimeout(300_000, now + 20_000, now)).toBe(20_000);
    expect(boundWallTimeout(5_000, now + 20_000, now)).toBe(5_000);
    expect(boundWallTimeout(5_000, now - 1, now)).toBe(1);
  });
});
