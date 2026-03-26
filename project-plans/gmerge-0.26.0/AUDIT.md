# Audit: gmerge/0.26.0

Post-implementation reconciliation. Updated continuously during execution.

## Legend

- **PICKED** — cherry-picked as-is (or with trivial conflict resolution)
- **REIMPLEMENTED** — adapted for LLxprt architecture
- **SKIPPED** — intentionally not ported
- **NO_OP** — LLxprt already has this or it's not applicable

## PICK Commits (22)

| Upstream SHA | Decision | LLxprt Commit | Notes |
|:------------:|----------|---------------|-------|
| c04af6c | PICKED | 8ef4487f0 | docs: clarify F12 — PASS |
| f6c2d61 | PICKED | (empty skip) | docs: Remove .md extension — target file absent, acceptable |
| c8c7b57 | PICKED | 93697af0e | skills project→workspace — PASS |
| 4848f42 | PICKED | 68384cf6e | skill colons — PASS |
| d0bbc7f | PICKED | 89a27bb44 | skill parsing hardening — PASS |
| 448fd3c | PICKED | (NO_OP) | circular dep tsconfig — LLxprt already had correct path |
| 6740886 | PICKED | (NO_OP) | prevent ModelInfo on aborted — LLxprt doesn't emit ModelInfo |
| be37c26 | PICKED | 99836347f | text buffer perf — PASS (+ LruCache.size, type annotations) |
| 41e01c2 | PICKED | d1ff2eb9f | PKCE/OAuth — PASS (+ static method fixes) |
| d8a8b43 | PICKED | 4478accbc | OSC-52 clipboard — PASS |
| a90bcf7 | PICKED | e45cfdb3c | /introspect command — PASS |
| 155d9aa | PICKED | (NO_OP) | fireSessionStartEvent — LLxprt handles via triggerSessionStartHook |
| 4920ad2 | PICKED | a8a282fd0 | docs themes — PASS |
| 166e04a | PICKED | cc6b6be76 | mcp instructions — PASS (+ refreshMcpContext fixup) |
| 88df621 | PICKED | aa87fd250 | hook exit code tests — PASS |
| 85b1716 | PICKED | 0f05bcaf4 | extension examples — PASS |
| b99e841 | PICKED | 98e0ca414 | Windows pty crash — PASS |
| 995ae42 | PICKED | d1998fe0e | DebugProfiler warnings — PASS |
| 2455f93 | PICKED | 37b4c79d2 | home/end keybinding — PASS |
| 55c2783 | PICKED | a522dcf83 | mcp http display — PASS |
| 9866eb0 | PICKED | 5e5308b37 | external editor fallback — PASS |
| 97aac69 | PICKED | c9f625505 | mcp tool lookup — PASS |

## REIMPLEMENT Commits (42)

| Upstream SHA | Decision | LLxprt Commit | Notes |
|:------------:|----------|---------------|-------|
| 3b55581 | REIMPLEMENTED | b56a039ef | extension config — PASS |
| a3234fb | REIMPLEMENTED | 038ec6682 | rootCommands — PASS |
| 09a7301 | REIMPLEMENTED | 756587f69 | remove \\x7f bindings — PASS |
| 94d5ae5 | REIMPLEMENTED | 893307fe9 | paste handling — PASS |
| 7e6817d | REIMPLEMENTED | (no-op) | stdin close cleanup — already present |
| 6021e4c | REIMPLEMENTED | fd040a143 | scheduler event types — PASS |
| fb76408 | REIMPLEMENTED | 9a5ce9e78 | sequence binding — PASS |
| a2dab14 | REIMPLEMENTED | 55feec847 | undeprecate --prompt — PASS |
| 42c26d1 | REIMPLEMENTED | 320696790 | improve keybindings — PASS |
| ae19802 | REIMPLEMENTED | a009d8b1f | shell parsing timeout — PASS |
| a81500a | REIMPLEMENTED | | skill install consent |
| 222b739 | REIMPLEMENTED | | skill conflict detection |
| f909c9e | REIMPLEMENTED | | policy source tracking |
| f7f38e2 | REIMPLEMENTED | 5e0fe9278 | **HIGH** non-nullable settings — PASS, FULL VERIFY |
| e77d7b2 | REIMPLEMENTED | 9b29e539a | OOM prevention — PASS |
| 8a627d6 | REIMPLEMENTED | 62f3ce394 | /dev/tty safety — PASS, FULL VERIFY |
| 1e8f87f | REIMPLEMENTED | 8f68d3b78 | MCPDiscoveryState — PASS |
| cfdc4cf | NO_OP | — | scheduleToolCalls race — already present in LLxprt |
| ce35d84 | REIMPLEMENTED | 7f5c40438 | organize keybindings — PASS |
| 9722ec9 | REIMPLEMENTED | 4180f7ba2 | hook event names — PASS, FULL VERIFY |
| 608da23 | REIMPLEMENTED | 5bf2581c4 | **HIGH** disable→enable settings — PASS |
| 1681ae1 | REIMPLEMENTED | 2dd155b87 | unify shell confirmation — PASS |
| 272570c | REIMPLEMENTED | de72ae2b4 | skills default enabled — PASS |
| 6900253 | REIMPLEMENTED | | keyboard shortcuts URL (was PICK) |
| 4cfbe4c | REIMPLEMENTED | | Homebrew detection (was PICK) |
| 1b6b6d4 | REIMPLEMENTED | | centralize tool mapping |
| 0bebc66 | REIMPLEMENTED | | rationale before tool calls (was PICK) |
| ec74134 | REIMPLEMENTED | | shell redirection security |
| 1182168 | REIMPLEMENTED | | enhanced compression |
| e92f60b | REIMPLEMENTED | | migrate hooks |
| 645e2ec | REIMPLEMENTED | | Ctrl+Enter/Ctrl+J |
| b288f12 | REIMPLEMENTED | | MCP client version |
| 211d2c5 | REIMPLEMENTED | | **HIGH** hooks event names split |
| aceb06a | REIMPLEMENTED | | newline fix |
| e1fd5be | REIMPLEMENTED | | Esc-Esc clear |
| 93ae777 | REIMPLEMENTED | | System scopes migration |
| 0fa9a54 | REIMPLEMENTED | | auth failure |
| ee87c98 | REIMPLEMENTED | | fast return buffer |
| cebe386 | REIMPLEMENTED | | **HIGH** MCP status hook |
| 2a3c879 | REIMPLEMENTED | | clearContext hooks |
| 43846f4 | REIMPLEMENTED | | package.ts error |
| d8e9db3 | REIMPLEMENTED | | package.ts follow-up |

## SKIP Commits (85)

See CHERRIES.md SKIP table (76 original + 9 added during review).

## NO_OP Commits (5)

| Upstream SHA | Decision | Notes |
|:------------:|----------|-------|
| c8d7c09 | NO_OP | tokenCalculation.ts missing; added to #1648 |
| 0a6f2e0 | NO_OP | LLxprt already has thought detection fix |
| 31c6fef | NO_OP | Skills already at stable in LLxprt |
| 013a4e0 | NO_OP | LLxprt already has safePtyDestroy() (was PICK) |
| 52fadba | NO_OP | LLxprt never emits ModelInfo; filed #1770 (was REIMPLEMENT) |
