# Runtime Factory Contract — Type-Proof (Single-Source)

/**
 * @plan PLAN-20260629-ISSUE2285.P08
 * @requirement REQ-005
 */

Plan ID: PLAN-20260629-ISSUE2285
Phase: P08 (type-proof / guard — BEFORE P09 production migration)
Decision branch: `single-source` (per
`project-plans/issue2285/analysis/runtime-factory-contract-decision.md`).

This document is the migration type-proof for the `single-source` decision.
It records the exact core target module, the exact core root re-export path,
the dependency/no-cycle proof, the exact P09 import statements, and the
executable structural typecheck proof output. Because the decision is
`single-source`, NO drift guard is required — P09 produces one source of
truth in core, eliminating the second copy that could drift.

## 1. Exact core module where `AgentRuntimeFactoryBindings` will be added in P09

**Target module:** `packages/core/src/core/clientContract.ts`

Rationale: `clientContract.ts` already owns `AgentClientFactory` (line 127)
and `AgentClientContract` (line 67) — the central factory type and return
contract of the binding's `agentClientFactory` member. It already imports
`Config` (`../config/config.js`, line 42) and `AgentRuntimeState`
(`../runtime/AgentRuntimeState.js`, line 43). Adding the aggregation
interface here requires only two additional type-only imports of the other
constituent contract types (which live in sibling/adjacent core modules),
keeping the binding next to the contract it primarily binds.

The interface will be composed purely from core-owned constituent types:

| Member | Constituent type | Core source module |
|--------|------------------|--------------------|
| `agentClientFactory` | `AgentClientFactory` | `packages/core/src/core/clientContract.ts:127` |
| `toolSchedulerFactory` | `ToolSchedulerFactory` | `packages/core/src/core/toolSchedulerContract.ts:107` |
| `taskToolRegistration` | `() => TaskToolRegistration` | `packages/core/src/config/toolRegistryFactory.ts:86` |

No core-internal cycle is introduced: `toolRegistryFactory.ts` does NOT import
`clientContract.ts` or `toolSchedulerContract.ts`, and `toolSchedulerContract.ts`
does NOT import `clientContract.ts` or `toolRegistryFactory.ts` (verified by
grep). So `clientContract.ts` adding type-only imports of
`ToolSchedulerFactory` (from `./toolSchedulerContract.js`) and
`TaskToolRegistration` (from `../config/toolRegistryFactory.js`) is acyclic.

## 2. Exact core root re-export path

**Re-export path:** `packages/core/src/index.ts` already contains
`export * from './core/clientContract.js';` (line 73). Because the interface
is added to `clientContract.ts` (a module already re-exported via `export *`),
the core root barrel `@vybestack/llxprt-code-core` will expose
`AgentRuntimeFactoryBindings` automatically — NO additional re-export line is
required in P09.

This is the REAL bare specifier both agents and providers already use to
reach core: `@vybestack/llxprt-code-core` (resolved by each package's
`tsconfig.json` `paths` mapping to `../core/index.ts` — i.e. core SOURCE,
not `dist`).

## 3. Dependency / no-cycle proof

The recorded decision (`runtime-factory-contract-decision.md`) establishes the
dependency direction. This phase re-verified it against the real
`package.json` files:

- `packages/agents/package.json:42` lists
  `"@vybestack/llxprt-code-core": "file:../core"` → **agents depends on core**.
- `packages/providers/package.json:152` lists
  `"@vybestack/llxprt-code-core": "file:../core"` → **providers depends on core**.
- `packages/providers/package.json` has NO `@vybestack/llxprt-code-agents`
  entry (grep returned `NO_AGENTS_DEP_IN_PROVIDERS`) → **providers does NOT
  depend on agents**.
- `packages/agents/package.json:45` lists
  `"@vybestack/llxprt-code-providers": "file:../providers"` → agents depends
  on providers (orthogonal to the core ownership decision).

Therefore placing `AgentRuntimeFactoryBindings` in core creates NO new
dependency edge and NO cycle: both consumers already depend on core, and the
edge direction (agents→core, providers→core) is unchanged.

## 4. Exact P09 import statements

### 4a. core module addition (`packages/core/src/core/clientContract.ts`)

P09 will add, after the existing `AgentClientFactory` type alias:

```ts
import type { ToolSchedulerFactory } from './toolSchedulerContract.js';
import type { TaskToolRegistration } from '../config/toolRegistryFactory.js';

/**
 * Aggregation of the three agent-runtime factory primitives the composition
 * root wires into Config. Single source of truth — both agents and providers
 * import this from core (no duplicated structural re-declaration).
 */
export interface AgentRuntimeFactoryBindings {
  agentClientFactory: AgentClientFactory;
  toolSchedulerFactory: ToolSchedulerFactory;
  taskToolRegistration: () => TaskToolRegistration;
}
```

(Only the two `import type` lines are new; `AgentClientFactory`,
`AgentRuntimeState`, and `Config` are already in scope in `clientContract.ts`.)

### 4b. agents import site (`packages/agents/src/api/runtimeFactories.ts`)

P09 will REMOVE the local `export interface AgentRuntimeFactoryBindings { ... }`
(lines 58–63) and the now-redundant inline `agentClientFactory` signature, and
IMPORT the interface from core:

```ts
import type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core';
```

and re-export it so existing consumers (`api/index.ts:72`,
`configBuilder.ts`) keep resolving:

```ts
export type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core';
```

### 4c. providers import site (`packages/providers/src/runtime/runtimeContextFactory.ts`)

P09 will REMOVE the local `export interface AgentRuntimeFactoryBindings { ... }`
(lines 55–59) and IMPORT the interface from core:

```ts
import type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core';
```

and re-export it so `runtimeSettings.ts:45`
(`export type { AgentRuntimeFactoryBindings } from './runtimeContextFactory.js';`)
keeps resolving transitively:

```ts
export type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core';
```

Both sites already import other core types via the REAL bare specifier
`@vybestack/llxprt-code-core` / `@vybestack/llxprt-code-core/...`, so the new
import uses the same resolution path the real package tsconfig already
provides (no new path mapping).

## 5. No drift guard required

Because the decision is `single-source`, P09 removes BOTH duplicated
declarations and replaces them with ONE core-owned interface imported by both
packages. There is no second copy to drift from, so a compile-time drift guard
is unnecessary. A drift guard is only required for the `retained-duplication`
path, which was NOT chosen (see `runtime-factory-contract-decision.md`).

## 6. Executable structural typecheck proof

The executable proof lives at
`project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs`
(marker-free — attribution is this document, per revision 5 architect finding
5).

It makes a **disposable full-repo copy of the CURRENT working tree** — NOT a
clean checkout of `HEAD`. Because prior P03–P07 changes are uncommitted in the
working tree, a clean `git worktree add --detach` (HEAD only) would silently
drop all of those changes and would NOT prove the exact current source state
plus the P09 migration. The proof therefore enumerates the current source
state with two git plumbing commands and copies real bytes:

- `git ls-files -z` — tracked files at their **working-tree** content (which
  includes any tracked-modified P03–P07 changes).
- `git ls-files --others --exclude-standard -z` — untracked, non-ignored
  files (which includes the untracked P03–P07 additions).

Both honor `.gitignore`, so `.git`, `node_modules`, dist/build outputs, and
other ignored artifacts are excluded by git itself. The proof then runs
`npm install` inside the copy to create fresh, real workspace links
(`node_modules/@vybestack/llxprt-code-core -> packages/core`, etc.), applies
the EXACT P09 production changes to the COPY ONLY (add the interface to the
real `packages/core/src/core/clientContract.ts`; update the real
`packages/agents/src/api/runtimeFactories.ts` and real
`packages/providers/src/runtime/runtimeContextFactory.ts` import sites to
import `AgentRuntimeFactoryBindings` from `@vybestack/llxprt-code-core` and
remove the local declarations), runs `npm run build` then the REAL workspace
`npm run typecheck` in the disposable copy, and removes the copy on exit via
the exit/SIGINT/SIGTERM handlers. Production source in the real working tree
is NEVER modified.

This exercises the REAL production resolution path against the exact current
source state: the real package `tsconfig.json` path mappings, real core root
barrel re-export, real TypeScript project references (cli/a2a-server reference
core's built declarations), and real inter-package dependency graph.

### Proof output (recorded from the required P08 execution)

The proof is executed as a required P08 verification step. Output captured
from `node project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs`
(exit status 0):

#### Proof run log

```
[proof] creating disposable working-tree copy: /var/folders/.../T/llxprt-rf-proof-44800
[proof] copied 9184 working-tree files (skipped 0 deleted) into copy
[proof] running npm install in copy (fresh workspace links)...
[proof] npm install done
[proof] added AgentRuntimeFactoryBindings to core (copy)
[proof] migrated agents import site to core (copy)
[proof] migrated providers import site to core (copy)
[proof] running npm run build in copy...
[proof] build PASSED in copy
[proof] running npm run typecheck in copy...

> @vybestack/llxprt-code@0.10.0 typecheck
> npm run typecheck --workspaces --if-present

> @vybestack/llxprt-code-tools@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-storage@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-auth@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-settings@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-telemetry@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-ide-integration@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-policy@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-mcp@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-core@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-lsp@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-providers@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-agents@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-a2a-server@0.10.0 typecheck
> tsc --noEmit
> @vybestack/llxprt-code-test-utils@0.10.0 typecheck
> tsc --noEmit

[proof] typecheck PASSED in copy
[proof] real working tree production source unchanged

PASS: single-source migration typechecks under the REAL workspace resolution.
  - Disposable copy built from CURRENT working tree (tracked + untracked, non-ignored)
  - AgentRuntimeFactoryBindings added to packages/core/src/core/clientContract.ts (copy)
  - re-exported via the real core root barrel (@vybestack/llxprt-code-core)
  - agents/providers import sites migrated to import from core (copy)
  - npm install + npm run build + npm run typecheck PASSED in the copy
  - production source in the real working tree is unchanged
EXIT=0
```

The proof confirms the proposed core interface, the real core root re-export
path, and the real agents/providers tsconfigs compile with the new import —
end-to-end against the exact current working-tree state — BEFORE P09 touches
production source.
