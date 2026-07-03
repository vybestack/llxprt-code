# Pseudocode: Boundary Checker Replacement

Plan ID: PLAN-20260629-ISSUE2285
Component: scripts/check-cli-import-boundary.mjs (PUBLIC_AGENT_SYMBOLS removal)

## Interface Contracts

```
INPUT: packages/cli/src production source files
OUTPUT: violations list (deep imports, internals subpath, getConfig escape-hatch, ...)
```

## Numbered pseudocode

```
10: METHOD analyzeFile(filePath)
20:   sourceFile = read(filePath)
30:   violations = []
40:   FOR each import node in sourceFile:
50:     specifier = extractSpecifier(node)
60:     // Deep import check (UNCHANGED from current)
70:     IF isDisallowedDeepImport(specifier):
80:       IF NOT isAllowed(relFile, specifier):
90:         violations.push({ specifier, kind: classifyKind(node) })
100:    // REMOVED: bare agents-root symbol check (PUBLIC_AGENT_SYMBOLS deleted)
110:    // The bare root '@vybestack/llxprt-code-agents' is now ALWAYS allowed at
120:    // the specifier level because the root is curated by the API-surface guard.
130:    // If an internal name leaks back into the root, the API-surface guard
140:    // catches it (declaration-aware), NOT this checker.
150:    // Non-literal vi.mock detection (UNCHANGED)
160:    IF isNonLiteralViMock(node):
170:      violations.push({ kind: 'vi.mock-non-literal' })
180:  // getConfig escape-hatch scan (UNCHANGED)
190:  getConfigHits = scanGetConfigEscapeHatch(sourceFile)
200:  violations.push(...getConfigHits)
210:  RETURN violations
220: ENDMETHOD
```

## Preflight confirmation (authoritative — see preflight-results.md §2, §6)

P01 preflight CONFIRMED:

1. **Internals subpath already forbidden by deep-import rule.** Today the ONLY
   consumers of `@vybestack/llxprt-code-agents/internals.js` are three files
   inside `packages/agents/src/api/__tests__/` (two test imports + one string
   constant) — NO production CLI or A2A source imports it. The current
   `PUBLIC_SUBPATHS_BY_PACKAGE['@vybestack/llxprt-code-agents']` list is empty
   for agents, so `.../internals.js` is ALREADY a deep-import violation. No
   new logic is needed to forbid it; removing `PUBLIC_AGENT_SYMBOLS` does NOT
   weaken this.
2. **Production CLI is already clean** (no internals-only root imports today —
   all production CLI bare-root imports use public symbols). The
   `PUBLIC_AGENT_SYMBOLS` removal does not break production CLI because the
   actual production imports already use only public symbols.
3. **CLI test compile-breakers (9 files)** migrate to the internals subpath
   (P04). The boundary checker still allows the internals subpath for TEST
   files (tests may use internals; only production CLI source is forbidden).

## What changes

- DELETE: `PUBLIC_AGENT_SYMBOLS` constant.
- DELETE: `AGENTS_PACKAGE_ROOT` bare-root symbol check block in `analyzeFile`.
- DELETE: `importedSymbolsOf` function (no longer needed for symbol check).
- KEEP: `isDisallowedDeepImport`, `PUBLIC_SUBPATHS_BY_PACKAGE`, `ALLOWLIST`,
  self-pruning freshness guard, getConfig scan, non-literal vi.mock detection,
  thin-entry guard, namespace/default import handling IF still needed.

Wait — the internals subpath must be FORBIDDEN in production CLI. Current
`isDisallowedDeepImport` already flags any `@vybestack/llxprt-code-agents/<subpath>`
that is NOT in `PUBLIC_SUBPATHS_BY_PACKAGE['@vybestack/llxprt-code-agents']`.
Currently that list is empty for agents, so `.../internals.js` is ALREADY a deep
import violation. **CONFIRMED by P01 preflight (preflight-results.md §6): the
internals subpath is already forbidden by the deep-import rule; no new logic is
needed.**

## What stays

```
300: // internals.js is a deep subpath NOT in PUBLIC_SUBPATHS_BY_PACKAGE[agents]
310: // so isDisallowedDeepImport('.../internals.js') returns true ALREADY
320: // The only change is removing the symbol-level bare-root check.
```

## Fixture test updates (CLI_BOUNDARY_ROOT) — finalized against preflight

```
400: // OLD tests (REMOVE or CONVERT):
410: //   "flags importing AgentClient from bare root" — bare root is now allowed
420: //   at specifier level; the import fails at TYPECHECK, not boundary check.
430: // NEW tests (ADD):
440: //   "flags importing from agents internals.js subpath" (deep import)
450: //   "allows bare agents root import" (specifier-level, always)
460: //   "flags deep agents source path import" (deep import)
470: KEEP: getConfig, vi.mock, thin-entry, public subpath, self-pruning tests
```

### Preflight-confirmed consumer conversion list (from preflight-results.md §2-§4)

Production CLI source: NO conversions needed (already clean — all bare-root
imports use public symbols per preflight §2.1).

Production A2A server (4 compile-breakers — migrate in P04, NOT here):
- `packages/a2a-server/src/config/config.ts` — `AgentClient`,
  `CoreToolScheduler`, `createTaskToolRegistration` → public factories
  (`createAgentClient`, `createToolScheduler`); `createTaskToolRegistration`
  stays a curated root export.
- `packages/a2a-server/src/agent/task.ts` — `AgentClient` (value) →
  `createAgentClient`; field type → `AgentClientContract` (core).
- `packages/a2a-server/src/agent/task-runtime-helpers.ts` — type `AgentClient`
  → `AgentClientContract` (core).
- `packages/a2a-server/src/utils/testing_utils.ts` — type `CoreToolScheduler`
  → `ToolSchedulerContract` (core).

CLI test compile-breakers (9 files — migrate to internals subpath in P04):
- `integration-tests/test-utils.ts` — `AgentClient`, `CoreToolScheduler`,
  `createTaskToolRegistration`
- `integration-tests/todo-continuation.integration.test.ts` — `AgentClient`,
  type `Turn`
- `ui/hooks/useTodoContinuation.spec.ts` — `AgentClient as AgentClientClass`
- `ui/hooks/useToolScheduler.test.ts` — type `CoreToolScheduler`
- `ui/hooks/useToolScheduler.part{2,3,4,5}.test.ts` — type `CoreToolScheduler`
- `ui/hooks/geminiStream/__tests__/useAgenticLoop.test.tsx` — `CoreToolScheduler`

NOTE: `App.{behavior,context,test,components,dialogs}.test.tsx` import
`AgentClient` from `@vybestack/llxprt-code-core` (NOT agents root) — they do
NOT break from depollution (preflight §4 confirmed).

The boundary checker does NOT need new allowlist entries for any of the above:
tests that use the internals subpath are NOT production CLI source, so the
deep-import rule permits them (the rule scopes to production source paths
under `packages/cli/src` non-test, per the existing checker architecture).

## Anti-pattern warnings

```
[ERROR] DO NOT: keep PUBLIC_AGENT_SYMBOLS as a different name — that is the
         same hidden allowlist
[OK] DO: delete the symbol check entirely; rely on API-surface guard + typecheck

[ERROR] DO NOT: add agents internals.js to PUBLIC_SUBPATHS_BY_PACKAGE for CLI
[OK] DO: keep it as a deep import violation for production CLI
```
