# Progress: gmerge/0.26.0

## PICK Batches

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit | Notes |
|------:|------|-----------------|--------|---------------|-------|
| P1 | PICK x5 | c04af6c f6c2d61 c8c7b57 4848f42 d0bbc7f | DONE | 8ef4487f0, 93697af0e, 68384cf6e, 89a27bb44 | docs + skills (f6c2d61 empty-skipped: docs/architecture.md not in LLxprt) |
| P2 | PICK x5 | 448fd3c 6740886 be37c26 41e01c2 d8a8b43 | DONE | 99836347f, d1ff2eb9f, 4478accbc, b72c08dc3 | core fixes + UI perf (448fd3c+6740886 NO_OP; LruCache.size added; OAuth static fix) |
| P3 | PICK x5 | a90bcf7 155d9aa 4920ad2 166e04a 88df621 | DONE | e45cfdb3c, a8a282fd0, cc6b6be76, aa87fd250, 2b524443e | commands + hooks + mcp (155d9aa NO_OP: LLxprt handles differently) |
| P4 | PICK x5 | 85b1716 b99e841 995ae42 2455f93 55c2783 | DONE | 0f05bcaf4, 98e0ca414, d1998fe0e, 37b4c79d2, a522dcf83, 4a6e65266 | extensions + pty + UI + mcp |
| P5 | PICK x2 | 9866eb0 97aac69 | DONE | 5e5308b37, c9f625505 | editor fallback + mcp lookup |

## REIMPLEMENT Batches

| Batch | Type | Upstream SHA | Status | LLxprt Commit | Notes |
|------:|------|-------------|--------|---------------|-------|
| R1 | REIMPLEMENT | 3b55581 | DONE | b56a039ef | extension config |
| R2 | REIMPLEMENT | a3234fb | DONE | 038ec6682 | rootCommands |
| R3 | REIMPLEMENT | 09a7301 | DONE | 756587f69 | remove \\x7f bindings |
| R4 | REIMPLEMENT | 94d5ae5 | DONE | 893307fe9 | paste handling |
| R5 | REIMPLEMENT | 7e6817d | DONE | (no-op) | stdin close cleanup — already present in LLxprt |
| R6 | REIMPLEMENT | 6021e4c | DONE | fd040a143 | scheduler event types |
| R7 | REIMPLEMENT | fb76408 | DONE | 9a5ce9e78 | sequence binding |
| R8 | REIMPLEMENT | a2dab14 | DONE | 55feec847 | undeprecate --prompt |
| R9 | REIMPLEMENT | 42c26d1 | DONE | 320696790 | improve keybindings |
| R10 | REIMPLEMENT | ae19802 | DONE | a009d8b1f | shell parsing timeout |
| R11 | REIMPLEMENT | a81500a | DONE | b40cfc34e | skill install consent |
| R12 | REIMPLEMENT | 222b739 | DONE | fbdad473a | skill conflict detection |
| R13 | REIMPLEMENT | f909c9e | DONE | ab08dd4fe | policy source tracking |
| R14 | REIMPLEMENT | f7f38e2 | DONE | 5e0fe9278 | **HIGH RISK** non-nullable settings — 33 files changed, MergedSettings type, 63 ?. removals |
| R15 | REIMPLEMENT | e77d7b2 | DONE | 9b29e539a | OOM prevention — maxFiles/timeout in crawler |
| R16 | REIMPLEMENT | 8a627d6 | DONE | 62f3ce394 | /dev/tty safety — async pickTty with timeout |
| R17 | REIMPLEMENT | 1e8f87f | DONE | 8f68d3b78 | MCPDiscoveryState tracking |
| R18 | REIMPLEMENT | cfdc4cf | DONE (NO_OP) | — | scheduleToolCalls race — already present in LLxprt |
| R19 | REIMPLEMENT | ce35d84 | DONE | 7f5c40438 | organize keybindings (chain 4/4) |
| R20 | REIMPLEMENT | 9722ec9 | DONE | 4180f7ba2 | hook event name validation (chain 1/4) |
| R21 | REIMPLEMENT | 608da23 | DONE | 5bf2581c4 | **HIGH RISK** disable→enable settings (21 files) |
| R22 | REIMPLEMENT | 1681ae1 | DONE | 2dd155b87 | unify shell confirmation |
| R23 | REIMPLEMENT | 272570c | DONE | de72ae2b4 | skills default enabled |
| R24 | REIMPLEMENT | 6900253 | DONE | 234a2255f | keyboard shortcuts URL |
| R25 | REIMPLEMENT | 4cfbe4c | DONE | 76bc50193 | Homebrew detection |
| R26 | REIMPLEMENT | 1b6b6d4 | DONE | 895be1e83 | centralize tool mapping |
| R27 | REIMPLEMENT | 0bebc66 | NO_OP | — | rationale flush already present in LLxprt |
| R28 | REIMPLEMENT | ec74134 | DONE | c1d5aec22 | shell redirection security |
| R29 | REIMPLEMENT | 1182168 | DONE | 5393ce6d0 | enhanced compression |
| R30 | REIMPLEMENT | e92f60b | DONE | 44c3d484e | migrate hooks |
| R31 | REIMPLEMENT | 645e2ec | DONE | e62e45099 | Ctrl+Enter/Ctrl+J |
| R32 | REIMPLEMENT | b288f12 | DONE | bc456e0e2 | MCP client version |
| R33 | REIMPLEMENT | 211d2c5 | DONE | d160f64ef | **HIGH RISK** hooks event names split |
| R34 | REIMPLEMENT | aceb06a | DONE | 0ab20d705 | newline fix |
| R35 | REIMPLEMENT | e1fd5be | DONE | ca2b2eaa3 | Esc-Esc clear |
| R36 | REIMPLEMENT | 93ae777 | DONE | 1d60766c2 | System scopes migration |
| R37 | REIMPLEMENT | 0fa9a54 | DONE | 3ae52cbd1 | auth failure |
| R38 | REIMPLEMENT | ee87c98 | DONE | cd3a71bf4 | fast return buffer |
| R39 | REIMPLEMENT | cebe386 | DONE | 54ea7b615 | **HIGH RISK** MCP status hook |
| R40 | REIMPLEMENT | 2a3c879 | DONE | 2b98926f5 | clearContext hooks |
| R41 | REIMPLEMENT | 43846f4 | DONE | 777226143 | package.ts error |
| R42 | REIMPLEMENT | d8e9db3 | DONE | 829ff6adf | package.ts follow-up |


## Post-Audit Remediation

| Batch | Type | Scope | Status | LLxprt Commit | Notes |
|------:|------|-------|--------|---------------|-------|
| R-AUDIT | FIXUP | gmerge/0.26.0 deep review findings | DONE | 201a5303e | Addressed flagged FAIL/CONCERN items and re-ran full verification chain |
