# Progress Tracker: gmerge-0.24.5

## Phase A: Cherry-Picks (34 PICK commits)

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit | Notes |
|------:|------|-----------------|--------|---------------|-------|
| PICK-B1 | PICK×5 | `0a216b28`, `b0d5c4c0`, `e9a601c1`, `b6b0727e`, `5f286147` | TODO | | EIO, dynamic policy, MCP type, schema, resources |
| PICK-B2 | PICK×5 | `873d10df`, `56b05042`, `acecd80a`, `21388a0a`, `0eb84f51` | TODO | | Terse images, typo, IDE, GitService, integration |
| PICK-B3 | PICK×5 | `de1233b8`, `958284dc`, `764b1959`, `e78c3fe4`, `f0a039f7` | TODO | | Skills 1-5 (branding changes needed) |
| PICK-B4 | PICK×4 | `bdb349e7`, `d3563e2f`, `2cb33b2f`, `0c541362` | TODO | | Skills 6-9 |
| PICK-B5 | PICK×2 | `5f027cb6`, `59a18e71` + yolo.toml manual | TODO | | Skills 10-11 + yolo.toml |
| PICK-B6 | PICK×5 | `8a0190ca`, `18fef0db`, `0f3555a4`, `30f5c4af`, `615b218f` | TODO | | MCP, shell, /dir, powershell, consent |
| PICK-B7 | PICK×5 | `3997c7ff`, `dc6dda5c`, `2da911e4`, `8f0324d8`, `a61fb058` | TODO | | Terminal, SDK, /copy, paste, writeTodo |
| PICK-B8 | PICK×3 | `d2849fda`, `687ca40b`, `588c1a6d` | TODO | | Keyboard, race condition, rationale |

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
