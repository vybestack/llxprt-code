# Notes: gmerge/0.26.0

Running notes during batch execution. Append after each batch.

---

## Pre-Execution Notes (2026-03-25)

- Human review changed 17 decisions from initial audit
- 3 A2A server picks deferred to #1675
- ModelInfo dedup (52fadba) → NO_OP; filed #1770 for profile-aware model info
- PTY leak fix (013a4e0) → NO_OP; LLxprt already has safePtyDestroy()
- Hooks disable fix (1998a71) → SKIP; LLxprt already has correct behavior
- 4 HIGH RISK REIMPLEMENTs identified: f7f38e2 (59 files), 608da23 (22+ files), 211d2c5 (hooks schema), cebe386 (MCP status hook)
- Keybinding chain dependency: 09a7301 → fb76408 → 42c26d1 → ce35d84 (all REIMPLEMENT, solo batches in order)
- Skills chain dependency: 4848f42 (PICK) → 222b739 (REIMPLEMENT)
- Package.ts chain: 43846f4 → d8e9db3 (consecutive REIMPLEMENTs)

---

## Batch P1 (2026-03-25)

- c04af6c: Applied with conflict resolution in 3 files; docs/get-started/configuration.md excluded (not in LLxprt). F12 info added to troubleshooting.md.
- f6c2d61: Empty cherry-pick — only touched docs/architecture.md which doesn't exist in LLxprt. Acceptable skip.
- c8c7b57: "project" → "workspace" terminology applied across skill scope strings in disable.ts, skillUtils.ts, skillManager.ts and tests.
- 4848f42: Clean apply. YAML colon handling with parseFrontmatter/parseSimpleFrontmatter.
- d0bbc7f: Conflict resolved — preserved LLxprt's `source` property while taking upstream's `match[2]?.trim() ?? ''` safety.
- Lint: 0 errors (warnings only), typecheck: clean.

## Batch P2 (2026-03-25)

- 448fd3c: Empty NO_OP — LLxprt already had correct @vybestack/llxprt-code-core tsconfig path.
- 6740886: Empty NO_OP — LLxprt doesn't emit ModelInfo events.
- be37c26: Applied. Needed LruCache.size property added to core (upstream's mnemoist exposes it, LLxprt's wrapper didn't). Also added type annotations for destructured forEach callbacks to fix implicit any errors. Required core tsc --build before CLI typecheck succeeds.
- 41e01c2: Applied. getPortFromUrl and startCallbackServer needed to be made static (LLxprt's authenticate is static, upstream's is instance). Test calls updated from instance to static.
- d8a8b43: Applied cleanly.
- Full verify: lint clean, typecheck clean, 514 test files pass, build clean, smoke test passes.

## Batch P3 (2026-03-25)

- a90bcf7: Applied. /introspect command TOML at .gemini/commands/introspect.toml. Branding fix: GEMINI.md→LLXPRT.md.
- 155d9aa: Empty NO_OP — LLxprt already handles fireSessionStartEvent return type via triggerSessionStartHook in lifecycleHookTriggers.ts.
- 4920ad2: Applied cleanly. DiffModified removed from theme docs.
- 166e04a: Applied with conflicts. Added refreshMcpContext() using LLxprt's refreshMemory(). scheduleMcpContextRefresh() debounce added. Updated instruction format.
- 88df621: Applied with modify/delete conflict resolved. Hook exit code test coverage using TestRig, provider-agnostic.
- Quick verify: lint 0 errors, typecheck clean.

## Batch P4 (2026-03-25)

- 85b1716: Applied with conflicts. Extension examples branding fixed (Gemini CLI→LLxprt Code). eslint.config.js merged.
- b99e841: Applied with conflicts. Windows PTY crash fix merged with LLxprt's existing uncaughtException handling.
- 995ae42: Applied with conflicts. DebugProfiler coreEvents/AppEvent registration. Cast to base EventEmitter for type compat.
- 2455f93: Applied with conflicts. home/end keybinding ctrl:false/shift:false. Preserved LLxprt-specific bindings (TOGGLE_TODO_DIALOG, etc.).
- 55c2783: Applied with conflicts. MCP list 'http' type display.
- Fixed: disable.test.ts message updated ("Restart required to take effect."), DebugProfiler test uses AppEvent.OpenDebugConsole, MCP list test mocks.
- Full verify: typecheck clean, core 514 tests pass, CLI specific areas pass (auth 45 pass, commands 28 pass), format clean, build clean, smoke test passes.

## Batch P5 (2026-03-25)

- 9866eb0: Applied cleanly. Operator precedence fix in text-buffer.ts external editor fallback.
- 97aac69: Applied with conflicts. getFullyQualifiedName()/getFullyQualifiedPrefix() added to mcp-tool.ts. MCP fallback lookup integrated into LLxprt's getTool() as 3rd lookup path after normalizeToolName.
- Quick verify: typecheck clean.

---


## Batch R14 (2026-03-25) - HIGH RISK

- Created MergedSettings type with NonNullable wrappers for 7 sub-objects
- mergeSettings() now explicitly constructs security, telemetry, mcp, tools sub-objects
- Removed 63 optional chaining patterns across 22 source files
- Fixed broken raw-newline string literals in consent.ts from R11
- Fixed R13 policy source tracking test expectations
- Fixed R11 install.test.ts mock (LruCache export, extra consent callback arg)
- Updated test mocks with required ui sub-object
- FULL VERIFY: lint 0 errors, typecheck clean, core 514 pass, CLI 336 pass, format/build/smoke clean

---
