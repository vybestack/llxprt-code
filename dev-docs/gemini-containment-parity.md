# Gemini containment parity — differential negative-control evidence (#2628)

Measured on branch `issue2628` at `99a3411cd`, 2026-09-17, macOS, bun 1.3.14.
The old guards were still present and running when every old-guard verdict
below was measured. Nothing in the old-guard family was modified or deleted for
this document.

**Summary:** every injection shape the old guards detected, in every context
they scanned, is detected by the new gate against its own target SDK. The new
gate additionally covers layers the old family never had (root lockfiles, mock
specifiers, the plugin package lane, alias rules inside the sanctioned plugin
manifest, plugin-manifest/hint parity). The old guards' non-import semantic
checks (Gemini-named exports, banned-symbol and wire-shape policing, the
inventory ratchet) retire as intentionally out of scope, with justifications in
§6 and residual risks in §8.

## 1. What this doc is

Per the #3421 guard-retirement contract, retiring the old guard family requires
committed evidence that every meaningful assertion the old guards made is
covered by the new gate, with inapplicable cells justified. This is that
evidence, in the form of a measured differential matrix.

- Live half (committed, survives retirement):
  `scripts/tests/gemini-containment-parity.test.ts` builds the same fixture
  trees and asserts the new gate's verdict for every matrix row on every run.
- This doc: the measured old-guard verdicts against the same fixtures, the
  new-gate verdicts, dispositions, and the exact commands.

Fixture helpers live in the test file (`buildBaseTree` and the lock/manifest
builders), following the local convention of
`scripts/tests/check-gemini-containment.test.ts`. The one-off measurement
harness used for this doc was a scratch script under gitignored `tmp/` and is
not committed.

## 2. Guards compared

### Old family (all retiring)

| Guard                                                                                                                                                       | CI entry                                              | Target SDK               | Universe                                                                                                                                                        | Import shapes                                                                                                            | Extra assertions                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-genai-enclave.ts` (+ `scripts/genai-enclave/**`)                                                                                             | `lint:genai-enclave`                                  | `@google/genai`          | `packages/**` sources, TS+JS; manifests: root + all of `packages/**` (required: root, `packages/providers`); `dist/` pruned; no plugins lane; no lockfile layer | static (incl. type-only), dynamic `import()`, `require()`, re-exports, `import()` type refs, computed-specifier tripwire | Gemini-named exports outside `packages/providers/src/gemini/**` + allowlist                                                                                                                                                                                                             |
| `scripts/agents-neutral-gate.ts`                                                                                                                            | `gate:agents-neutral` (`npx tsx … --enforce-imports`) | `@google/genai` (checkA) | CI default: production files under `packages/agents/src` (test files excluded); `--files` accepts any path                                                      | checkA: static, re-export, dynamic, `require()`, `import()` type refs                                                    | checkB–H: banned Google symbols from banned modules, `Contract*` aliases, deleted-helper roundtrip symbols, `FinishReason`/`Type` enum re-declarations, structural `{candidates}`/`{role,parts}` envelopes, `toGeminiContent` calls, `GeminiContent*` barrel imports, Gemini usage keys |
| `scripts/agents-neutral-test-gate.ts`                                                                                                                       | `gate:agents-neutral` (`npx tsx …`)                   | `@google/genai`          | agents test files (`packages/agents` `.test`/`.spec`/helpers/`__tests__`)                                                                                       | static, re-export, dynamic, `require()` (`findGenaiOffenders`)                                                           | structural Google-shaped fixtures in tests (`role`+`parts`, `functionCall`, `functionResponse`) with provenance exemptions                                                                                                                                                              |
| `scripts/genai-import-inventory.ts`                                                                                                                         | `lint:genai-inventory`                                | `@google/genai`          | tracked `packages/**/*.ts` via `git ls-files` (git-locked to the real repo; no fixture override)                                                                | quoted-specifier text match (overmatches strings/mocks)                                                                  | baseline-drift ratchet vs `dev-docs/genai-import-baseline.md`                                                                                                                                                                                                                           |
| `packages/agents` Gemini naming scanner (`src/core/__tests__/geminiIdentifierScanner.ts` driven by `providerAgnosticNaming.test.ts` + its allowlist module) | agents package test suite                             | n/a (names, not imports) | all package workspaces                                                                                                                                          | n/a                                                                                                                      | Gemini-named declared identifiers and filenames outside `GENUINE_GEMINI_TREES`/files/pair allowlists                                                                                                                                                                                    |

### New gate

`scripts/check-gemini-containment.ts` (+ `scripts/lib/gemini-containment-{shared,source,envelope}.ts`),
CI mode `bun scripts/check-gemini-containment.ts`. Target SDK: `@ai-sdk/google`.
Layers:

- **L1-manifest** — exactly one `@ai-sdk/google` declaration, in
  `plugins/google-gemini/package.json` `dependencies`; npm-alias disguises
  rejected in every manifest; required manifests fail closed.
- **L1-lockfile** — root `bun.lock` and `package-lock.json` carry no SDK entry;
  the plugin-local `bun.lock` is a sanctioned separate install context.
- **L2-import** — no import-shaped SDK specifier outside `plugins/*/src` and
  `plugins/*/dist`. Scans `packages/`, `scripts/`, `evals/`,
  `integration-tests/`, `test-scripts/`, root loose files, and the plugins tree
  outside every plugin's `src`/`dist`. Shapes: transpiler-reported statements
  (static, side-effect, re-export, dynamic `import()`, `require()`) plus
  matchers for type-only statements (straight and inline-braced) and
  `mock.module`/`vi.mock`/`jest.mock` specifier arguments. Zero-allowlist.
- **L3-residency** — no file whose basename starts with `gemini` (either case)
  under `packages/providers/src/**`.
- **envelope** — plugin-manifest provider contributions must exactly equal the
  capability set the base hints at (`PLUGIN_PROVIDED_PROVIDER_HINTS`).

**Retargeting, stated plainly:** the old guards policed `@google/genai`; the
new gate polices `@ai-sdk/google`. Neither flags the other's specifier — both
directions were measured (cross cells below). The legacy SDK has zero tracked
importers under `packages/**` today (read-only `git ls-files` + matcher scan),
zero manifest declarations, and the old enclave directory
`packages/providers/src/gemini/` no longer exists; the containment contract
moved to the non-workspace plugin and the current generation SDK.

## 3. Measurement protocol

One fixture tree per cell, one injection per tree, so every verdict maps to
exactly one injected site. The tree family mirrors the real repo's shape: root
`package.json`/`bun.lock`/`package-lock.json`, a `plugins/google-gemini/`
package (manifest, `bun.lock`, `src/`, `dist/`, `scripts/`, `types/`),
`plugins/google-mcp-auth/`, `packages/providers` (with the manifest the old
guard requires) plus `src/`, `packages/agents/src` (with `__tests__/`), and
`packages/core/src`.

Each old guard ran against the `@google/genai` variant of the same injection;
the new gate ran against the `@ai-sdk/google` variant. Both cross combinations
were measured too, so the retargeting is data, not an assumption.

Old-guard commands (exact):

```sh
# repo-wide import + manifest guard (fixture mode)
GENAI_ENCLAVE_ROOT=<fixture-tree> bun scripts/check-genai-enclave.ts

# agents production gate, checkA engine (same entry its own suite drives)
bun scripts/agents-neutral-gate.ts --enforce-imports --files <fixture-file>

# agents test gate, import half (harness entry used by scripts/tests/agentsNeutralTestGate.test.ts)
findGenaiOffenders([<fixture test files>], <fixture root>)

# inventory matcher (pure function; the CLI itself is git-locked — see below)
isGenaiImporterContent(<fixture source text>)
```

New gate: `runContainmentScan(<fixture-tree>)` in-process, the same entry the
CLI uses (`LLXPRT_GATE_ROOT=<fixture-tree> bun scripts/check-gemini-containment.ts`
produces identical findings).

Mechanical limitations, recorded rather than papered over:

- `genai-import-inventory.ts` resolves its repo root from `import.meta.url` and
  enumerates files with `git ls-files`, so it cannot be pointed at a fixture
  tree. Its exported pure matcher `isGenaiImporterContent` was measured on the
  fixture content instead; its discovery universe (tracked `packages/**/*.ts`)
  is recorded per row.
- The agents gates' CI lanes are `packages/agents`-scoped. Where a verdict was
  obtained only by pointing `--files` at a file outside that charter, the row
  says so.

## 4. Differential matrix (shape × context)

Legend: **enclave** = `check-genai-enclave.ts`, **agents** =
`agents-neutral-gate.ts` checkA, **testgate** = `agents-neutral-test-gate.ts`
import half, **inventory** = `genai-import-inventory.ts` matcher. Old verdicts
are for the `@google/genai` injection; new verdicts for the `@ai-sdk/google`
injection. Cross measurements (old guard vs `@ai-sdk/google`, new gate vs
`@google/genai`) are stated once after the table.

### Production lane (`packages/providers/src/parityInjection.ts`; agents charter measured at `packages/agents/src/parityInjection.ts`)

| Shape                                                       | Old verdict                                                                                                                                                                    | New verdict                                                                  | Disposition                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| runtime static import                                       | enclave **FLAG** (exit 1, both provider and agents sites); agents **FLAG**; inventory **FLAG**                                                                                 | **FLAG** `[L2-import]` file:line reported                                    | covered — same shape + context enforcement, retargeted to the current SDK                                                                       |
| type-only import (`import type`)                            | enclave **FLAG**; agents **FLAG**; inventory **FLAG**                                                                                                                          | **FLAG** `[L2-import]` (type-only matcher; Bun's transpiler skips the shape) | covered                                                                                                                                         |
| inline-braced `import { type X }`                           | enclave **FLAG**; agents **FLAG**; inventory **FLAG**                                                                                                                          | **FLAG** `[L2-import]` (braced type-only matcher)                            | covered                                                                                                                                         |
| dynamic `import()`                                          | enclave **FLAG**; agents **FLAG**; inventory **FLAG**                                                                                                                          | **FLAG** `[L2-import]`                                                       | covered                                                                                                                                         |
| `require()`                                                 | enclave **FLAG**; agents **FLAG**; inventory **FLAG**                                                                                                                          | **FLAG** `[L2-import]`                                                       | covered                                                                                                                                         |
| mock specifier (`mock.module` / `vi.mock` string arg)       | enclave pass; agents pass; testgate pass; inventory **FLAG** (text overmatch, not import detection)                                                                            | **FLAG** `[L2-import]` "mock specifier argument"                             | covered — new capability: no old guard detected mock specifiers as import-shaped; the only old signal was the inventory's quoted-text overmatch |
| npm-alias manifest disguise (`"@google-ai": "npm:<sdk>@4"`) | enclave **FLAG** (F1 alias rule on `packages/foo/package.json`); agents n/a (no manifest layer); inventory pass (matcher is quoted-specifier based; recorded as no capability) | **FLAG** `[L1-manifest]`                                                     | covered — alias rule carried over into the new gate at parity                                                                                   |

### Test lane (`packages/core/src/parityInjection.test.ts`; agents charter measured at `packages/agents/src/__tests__/parityInjection.test.ts`)

| Shape                             | Old verdict                                                                                                                                                                                                                    | New verdict              | Disposition                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| runtime static import             | enclave **FLAG** (imports are not exempt in test files); agents **FLAG** under explicit `--files` (its CI default scan excludes `*.test.*` — the agents test lane belonged to testgate); testgate **FLAG**; inventory **FLAG** | **FLAG** `[L2-import]`   | covered                                                                                                                                                                                                    |
| type-only import                  | enclave **FLAG**; agents **FLAG** (`--files`); testgate **FLAG**; inventory **FLAG**                                                                                                                                           | **FLAG** `[L2-import]`   | covered                                                                                                                                                                                                    |
| inline-braced `import { type X }` | enclave **FLAG**; agents **FLAG** (`--files`); testgate **FLAG**; inventory **FLAG**                                                                                                                                           | **FLAG** `[L2-import]`   | covered                                                                                                                                                                                                    |
| dynamic `import()`                | enclave **FLAG**; agents **FLAG** (`--files`); testgate **FLAG**; inventory **FLAG**                                                                                                                                           | **FLAG** `[L2-import]`   | covered                                                                                                                                                                                                    |
| `require()`                       | enclave **FLAG**; agents **FLAG** (`--files`); testgate **FLAG**; inventory **FLAG**                                                                                                                                           | **FLAG** `[L2-import]`   | covered                                                                                                                                                                                                    |
| mock specifier                    | enclave pass; agents pass; testgate pass; inventory **FLAG** (overmatch)                                                                                                                                                       | **FLAG** `[L2-import]`   | covered — new capability, as above                                                                                                                                                                         |
| npm-alias manifest disguise       | enclave **FLAG** (manifest layer is lane-independent)                                                                                                                                                                          | **FLAG** `[L1-manifest]` | covered — manifest declarations carry no lane; the L1 walk visits every manifest regardless of neighboring file lanes, so this row equals the production row by construction (measured, identical verdict) |

### Packed-tarball lane (`plugins/google-gemini/` package layout; source shapes at `plugins/google-gemini/scripts/postinstall.ts`, alias in the plugin manifest)

| Shape                                                                 | Old verdict                                                                                                                                                                                                                                                                                                                                            | New verdict                                                                            | Disposition                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| runtime static import                                                 | enclave **pass** — the injection sits outside its discovery universe (`<root>/packages` only); the guard exits 0 because the packages it does scan are clean. agents **FLAG** only under explicit `--files`; no CI lane points it at plugin trees (charter `packages/agents/src`) — none-in-practice. inventory: universe is `packages/**/*.ts` — none | **FLAG** `[L2-import]` (the plugin tree outside `src`/`dist` is scanned)               | covered — the new gate extends import enforcement into the plugin package lane the old guards never scanned |
| type-only import                                                      | same as above                                                                                                                                                                                                                                                                                                                                          | **FLAG** `[L2-import]`                                                                 | covered                                                                                                     |
| inline-braced `import { type X }`                                     | same as above                                                                                                                                                                                                                                                                                                                                          | **FLAG** `[L2-import]`                                                                 | covered                                                                                                     |
| dynamic `import()`                                                    | same as above                                                                                                                                                                                                                                                                                                                                          | **FLAG** `[L2-import]`                                                                 | covered                                                                                                     |
| `require()`                                                           | same as above                                                                                                                                                                                                                                                                                                                                          | **FLAG** `[L2-import]`                                                                 | covered                                                                                                     |
| mock specifier                                                        | same as above                                                                                                                                                                                                                                                                                                                                          | **FLAG** `[L2-import]`                                                                 | covered — new capability                                                                                    |
| npm-alias manifest disguise (in `plugins/google-gemini/package.json`) | enclave **pass** — plugin manifests are outside its manifest universe (root + `packages/**`); agents/inventory: no capability                                                                                                                                                                                                                          | **FLAG** `[L1-manifest]` — the alias rule fires even in the sanctioned plugin manifest | covered — the old alias rule never reached plugin manifests; the new rule is stricter                       |

Cross measurements (retargeting is explicit data):

- Old guards against `@ai-sdk/google` injections of every shape above:
  **pass** — `@ai-sdk/google` is not the legacy guards' target.
- New gate against `@google/genai` injections of every shape above: **pass** —
  `@google/genai` is not the new gate's target. This is pinned live by
  `scripts/tests/gemini-containment-parity.test.ts` (retargeting cross-check).
- Clean negative controls (no injection): enclave exit 0, new gate zero
  violations.

## 5. Sanctioned zones and old: none cells

Cells where a guard intentionally passes, or one generation has no
corresponding capability.

| Cell                                                           | Old verdict                                                                                  | New verdict                                                                                | Why                                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| SDK import inside `plugins/google-gemini/src/**`               | n/a — the plugins lane was never in any old guard's universe                                 | passes (sanctioned owner zone)                                                             | after #2763 the plugin owns the SDK; its `src/` is the one legitimate consumption site                                              |
| SDK import inside `plugins/google-gemini/dist/**`              | n/a — no old guard scanned any `dist/` (the enclave guard prunes it even inside `packages/`) | passes (built artifacts of the owning plugin)                                              | same containment model; the manifest/lockfile layers still constrain what the package can declare                                   |
| SDK entry in `plugins/google-gemini/bun.lock`                  | old: none — no lockfile layer existed                                                        | passes (separate install context)                                                          | plugin-local installs are how the sanctioned dependency gets resolved                                                               |
| SDK entry in root `bun.lock` / `package-lock.json`             | old: none — no lockfile layer existed                                                        | **FLAG** `[L1-lockfile]` (both the workspace entry and the `packages["<sdk>"]` resolution) | new capability; a root-lock declaration would hoist the SDK into every workspace                                                    |
| Alias disguise inside the sanctioned plugin manifest           | old: none — plugin manifests unscanned                                                       | **FLAG** `[L1-manifest]`                                                                   | disguised declarations are prohibited everywhere, including the sanctioned manifest                                                 |
| Plugin-manifest ↔ base-hint exact-set parity (envelope layer) | old: none — no old guard asserted plugin capability parity                                   | enforced (`envelope` layer)                                                                | new enforcement from the #2628 policy; closest old relatives (checkG-barrel, checkH) policed different objects (agents wire shapes) |

## 6. Old-guard capabilities outside the import matrix

These old assertions have no new-gate counterpart. Each retires as
intentionally out of scope, with the reason.

1. **Gemini-named export scan** (`check-genai-enclave.ts`: exported identifiers
   containing "Gemini" outside `packages/providers/src/gemini/**` + allowlist).
   New gate: none. Out of scope because it enforced the intermediate
   neutral-API milestone — base workspaces must not re-export Google wire
   vocabulary — and that milestone is finished: the enclave directory no longer
   exists and the provider lives in `plugins/google-gemini`. The durable
   residue (no Gemini-named files in the base provider workspace) survives as
   L3-residency. What is given up: naming hygiene for exported _identifiers_ in
   base code.
2. **Computed-specifier tripwire** (`check-genai-enclave.ts`: any computed
   `import()`/`require()` in `packages/**` outside the one sanctioned loader).
   New gate: none (no static guard can attribute a computed specifier to a
   module — both generations are blind here; the old tripwire fired on the
   _shape_, not the SDK). Out of scope because its practical protection against
   SDK smuggling now comes from L1: the SDK is undeclarable outside the plugin
   manifest, so a computed import of it cannot resolve in workspace code at
   runtime. Limit named in §8.
3. **agents-neutral-gate checkB–H** (banned Google symbols from banned modules,
   `Contract*` aliases, deleted-helper roundtrip symbols, `FinishReason`/`Type`
   enum re-declarations, structural `{candidates}`/`{role,parts}` envelopes,
   `toGeminiContent` calls, `GeminiContent*` barrel imports, Gemini usage keys
   outside boundary modules). New gate: none. Out of scope because these
   policed the agents neutral-API migration (#2349/#2424) — keeping Google wire
   shapes out of `packages/agents` — which is complete; they are API-shape
   hygiene, not generation-SDK containment. The new gate's envelope layer
   asserts a different parity (plugin capability vs base hints).
4. **agents-neutral-test-gate structural fixture checks** (`role`+`parts`,
   `functionCall`, `functionResponse` envelopes in agents tests). New gate:
   none for shapes; the import half of this gate is covered by L2 (matrix, test
   lane). Same justification as (3), scoped to agents tests.
5. **genai-import-inventory ratchet** (`--check` drift vs
   `dev-docs/genai-import-baseline.md`). New gate: superseded for the current
   SDK by zero-allowlist L2 — there is no baseline to shrink because any
   import anywhere outside the plugin fails outright. For the legacy SDK the
   ratchet's remaining content is bookkeeping over an empty set: measured on
   this branch, tracked `packages/**` has zero `@google/genai` importers and
   the checked-in baseline still lists three files that no longer exist (the
   deleted enclave tree), so `--check` currently exits 1 asking to shrink the
   baseline to zero. Retirement deletes that bookkeeping, not a live control.
6. **packages/agents naming scanner** (AST scan for Gemini-named declared
   identifiers and filenames across all workspaces, allowlist-gated). New gate:
   L3 covers filename residency in `packages/providers/src/**` only.
   Identifier-level name policing elsewhere retires with the same justification
   as (1); the scanner's own allowlists already document every surviving
   Gemini-named identifier as compat surface.

## 7. Verification commands

```sh
# live parity suite + existing gate suite
bun test scripts/tests/gemini-containment-parity.test.ts scripts/tests/check-gemini-containment.test.ts

# new gate on the real tree (must stay exit 0)
bun scripts/check-gemini-containment.ts

# old guards on the real tree at measurement time (both green before retirement)
bun scripts/check-genai-enclave.ts
bun scripts/agents-neutral-gate.ts --enforce-imports   # via gate:agents-neutral
bun scripts/agents-neutral-test-gate.ts                # via gate:agents-neutral

# per-cell old-guard measurements (fixture trees; see §3)
GENAI_ENCLAVE_ROOT=<fixture-tree> bun scripts/check-genai-enclave.ts
bun scripts/agents-neutral-gate.ts --enforce-imports --files <fixture-file>
```

## 8. Residual risk after retirement (plain statement)

- **Legacy `@google/genai` reintroduction becomes unguarded.** After
  retirement no automated check detects a `@google/genai` import, manifest
  declaration, alias, or inventory drift. Mitigating facts: zero current
  importers and declarations, the package appears in no manifest or lockfile,
  and any new Google generation SDK usage is supposed to enter through the
  plugin — where L1/L2 would catch `@ai-sdk/google` misplacement but not the
  legacy specifier. If that residual risk is judged unacceptable, the minimal
  alternative is keeping `lint:genai-enclave` alone; this doc's matrix shows
  everything else in the family is either covered or out of scope.
- **Computed-specifier imports remain invisible to static analysis** (true
  during and after retirement). L1's exactly-one-declaration rule keeps the
  current SDK unresolvable outside the plugin, which limits the vector at
  runtime but does not detect it statically.
- **Gemini-named identifier/export hygiene is no longer repo-wide policy.**
  L3 keeps file residency in the provider workspace; identifier names and
  exports outside it become convention, not gate.
