# Issue #2615 — Status: Blocked on a Prerequisite Architectural Fix

**Status:** analysis preserved, implementation abandoned, issue unassigned.
**PR #3118:** closed unmerged.
**Do not restart implementation from this material** until the prerequisite
described below is settled.

## Why this document exists

Two implementation attempts were made and both were wrong. The artifacts in
this directory are worth keeping — the census in particular took real work and
is accurate — but the *plan* they were built to serve was aimed at the wrong
target. This records what happened so the next attempt does not repeat it.

## The actual root cause: `Config` violates separation of concerns

`Config` is not merely large. It is four different things in one class, and that
is why nothing can be cleanly separated out of it. Measured on `main`:

| Concern | Evidence |
|---|---|
| **Configuration** — plain value accessors | 67 getters returning `string`/`number`/`boolean` |
| **Construction** — builds its own collaborators | 16 `new X(...)` sites inside `config.ts` |
| **Service location** — hands out collaborators on request | 44 getters returning object types |
| **Injection** — collaborators pushed in after construction | 29 `setX(...)` methods |
| **Scattered application** — a value write reconfigures services | 6 key-branching side-effect blocks in `configBase.ts` |

Totals for the hierarchy: **134 declared fields (63 service-typed) and 225
methods** across `config.ts`, `configBase.ts` and `configBaseCore.ts`.

The four concerns are mutually entangling:

- because `Config` **constructs**, a consumer that needs one collaborator must
  wait for `Config` to be initialized;
- because `Config` **locates**, any consumer holding it can reach anything, so
  no dependency is documented anywhere;
- because collaborators are **injected after** construction, the object is never
  fully formed, and code defends against partially-initialised state;
- because a value write **applies side effects**, settings cannot be treated as
  data.

Extracting one collaborator therefore requires touching all four axes at once.
That is not a scale problem to be solved with more slices — it is the reason the
slices are expensive.

## The same pattern exists elsewhere

This is not unique to `Config`, which matters for whatever fix is chosen:

- **Settings**: 92 production `setEphemeralSetting(...)` call sites, and
  `SettingsService` both mutates and emits (`SettingsService.ts:151, 175, 180,
  216`). Applying a setting is an action with scattered consequences rather than
  a data write.
- **Profiles**: 48 production files participate in profile application. There is
  no single place where "a profile is applied"; it is diffused.

A fix that repairs `Config` while leaving settings and profiles with the same
shape will partially undo itself over time.

## Attempt 1 — narrowing type annotations (abandoned)

Replaced wide `Config` annotations with narrow interfaces across ~76 files. A
guard counting references to the type named `Config` fell from 85 files to 9,
which looked like progress.

It was not. **The concrete `Config` implementation never changed.**
`configBase.ts`, `configBaseCore.ts`, `configConstructor.ts` and
`configTypes.ts` had no substantive diff. `Config` still constructed, stored,
located and disposed everything.

The guard was gamed three times, once by the author of the guard:

1. `config: Config` rewritten as `Config['getSettingsService']` — an indexed
   access is still a dependency on `Config`;
2. twelve `as unknown as` casts inserted to force compilation;
3. a new `ProviderRuntimeConfig` type with **104 members**, against `Config`'s
   116-member cross-package surface, which 35 files then depended on. The
   god-object renamed.

**Lesson: never measure the spelling of a type.** Measure members actually
touched, or ownership. `analysis/config-coupling.ts.txt` (kept as reference) does the former.

## Attempt 2 — vertical ownership extraction (correct method, wrong scale)

One collaborator, `ShellJobManager`, was fully extracted: construction moved to
an agents-side `SessionRuntime`, `Config` received it as a borrowed value,
consumers were injected rather than reaching for it, the settings reaction became
an explicit ordered port, and disposal became the runtime's responsibility.
`Config`'s field, getter, lazy construction and disposal were deleted with no
delegate. Acceptance was behavioural and mutation-verified; CI was green.

That work was sound and the pattern is recorded in the closed PR. But it moved
**1 of 63 service-typed fields — about 1.6%** — and required coordinated changes
across core, agents, cli and a2a-server. Sixty-three of those is not a plan.

An earlier report of this as "1 of 8" was wrong: that count came from a grep
matching only names ending in `Manager|Service|Registry|Client|System|Engine`.

## What is preserved here, and what it is good for

| Artifact | Use |
|---|---|
| `analysis/role-assignment.json` | Checker-based census: every `Config` member reached from outside core, with signatures and call sites. Built with the TypeScript type checker, so it resolves receivers reached through `deps.config`-style properties that grep-based tools miss entirely. Trustworthy input for any approach. |
| `analysis/01-analysis.md` | Summary of the census, including where the checker disagreed with syntactic tooling and why. |
| `analysis/api-architecture.svg` | Diagram of the package/API surface. |
| `analysis/api-walkthrough.md`, `analysis/usage-census.md`, `analysis/target-api-design.md` | Earlier API-surface analysis. `target-api-design.md` §11 records why it was **not** ready to publish as a contract. |
| `analysis/role-gaps.md` | Members with no natural home — useful signal about which concerns are genuinely tangled. |
| `analysis/config-coupling.ts.txt` | Reference source, not live code. Measures members-touched per file using the TypeScript checker, so renaming a type cannot satisfy it. Drop into `scripts/` and register in `tsconfig.scripts.json` if wanted. Use as a **trend report**, never as a definition of done. |
| `plan/` | The superseded plans. Kept for the reasoning and the recorded dead ends, not to execute. |

## Established facts worth not rediscovering

- The problem is ownership and concern-mixing, not type width.
- Do **not** hand `Config` a factory to invoke. It would remain the composition
  root and the exercise becomes pointless.
- Migration runs **bottom-up**. Roots-first was tried; a root cannot stop
  depending on `Config` while it still passes `Config` to a callee that needs it.
- `packages/agents` is the lowest package that can legally own assembly; core
  must not depend on agents.
- `fromConfig` guarantees caller-object identity, asserted by test. That is an
  adoption boundary, and it propagates the concrete type up its call chain.
- The process-global scheduler singleton (`schedulerSingleton.ts`) shares state
  whenever two callers pass matching `sessionId` strings. That is a bug, not a
  feature.
- Construction ordering must stay explicit: extension, LSP and skill mutation
  have to complete before the first tool publication, and MCP shutdown has to be
  initiated before awaiting trust-transition settlement. A topological sorter
  would hide both.

## Open questions for the architectural session

1. Can the 63 service-typed fields be absorbed by a **small number** of cohesive
   objects, rather than 63 extractions? If that number is five or six, the shape
   of the work changes entirely.
2. Should `Config` be **deleted** rather than decomposed? `ConfigParameters` is
   an exported construction surface, so what is the compatibility path?
3. Is a **mechanical transformation** available, or is this inherently hand work?
4. Is decomposition the honest goal at all, versus **containment** — freeze the
   surface, forbid new service fields by lint, and stop?
5. Does the fix have to address settings and profiles at the same time, given
   they exhibit the same scattered-application pattern?

Question 4 deserves a real answer rather than a default. A large investment has
already produced 1.6%, and "contain it" is a legitimate outcome.
