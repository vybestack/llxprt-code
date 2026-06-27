/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @pseudocode tool-confirmation-merge.md steps 10-31
 *
 * The confirmation-forcing seam. Two parts:
 *
 * 1. **Policy-ASK injection** (`injectConfirmationForcingPolicy`): adds a
 *    priority-4 ASK rule for every tool so the ConfirmationCoordinator's
 *    `tryFastApprove` falls through (ASK is neither ALLOW nor DENY). This is
 *    required because read-only tools (read_file, list_directory, glob, …)
 *    are ALLOW (priority 1.050) in read-only.toml, which short-circuits
 *    BEFORE `shouldConfirmExecute` is ever consulted.
 *
 * 2. **Registry/invocation wrapper** (`wrapRegistryWithConfirmation`):
 *    wraps every tool so `build()` returns an invocation whose
 *    `shouldConfirmExecute` returns truthy `info`-variant
 *    `ToolCallConfirmationDetails`. The coordinator then publishes a real
 *    `TOOL_CONFIRMATION_REQUEST` and sets the ToolCall to
 *    `awaiting_approval` carrying `confirmationDetails`, which the
 *    eventAdapter projects (with details) into the public stream.
 *
 * The wrapper also normalizes common param-name aliases (e.g. `path` →
 * `absolute_path`) so fixtures that use short-form arg keys produce working
 * invocations instead of build errors. This is a backwards-compatibility
 * adapter: many providers and fixtures emit `path` for read_file / `dir`
 * for list_directory, and the underlying tools require `absolute_path`.
 */

import type {
  AnyDeclarativeTool,
  AnyToolInvocation,
  ToolCallConfirmationDetails,
} from '@vybestack/llxprt-code-tools';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import type { PolicyEngine } from '@vybestack/llxprt-code-policy';

/**
 * The priority assigned to the confirmation-forcing ASK rule. Must exceed all
 * TOML tiers (1.x/2.x/3.x) and settings bands (max 2.95) so no ALLOW rule can
 * override it.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @pseudocode tool-confirmation-merge.md steps 10-31
 */
const CONFIRMATION_FORCING_PRIORITY = 4.0;

export const CONFIRMATION_FORCING_SOURCE =
  'Agent confirmation-forcing seam (P17)';

/**
 * Adds a high-priority ASK rule (matching every tool) to the policy engine so
 * the ConfirmationCoordinator reaches `evaluateAndRoute` →
 * `shouldConfirmExecute` for ALL tools, including read-only ALLOW tools.
 *
 * Must be called after Config construction (which builds the engine from TOML
 * + settings) so the injected rule sits at the top of the priority list.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @pseudocode tool-confirmation-merge.md steps 10-31
 */
export function injectConfirmationForcingPolicy(
  policyEngine: PolicyEngine,
): void {
  policyEngine.addRule({
    toolName: undefined,
    decision: PolicyDecision.ASK_USER,
    priority: CONFIRMATION_FORCING_PRIORITY,
    source: CONFIRMATION_FORCING_SOURCE,
  });
}

/**
 * Maps common short-form arg keys to the canonical names expected by the
 * underlying tool implementations. This is a backwards-compatibility adapter
 * for fixtures and providers that emit shorthand parameter names.
 *
 * Only renames keys when the canonical key is ABSENT — it never overwrites an
 * existing canonical key.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @pseudocode tool-confirmation-merge.md steps 10-31
 */
const ARG_ALIASES: Readonly<Record<string, string>> = {
  path: 'absolute_path',
  dir: 'absolute_path',
};

/**
 * Returns a shallow copy of `args` with any alias keys remapped to their
 * canonical names. Canonical keys that already exist are never overwritten.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @pseudocode tool-confirmation-merge.md steps 10-31
 */
function normalizeArgAliases(args: object): Record<string, unknown> {
  const source = args as Record<string, unknown>;
  const result: Record<string, unknown> = { ...source };
  for (const [alias, canonical] of Object.entries(ARG_ALIASES)) {
    if (alias in result && !(canonical in result)) {
      result[canonical] = result[alias];
    }
  }
  return result;
}

/**
 * Wraps a single tool invocation so `shouldConfirmExecute` returns truthy
 * `info`-variant confirmation details, while every other member delegates to
 * the original invocation. Implemented via Proxy so the exact
 * `ToolInvocation` member shapes (including `execute`'s overload) are
 * preserved without re-declaring them.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @pseudocode tool-confirmation-merge.md steps 10-31
 */
function wrapInvocationWithConfirmation(
  invocation: AnyToolInvocation,
): AnyToolInvocation {
  return new Proxy(invocation, {
    get(target: AnyToolInvocation, prop: string | symbol): unknown {
      if (prop === 'shouldConfirmExecute') {
        return async (): Promise<ToolCallConfirmationDetails> => ({
          type: 'info',
          title: 'Confirm tool execution',
          prompt: 'Allow this tool to run?',
          onConfirm: async () => {
            /* no-op — the coordinator drives execution after approval */
          },
        });
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function'
        ? (value as (...args: never[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * Wraps a single tool so `build()` returns a confirming invocation. Every
 * other property delegates to the original tool.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @pseudocode tool-confirmation-merge.md steps 10-31
 */
function wrapToolWithConfirmation(
  tool: AnyDeclarativeTool,
): AnyDeclarativeTool {
  const originalBuild = tool.build.bind(tool);
  return new Proxy(tool, {
    get(target: AnyDeclarativeTool, prop: string | symbol): unknown {
      if (prop === 'build') {
        return (params: object): AnyToolInvocation => {
          const normalized = normalizeArgAliases(params);
          return wrapInvocationWithConfirmation(originalBuild(normalized));
        };
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function'
        ? (value as (...args: never[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * Wraps a ToolRegistry so every tool returned from `getTool`,
 * `getAllTools`, and `getEnabledTools` forces confirmation. All other registry
 * methods delegate to the original registry.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @pseudocode tool-confirmation-merge.md steps 10-31
 */
export function wrapRegistryWithConfirmation(
  registry: ToolRegistry,
): ToolRegistry {
  const wrap = wrapToolWithConfirmation;
  return new Proxy(registry, {
    get(
      target: ToolRegistry,
      prop: string | symbol,
      receiver: unknown,
    ): unknown {
      if (prop === 'getTool') {
        return (
          name: string,
          context?: unknown,
        ): AnyDeclarativeTool | undefined => {
          const original = target.getTool(
            name,
            context as Parameters<typeof target.getTool>[1],
          );
          return original !== undefined ? wrap(original) : undefined;
        };
      }
      if (prop === 'getAllTools') {
        return (): AnyDeclarativeTool[] => target.getAllTools().map(wrap);
      }
      if (prop === 'getEnabledTools') {
        return (): AnyDeclarativeTool[] => target.getEnabledTools().map(wrap);
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function'
        ? (value as (...args: never[]) => unknown).bind(target)
        : value;
    },
  });
}
