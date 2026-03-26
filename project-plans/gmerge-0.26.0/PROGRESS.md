# Progress: gmerge/0.26.0

## PICK Batches

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit | Notes |
|------:|------|-----------------|--------|---------------|-------|
| P1 | PICK x5 | c04af6c f6c2d61 c8c7b57 4848f42 d0bbc7f | DONE | 8ef4487f0, 93697af0e, 68384cf6e, 89a27bb44 | docs + skills (f6c2d61 empty-skipped: docs/architecture.md not in LLxprt) |
| P2 | PICK x5 | 448fd3c 6740886 be37c26 41e01c2 d8a8b43 | DONE | 99836347f, d1ff2eb9f, 4478accbc, b72c08dc3 | core fixes + UI perf (448fd3c+6740886 NO_OP; LruCache.size added; OAuth static fix) |
| P3 | PICK x5 | a90bcf7 155d9aa 4920ad2 166e04a 88df621 | DONE | e45cfdb3c, a8a282fd0, cc6b6be76, aa87fd250, 2b524443e | commands + hooks + mcp (155d9aa NO_OP: LLxprt handles differently) |
| P4 | PICK x5 | 85b1716 b99e841 995ae42 2455f93 55c2783 | TODO | | extensions + pty + UI + mcp |
| P5 | PICK x2 | 9866eb0 97aac69 | TODO | | editor fallback + mcp lookup |

## REIMPLEMENT Batches

| Batch | Type | Upstream SHA | Status | LLxprt Commit | Notes |
|------:|------|-------------|--------|---------------|-------|
| R1 | REIMPLEMENT | 3b55581 | TODO | | extension config |
| R2 | REIMPLEMENT | a3234fb | TODO | | rootCommands |
| R3 | REIMPLEMENT | 09a7301 | TODO | | remove \x7f bindings |
| R4 | REIMPLEMENT | 94d5ae5 | TODO | | paste handling |
| R5 | REIMPLEMENT | 7e6817d | TODO | | stdin close cleanup |
| R6 | REIMPLEMENT | 6021e4c | TODO | | scheduler event types |
| R7 | REIMPLEMENT | fb76408 | TODO | | sequence binding |
| R8 | REIMPLEMENT | a2dab14 | TODO | | undeprecate --prompt |
| R9 | REIMPLEMENT | 42c26d1 | TODO | | improve keybindings |
| R10 | REIMPLEMENT | ae19802 | TODO | | shell parsing timeout |
| R11 | REIMPLEMENT | a81500a | TODO | | skill install consent |
| R12 | REIMPLEMENT | 222b739 | TODO | | skill conflict detection |
| R13 | REIMPLEMENT | f909c9e | TODO | | policy source tracking |
| R14 | REIMPLEMENT | f7f38e2 | TODO | | **HIGH RISK** non-nullable settings (59 files) |
| R15 | REIMPLEMENT | e77d7b2 | TODO | | OOM prevention |
| R16 | REIMPLEMENT | 8a627d6 | TODO | | /dev/tty safety |
| R17 | REIMPLEMENT | 1e8f87f | TODO | | MCPDiscoveryState |
| R18 | REIMPLEMENT | cfdc4cf | TODO | | scheduleToolCalls race |
| R19 | REIMPLEMENT | ce35d84 | TODO | | organize keybindings |
| R20 | REIMPLEMENT | 9722ec9 | TODO | | hook event names |
| R21 | REIMPLEMENT | 608da23 | TODO | | **HIGH RISK** disable→enable settings (22+ files) |
| R22 | REIMPLEMENT | 1681ae1 | TODO | | unify shell confirmation |
| R23 | REIMPLEMENT | 272570c | TODO | | skills default enabled |
| R24 | REIMPLEMENT | 6900253 | TODO | | keyboard shortcuts URL |
| R25 | REIMPLEMENT | 4cfbe4c | TODO | | Homebrew detection |
| R26 | REIMPLEMENT | 1b6b6d4 | TODO | | centralize tool mapping |
| R27 | REIMPLEMENT | 0bebc66 | TODO | | rationale before tool calls |
| R28 | REIMPLEMENT | ec74134 | TODO | | shell redirection security |
| R29 | REIMPLEMENT | 1182168 | TODO | | enhanced compression |
| R30 | REIMPLEMENT | e92f60b | TODO | | migrate hooks |
| R31 | REIMPLEMENT | 645e2ec | TODO | | Ctrl+Enter/Ctrl+J |
| R32 | REIMPLEMENT | b288f12 | TODO | | MCP client version |
| R33 | REIMPLEMENT | 211d2c5 | TODO | | **HIGH RISK** hooks event names split |
| R34 | REIMPLEMENT | aceb06a | TODO | | newline fix |
| R35 | REIMPLEMENT | e1fd5be | TODO | | Esc-Esc clear |
| R36 | REIMPLEMENT | 93ae777 | TODO | | System scopes migration |
| R37 | REIMPLEMENT | 0fa9a54 | TODO | | auth failure |
| R38 | REIMPLEMENT | ee87c98 | TODO | | fast return buffer |
| R39 | REIMPLEMENT | cebe386 | TODO | | **HIGH RISK** MCP status hook |
| R40 | REIMPLEMENT | 2a3c879 | TODO | | clearContext hooks |
| R41 | REIMPLEMENT | 43846f4 | TODO | | package.ts error |
| R42 | REIMPLEMENT | d8e9db3 | TODO | | package.ts follow-up |
