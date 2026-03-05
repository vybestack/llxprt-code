# Audit: gmerge-0.24.5

Post-implementation reconciliation. Updated as batches complete.

## PICK Commits (34)

| # | Upstream SHA | Decision | LLxprt Commit(s) | Notes |
|---|-------------|----------|-------------------|-------|
| 1 | `0a216b28f36c` | PICK | | EIO fix |
| 2 | `b0d5c4c0587b` | PICK | | Dynamic policy |
| 3 | `e9a601c1fe87` | PICK | | MCP type field |
| 4 | `b6b0727e28b7` | PICK | | Schema non-fatal |
| 5 | `5f2861476093` | PICK | | MCP resources |
| 6 | `873d10df429c` | PICK | | Terse images |
| 7 | `56b050422d7a` | PICK | | Typo fix |
| 8 | `acecd80afa24` | PICK | | IDE promise |
| 9 | `21388a0a40b0` | PICK | | GitService |
| 10 | `de1233b8ca5f` | PICK | | Skills: core infra |
| 11 | `958284dc2491` | PICK | | Skills: activation |
| 12 | `764b195977f4` | PICK | | Skills: system prompt |
| 13 | `e78c3fe4f0be` | PICK | | Skills: status bar |
| 14 | `f0a039f7c07d` | PICK | | Skills: refactor |
| 15 | `bdb349e7f6c0` | PICK | | Skills: extension support |
| 16 | `d3563e2f0eb1` | PICK | | Skills: CLI commands |
| 17 | `2cb33b2f764b` | PICK | | Skills: reload |
| 18 | `0c5413624415` | PICK | | Skills: workspace context |
| 19 | `5f027cb63a45` | PICK | | Skills: UI fix |
| 20 | `0eb84f5133a8` | PICK | | Integration test |
| 21 | `8a0190ca3bc4` | PICK | | MCP promise |
| 22 | `18fef0db31a2` | PICK | | Shell redirection |
| 23 | `0f3555a4d241` | PICK | | /dir add |
| 24 | `30f5c4af4a28` | PICK | | Powershell mock |
| 25 | `615b218ff702` | PICK | | Consent test |
| 26 | `3997c7ff803c` | PICK | | Terminal hang |
| 27 | `dc6dda5c3796` | PICK | | SDK logging |
| 28 | `2da911e4a02e` | PICK | | /copy Windows |
| 29 | `8f0324d86890` | PICK | | Paste Windows |
| 30 | `a61fb058b7ca` | PICK | | writeTodo |
| 31 | `d2849fda8ad4` | PICK | | Keyboard modes |
| 32 | `687ca40b5093` | PICK | | Race condition fix |
| 33 | `588c1a6d1657` | PICK | | Rationale rendering |
| 34 | `59a18e710daa` | PICK | | Skills: docs |

## REIMPLEMENT Commits (30)

| # | Upstream SHA | Decision | LLxprt Commit(s) | Notes |
|---|-------------|----------|-------------------|-------|
| 1 | `dced409ac42d` | REIMPLEMENT | | Hooks: folder trust |
| 2 | `9c48cd849bb7` | REIMPLEMENT | | Hooks: security warning UI |
| 3 | `3b1dbcd42d8f` | REIMPLEMENT | | Env sanitization |
| 4 | `e6344a8c2478` | REIMPLEMENT | | Hooks: project warnings |
| 5 | `563d81e08e73` | REIMPLEMENT | | Extensions: install/uninstall |
| 6 | `37be16243557` | REIMPLEMENT | | Policy: granular allowlist |
| 7 | `dcd2449b1a16` | REIMPLEMENT | | Policy: deprecate legacy |
| 8 | `10ae84869a39` | REIMPLEMENT | | Console migration |
| 9 | `15c9f88da6df` | REIMPLEMENT | | Hooks: agent dedup |
| 10 | `ec79fe1ab269` | REIMPLEMENT | | Extensions: update notification |
| 11 | `ec11b8afbf38` | REIMPLEMENT | | Extensions: settings info |
| 12 | `90eb1e0281bf` | REIMPLEMENT | | Hooks: tool input mod |
| 13 | `05049b5abfae` | REIMPLEMENT | | Hooks: STOP_EXECUTION |
| 14 | `d3c206c6770d` | REIMPLEMENT | | Policy: unify shell security |
| 15 | `5566292cc83f` | REIMPLEMENT | | ToolScheduler: extract types |
| 16 | `b4b49e7029d3` | REIMPLEMENT | | ToolScheduler: extract executor |
| 17 | `4c67eef0f299` | REIMPLEMENT | | Extensions: missing settings |
| 18 | `7edd8030344e` | REIMPLEMENT | | Extensions: settings fallback |
| 19 | `6f4b2ad0b95a` | REIMPLEMENT | | Default folder trust |
| 20 | `881b026f2454` | REIMPLEMENT | | Tsconfig circular dep |
| 21 | `006de1dd318d` | REIMPLEMENT | | Security docs |
| 22 | `eec5d5ebf839` | REIMPLEMENT | | MessageBus Phase 1 |
| 23 | `90be9c35876d` | REIMPLEMENT | | MessageBus Phase 2 |
| 24 | `12c7c9cc426b` | REIMPLEMENT | | MessageBus Phase 3 |
| 25 | `dd84c2fb837a` | REIMPLEMENT | | Hooks: granular stop/block |
| 26 | `6d1e27633a32` | REIMPLEMENT | | Hooks: context injection |
| 27 | `61dbab03e0d5` | REIMPLEMENT | | Hooks: visual indicators |
| 28 | `56092bd78205` | REIMPLEMENT | | Hooks: hooks.enabled |
| 29 | `9172e2831542` | REIMPLEMENT | | Settings: descriptions |
| 30 | `2fe45834dde6` | REIMPLEMENT | | Settings: remote admin |

## SKIP Commits (45)

See CHERRIES.md SKIP table for full list with rationale.

## NO_OP Commits (12)

See CHERRIES.md NO_OP table for full list with rationale.
Note: Row 12 (`334b813d`) has a 1-line `yolo.toml` manual add done during PICK-B5.
