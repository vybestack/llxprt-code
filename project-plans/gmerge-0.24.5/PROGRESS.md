# Progress Tracker: gmerge-0.24.5

## Phase A: Cherry-Picks (34 PICK commits)

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit | Notes |
|------:|------|-----------------|--------|---------------|-------|
| PICK-B1 | PICK×2 | `0a216b28`, `e9a601c1` | DONE | `77d400cb0`, `1edf8b902`, `df76e9067` | 2/5 picked. b0d5c4c0→REIMPLEMENT, b6b0727e→REIMPLEMENT, 5f286147→SKIP |
| PICK-B2 | PICK×3 | `56b05042`, `acecd80a`, `21388a0a` | DONE | `31d67db0a`, `768747190`, `11abb491e` | 3/5 picked. 873d10df->REIMPLEMENT, 0eb84f51->SKIP |
| PICK-B3 | PICK×5 | `de1233b8`, `958284dc`, `764b1959`, `e78c3fe4`, `f0a039f7` | DONE | `4989cded7`, `50b5e9cfd`, `aa7c0b456`, `6015c7e60`, `fe31e61c3`, fix `d94355b84`, `1e6c23f84` | Skills 1-5: branding .gemini→.llxprt, @google→@vybestack; lint --fix for type assertion ripple |
| PICK-B4 | PICK×4 | `bdb349e7`, `d3563e2f`, `2cb33b2f`, `0c541362` | DONE | `bfc4670ac`, `464c9db2c`, `a04ab3e11`, `3dcc9871e`, fix `65621d379` | Skills 6-9: consent.ts rewrite (merged hook+skills consent), extension-manager deleted (LLxprt modularized), debugLogger compat shim, SettingsChanged overloads |
| PICK-B5 | PICK×2 | `5f027cb6`, `59a18e71` + yolo.toml manual | DONE | `9987f48e4`, `5925aa745`, fix `e4d5526e9` | Skills docs + yolo.toml allow_redirection. Docs branding applied. |
| PICK-B6 | PICK×2 | `8a0190ca`, `615b218f` | DONE | `f92cf4259`, `6e30c5b9e`, fix `52ee3ffe1` | 2/5 picked. 18fef0db→REIMPLEMENT (shell redirection, 12 conflicts), 0f3555a4→REIMPLEMENT (/dir add, modify/delete), 30f5c4af→SKIP (powershell mock, shell area diverged) |
| PICK-B7 | PICK×3 | `3997c7ff`, `2da911e4`, `a61fb058` | DONE | `3c72fe53a`, `27f70ed00`, `c3d0791f3` | 3/5 picked. dc6dda5c→SKIP (SDK logging, loggingContentGenerator diverged), 8f0324d8→REIMPLEMENT (paste fix, 13 conflicts incl. modify/delete) |
| PICK-B8 | PICK×2 | `687ca40b`, `588c1a6d` | DONE | `9a22e0a72`, `df0360331`, fix `e57777dba` | 2/3 picked. d2849fda→REIMPLEMENT (keyboard modes, depends on paste infra). Race condition fix: merged dedup+await+rationale flush. |

## Phase B: ToolScheduler REIMPLEMENT

| Batch | Phases | Status | LLxprt Commit | Notes |
|------:|--------|--------|---------------|-------|
| TS-B1 | 00a, 01, 01a | DONE | `bd634d166` | Preflight + extract types |
| TS-B2 | 02, 02a | DONE | `327699504` | Re-exports |
| TS-B3 | 03, 03a | DONE | `9fe274491` | Characterize tool execution |
| TS-B4 | 04, 04a | DONE | `46a54fba2` | Extract ToolExecutor |
| TS-B5 | 05, 05a | DONE | `197333813` | Extract response formatting |

## Phase C: MessageBus DI REIMPLEMENT

| Batch | Phases | Status | LLxprt Commit | Notes |
|------:|--------|--------|---------------|-------|
| MB-B1 | 00a, 01, 01a | DONE | `d67aa88ea` | Preflight + optional params |
| MB-B2 | 02, 02a | DONE | remediation session | Standardize constructors — completed as part of D01 remediation (26 phases) |
| MB-B3 | 03, 03a | DONE | remediation session | Mandatory injection — Config no longer owns/creates MessageBus; explicit DI is mandatory |

## Phase D: SHA-Plan Playbook REIMPLEMENTs

| Batch | Playbook(s) | Status | LLxprt Commit | Notes |
|------:|-------------|--------|---------------|-------|
| RE-B1 | `3b1dbcd4` | DONE | `87952e5fe` | Env sanitization |
| RE-B2 | `6f4b2ad0`, `881b026f` | DONE | `0331e90bb` | Folder trust + tsconfig |
| RE-B3 | `dced409a`, `e6344a8c`, `15c9f88d` | DONE | `393ea0d81` | Hooks infra |
| RE-B4 | `90eb1e02`, `05049b5a`, `dd84c2fb` | DONE | `09970d2ed` | Hooks core |
| RE-B5 | `6d1e2763`, `61dbab03`, `56092bd7`, `9c48cd84` | DONE | `59dfed20f` | Hooks UI |
| RE-B6 | `37be1624`, `dcd2449b`, `d3c206c6` | DONE | `1733b5897` | Policy |
| RE-B7 | `563d81e0`, `ec79fe1a`, `ec11b8af`, `4c67eef0`, `7edd8030` | DONE | `0029c7618` | Extensions |
| RE-B8 | `9172e283`, `2fe45834` | DONE | `5c5c1dd4d` | Settings |
| RE-B9 | `006de1dd` | DONE | `2077ff60e` | Security docs |
| RE-B10 | `10ae8484` | DONE | `eff4e88e4`, fix `6f137d731`, `1e92130c2` | Console → debugLogger migration (47 files) |

## Phase E: Final

| Batch | Status | LLxprt Commit | Notes |
|------:|--------|---------------|-------|
| FINAL-verify | DONE | — | Typecheck, lint, and targeted test suites pass |
| FINAL-docs | DONE | — | This file updated to reflect actual branch state |
| FINAL-pr | PENDING | — | PR + CI + CodeRabbit still needed |
