/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P19
 * @requirement:REQ-INT-002,REQ-INT-004
 *
 * Broad parity harness — CLI turn-parity. Exercises the SAME public entry
 * points the eventual #1595 CLI will use (`fromConfig`, `agent.stream`) against
 * a REAL CLI-style Config + a REAL FakeProvider JSONL fixture, comparing
 * turn-drive parity against the CLI's actual reference `AgenticLoop` drive.
 * This is a PARITY-EXPANSION / VERIFICATION gate (NOT a RED TDD phase): the
 * fromConfig turn-parity seam is already implemented (P09), so a PASSING suite
 * is the success condition.
 *
 * Scenarios (mirroring pseudocode cli-integration-adapter.md):
 *   T10 (lines 40-51) — Path A (fromConfig stream) projects identically to
 *     Path B (reference AgenticLoop) over the same fixture, with behavioral
 *     anchors (specific tool name, exactly one terminal done).
 *   T11 (lines 80-84) — boundary scan: the THREE parity spec files import ONLY
 *     the curated public root (no ./internals.js in Path A, no deep /src/,
 *     core/src, or providers/src anywhere).
 *   Property (lines 70-77) — Path A vs Path B projection equivalence holds
 *     across generated tool names and answer texts.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
 * so Path A and Path B project to the SAME comparable event space. Mirrors the
 * CLI's useAgenticLoop.ts:254 object-form construction EXACTLY.
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
 * removes the temp directory. Mirrors the early slice's writeTempFixture.
 */
function writeTempFixture(
  toolName: string,
  answerText: string,
): { readonly path: string; readonly cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'llxprt-parity-p19-'));
  const fixturePath = join(dir, 'generated.jsonl');
  const turn1 = {
    chunks: [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-gen-p19-1',
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

/**
 * Extracts import specifiers from a single source line using plain string
 * operations (no regex). Recognizes `... from '...'` and `... from "..."`.
 */
function extractFromSpecifiers(rawLine: string): string[] {
  const line = rawLine.trim();
  const out: string[] = [];
  const markers = ["from '", 'from "'];
  for (const marker of markers) {
    const idx = line.indexOf(marker);
    if (idx === -1) continue;
    const quote = marker.charAt(marker.length - 1);
    const start = idx + marker.length;
    const end = line.indexOf(quote, start);
    if (end > start) {
      out.push(line.slice(start, end));
    }
  }
  return out;
}

// ─── T10 / Property / T11 ───────────────────────────────────────────────────

describe('CLI turn-parity (broad) @plan:PLAN-20260621-COREAPIREMED.P19 @requirement:REQ-INT-002 @requirement:REQ-INT-004', () => {
  it('T10 Path A (fromConfig stream) projects identically to Path B (reference AgenticLoop) over parity-toolcall.jsonl (REQ-INT-002)', async () => {
    const built = await buildCliStyleConfig('parity-toolcall.jsonl');
    try {
      // Path A: the public fromConfig agent drives a turn over its OWN
      // Config + MessageBus + FakeProvider script so it does not drain Path B.
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

      // Behavioral anchor: exactly one tool-call event with the specific tool.
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

  it('PROP parity: Path A vs Path B projection equivalence holds across generated tool names and answer texts (REQ-INT-002)', async () => {
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

              // Path B: reference AgenticLoop drive over an INDEPENDENT config.
              const builtRef = await buildCliStyleConfig(fixture.path);
              try {
                const pathBEvents = await driveReferenceLoop(
                  builtRef.config,
                  builtRef.messageBus,
                  'hello',
                );
                const pathB = projectEvents(pathBEvents);
                return JSON.stringify(pathA) === JSON.stringify(pathB);
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
    );
  }, 60000);

  it('T11 boundary scan: the parity spec files import ONLY the public root (no ./internals.js in Path A, no deep /src/ anywhere) (REQ-INT-004)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const specs = [
      join(here, 'cli-turn-parity.spec.ts'),
      join(here, 'config-injection.spec.ts'),
      join(here, 'settings-surface.spec.ts'),
    ];

    // Collect every `from '...'` import specifier across the three specs,
    // using plain string operations (no regex) to parse the import lines.
    const allSpecifiers: string[] = [];
    for (const spec of specs) {
      const src = readFileSync(spec, 'utf8');
      for (const rawLine of src.split('\n')) {
        allSpecifiers.push(...extractFromSpecifiers(rawLine));
      }
    }

    // REQ-INT-004 (a): NO deep core/src or providers/src imports.
    const deepImport = allSpecifiers.find(
      (s) => s.includes('core/src/') || s.includes('providers/src/'),
    );
    expect(deepImport).toBeUndefined();

    // REQ-INT-004 (b): every @vybestack/llxprt-code-agents import is the root
    // or a documented non-internals subpath. ./internals.js is FORBIDDEN as a
    // Path-A import; the reference AgenticLoop import comes from the root.
    const agentsImports = allSpecifiers.filter((s) =>
      s.startsWith('@vybestack/llxprt-code-agents'),
    );
    for (const spec of agentsImports) {
      // Root or documented subpath ONLY (never internals).
      expect(spec.endsWith('/internals.js')).toBe(false);
    }

    // REQ-INT-004 (c): there IS at least one agents root import (the surface
    // under test is exercised through the curated public root).
    const rootImports = agentsImports.filter(
      (s) => s === '@vybestack/llxprt-code-agents',
    );
    expect(rootImports.length).toBeGreaterThan(0);
  }, 30000);
});
