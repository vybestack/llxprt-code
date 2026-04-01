# Audit Details — gmerge/0.26.0

This file records the methodology and traceability for the code-level audit of 154 upstream commits (v0.25.2..v0.26.0).

## Audit Batches

| Batch | Commits | Method | File |
|------:|---------|--------|------|
| 1 | 1-31 (c8d7c09..467e869) | codeanalyzer subagent | `audit-batch1.md` |
| 2 | 32-62 (4848f42..ce35d84) | codeanalyzer subagent | `audit-batch2.md` |
| 3 | 63-93 (fcd860e..d8a8b43) | Manual (coordinator) — subagent failed auth | `audit-batch3.md` |
| 4 | 94-124 (0a6f2e0..67d6908) | codeanalyzer subagent | `audit-batch4.md` |
| 5 | 125-154 (645e2ec..c1b110a) | codeanalyzer subagent | `audit-batch5.md` |

## Batch 3 Failure Note

The codeanalyzer subagent failed twice for batch 3 (commits 63-93) due to authentication errors with the `chuteskeyminimax` profile. The batch was audited manually by the coordinator using:

1. `git show --stat <sha>` for all 31 commits to assess file scope
2. Targeted `git show <sha> -- <file>` for key commits (e.g., text buffer optimization, PTY leak, settings rename, shell confirmation)
3. LLxprt file existence verification (`ls <path>`) for all affected files
4. Cross-reference with LLxprt state assessment (presence/absence of skills, hooks, scheduler, admin, agents, compression, etc.)

## LLxprt State Assessment

Before decisioning, the following LLxprt components were verified:

### Present in LLxprt
- Skills system (skillLoader, skillManager, CLI commands)
- Hooks system (hookSystem, hookRegistry, hookAggregator, hookRunner, hookPlanner, hookEventHandler)
- Confirmation-bus (packages/core/src/confirmation-bus/)
- Key bindings (keyBindings.ts, keyMatchers.ts) with extra LLxprt commands
- A2A server (packages/a2a-server/)
- Policy engine (discovered.toml, read-only.toml, write.toml, yolo.toml)
- ShellConfirmationDialog.tsx
- MCP OAuth provider (oauth-provider.ts)
- ShellExecutionService.ts
- LruCache.ts (not migrated to mnemoist)
- text-buffer.ts, highlight.ts, commandUtils.ts, installationInfo.ts
- Help.tsx, DebugProfiler.tsx, SettingsDialog.tsx
- hooksCommand.ts, tool-executor.ts, mcp-client-manager.ts

### Not Present in LLxprt
- Upstream agent system (no a2a-client-manager, delegate-to-agent-tool, local-executor, generalist-agent)
- Availability/model routing/fallback (no fallback/, routing/, availability/)
- Plan mode (no plan.toml)
- Admin controls (no code_assist/admin/)
- Builtin skills (no skill-creator)
- Rewind feature (no RewindViewer, RewindConfirmation)
- Mnemoist dependency
- Scheduler modules beyond tool-executor.ts + types.ts
- ValidationDialog, useQuotaAndFallback
- chatCompressionService.ts (LLxprt has own core/compression/)
- telemetry/semantic.ts (LLxprt uses local file logging only)

## Coordinator Overrides

The following verdicts from subagent audits were overridden by the coordinator:

| SHA | Subagent Verdict | Override | Reason |
|-----|-----------------|----------|--------|
| `943481c` | REIMPLEMENT | SKIP | Admin controls not in LLxprt — advancedFeaturesEnabled is Google enterprise |
| `b71fe94` | REIMPLEMENT | SKIP | Admin settings enforcement not in LLxprt — deferred.ts is admin-specific |
| `67d6908` | REIMPLEMENT | SKIP | GEMINI.md and .gemini/skills/pr-creator not in LLxprt |
