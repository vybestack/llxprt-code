/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 *
 * Focused infra probe for the confirmation-forcing seam (NOT the Agent under
 * test). Lives under __tests__/helpers/ so deep imports of tools/policy are
 * permitted while staying excluded from the T17 boundary scan.
 *
 * Builds REAL collaborators:
 *  - a real {@link PolicyEngine} (so injectConfirmationForcingPolicy adds a
 *    rule we can observe through the engine's public evaluate());
 *  - a real BaseDeclarativeTool subclass whose build() records the params it
 *    received (so alias normalization is observable by VALUE, not by spy);
 *  - a structural ToolRegistry over an in-memory tool map (the wrapper only
 *    calls getTool/getAllTools/getEnabledTools + delegates other members).
 *
 * The single class-narrowing cast (structural registry → ToolRegistry) is
 * isolated here.
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
} from '@vybestack/llxprt-code-tools';
import type {
  AnyDeclarativeTool,
  AnyToolInvocation,
  ToolResult,
  ToolRegistry,
} from '@vybestack/llxprt-code-tools';
import { PolicyEngine, PolicyDecision } from '@vybestack/llxprt-code-policy';
import {
  injectConfirmationForcingPolicy,
  wrapRegistryWithConfirmation,
} from '../../confirmationForcing.js';

export { PolicyDecision };

interface ProbeParams {
  readonly absolute_path?: string;
  readonly [key: string]: unknown;
}

/**
 * A real declarative-tool invocation that simply echoes the params it was
 * constructed with. Used to observe what `build()` received after alias
 * normalization.
 */
class ProbeInvocation extends BaseToolInvocation<ProbeParams, ToolResult> {
  // Uses `this.params` so a correct delegation MUST bind `this`; an unbound
  // call (or one returning the wrong member) produces a different value.
  getDescription(): string {
    return `probe:${this.params.absolute_path ?? 'none'}`;
  }

  async execute(): Promise<ToolResult> {
    return {
      llmContent: `executed:${this.params.absolute_path ?? 'none'}`,
      returnDisplay: 'ok',
    };
  }
}

/**
 * A real declarative tool. `createInvocation` records the (already
 * alias-normalized) params on the shared `lastBuildParams` sink so a test can
 * assert on the VALUE the underlying tool received.
 */
class ProbeTool extends BaseDeclarativeTool<ProbeParams, ToolResult> {
  constructor(
    name: string,
    private readonly sink: { last?: ProbeParams },
  ) {
    super(
      name,
      name,
      'probe tool',
      Kind.Read,
      {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
      true,
      false,
    );
  }

  protected createInvocation(params: ProbeParams): ProbeInvocation {
    this.sink.last = params;
    return new ProbeInvocation(params);
  }
}

export interface ConfirmationForcingProbe {
  readonly policyEngine: PolicyEngine;
  /** Wrapped registry produced by wrapRegistryWithConfirmation. */
  readonly wrappedRegistry: ToolRegistry;
  /** The raw (unwrapped) registry the wrapper delegates to. */
  readonly baseRegistry: ToolRegistry;
  /** Records of which registry methods were asked and for what name. */
  readonly probeToolName: string;
  /** Returns the params the underlying tool's build() last received. */
  lastBuildParams(): ProbeParams | undefined;
}

/**
 * Builds the probe with a single named tool registered.
 */
export function createConfirmationForcingProbe(
  toolName = 'read_file',
): ConfirmationForcingProbe {
  const policyEngine = new PolicyEngine();
  const sink: { last?: ProbeParams } = {};
  const tool = new ProbeTool(toolName, sink) as unknown as AnyDeclarativeTool;
  const toolMap = new Map<string, AnyDeclarativeTool>([[toolName, tool]]);

  const structuralRegistry = {
    registryKind: 'structural-probe-registry',
    getTool(name: string): AnyDeclarativeTool | undefined {
      return toolMap.get(name);
    },
    getAllTools(): AnyDeclarativeTool[] {
      return [...toolMap.values()];
    },
    getEnabledTools(): AnyDeclarativeTool[] {
      return [...toolMap.values()];
    },
    // A delegated, non-wrapped METHOD that READS `this` — proving the wrapper
    // hands back a this-BOUND function (a detached/unbound call must still see
    // registryKind via `this`).
    describeRegistry(): string {
      return this.registryKind;
    },
    // A delegated, non-wrapped METHOD used to prove function pass-through.
    getToolNamesForPrompt(): string[] {
      return [...toolMap.keys()];
    },
  };

  const baseRegistry = structuralRegistry as unknown as ToolRegistry;
  const wrappedRegistry = wrapRegistryWithConfirmation(baseRegistry);

  return {
    policyEngine,
    wrappedRegistry,
    baseRegistry,
    probeToolName: toolName,
    lastBuildParams: () => sink.last,
  };
}

/**
 * Applies the production policy injection to a probe's engine.
 */
export function applyForcingPolicy(probe: ConfirmationForcingProbe): void {
  injectConfirmationForcingPolicy(probe.policyEngine);
}

/**
 * Convenience: build a tool from the wrapped registry's getTool and produce an
 * invocation with the given args, returning both the invocation and the
 * confirmation details its shouldConfirmExecute resolves to.
 */
export async function buildAndConfirm(
  probe: ConfirmationForcingProbe,
  args: Record<string, unknown>,
): Promise<{
  readonly invocation: AnyToolInvocation;
  readonly details: Awaited<
    ReturnType<AnyToolInvocation['shouldConfirmExecute']>
  >;
}> {
  const tool = probe.wrappedRegistry.getTool(probe.probeToolName);
  if (tool === undefined) {
    throw new Error('probe tool missing from wrapped registry');
  }
  const invocation = tool.build(args) as AnyToolInvocation;
  const details = await invocation.shouldConfirmExecute(
    new AbortController().signal,
  );
  return { invocation, details };
}

/**
 * Confirmation details with the `false` (no-confirmation) case excluded. A
 * forced/wrapped tool ALWAYS surfaces a structured details object, so callers
 * narrow to this shape via {@link narrowConfirmDetails}.
 */
export type ConfirmDetails = Exclude<
  Awaited<ReturnType<AnyToolInvocation['shouldConfirmExecute']>>,
  false
>;

/**
 * Cast-free narrowing for confirmation details: throws (instead of using an
 * in-test conditional) when the wrapped tool unexpectedly returns `false`,
 * returning the structured details object so specs can assert on it directly.
 */
export function narrowConfirmDetails(
  details: Awaited<ReturnType<AnyToolInvocation['shouldConfirmExecute']>>,
): ConfirmDetails {
  if (details === false) {
    throw new Error('expected structured confirmation details, got false');
  }
  return details;
}
