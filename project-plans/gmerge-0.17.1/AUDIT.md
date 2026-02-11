# Audit: gmerge/0.17.1

Upstream SHA -> final disposition + LLxprt commit hash(es).

| Upstream SHA | Decision | LLxprt Commit(s) | Notes |
|-------------|----------|-------------------|-------|
| `0fcbff506` | SKIPPED | — | Release automation |
| `ab11b2c27` | REIMPLEMENTED | a89f8f8d1, ece33125e | Show profile name on change (not model) + cleanup: ProfileChangeMessage component |
| `2c5e09e1c` | SKIPPED | — | ClearcutLogger |
| `3174573b6` | SKIPPED | — | Release automation |
| `555e25e63` | SKIPPED (NO_OP) | — | ModelMessage.tsx does not exist in LLxprt |
| `638dd2f6c` | REIMPLEMENTED | e40324c76 | Extension tests + it.each refactoring |
| `a591505bf` | SKIPPED | — | Deprecation docs |
| `016b5b42e` | SKIPPED | — | Deprecation docs |
| `9d74b7c0e` | SKIPPED | — | Google ADC auth |
| `6d83d3440` | SKIPPED | — | Compress threshold |
| `d683e1c0d` | PICKED | e288fe9e4 | Exit on trust save fail |
| `ba15eeb55` | SKIPPED | — | Selection mode (LLxprt uses /mouse off) |
| `ce56b4ee1` | SKIPPED | — | Experiments flag |
| `472e775a1` | REIMPLEMENTED | 97fc400ea | /permissions modify trust for other dirs (follow-up P1) |
| `ab6b22930` | SKIPPED | — | Mouse warning (no SelectionWarning in LLxprt) |
| `d03496b71` | SKIPPED | — | Paste timeout warning (no warning UI) |
| `9786c4dcf` | REIMPLEMENTED | 4018472a9 | Folder trust gate before /add directory (follow-up P2) |
| `c6b6dcbe9` | SKIPPED | — | Upstream docs |
| `e650a4ee5` | SKIPPED | — | Core test refactor (diverged) |
| `cf8de02c6` | SKIPPED | — | Release automation |
| `78a28bfc0` | PICKED | f412ee16c | NO_COLOR scrollbar fix (UI component conflicts kept LLxprt versions) |
| `394a7ea01` | SKIPPED | — | Tools test refactor (diverged) |
| `8c78fe4f1` | PICKED | c9e1b0ac6 | MCP rework — McpCallableTool, DebugLogger preserved |
| `ba88707b1` | REIMPLEMENTED | b76025750 | Terminal mode cleanup (broader scope) |
| `1d1bdc57c` | SKIPPED | — | Tools test refactor (patterns adopted in test REIMPLEMENT) |
| `8877c8527` | REIMPLEMENTED | c3af05523 | Right-click paste in alt buffer |
| `2f8b68dff` | SKIPPED | — | Glob already at ^12.0.0 |
| `ecf8fba10` | SKIPPED | — | Tips/phrases (not interested) |
| `7d33baabe` | REIMPLEMENTED | 52c10a951 | Multi-extension uninstall |
| `78075c8a3` | SKIPPED | — | Upstream changelog |
| `86828bb56` | REIMPLEMENTED | de1f0fba4 | Gemini 3 extracts (7 sub-changes) |
| `9e5e06e8b` | SKIPPED | — | Release tag |
| `dd1f8e12f` | SKIPPED | — | Model router fix |
| `1a0e349cc` | SKIPPED | — | Release tag |
| `fbe8e9d7d` | SKIPPED | — | Model router fix |
| `7a9da6360` | SKIPPED | — | Release tag |
| `d3bf3af4a` | SKIPPED | — | Compress threshold |
| `6e12a7a83` | SKIPPED | — | Release tag |
| `cc0eadffe` | SKIPPED | — | setupGithubCommand disabled/stubbed in LLxprt |
| `17f4718d9` | SKIPPED | — | Release tag |
| `d9c3b73bf` | SKIPPED | — | Settings dialog (diverged) |
| `7c684e36f` | SKIPPED | — | Release tag |
| `079dfef2f` | SKIPPED | — | Release tag |
| `1d51935fc` | SKIPPED | — | Alt buffer default (LLxprt keeps true) |
| `6a27d5e8f` | SKIPPED | — | Release tag |

## Summary

- **PICKED:** 3 (d683e1c0d, 78a28bfc0, 8c78fe4f1)
- **REIMPLEMENTED:** 6 (86828bb56, 7d33baabe, ba88707b1, 8877c8527, ab11b2c27, 638dd2f6c)
- **SKIPPED:** 34 (includes release tags, docs, diverged code, Google-only features)
- **NO_OP:** 1 (555e25e63 — file doesn't exist in LLxprt)

## Fix/Formatting Commits

- cbf986497 — post-batch 1 verification fixes
- f2a7a3fdb — progress docs update
- 75fedd320 — prettier formatting

## Follow-Up Commits (Post Batch 1–9)

- 97fc400ea — reimplement: /permissions modify trust for other dirs (472e775a1)
- 4018472a9 — reimplement: folder trust gate before /add directory (9786c4dcf)
- ece33125e — refactor: componentize ProfileChangeMessage + upstream formatting parity (ab11b2c27 cleanup)
- d95d006eb — chore: regenerate settings.schema.json (previewFeatures + showProfileChangeInChat)
