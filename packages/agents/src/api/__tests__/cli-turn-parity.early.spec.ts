/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P07
 * @requirement:REQ-INT-001,REQ-INT-002
 *
 * Early integration-first CLI turn-parity slice. Drives the public
 * `fromConfig` path against the CLI's reference `AgenticLoop` drive over a
 * REAL FakeProvider fixture.
 *
 * P09 Frozen-Driver Correction (applied to the P07 driver):
 *
 * The P07 driver was internally inconsistent and could never reach GREEN even
 * with a correct `fromConfig`. Two defects were masked at P07 because the
 * `fromConfig` stub rejected before reaching the tool drive. Both are
 * corrected here so the SAME behavioral assertions pass with no weakening:
 *
 *   Defect #1 (confirmation deadlock): the helper sets `interactive: true`
 *   and injects a priority-4.0 forcing-ASK policy, and the
 *   `parity-toolcall.jsonl` fixture issues a `read_file` tool call. Path B
 *   (the reference `AgenticLoop`) is constructed with an approval handler
 *   returning `ProceedOnce`, but Path A called `fromConfig({ config })` with
 *   no approval handler, so the tool's `TOOL_CONFIRMATION_REQUEST` was never
 *   answered and the turn hung indefinitely. Path A now mirrors Path B's
 *   approval semantics by passing
 *   `onApproval: () => ToolConfirmationOutcome.ProceedOnce` to every
 *   `fromConfig` call. This matches the established headless-approval pattern
 *   across this suite (core-tools.spec.ts T11, agent-bootstrap.spec.ts:443,
 *   disposal.spec.ts:123). A silent auto-approve default inside `fromConfig`
 *   is intentionally NOT introduced (it would be a security smell).
 *
 *   Defect #2 (fixture starvation): EP2/EP3 drove Path A then Path B over the
 *   SAME single built Config whose FakeProvider fixture has a finite 2-turn
 *   script. Path A consumed the script, leaving Path B to run on the drained
 *   Config and end with `doneReason: "error"`, so the projected-equality
 *   assertion could never hold. Each path now drives an independent
 *   fixture-config (its own Config + MessageBus + FakeProvider script) so
 *   neither drains the other. Both configs are cleaned up in `finally`.
 *
 * Coordinator probe evidence (proving the defects were in the DRIVER, not in
 * `fromConfig`): supplying `onApproval: () => ProceedOnce` to `fromConfig`
 * over `parity-toolcall.jsonl` drove the tool turn to exactly one terminal
 * `done` in ~180ms with no hang; and with each path given its own
 * `buildCliStyleConfig('parity-toolcall.jsonl')` plus Path A given the
 * `ProceedOnce` handler, `projectEvents(pathA)` `toStrictEqual`
 * `projectEvents(pathB)` passed (tool=`read_file`, one `done`).
 *
 * NO behavioral assertion was weakened, relaxed, deleted, or skipped. Every
 * original `expect(...)` — the projected-equality checks, the
 * `toHaveLength(1)` done/tool-call checks, and the `toBe('read_file')` anchor
 * — is preserved verbatim. The property generators and run ratio are
 * unchanged.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  fromConfig,
  AgenticLoop,
  mapLoopStream,
  type AgentEvent,
  type Agent,
  type ApprovalHandler,
} from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  buildCliStyleConfig,
  projectEvents,
  type Config,
  type MessageBus,
} from './helpers/buildCliStyleConfig.js';
import { drain } from './helpers/agentHarness.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Drives the reference AgenticLoop (Path B) over the Config's agentClient and
 * maps its AgenticLoopEvents through the public event adapter to AgentEvents,
 * so Path A and Path B project to the SAME comparable event space.
 */
async function driveReferenceLoop(
  config: Config,
  messageBus: MessageBus,
  input: string,
): Promise<readonly AgentEvent[]> {
  const approvalHandler: ApprovalHandler = async () => ({
    outcome: ToolConfirmationOutcome.ProceedOnce,
  });
  const loop = new AgenticLoop({
    agentClient: config.getAgentClient(),
    config,
    messageBus,
    interactiveMode: false,
    approvalHandler,
    displayCallbacks: {},
  });
  const controller = new AbortController();
  const loopEvents = loop.run(input, controller.signal);
  const agentEvents = mapLoopStream(loopEvents);
  return drain(agentEvents);
}

/**
 * Writes an inline JSONL fixture (two turns: a tool call then a final text
 * answer) to a temp directory and returns the absolute path. The cleanup
 * removes the temp directory.
 */
function writeTempFixture(
  toolName: string,
  answerText: string,
): { readonly path: string; readonly cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'llxprt-parity-'));
  const fixturePath = join(dir, 'generated.jsonl');
  const turn1 = {
    chunks: [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-gen-1',
            name: toolName,
            parameters: { path: '{{CWD}}/package.json' },
          },
        ],
      },
    ],
  };
  const turn2 = {
    chunks: [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: answerText }],
      },
    ],
  };
  writeFileSync(
    fixturePath,
    `${JSON.stringify(turn1)}\n${JSON.stringify(turn2)}\n`,
    'utf8',
  );
  return {
    path: fixturePath,
    cleanup: (): void => rmSync(dir, { recursive: true, force: true }),
  };
}

// ─── EP1/EP2/EP3 ─────────────────────────────────────────────────────────────

describe('CLI turn-parity (early RED) @plan:PLAN-20260621-COREAPIREMED.P07 @requirement:REQ-INT-001 @requirement:REQ-INT-002', () => {
  it('EP1 fromConfig adopts the external Config and drives a terminal done (REQ-INT-001)', async () => {
    const built = await buildCliStyleConfig('parity-toolcall.jsonl');
    try {
      const config = built.config;
      const agent: Agent = await fromConfig({
        config,
        onApproval: () => ToolConfirmationOutcome.ProceedOnce,
      });

      // REQ-INT-001: the adopted Config is the SAME instance.
      expect(agent.getConfig()).toBe(config);

      // REQ-INT-001: the stream yields exactly one terminal done.
      const events = await drain(agent.stream('hello'));
      const doneEvents = events.filter((e) => e.type === 'done');
      expect(doneEvents).toHaveLength(1);
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('EP2 Path A (fromConfig stream) projects identically to Path B (reference AgenticLoop) over the same fixture (REQ-INT-002)', async () => {
    const built = await buildCliStyleConfig('parity-toolcall.jsonl');
    try {
      // Path A: the public fromConfig agent drives a turn over its OWN
      // Config + MessageBus + FakeProvider script so it does not drain the
      // Path B reference drive.
      const agent: Agent = await fromConfig({
        config: built.config,
        onApproval: () => ToolConfirmationOutcome.ProceedOnce,
      });
      const pathAEvents = await drain(agent.stream('hello'));
      const pathA = projectEvents(pathAEvents);

      // Path B: the reference AgenticLoop drive over an INDEPENDENT config so
      // the finite FakeProvider script is not starved by Path A.
      const builtRef = await buildCliStyleConfig('parity-toolcall.jsonl');
      try {
        const pathBEvents = await driveReferenceLoop(
          builtRef.config,
          builtRef.messageBus,
          'hello',
        );
        const pathB = projectEvents(pathBEvents);

        // REQ-INT-002: same projected tool names, isError flags, and single
        // terminal done reason. Internal fields (prompt_id, traceId) are
        // projected away — never compared.
        expect(pathA).toStrictEqual(pathB);
      } finally {
        await builtRef.cleanup();
      }

      // Behavioral anchor: at least one tool-call event is projected with a
      // specific tool name (parity must be behavioral, not vacuously empty).
      const toolCalls = pathA.filter((e) => e.type === 'tool-call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolName).toBe('read_file');

      // Behavioral anchor: exactly one terminal done.
      const dones = pathA.filter((e) => e.type === 'done');
      expect(dones).toHaveLength(1);
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('EP3 property: Path A vs Path B projection equivalence holds across generated tool names and answer texts (REQ-INT-002)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('read_file', 'list_directory', 'glob', 'search'),
        fc.string({ minLength: 1, maxLength: 40 }),
        async (toolName, answerText) => {
          const fixture = writeTempFixture(toolName, answerText);
          try {
            // Path A: its OWN config so it does not starve Path B.
            const built = await buildCliStyleConfig(fixture.path);
            try {
              const agent: Agent = await fromConfig({
                config: built.config,
                onApproval: () => ToolConfirmationOutcome.ProceedOnce,
              });
              const pathAEvents = await drain(agent.stream('hello'));
              const pathA = projectEvents(pathAEvents);

              // Path B: reference AgenticLoop drive over an INDEPENDENT
              // config so the finite FakeProvider script is not drained by
              // Path A.
              const builtRef = await buildCliStyleConfig(fixture.path);
              try {
                const pathBEvents = await driveReferenceLoop(
                  builtRef.config,
                  builtRef.messageBus,
                  'hello',
                );
                const pathB = projectEvents(pathBEvents);

                // REQ-INT-002: projected event sequences are equivalent for
                // every generated turn.
                expect(pathA).toStrictEqual(pathB);
              } finally {
                await builtRef.cleanup();
              }
            } finally {
              await built.cleanup();
            }
          } finally {
            fixture.cleanup();
          }
        },
      ),
      // Each run builds two configs and drains two full streams; cap the case
      // count to keep the property well within the 30s timeout under parallel
      // test load (consistent with other heavy-agent property tests).
      { numRuns: 8 },
    );
  }, 30000);
});
