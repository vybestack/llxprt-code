# Core Top-Level Tool Export Manifest

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Generated: 2026-06-08

This document enumerates every current `packages/core/src/index.ts` tool export, its final source after extraction, and consumer need. Required by P10 and referenced by P13.

## Evidence

Raw baseline: `analysis/core-top-level-tool-export-baseline.txt` (generated from repository scan).

```bash
rg -n "export .* from './tools/" packages/core/src/index.ts > project-plans/issue1585/analysis/core-top-level-tool-export-baseline.txt
```

## Current Tool Exports And Final Disposition

| Line | Current Export | Final Source | Consumer Need | Action |
| --- | --- | --- | --- | --- |
| 216 | `export * from './tools/tools.js'` | @vybestack/llxprt-code-tools | core, scheduler, CLI | Update: `export * from '@vybestack/llxprt-code-tools'` (or specific re-exports) |
| 217 | `export * from './tools/tool-error.js'` | @vybestack/llxprt-code-tools | scheduler, policy | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 218 | `export * from './tools/tool-registry.js'` | @vybestack/llxprt-code-tools | agents, scheduler | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 219 | `export * from './tools/tool-context.js'` | @vybestack/llxprt-code-tools | agents | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 220 | `export * from './tools/tool-names.js'` | @vybestack/llxprt-code-tools | integration-tests | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 233 | `export * from './tools/read-file.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 234 | `export * from './tools/ls.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 235 | `export * from './tools/grep.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 236 | `export * from './tools/ripGrep.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 237 | `export * from './tools/glob.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 238 | `export * from './tools/edit.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 239 | `export * from './tools/write-file.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 240 | `export * from './tools/google-web-fetch.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 241 | `export * from './tools/direct-web-fetch.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 242 | `export * from './tools/memoryTool.js'` | @vybestack/llxprt-code-tools | evals, integration-tests | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 243 | `export * from './tools/shell.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 244 | `export * from './tools/google-web-search.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 245 | `export * from './tools/exa-web-search.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 246 | `export * from './tools/codesearch.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 247 | `export * from './tools/read-many-files.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 248 | `export * from './tools/mcp-client.js'` | STAYS in core (RETAINED_MCP) | utils/events.ts | KEEP: local re-export (mcp-client stays in core) |
| 249 | `export * from './tools/mcp-tool.js'` | @vybestack/llxprt-code-tools (if moved) | CLI (re-export) | Update if mcp-tool moves |
| 250 | `export * from './tools/todo-read.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 251 | `export * from './tools/todo-write.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 252 | `export * from './tools/todo-pause.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 253 | `export * from './tools/todo-schemas.js'` | @vybestack/llxprt-code-tools | services | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 254 | `export * from './tools/todo-store.js'` | @vybestack/llxprt-code-tools | core | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 255 | `export * from './tools/todo-events.js'` | @vybestack/llxprt-code-tools | core | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 256 | `export * from './tools/list-subagents.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 257 | `export * from './tools/task.js'` | @vybestack/llxprt-code-tools | CLI (re-export) | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 258 | `export * from './tools/tool-key-storage.js'` | SPLIT: IToolKeyStorage moves, class stays | secure-store tests | Update: re-export pure functions from tools; keep class export locally |
| 318 | `export * from './tools/IToolFormatter.js'` | @vybestack/llxprt-code-tools | providers | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 319 | `export * from './tools/ToolFormatter.js'` | @vybestack/llxprt-code-tools | providers | Update: `export * from '@vybestack/llxprt-code-tools'` |
| 438 | `export { McpClientManager } from './tools/mcp-client-manager.js'` | STAYS in core (RETAINED_MCP) | core | KEEP: local re-export |
| 439 | `export { McpClient } from './tools/mcp-client.js'` | STAYS in core (RETAINED_MCP) | core | KEEP: local re-export |

## Summary

- **34 tool exports** re-exported from `'./tools/*'` in `packages/core/src/index.ts`
- **32 exports** will be updated to re-export from `@vybestack/llxprt-code-tools`
- **3 exports stay local**: mcp-client.js, McpClientManager, McpClient (RETAINED_MCP)
- **1 export split**: tool-key-storage.js (pure function exports move, class export stays)
- **Consumer impact**: CLI and external consumers access these through core top-level re-exports; no direct tools dependency needed for CLI