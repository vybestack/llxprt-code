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
| TS-B1 | 00a, 01, 01a | TODO | | Preflight + extract types |
| TS-B2 | 02, 02a | TODO | | Re-exports |
| TS-B3 | 03, 03a | TODO | | Characterize tool execution |
| TS-B4 | 04, 04a | TODO | | Extract ToolExecutor |
| TS-B5 | 05, 05a | TODO | | Extract response formatting |

## Phase C: MessageBus DI REIMPLEMENT

| Batch | Phases | Status | LLxprt Commit | Notes |
|------:|--------|--------|---------------|-------|
| MB-B1 | 00a, 01, 01a | TODO | | Preflight + optional params |
| MB-B2 | 02, 02a | TODO | | Standardize constructors |
| MB-B3 | 03, 03a | TODO | | Mandatory injection (31 files) |

## Phase D: SHA-Plan Playbook REIMPLEMENTs

| Batch | Playbook(s) | Status | LLxprt Commit | Notes |
|------:|-------------|--------|---------------|-------|
| RE-B1 | `3b1dbcd4` | TODO | | Env sanitization |
| RE-B2 | `6f4b2ad0`, `881b026f` | TODO | | Folder trust + tsconfig |
| RE-B3 | `dced409a`, `e6344a8c`, `15c9f88d` | TODO | | Hooks infra |
| RE-B4 | `90eb1e02`, `05049b5a`, `dd84c2fb` | TODO | | Hooks core |
| RE-B5 | `6d1e2763`, `61dbab03`, `56092bd7`, `9c48cd84` | TODO | | Hooks UI |
| RE-B6 | `37be1624`, `dcd2449b`, `d3c206c6` | TODO | | Policy |
| RE-B7 | `563d81e0`, `ec79fe1a`, `ec11b8af`, `4c67eef0`, `7edd8030` | TODO | | Extensions |
| RE-B8 | `9172e283`, `2fe45834` | TODO | | Settings |
| RE-B9 | `006de1dd` | TODO | | Security docs |
| RE-B10 | `10ae8484` | TODO | | Console migration (47 files) |

## Phase E: Final

| Batch | Status | LLxprt Commit | Notes |
|------:|--------|---------------|-------|
| FINAL-verify | TODO | | Full verification suite |
| FINAL-docs | TODO | | Update tracking docs |
| FINAL-pr | TODO | | PR + CI + CodeRabbit |
