/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-015
 * @requirement:REQ-010
 *
 * Fake hook definition/handler (infra fake — NOT the Agent under test).
 * Lives under __tests__/helpers/ so deep imports of core hook types are
 * permitted here while staying excluded from the T17 boundary scan.
 *
 * The fake lets a spec register an observer that captures every lifecycle
 * event the Agent fires (SessionStart/SessionEnd/BeforeAgent/...), and build
 * a HookDefinition the Agent can consume through its public AgentConfig.hooks
 * seam. The captured events let specs assert REAL event SEQUENCES and CONTENT
 * (not "called" mock-theater) via the public agent.hooks.* surface.
 */

import {
  HookEventName,
  type HookDefinition,
  type HookDecision,
  type HookInput,
  type HookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';

/** A captured (event, input, output) triple for sequence assertions. */
export interface CapturedHookEvent {
  readonly event: HookEventName;
  readonly input: HookInput;
  readonly output: HookOutput;
}

/**
 * Observer/handle for fake-hook lifecycle observation. The spec registers the
 * observer via the public agent.hooks.onHookExecution(cb) surface and reads
 * the captured sequence to assert ordering + content.
 */
export interface FakeHookObserver {
  /** All captured events in firing order. */
  captured(): readonly CapturedHookEvent[];
  /** Captured events filtered to a specific event name. */
  forEvent(name: HookEventName): readonly CapturedHookEvent[];
  /** True when at least one event of the given name fired. */
  saw(name: HookEventName): boolean;
  /** Reset captured state (between turns, if needed). */
  reset(): void;
  /**
   * Feeds a captured (event, input, output) triple into the observer. Specs
   * drive this through {@link recordHookExecution} from their public
   * `onHookExecution` callback so they can assert the REAL event sequence the
   * Agent produced.
   */
  capture(event: HookEventName, input: HookInput, output: HookOutput): void;
}

class FakeHookObserverImpl implements FakeHookObserver {
  private events: CapturedHookEvent[] = [];

  capture(event: HookEventName, input: HookInput, output: HookOutput): void {
    this.events.push({ event, input, output });
  }

  captured(): readonly CapturedHookEvent[] {
    return [...this.events];
  }

  forEvent(name: HookEventName): readonly CapturedHookEvent[] {
    return this.events.filter((e) => e.event === name);
  }

  saw(name: HookEventName): boolean {
    return this.events.some((e) => e.event === name);
  }

  reset(): void {
    this.events = [];
  }
}

/**
 * Builds a fresh fake-hook observer. The observer is the capture sink; the
 * returned HookDefinition(s) are the AgentConfig.hooks entries the Agent
 * consumes to decide which events to fire.
 */
export function createFakeHookObserver(): FakeHookObserver {
  return new FakeHookObserverImpl();
}

/**
 * Builds a HookDefinition that fires on SessionStart and SessionEnd. The
 * returned definition is structurally compatible with AgentConfig.hooks and
 * is consumed by the real Agent lifecycle at GREEN. At RED the
 * agent.hooks.* surface throws before any capture occurs.
 *
 * The observer is accepted so callers can document which observer the
 * definitions are bound to; the capture itself is driven separately by the
 * spec's `onHookExecution` callback calling {@link recordHookExecution}.
 */
export function fakeSessionHookDefinitions(
  _observer: FakeHookObserver,
): Readonly<Partial<Record<HookEventName, readonly HookDefinition[]>>> {
  // The hook definition's hooks list is opaque config consumed by the real
  // hook runner. We populate a structurally-valid entry; the capture path is
  // driven by agent.hooks.onHookExecution at the public surface, not by the
  // command process.
  const startDef: HookDefinition = {
    hooks: [
      {
        type: 'command' as never,
        command: 'true',
        name: 'fake-session-start',
      },
    ],
  };
  const endDef: HookDefinition = {
    hooks: [
      {
        type: 'command' as never,
        command: 'true',
        name: 'fake-session-end',
      },
    ],
  };
  // The capture path is driven by the spec's onHookExecution callback, which
  // calls recordHookExecution(observer, ...) to feed the observer. This wiring
  // is a no-op at RED and the observer only fills once the real Agent fires
  // events at GREEN.
  return {
    [HookEventName.SessionStart]: [startDef],
    [HookEventName.SessionEnd]: [endDef],
  };
}

/**
 * A default no-op HookOutput the observer reports for every captured event.
 * At GREEN the real Agent produces a richer output; at RED no capture occurs.
 */
export function defaultFakeHookOutput(): HookOutput {
  return {
    continue: true,
    decision: 'allow',
    systemMessage: undefined,
    suppressOutput: false,
  };
}

/**
 * Feeds a captured (event, input, output) triple into the observer, narrowing
 * the observed values to {@link HookInput}/{@link HookOutput} WITHOUT any
 * `as` / `as unknown as` casts. The observed `input`/`output` arrive as
 * `unknown` (from the spec's `onHookExecution` callback payload); this helper
 * builds a fresh, typed {@link HookInput} from the documented fields and uses
 * {@link defaultFakeHookOutput} as the output fallback when the observed
 * output does not structurally match {@link HookOutput}.
 *
 * This is the ONLY function a spec needs to mirror a real hook execution into
 * the observer, keeping all cast-prone plumbing out of the spec boundary.
 */
export function recordHookExecution(
  observer: FakeHookObserver,
  event: HookEventName,
  input: unknown,
  output: unknown,
): void {
  observer.capture(
    event,
    normalizeHookInput(event, input),
    normalizeHookOutput(output),
  );
}

/**
 * Builds a typed {@link HookInput} from an observed value, filling documented
 * defaults for any missing/invalid field. Cast-free: every field is read via a
 * runtime `typeof`/truthiness guard.
 */
function normalizeHookInput(event: HookEventName, input: unknown): HookInput {
  const src = isRecord(input) ? input : {};
  return {
    session_id: typeof src['session_id'] === 'string' ? src['session_id'] : '',
    transcript_path:
      typeof src['transcript_path'] === 'string' ? src['transcript_path'] : '',
    cwd: typeof src['cwd'] === 'string' ? src['cwd'] : '',
    hook_event_name:
      typeof src['hook_event_name'] === 'string'
        ? src['hook_event_name']
        : event,
    timestamp: typeof src['timestamp'] === 'string' ? src['timestamp'] : '',
  };
}

/**
 * Narrows an observed value to {@link HookOutput}, falling back to
 * {@link defaultFakeHookOutput} when the value does not structurally match.
 * Cast-free: each optional field is copied only when its runtime type matches
 * the declared output type.
 */
function normalizeHookOutput(output: unknown): HookOutput {
  if (!isRecord(output)) {
    return defaultFakeHookOutput();
  }
  const fallback = defaultFakeHookOutput();
  return {
    continue:
      typeof output['continue'] === 'boolean'
        ? output['continue']
        : fallback.continue,
    decision: isHookDecision(output['decision'])
      ? output['decision']
      : fallback.decision,
    systemMessage:
      typeof output['systemMessage'] === 'string'
        ? output['systemMessage']
        : fallback.systemMessage,
    suppressOutput:
      typeof output['suppressOutput'] === 'boolean'
        ? output['suppressOutput']
        : fallback.suppressOutput,
    stopReason:
      typeof output['stopReason'] === 'string'
        ? output['stopReason']
        : undefined,
    reason: typeof output['reason'] === 'string' ? output['reason'] : undefined,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const HOOK_DECISIONS: readonly string[] = [
  'ask',
  'block',
  'deny',
  'approve',
  'allow',
] as const;

function isHookDecision(v: unknown): v is HookDecision {
  return typeof v === 'string' && HOOK_DECISIONS.includes(v);
}

export { HookEventName };
