# Progress: gmerge/0.17.1

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit | Notes |
|------:|------|-----------------|--------|---------------|-------|
| 1 | PICK (5) | 555e25e63, d683e1c0d, 472e775a1, 9786c4dcf, 78a28bfc0 | DONE | e288fe9e4, f412ee16c, cbf986497 | 555e25e63 SKIPPED (ModelMessage.tsx N/A). 472e775a1 + 9786c4dcf deferred (massive conflicts). d683e1c0d + 78a28bfc0 picked. Fix commit for type/lint issues. |
| 2 | PICK WITH CONFLICTS (1) | 8c78fe4f1 | DONE | c9e1b0ac6 | MCP rework — McpCallableTool, DebugLogger preserved |
| 3 | PICK (1) | cc0eadffe | SKIPPED | — | setupGithubCommand disabled/stubbed in LLxprt, 5 conflict markers |
| 4 | REIMPLEMENT | 86828bb56 | DONE | de1f0fba4 | Gemini 3 extracts (7 sub-changes) — all verified |
| 5 | REIMPLEMENT | 7d33baabe | DONE | 52c10a951 | Multi-extension uninstall |
| 6 | REIMPLEMENT | ba88707b1 | DONE | b76025750 | Terminal mode cleanup on exit |
| 7 | REIMPLEMENT | 8877c8527 | DONE | c3af05523 | Right-click paste in alt buffer |
| 8 | REIMPLEMENT | ab11b2c27 | DONE | a89f8f8d1 | Show profile name on change |
| 9 | REIMPLEMENT | 638dd2f6c + N/A | DONE | e40324c76 | Extension tests + it.each refactoring |

Final formatting commit: 75fedd320

## Follow-Up Plans (Post Batch 1–9)

| Plan | Upstream SHA | Status | LLxprt Commit | Notes |
|------|-------------|--------|---------------|-------|
| P1 | 472e775a1 | DONE | 97fc400ea | /permissions modify trust for other dirs — REIMPLEMENTED |
| P2 | 9786c4dcf | DONE | 4018472a9 | Folder trust gate before /add directory — REIMPLEMENTED |
| P3 | ab11b2c27 (cleanup) | DONE | ece33125e | Componentize ProfileChangeMessage + upstream formatting parity |
| P4 | — (schema gap) | DONE | d95d006eb | Regenerate settings.schema.json (previewFeatures + showProfileChangeInChat) |
