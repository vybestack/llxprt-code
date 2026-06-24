/**
 * @plan:PLAN-20260617-COREAPI.P25
 * @requirement:REQ-017
 *
 * Static discovery helpers.
 *
 * These functions return the built-in / static public provider and tool sets so
 * a consumer can pick a plausible provider/tool value BEFORE constructing an
 * Agent (i.e. before any CLI runtime or Config exists). They are deliberately
 * callable standalone — with NO Agent and NO registered runtime.
 *
 * Provider enumeration is re-projected from the SAME accessor the instance path
 * uses — `ProviderManager.listProviders()` — but reached via the runtime-free
 * composition seam `createProviderManager` (from
 * `@vybestack/llxprt-code-providers/composition.js`). That seam builds a fully
 * registered ProviderManager from a fresh SettingsService and imports nothing
 * from the CLI. We deliberately do NOT call the global
 * `@vybestack/llxprt-code-providers/runtime.js` `listProviders()` accessor: it
 * delegates to `getCliRuntimeServices()`, which THROWS when no Config/runtime is
 * registered — exactly the pre-agent situation these helpers serve.
 *
 * Tool enumeration is re-projected from the canonical built-in tool classes'
 * `static readonly Name` properties — the SAME classes `registerStandardTools`
 * (core's tool-registry factory) registers — without constructing a live Config.
 */

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderManager } from '@vybestack/llxprt-code-providers/composition.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  LSTool,
  ReadFileTool,
  GrepTool,
  GlobTool,
  EditTool,
  ASTEditTool,
  WriteFileTool,
  GoogleWebFetchTool,
  ReadManyFilesTool,
  ReadLineRangeTool,
  ASTReadFileTool,
  AstGrepTool,
  StructuralAnalysisTool,
  DeleteLineRangeTool,
  InsertAtLineTool,
  ApplyPatchTool,
  ShellTool,
  MemoryTool,
  GoogleWebSearchTool,
  ExaWebSearchTool,
  TodoWrite,
  TodoRead,
  TodoPause,
  CodeSearchTool,
  DirectWebFetchTool,
} from '@vybestack/llxprt-code-tools';
import type { ProviderInfo, ToolInfo } from './agent.js';

/**
 * Minimal carrier for a tool class' canonical static name. Every built-in tool
 * class exposes a `static readonly Name`; this is the runtime-free source that
 * mirrors what core's `registerStandardTools` registers.
 */
interface ToolNameCarrier {
  readonly Name: string;
}

/**
 * The canonical built-in tool set, derived from the SAME tool classes core's
 * tool-registry factory registers via `registerStandardTools`. We read each
 * class' `static readonly Name` so the static list cannot drift from the real
 * built-in definitions (no hand-typed literal duplication).
 *
 * Note: this is the unconditional standard set. Tools that core registers only
 * under runtime-dependent governance (e.g. RipGrep vs Grep selection, or the
 * subagent/async tools gated on live Config) are intentionally excluded from the
 * runtime-free static projection.
 */
const BUILTIN_TOOL_CLASSES: readonly ToolNameCarrier[] = [
  LSTool,
  ReadFileTool,
  GrepTool,
  GlobTool,
  EditTool,
  ASTEditTool,
  WriteFileTool,
  GoogleWebFetchTool,
  ReadManyFilesTool,
  ReadLineRangeTool,
  ASTReadFileTool,
  AstGrepTool,
  StructuralAnalysisTool,
  DeleteLineRangeTool,
  InsertAtLineTool,
  ApplyPatchTool,
  ShellTool,
  MemoryTool,
  GoogleWebSearchTool,
  ExaWebSearchTool,
  TodoWrite,
  TodoRead,
  TodoPause,
  CodeSearchTool,
  DirectWebFetchTool,
];

/**
 * Projects provider names to the public ProviderInfo shape. Inlined (rather than
 * importing `buildProviderInfos` from `./agentBootstrap.js`) to avoid pulling the
 * heavy bootstrap/AgentClient runtime chain into this pre-agent module.
 */
function projectProviderInfos(
  names: readonly string[],
): readonly ProviderInfo[] {
  return names.map((name) => ({
    name,
    // Static, runtime-free discovery has no bound credentials or active runtime,
    // so no provider is authoritatively "configured" yet. This is an honest
    // pre-agent projection, not a fabricated per-provider literal.
    configured: false,
  }));
}

/**
 * Returns the static, built-in provider set as public ProviderInfo[].
 *
 * Callable with no Agent and no registered CLI runtime: it constructs a
 * runtime-free ProviderManager (fresh SettingsService) purely to enumerate the
 * registered built-in provider names, then re-projects them to the public shape.
 *
 * @plan:PLAN-20260617-COREAPI.P25
 * @requirement:REQ-017
 */
export function listProviders(): readonly ProviderInfo[] {
  const settingsService = new SettingsService();
  const context: ProviderRuntimeContext = {
    settingsService,
    runtimeId: 'static-discovery',
    metadata: { stage: 'static-discovery' },
  };
  const { manager } = createProviderManager(context, {});
  const names = manager.listProviders();
  return projectProviderInfos(names);
}

/**
 * Returns the static, built-in tool set as public ToolInfo[].
 *
 * Callable with no Agent and no registered CLI runtime: it re-projects the
 * canonical built-in tool classes' `static readonly Name` into the public shape.
 * `source` is always `'builtin'` here; `enabled` is `true` because the standard
 * set is the default-on built-in surface (governance that disables individual
 * tools is a runtime/Config concern surfaced by the instance helper).
 *
 * @plan:PLAN-20260617-COREAPI.P25
 * @requirement:REQ-017
 */
export function listTools(): readonly ToolInfo[] {
  return BUILTIN_TOOL_CLASSES.map((toolClass) => ({
    name: toolClass.Name,
    source: 'builtin',
    enabled: true,
  }));
}
