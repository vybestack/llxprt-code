# API Walkthrough — what it looks like in code

Companion to `api-architecture.svg`. Same idea, in source form.

## 1. The door is a hand-written file

One file per seam. Every export named explicitly. No `export *`.

```ts
// packages/core/src/api/content.ts   ->  "@vybestack/llxprt-code-core/content"

export type {
  IContent,
  ContentBlock,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
  ThinkingBlock,
  MediaBlock,
  CodeBlock,
  ContentMetadata,
  UsageStats,
} from '../services/history/IContent.js';

export { createUserMessage, createToolResponse } from '../services/history/IContent.js';
```

Ten lines. That is the entire public content contract, and it is reviewable.

Why it matters: `services/history/IContent.js` never appears in a consumer again. The file can move
to `packages/core/src/content/model.ts` tomorrow and not one caller changes — only this door does.

## 2. The wall is `package.json`

```jsonc
{
  "exports": {
    ".":                   { "types": "./dist/index.d.ts",           "bun": "./index.ts",              "import": "./dist/index.js" },
    "./content":           { "types": "./dist/src/api/content.d.ts",     "bun": "./src/api/content.ts",    "import": "./dist/src/api/content.js" },
    "./config":            { "types": "./dist/src/api/config.d.ts",      "bun": "./src/api/config.ts",     "import": "./dist/src/api/config.js" },
    "./session":           { "types": "./dist/src/api/session.d.ts",     "bun": "./src/api/session.ts",    "import": "./dist/src/api/session.js" },
    "./runtime/contracts": { "types": "./dist/src/api/contracts.d.ts",   "bun": "./src/api/contracts.ts",  "import": "./dist/src/api/contracts.js" }
    // ~8 more
  }
}
```

Anything not listed here does not exist as far as the outside world is concerned. Note every entry
carries `types` — today core has that on only 12 of 127, which is the reason the wildcard aliases
exist and why they cannot be deleted before this is fixed.

## 3. What a caller writes

**Before** — five imports, five internal paths, coupled to core's folder layout:

```ts
// packages/providers/src/LoggingProviderWrapper.ts   (actual code today)
import type { PromptEnvelope }        from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent }              from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config }                from '@vybestack/llxprt-code-core/config/config.js';
import { DebugLogger }                from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { ProviderRuntimeContext }     from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
```

**After** — four doors, no internal paths:

```ts
import type { PromptEnvelope }        from '@vybestack/llxprt-code-core/runtime/contracts';
import type { IContent }              from '@vybestack/llxprt-code-core/content';
import type { ProviderConfig }        from '@vybestack/llxprt-code-core/config';
import { DebugLogger }                from '@vybestack/llxprt-code-telemetry/debug';
import { ProviderRuntimeContext }     from '@vybestack/llxprt-code-core/runtime';
```

Two things changed beyond the paths:

- `Config` became `ProviderConfig` — a role interface with the ~6 methods providers actually calls,
  not the 200-method god-object. 231 of 266 `Config` imports are type-only, so for most callers this
  is a one-word edit.
- `DebugLogger` now comes from telemetry, which owns it. Core was re-exporting it via a file whose
  own header says *"Compatibility shim"*.

## 4. Who calls what

| Package | Doors it uses | Never touches |
|---|---|---|
| tools | *(nothing — lowest layer)* | everything above |
| core | tools, auth, settings, storage, policy, telemetry | providers, agents, cli, **mcp** |
| providers | core: `content`, `config`, `runtime/contracts`, `runtime` | agents, cli |
| agents | core: `content`, `config`, `session`, `runtime`, `history`, `policy`, `tool-scheduling` | cli |
| cli / a2a-server | agents, core: `content`, `session`, `policy` | — |
| mcp, auth, settings, storage, policy, telemetry | *(leaves — nothing internal)* | core |

**The `core` row above is provisional and the DAG is not settled.** An earlier version of this table
treated `core → tools` as normal. The codebase says otherwise — `packages/core/src/config/configTypes.ts`
carries a hook whose stated purpose is "Eliminates the inverted core->tools dependency," so that edge
is being removed, not sanctioned. Core still declares dependencies on both `tools` and `mcp`.

Two edges are therefore in question, not one:

- **core → mcp** — an actual cycle today; mcp declares core only as a devDependency, which is also a
  packaging bug.
- **core → tools** — treated as inverted by the source, as accepted by issue #2618. This must be
  resolved before any ownership move, because it decides where retry/errors/logger land and whether
  `ResourceRegistry` and `SkillManager` may move at all.

## 5. What happens when you get it wrong

Deep import of something not on the wall:

```
error TS2307: Cannot find module '@vybestack/llxprt-code-core/config/config.js'
              or its corresponding type declarations.
```

That is real output, verified against a `nodenext` fixture with no path aliases — the exports map
already does this. It is inert today only because 11 tsconfigs alias around it.

Same import, caught in the PR by lint:

```
16:29  error  Reaching to "@vybestack/llxprt-code-core/config/config.js" is not allowed
              import/no-internal-modules
```

Also real output. The rule is already installed at error severity; it catches nothing because its
`allow` mode returns "fine" for any specifier it cannot resolve, and no TypeScript resolver is
configured. Switching to `forbid` flags 5 of 5 deep imports in that file.

## 6. Why the surface stops growing

Adding a door means editing `src/api/*.ts` **and** `package.json` — a diff a reviewer sees and can
question. Today it means adding three lines to `package.json`, which looks like nothing.

And no `export *` anywhere public: with `export *`, adding an export to any internal file silently
widens the public API. That is how 117 doors became 127 while an issue about it was open. 26 of the
repo's 282 public entry points still use it.

## 7. Order of work

1. Add `types` conditions to every subpath that survives. Nothing else can proceed without it.
2. Switch `import/no-internal-modules` to `forbid` + TS resolver, scoped to already-clean packages;
   widen the scope per migration PR. Monotonic, no warn phase, no disable comments.
3. Delete the 65 dead subpaths and the 15 cross-package shims. No design decisions required.
4. Move the 28 single-consumer utilities to the package that actually uses them.
5. Write the doors, one seam per PR, migrating that seam's callers in the same PR.
6. Delete the wildcard aliases per consumer, in that consumer's final PR.
7. Turn on the cycle test.

Steps 1–4 are mechanical and account for a large share of the surface. Step 5 is where the design
judgement lives.
