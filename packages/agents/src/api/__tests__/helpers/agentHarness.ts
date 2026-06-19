/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P11
 * @requirement:REQ-001
 * @requirement:REQ-003
 * @requirement:REQ-006
 * @requirement:REQ-010
 *
 * Layer-3 core-behavior harness. Builds a REAL public Agent over a REAL
 * FakeProvider via the LLXPRT_FAKE_RESPONSES production seam (see
 * providerManagerInstance.ts): when that env var points at a JSONL file the
 * provider composition registers ONLY FakeProvider and replays it.
 *
 * Deep imports live here ONLY — this file lives under __tests__/helpers/
 * which is excluded from the T17 boundary scan in boundary.spec.ts. The
 * consumer-facing core-*.spec.ts files import ONLY the public root
 * (@vybestack/llxprt-code-agents) plus this helper's public-safe re-exports.
 *
 * At RED (P11) createAgent resolves and returns the stub AgentImpl whose
 * methods throw NotYetImplemented, so the behavioral specs FAIL NATURALLY.
 * At GREEN (P15+) the SAME harness wires the real FakeProvider and the same
 * assertions pass with no rewrite — this is the durable contract seam.
 */

import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  createAgent,
  type Agent,
  type AgentEvent,
  type AgentConfig,
  type ToolConfirmation,
  type ToolDecision,
  type DoneReason,
} from '@vybestack/llxprt-code-agents';
import { stripSandboxSegment } from './fixtureRoot.js';

const HARNESS_DIR = stripSandboxSegment(
  fileURLToPath(new URL('.', import.meta.url)),
);
const FIXTURES_DIR = resolve(HARNESS_DIR, '..', 'fixtures');

// ─── Public-safe re-exports (so specs avoid deep imports) ───────────────────

export { ToolConfirmationOutcome };
export type {
  Agent,
  AgentEvent,
  AgentInput,
  AgentMessage,
  AgentConfig,
  ToolConfirmation,
  ToolDecision,
  DoneReason,
} from '@vybestack/llxprt-code-agents';
export { createAgent } from '@vybestack/llxprt-code-agents';

// ─── Agent construction via the production env seam ─────────────────────────

export interface BuiltAgent {
  readonly agent: Agent;
  readonly cleanup: () => Promise<void>;
}

/**
 * Builds a real public Agent over a real FakeProvider by pointing the
 * LLXPRT_FAKE_RESPONSES env var at a fixture JSONL file (the production seam
 * in providerManagerInstance.ts). The returned cleanup restores the prior env
 * value and disposes the agent.
 */
export async function buildAgent(
  fixtureRelPath: string,
  configOverrides: Readonly<Partial<AgentConfig>> = {},
): Promise<BuiltAgent> {
  const prev = process.env.LLXPRT_FAKE_RESPONSES;
  const fixturePath = resolve(FIXTURES_DIR, fixtureRelPath);
  process.env.LLXPRT_FAKE_RESPONSES = fixturePath;
  const baseConfig: AgentConfig = {
    provider: 'fake',
    model: 'fake-model',
    workingDir: resolve(HARNESS_DIR, '..'),
  };
  let agent: Agent;
  try {
    agent = await createAgent({ ...baseConfig, ...configOverrides });
  } catch (error) {
    // createAgent failed before a cleanup could be returned — restore the env
    // var so the mutation does not leak into later tests, then rethrow.
    if (prev === undefined) {
      delete process.env.LLXPRT_FAKE_RESPONSES;
    } else {
      process.env.LLXPRT_FAKE_RESPONSES = prev;
    }
    throw error;
  }
  const cleanup = async (): Promise<void> => {
    await agent.dispose().catch(() => {
      /* disposed via cleanup regardless of impl state */
    });
    if (prev === undefined) {
      delete process.env.LLXPRT_FAKE_RESPONSES;
    } else {
      process.env.LLXPRT_FAKE_RESPONSES = prev;
    }
  };
  return { agent, cleanup };
}

export {
  /** Absolute path to the fixtures directory (exposed for assertions). */
  FIXTURES_DIR as fixturesDir,
};

/**
 * Builds an agent backed by an inline (programmatic) JSONL content string,
 * written to an ephemeral temp fixture file, via the SAME LLXPRT_FAKE_RESPONSES
 * production seam buildAgent uses. Useful when a scenario needs ad-hoc provider
 * responses (e.g. property-generated tool args) without a committed fixture
 * file. The returned cleanup restores the prior env value, disposes the agent,
 * and removes the temp directory.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 */
export async function buildAgentFromContent(
  jsonlContent: string,
  configOverrides: Readonly<Partial<AgentConfig>> = {},
): Promise<BuiltAgent> {
  const prev = process.env.LLXPRT_FAKE_RESPONSES;
  const dir = mkdtempSync(join(tmpdir(), 'llxprt-agent-fixture-'));
  const fixturePath = join(dir, 'inline.jsonl');
  writeFileSync(fixturePath, jsonlContent, 'utf8');
  process.env.LLXPRT_FAKE_RESPONSES = fixturePath;
  const baseConfig: AgentConfig = {
    provider: 'fake',
    model: 'fake-model',
    workingDir: resolve(HARNESS_DIR, '..'),
  };
  let agent: Agent;
  try {
    agent = await createAgent({ ...baseConfig, ...configOverrides });
  } catch (error) {
    // createAgent failed before a cleanup could be returned — restore the env
    // var and remove the temp dir so neither leaks into later tests, then
    // rethrow.
    if (prev === undefined) {
      delete process.env.LLXPRT_FAKE_RESPONSES;
    } else {
      process.env.LLXPRT_FAKE_RESPONSES = prev;
    }
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const cleanup = async (): Promise<void> => {
    await agent.dispose().catch(() => {
      /* disposed via cleanup regardless of impl state */
    });
    if (prev === undefined) {
      delete process.env.LLXPRT_FAKE_RESPONSES;
    } else {
      process.env.LLXPRT_FAKE_RESPONSES = prev;
    }
    rmSync(dir, { recursive: true, force: true });
  };
  return { agent, cleanup };
}

/**
 * Builds a two-turn FakeProvider JSONL script: turn 1 emits a single tool_call
 * block carrying the given name+parameters; turn 2 emits a terminal text block
 * so the continuation settles with a `done`. The IContent ToolCallBlock's
 * `parameters` flow verbatim to the surfaced AgentToolCall.args (FakeProvider
 * substituteCwd preserves keys; eventAdapter.projectToolCall echoes args before
 * validation), so callers can assert the projected args round-trip the input.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 */
export function scriptToolCallFixture(
  toolName: string,
  parameters: Readonly<Record<string, unknown>>,
): string {
  const turn1 = {
    chunks: [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-prop-1',
            name: toolName,
            parameters,
          },
        ],
      },
    ],
  };
  const turn2 = {
    chunks: [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'scripted continuation' }],
      },
    ],
  };
  return `${JSON.stringify(turn1)}
${JSON.stringify(turn2)}
`;
}

/** Joins a fixture-relative name to the fixtures dir. */
export function fixturePath(fixtureRelPath: string): string {
  return join(FIXTURES_DIR, fixtureRelPath);
}

// ─── Stream helpers ─────────────────────────────────────────────────────────

/**
 * Drains an AgentEvent async iterable to completion and returns the events in
 * emission order. Used for every stream-based assertion.
 */
export async function drain(
  stream: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

/** Maps events to their `.type` string for sequence assertions. */
export function typesOf(events: readonly AgentEvent[]): string[] {
  return events.map((e) => e.type);
}

/** Returns the index of the first event of a given type, or -1. */
export function indexOfType(
  events: readonly AgentEvent[],
  type: string,
): number {
  return events.findIndex((e) => e.type === type);
}

/** Counts events of a given type. */
export function countType(events: readonly AgentEvent[], type: string): number {
  return events.reduce((n, e) => (e.type === type ? n + 1 : n), 0);
}

// ─── Type-narrowing predicates (no casts in specs) ──────────────────────────

export function isDoneEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'done' }> {
  return e.type === 'done';
}

export function isTextEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'text' }> {
  return e.type === 'text';
}

export function isThinkingEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'thinking' }> {
  return e.type === 'thinking';
}

export function isToolCallEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'tool-call' }> {
  return e.type === 'tool-call';
}

export function isToolResultEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'tool-result' }> {
  return e.type === 'tool-result';
}

export function isToolConfirmationEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'tool-confirmation' }> {
  return e.type === 'tool-confirmation';
}

export function isToolStatusEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'tool-status' }> {
  return e.type === 'tool-status';
}

export function isCompressionEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'compression' }> {
  return e.type === 'compression';
}

export function isUsageEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'usage' }> {
  return e.type === 'usage';
}

export function isErrorEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'error' }> {
  return e.type === 'error';
}

// ─── Tool-scenario utilities ────────────────────────────────────────────────

/**
 * Subscribes to tool confirmations via the public onConfirmationRequest API
 * and resolves the FIRST confirmation with the given decision. Returns the
 * captured ToolConfirmation so the caller can assert on its ids/payload.
 */
export function respondToFirstConfirmation(
  agent: Agent,
  decision: ToolDecision,
): { captured: Promise<ToolConfirmation>; unsubscribe: () => void } {
  let resolveCaptured: (value: ToolConfirmation) => void;
  const captured = new Promise<ToolConfirmation>((resolve) => {
    resolveCaptured = resolve;
  });
  const unsubscribe = agent.tools.onConfirmationRequest((req) => {
    resolveCaptured(req);
    agent.tools.respondToConfirmation(req.confirmationId, decision);
  });
  return { captured, unsubscribe };
}

/** The set of valid DoneReason terminal reasons (mirrors event-types.ts). */
export const DONE_REASONS: readonly DoneReason[] = [
  'stop',
  'aborted',
  'max-turns',
  'context-overflow',
  'loop-detected',
  'error',
  'hook-stopped',
];

// ─── HistoryService identity (T4d/T4e) ──────────────────────────────────────
//
// The product-critical guarantee for provider/profile switching is that the
// SAME HistoryService instance is reused across a switch — IDENTITY, not equal
// contents. The public Agent surface has no HistoryService accessor (it is an
// internal-only seam), so the reach happens here via documented structural
// narrowing of the AgentImpl internals. At RED the AgentImpl has no
// historyService / agentClient / chat field wired, so this returns undefined;
// at GREEN (P15/P16) the real wiring is present and the SAME object reference
// is returned before and after a switch.

/**
 * Reaches the Agent's underlying HistoryService instance via structural
 * narrowing of the (opaque) AgentImpl internals. Returns `undefined` when the
 * field is absent (RED) — the caller compares the result with `toBe` so a
 * missing field fails the identity assertion NATURALLY.
 *
 * The narrowing is cast-free: the Agent is treated as `Record<string, unknown>`
 * and probed for a documented `historyService` field, then for the
 * `agentClient.getHistoryService()` chain, then for a `chat.historyService`
 * path. Each probe is guarded by `typeof` / `in` / truthiness checks.
 */
export function captureHistoryServiceIdentity(agent: Agent): unknown {
  const impl = agent as unknown as Record<string, unknown>;
  // Probe 1: AgentImpl.historyService (direct field, planned at P15).
  if (
    'historyService' in impl &&
    impl['historyService'] !== undefined &&
    impl['historyService'] !== null
  ) {
    return impl['historyService'];
  }
  // Probe 2: AgentImpl.agentClient.getHistoryService() (the chat-session path).
  const maybeClient = impl['agentClient'];
  if (isRecord(maybeClient)) {
    const getHs = maybeClient['getHistoryService'];
    if (typeof getHs === 'function') {
      const hs = getHs.call(maybeClient);
      if (hs !== undefined && hs !== null) {
        return hs;
      }
    }
  }
  // Probe 3: AgentImpl.chat.historyService (ChatSession direct field).
  const maybeChat = impl['chat'];
  if (isRecord(maybeChat)) {
    const hs = maybeChat['historyService'];
    if (hs !== undefined && hs !== null) {
      return hs;
    }
  }
  // No documented path populated yet — RED returns undefined; the caller's
  // `toBe(existing)` identity check fails because both are undefined only if
  // the switch even ran (the switch throws NYI first at RED).
  return undefined;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// ─── Profile / Load-Balancer fixture loaders (T4b/T4e/T18d) ─────────────────

/**
 * Reads a profile JSON fixture (relative to fixtures/) and returns it as a
 * parsed object. Used by T4b/T4e/T18d to assert that profiles.apply projects
 * the fixture's provider/model/params/auth onto the live agent.
 */
export async function loadProfileFixture(
  fixtureRelPath: string,
): Promise<Readonly<Record<string, unknown>>> {
  const { readFile } = await import('node:fs/promises');
  const abs = fixturePath(fixtureRelPath);
  const raw = await readFile(abs, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Reads a load-balancer profile JSON fixture. Same shape as a standard profile
 * but with an `isLoadBalancer: true` flag and a `targets` array; used by T4e to
 * assert LB-failover uses the same HistoryService-transfer path as a manual
 * switch.
 */
export async function loadLoadBalancerProfileFixture(
  fixtureRelPath: string,
): Promise<Readonly<Record<string, unknown>>> {
  return loadProfileFixture(fixtureRelPath);
}
