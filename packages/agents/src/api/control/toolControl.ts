/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @requirement:REQ-007
 * @pseudocode tool-confirmation-merge.md steps 10-109
 *
 * The public tool control surface. Surfaces tool listing/enablement,
 * confirmation request/response, live tool-status updates, and editor callback
 * registration. Confirmations and tool-status updates are driven from the SAME
 * projection the eventAdapter produces for the public stream
 * (awaiting_approval ToolCall WITH details), so the public
 * `ToolConfirmation` always carries a structured `details` payload (T3c).
 */

import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
// @plan:ISSUE-2376 the real tool/invocation types the get() handle wraps.
import type {
  AnyDeclarativeTool,
  AnyToolInvocation,
  ToolResult,
} from '@vybestack/llxprt-code-tools';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { ToolConfirmationPayload } from '@vybestack/llxprt-code-tools';
import type { EditorCallbacks } from '../config-types.js';
import type {
  AgentDisplayCallbacks,
  AgentToolConfirmationDetails,
  AgentToolContext,
  AgentToolControl,
  AgentToolExecResult,
  AgentToolHandle,
  AgentToolInvocation,
  AgentToolKeyControl,
  AgentToolLocation,
  ToolDecision,
  ToolInfo,
  Unsubscribe,
} from '../agent.js';
import type { ToolConfirmation, ToolUpdate } from '../event-types.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import {
  buildToolInfos,
  projectRegistryTool,
  readOptionalStringProp,
} from '../agentBootstrap.js';
import type { StableDisplayCallbacksHolder } from '../agentBootstrap.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { ToolKeysControl } from './toolKeysControl.js';
import type { ToolKeysControlDeps } from './toolKeysControl.js';

const logger = new DebugLogger('llxprt:agents:tool-control');

/**
 * Typed error thrown by {@link ToolControl.respondToConfirmation} when the
 * caller supplies an unknown confirmationId.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @pseudocode tool-confirmation-merge.md steps 80-91
 */
export class ToolControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolControlError';
    Object.setPrototypeOf(this, ToolControlError.prototype);
  }
}

/**
 * Dependencies injected into {@link ToolControl} by the AgentImpl constructor.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 */
export interface ToolControlDeps {
  /** The shared confirmation bus (respondToConfirmation publishes here). */
  readonly messageBus: MessageBus;
  /** The Config carrying the tool registry + settings service. */
  readonly config: Config;
  /**
   * The mutable editor-callbacks holder shared with the scheduler factory so
   * `setEditorCallbacks` is observable by the next turn's scheduler.
   */
  readonly editorCallbacksHolder: { editorCallbacks: EditorCallbacks };
  /**
   * The mutable display-callbacks holder shared with the scheduler factory so
   * `setDisplayCallbacks` is observable by the CURRENT loop's turn (and
   * survives loop rebuilds via the stable forwarding object).
   */
  readonly displayCallbacksHolder: StableDisplayCallbacksHolder;
  /**
   * Resolves the live AgentClient (for recordCompletedToolCalls). Never cached.
   */
  readonly resolveClient: () => AgentClientContract;
  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
  /** The deps bundle for the constructed ToolKeysControl. */
  readonly keysDeps: ToolKeysControlDeps;
}

type ConfirmationCallback = (req: ToolConfirmation) => void;
type ToolUpdateCallback = (u: ToolUpdate) => void;

/**
 * The public tool control surface.
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @requirement:REQ-007
 * @pseudocode tool-confirmation-merge.md steps 10-109
 */
export class ToolControl implements AgentToolControl {
  private readonly confirmationCallbacks = new Set<ConfirmationCallback>();
  private readonly toolUpdateCallbacks = new Set<ToolUpdateCallback>();
  private readonly seen = new Set<string>();
  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
  readonly keys: AgentToolKeyControl;

  constructor(private readonly deps: ToolControlDeps) {
    this.keys = new ToolKeysControl(deps.keysDeps);
  }

  /**
   * Returns a frozen snapshot of the registered tools, mirroring
   * `AgentImpl.listTools()`. Projects the enriched description/displayName/
   * parametersSchema/serverToolName fields (added by #2376) additively — each
   * is included only when the underlying tool defines it. The parametersSchema
   * mirrors `tool.schema.parametersJsonSchema` (the same source
   * mcpDisplay.ts:buildToolSchemaSection reads).
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   * @requirement:REQ-017
   * @plan:ISSUE-2376
   */
  list(): readonly ToolInfo[] {
    const registry = this.deps.config.getToolRegistry();
    const allTools = registry.getAllTools().map((t) =>
      projectRegistryTool({
        name: t.name,
        displayName: t.displayName,
        description: t.description,
        schema: t.schema,
        serverName: readOptionalStringProp(t, 'serverName'),
        serverToolName: readOptionalStringProp(t, 'serverToolName'),
      }),
    );
    const enabledNames = new Set(registry.getEnabledTools().map((t) => t.name));
    return Object.freeze(buildToolInfos(allTools, enabledNames));
  }

  /**
   * Returns a named-tool lookup handle wrapping the real
   * {@link AnyDeclarativeTool} from the registry, or undefined when no tool is
   * registered under `name`. The handle's build()/buildAndExecute() delegate to
   * the real tool; the invocation projection is thin (raw invocation, no
   * confirmation flow) and exposes the shouldConfirmExecute/toolLocations
   * passthroughs the Zed integration reads. setContext() is present only when
   * the underlying tool is context-aware (safe `'context' in tool` check).
   *
   * @plan:ISSUE-2376
   */
  get(name: string): AgentToolHandle | undefined {
    const registry = this.deps.config.getToolRegistry();
    const tool = registry.getTool(name);
    if (tool === undefined) {
      return undefined;
    }
    return wrapToolHandle(tool);
  }

  /**
   * Enables exactly the named tools (and disables all others) by setting the
   * `tools.allowed` ephemeral setting on the Config's settings service — the
   * same mechanism the profile manager uses.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   */
  async setEnabled(names: readonly string[]): Promise<void> {
    const settingsService = this.deps.config.getSettingsService();
    settingsService.set('tools.allowed', [...names]);
  }

  /**
   * Registers a confirmation-request callback. The callback fires when a tool
   * confirmation surfaces in the public stream. Returns an unsubscribe.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   * @pseudocode tool-confirmation-merge.md steps 10-31
   */
  onConfirmationRequest(cb: ConfirmationCallback): Unsubscribe {
    this.confirmationCallbacks.add(cb);
    return () => {
      this.confirmationCallbacks.delete(cb);
    };
  }

  /**
   * Responds to a surfaced confirmation by publishing the outcome on the shared
   * MessageBus (keyed by correlationId/confirmationId). Throws
   * {@link ToolControlError} for an unknown confirmationId.
   *
   * For `ModifyWithEditor`, the confirmationId is retired (the coordinator
   * issues a new correlationId). Optional payloads carry editor/suggest-edit
   * overrides, and requiresUserConfirmation flags decisions that should be
   * re-surfaced to the user by the bus consumer.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   * @pseudocode tool-confirmation-merge.md steps 80-91
   */
  respondToConfirmation(
    confirmationId: string,
    decision: ToolDecision,
    payload?: ToolConfirmationPayload,
    requiresUserConfirmation?: boolean,
  ): void {
    if (!this.seen.has(confirmationId)) {
      throw new ToolControlError('unknown confirmationId: ' + confirmationId);
    }
    this.deps.messageBus.respondToConfirmation(
      confirmationId,
      decision,
      payload,
      requiresUserConfirmation,
    );
    if (decision === ToolConfirmationOutcome.ModifyWithEditor) {
      // editor-modify retires the correlationId; the coordinator issues a new one.
      this.seen.delete(confirmationId);
    }
  }

  /**
   * Registers a tool-update callback. Fires on projected tool-status updates
   * surfaced in the public stream.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   * @pseudocode tool-confirmation-merge.md steps 40-67
   */
  onToolUpdate(cb: ToolUpdateCallback): Unsubscribe {
    this.toolUpdateCallbacks.add(cb);
    return () => {
      this.toolUpdateCallbacks.delete(cb);
    };
  }

  /**
   * Registers editor callbacks on the shared mutable holder so the next turn's
   * scheduler reads them.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   */
  setEditorCallbacks(cbs: EditorCallbacks): void {
    this.deps.editorCallbacksHolder.editorCallbacks = cbs;
  }

  /**
   * Registers display callbacks (tool updates, output, completion) on the
   * shared mutable holder. The stable forwarding DisplayCallbacks object the
   * loop holds reads the LATEST values at call time, so registration is
   * observable by the CURRENT loop's turn (and survives loop rebuilds).
   * REPLACES previously registered display callbacks (no merge).
   */
  setDisplayCallbacks(cbs: AgentDisplayCallbacks): void {
    this.deps.displayCallbacksHolder.onToolCallsUpdate = cbs.onToolCallsUpdate;
    this.deps.displayCallbacksHolder.outputUpdateHandler =
      cbs.outputUpdateHandler;
    this.deps.displayCallbacksHolder.onAllToolCallsComplete =
      cbs.onAllToolCallsComplete;
  }

  /**
   * Records completed tool calls into chat history (best-effort, mirroring the
   * AgenticLoop's own recordCompletedToolCalls semantics). Used by UI clients
   * that schedule tools outside the loop but still want the results persisted.
   * History persistence is best-effort: a failure is swallowed.
   */
  recordCompletedToolCalls(completed: readonly CompletedToolCall[]): void {
    try {
      const client = this.deps.resolveClient();
      const model =
        client.getCurrentSequenceModel() ?? this.deps.config.getModel();
      client.getChat().recordCompletedToolCalls(model, [...completed]);
    } catch (error) {
      // History persistence is best-effort.
      logger.debug(
        `recordCompletedToolCalls best-effort persistence failed: ${error}`,
      );
    }
  }

  // ─── Stream-tap notification (called by AgentImpl.stream) ──────────────────

  /**
   * Notifies the surface of a projected confirmation from the public stream.
   * Deduplicates by confirmationId; fires all registered callbacks.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   * @pseudocode tool-confirmation-merge.md steps 10-31
   */
  notifyConfirmation(confirmation: ToolConfirmation): void {
    if (this.seen.has(confirmation.confirmationId)) {
      return;
    }
    this.seen.add(confirmation.confirmationId);
    for (const cb of this.confirmationCallbacks) {
      try {
        cb(confirmation);
      } catch {
        // A throwing user callback must not break the stream tap.
      }
    }
  }

  /**
   * Notifies the surface of a projected tool-status update from the public
   * stream. Fires all registered callbacks.
   *
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   * @pseudocode tool-confirmation-merge.md steps 40-67
   */
  notifyToolUpdate(update: ToolUpdate): void {
    for (const cb of this.toolUpdateCallbacks) {
      try {
        cb(update);
      } catch {
        // A throwing user callback must not break the stream tap.
      }
    }
  }
}

// ─── ISSUE-2376: named-tool lookup handle wrapping ─────────────────────────
//
// Pure module-level helpers (no ToolControl state) so the wrapping is testable
// in isolation. The handle delegates build()/buildAndExecute() to the real
// AnyDeclarativeTool and projects the invocation through a thin wrapper that
// exposes getDescription/execute/shouldConfirmExecute/toolLocations — the four
// methods the CLI consumers (atCommandProcessorHelpers.ts, zed-tool-handler.ts)
// read. setContext() is attached ONLY when the underlying tool carries a
// `context` property (the same `'context' in tool` check zed-tool-handler.ts
// performs), so context-aware tools receive the context bundle and plain tools
// expose no setter.

/**
 * Wraps a real {@link AnyToolInvocation} as a thin {@link AgentToolInvocation}
 * projection. The wrapper delegates every method to the real invocation and
 * re-maps the result to the public {@link AgentToolExecResult} shape.
 *
 * @plan:ISSUE-2376
 */
function wrapInvocation(invocation: AnyToolInvocation): AgentToolInvocation {
  return {
    getDescription: () => invocation.getDescription(),
    execute: async (signal, updateOutput) => {
      // The public AgentToolInvocation.execute contract accepts only string
      // chunks, but the real ToolInvocation.execute delivers string |
      // AnsiOutput. When the caller supplies an updateOutput callback, forward
      // string chunks directly and losslessly flatten AnsiOutput (an
      // AnsiToken[][]) to its plain text so rich terminal output is preserved
      // rather than silently dropped — honoring the public (string-only)
      // contract without a cast.
      const result: ToolResult = await invocation.execute(
        signal,
        updateOutput !== undefined
          ? (chunk) => {
              if (typeof chunk === 'string') {
                updateOutput(chunk);
              } else {
                updateOutput(
                  chunk
                    .map((line) => line.map((token) => token.text).join(''))
                    .join('\n'),
                );
              }
            }
          : undefined,
      );
      return projectResult(result);
    },
    shouldConfirmExecute: (signal) =>
      invocation.shouldConfirmExecute(signal) as Promise<
        AgentToolConfirmationDetails | false
      >,
    toolLocations: () =>
      invocation.toolLocations() as readonly AgentToolLocation[],
  };
}

/**
 * Projects a real {@link ToolResult} to the public {@link AgentToolExecResult}
 * shape: llmContent and returnDisplay are copied unconditionally; error is
 * included only when the source defines it (undefined is omitted).
 *
 * @plan:ISSUE-2376
 */
function projectResult(result: ToolResult): AgentToolExecResult {
  const projected: {
    llmContent: unknown;
    returnDisplay?: unknown;
    error?: unknown;
  } = {
    llmContent: result.llmContent,
    returnDisplay: result.returnDisplay,
  };
  if (result.error !== undefined) {
    projected.error = result.error;
  }
  return projected;
}

/**
 * Wraps a real {@link AnyDeclarativeTool} as a public {@link AgentToolHandle}.
 *
 * @plan:ISSUE-2376
 */
export function wrapToolHandle(tool: AnyDeclarativeTool): AgentToolHandle {
  // Use the same centralized, type-validated accessor as ToolControl.list()
  // (readOptionalStringProp) instead of a bespoke cast, so MCP detection stays
  // consistent and a non-string serverName cannot be misread as an MCP tool.
  const isMcp = readOptionalStringProp(tool, 'serverName') !== undefined;
  const base: AgentToolHandle = {
    name: tool.name,
    displayName: tool.displayName,
    ...(tool.description.length > 0 ? { description: tool.description } : {}),
    // DeclarativeTool.kind is a required `Kind` string enum, always present —
    // assign it directly rather than guarding an always-true condition.
    kind: tool.kind,
    // @plan:ISSUE-2376 populate source so consumers (zed-tool-handler.ts) can
    // determine tool_type ('mcp' vs 'native') for telemetry without the
    // DiscoveredMCPTool instanceof check.
    source: isMcp ? 'mcp' : 'builtin',
    build: (params) => wrapInvocation(tool.build(params)),
    buildAndExecute: async (params, signal) => {
      const result: ToolResult = await tool.buildAndExecute(params, signal);
      return projectResult(result);
    },
  };
  // Attach setContext ONLY when the underlying tool is context-aware (mirrors
  // zed-tool-handler.ts: `if ('context' in tool) tool.context = {...}`).
  if ('context' in tool) {
    const contextAware = tool as { context?: AgentToolContext };
    base.setContext = (context: AgentToolContext) => {
      contextAware.context = context;
    };
  }
  return base;
}
