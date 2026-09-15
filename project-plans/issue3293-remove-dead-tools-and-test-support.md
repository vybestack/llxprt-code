# Plan: Remove dead tools and test-support artifacts (#3293)

Plan ID: PLAN-20260914-ISSUE3293
Generated: 2026-09-14
Issue: #3293 (Remove dead tools and test-support artifacts, OPEN, milestone 0.12.0)
Parent: #2232 (dead code and dead dependencies for 0.12.0)
Inventory source: `project-plans/issue2232-dead-code-inventory.md` (2026-08-24)
Total Phases: 3 (0.5 preflight, P1, P2) plus a documented WS2 disposition
Requirements: REQ-3293-01, REQ-3293-02

## Critical Reminders

1. Phase 0.5 preflight is complete; results recorded below and re-verified on
   the working branch before implementation.
2. Two separately labeled work streams run through the plan, commits, and PR:
   - **Work stream 1 — Production deletion**: dead tools modules, the dead
     `requireOne` schema keyword (tools and core copies), and the already
     completed MCP production-module deletion.
   - **Work stream 2 — Test-support removal**: test updates made obsolete by
     the production deletions, plus documented rejections of inventory rows
     whose tests now cover remaining production contracts.
3. Boundaries: tool registry behavior, MCP discovery and OAuth injection
   boundaries, package export-map targets, tool names, schemas, and test
   preloads are untouched. No package-wide test runner or test infrastructure
   restructuring.

## Accepted behavior (acceptance criteria)

- **AC1 (REQ-3293-01)**: The four inventory-confirmed dead tools modules —
  `packages/tools/src/tools/stubs.ts`, `packages/tools/src/formatters/index.ts`,
  `packages/tools/src/types/index.ts`,
  `packages/tools/src/types/provider-content-types.ts` — no longer exist in the
  source tree and no longer resolve as modules. A guard test in the style of
  `packages/tools/src/__tests__/removed-google-tools.test.ts` proves their
  absence and keeps proving it, while also proving the live leaf modules they
  duplicated (`formatters/IToolFormatter.js`, `types/tool-names.js`) still
  resolve.
  - GIVEN the repository source tree
  - WHEN the guard test resolves `../tools/stubs.js`, `../formatters/index.js`,
    `../types/index.js`, and `../types/provider-content-types.js`
  - THEN each resolution fails, and resolution of the live leaf modules
    succeeds.
- **AC2 (REQ-3293-02)**: The `requireOne` custom schema keyword is removed from
  the tools and core `SchemaValidator` copies and from the
  `BaseDeclarativeTool.buildSchema()` strip. No tool's model-facing schema
  changes: no tool declared the keyword, and the getter already deleted it
  before sending, so the model-facing schema is byte-identical before and
  after. Validation outcomes for every real schema are unchanged.
  - GIVEN a schema that carries a stray `requireOne` key (no production schema
    does)
  - WHEN `SchemaValidator.validate` runs against params that satisfy the
    standard JSON Schema keywords
  - THEN validation returns `null`; `requireOne` is treated as an unknown
    keyword, not an enforced constraint (test fails before the removal,
    passes after).
  - GIVEN any real tool schema
  - WHEN `tool.schema` is read twice and `validateToolParams` runs
  - THEN schema identity is memoized, the model-facing schema content equals
    the declared schema, and required-property enforcement is unchanged
    (existing `tools.schemaIdentity.test.ts` coverage, updated).
- **AC3**: MCP surface is untouched: the fake MCP discovery seam
  (`packages/mcp/src/fake/fakeMcpDiscovery.ts`), its root-barrel re-export,
  `oauthProviderTestSetup.ts`, `mcp-client.oauth.fixtures.ts`,
  `mcpClientTestHelpers.ts`, tool registry, MCP discovery, and OAuth injection
  boundaries all remain, and their tests pass unchanged.
- **AC4**: The `stepfun-37` startup smoke test and the full repository
  verification cycle pass on the candidate head.

## Phase 0.5: Preflight Verification

Completed 2026-09-14 on branch `issue3293` (fresh from `main` @ `e5ec3a161`).

### Candidate recheck against current source (disposition workflow step 2)

| Candidate | Inventory claim | Current-source evidence | Verdict |
|---|---|---|---|
| `packages/tools/src/tools/stubs.ts` | definitely dead | File is an intentional-empty `export {}`; zero importers repo-wide; not an export-map target | remove (WS1) |
| `packages/tools/src/formatters/index.ts` | definitely dead (private barrel) | Zero importers; package root `src/index.ts` re-exports leaf modules directly; no export-map key | remove (WS1) |
| `packages/tools/src/types/index.ts` | definitely dead (private barrel) | Zero importers; root `src/index.ts` re-exports leaf modules directly; no export-map key | remove (WS1) |
| `packages/tools/src/types/provider-content-types.ts` | definitely dead | Zero importers repo-wide; not an export-map target | remove (WS1) |
| `packages/mcp/src/auth/oauth-provider-dependencies.ts` + `MCPOAuthProviderDependencies` | definitely dead | File already deleted by #3305 (merged 2026-08-28, `537366410`); zero references remain | already satisfied; no change |
| `packages/mcp/src/auth/oauthProviderTestSetup.ts` | test-only, remove | Consumed by `oauth-provider.authenticate.test.ts` and `oauth-provider.token.test.ts`, which exercise the live `MCPOAuthProvider` production module (reached from `mcp-oauth-helpers.ts`, `mcp-transport.ts` OAuth injection, `cli mcpAuth`) | **reject removal** (WS2 disposition, see below) |
| `packages/mcp/src/client/mcp-client.oauth.fixtures.ts` | test-only, remove | Consumed by `mcp-client.oauth.test.ts` (866 lines covering `connectToMcpServer` OAuth flows); rebuilt around the real host seam by #3305 | **reject removal** (WS2 disposition) |
| `packages/mcp/src/client/mcpClientTestHelpers.ts` | test-only, remove | Consumed by `mcp-client.oauth.test.ts` and `mcp-client.transport.test.ts`, which cover OAuth/auth-provider injection into real SDK transports — a boundary this issue explicitly protects | **reject removal** (WS2 disposition) |
| `requireOne` keyword (issue comment 2026-08-27) | dead twice over: unreachable through `validateToolParams` (getter strips it before validation reads the schema) and declared by no tool, MCP schema, or fixture | Confirmed: source references only in the two `schemaValidator.ts` copies, the `tools.ts` strip, and tests. `ripGrep.ts` no longer references it (post-#3361). `dist/`/`bundle/` hits are build artifacts | remove keyword handling in both validators + the strip (WS1) |

### Why the MCP test-support row is rejected (WS2 disposition)

The inventory row dates from 2026-08-24. PR #3305 ("Make the MCP package
standalone", merged 2026-08-28) rebuilt the MCP OAuth/transport suites around
exactly these three helpers and references #3305 in the test files. Today the
helpers' consumers cover live production contracts: `MCPOAuthProvider`
authentication/token flows and `McpClient` OAuth/auth-provider injection into
SDK transports. The issue body authorizes removal only for "obsolete MCP
fixtures and helpers whose tests cover no remaining production contract" and
forbids using test-support removal as evidence a production path is dead.
Deleting the helpers would require deleting or rewriting OAuth-injection
coverage that the issue's boundaries protect, or restructuring test
infrastructure, both out of bounds. Classification: **Reject** (stale
inventory evidence, live production contracts covered).

### Why the fake MCP discovery seam is not touched

The issue's planner comment proposed removing `fakeMcpDiscovery.ts` and its
root-barrel re-export. The seam is a documented shipped test double (the MCP
analogue of FakeProvider) driven by `LLXPRT_FAKE_MCP`:

- `mcp-client-manager.ts` branches on it in production code (discovery
  replay), so the module is production-reachable, not orphaned.
- Live consumers: `packages/a2a-server/src/http/app.test.ts`,
  `packages/a2a-server/src/config/config.createTaskAgent.test.ts`,
  `packages/agents/src/api/__tests__/helpers/fakeMcpServer.ts`, and
  `packages/mcp/src/client/mcp-client-manager.fake-discovery.test.ts`.
- The inventory did not classify the module or the re-export dead; inventory
  rule 4 retains public exports unless a focused review proves them dead.

Classification: **Reject** (not inventory-confirmed; live seam). The planner
comment's preflight ("verify test files that reference fake discovery are
limited to...") fails against current source, which confirms the comment's
removal premise was wrong.

### Verification gate

- [x] All four tools candidates reconfirmed dead (importers, export map,
      self-references, scripts, preloads).
- [x] MCP production-dead row verified already removed by #3305.
- [x] MCP test-only row verified live via post-inventory #3305 evidence.
- [x] `requireOne` verified dead in both copies; no declarer exists.
- [x] Test infrastructure precedents located
      (`removed-google-tools.test.ts` guard style).

## Phase P1 (Work stream 1 — Production deletion): remove dead tools modules

### Requirements implemented

**REQ-3293-01**: The inventory-confirmed dead tools modules are removed and a
guard test pins their absence.

### Test-first

Create `packages/tools/src/__tests__/removed-dead-modules.test.ts`:

- Assert `createRequire(import.meta.url).resolve(...)` throws for
  `../tools/stubs.js`, `../formatters/index.js`, `../types/index.js`, and
  `../types/provider-content-types.js`.
- Assert the live leaf modules still resolve: `../formatters/IToolFormatter.js`,
  `../formatters/ToolFormatter.js`, `../types/tool-names.js`,
  `../types/tool-context.js` (guards against taking live surface with us).
- Reference the issue and inventory in the header comment; include
  `@plan:PLAN-20260914-ISSUE3293.P1` / `@requirement:REQ-3293-01` markers.

Run it: the four absence assertions fail (modules still resolve). Then delete:

- `packages/tools/src/tools/stubs.ts`
- `packages/tools/src/formatters/index.ts`
- `packages/tools/src/types/index.ts`
- `packages/tools/src/types/provider-content-types.ts`

Re-run: guard passes.

### Verification

- `cd packages/tools && bun test src/__tests__/removed-dead-modules.test.ts`
- `npm run test --workspace @vybestack/llxprt-code-tools`
- `npm run lint --workspace @vybestack/llxprt-code-tools` and
  `npm run typecheck --workspace @vybestack/llxprt-code-tools`
- Repo-wide `grep -rn "stubs.js\|formatters/index\|types/index\|provider-content-types" packages/ --include="*.ts"` (excluding `dist/`, `bundle/`, `llm-types`) is empty.

## Phase P2 (Work stream 1 — Production deletion): remove the dead `requireOne` keyword

### Requirements implemented

**REQ-3293-02**: The unreachable `requireOne` custom schema keyword and its
now-pointless strip are removed from the tools and core validators, with test
coverage updated alongside (issue comment: "that test gets updated or deleted
alongside").

Both validator copies move in the same change per the issue's cross-slice
note; the `packages/core` copy is otherwise #3294 territory, and this change
does not touch any other core code.

### Test-first

1. Add the failing behavior pin (fails before, passes after):
   - `packages/tools/src/utils/schemaValidator.compileCache.test.ts`: new test
     "treats requireOne as an unknown keyword, not an enforced constraint" —
     `SchemaValidator.validate({type:'object', properties:{old_string:{type:'string'},new_string:{type:'string'}}, requireOne:[['old_string','new_string']]}, {})`
     returns `null` after the removal (today it returns the
     "at least one of required properties" error).
   - `packages/core/src/utils/schemaValidator.test.ts`: same test against the
     core copy.
2. Update existing tests that reference the keyword:
   - `packages/tools/src/tools/tools.schemaIdentity.test.ts`: drop
     `requireOne` from `PARAMETER_SCHEMA`; replace "still strips requireOne
     from the schema sent to the model" with a content-parity assertion
     ("sends the declared parameter schema content to the model":
     `expect(parameters).toStrictEqual(PARAMETER_SCHEMA)` plus the
     no-source-mutation check); delete the characterization "does not enforce
     requireOne through validateToolParams" (nothing left to characterize).
   - `packages/tools/src/utils/schemaValidator.compileCache.test.ts` and
     `packages/core/src/utils/schemaValidator.compileCache.test.ts`: delete
     "keeps requireOne enforcement across repeated validations" (repeated-
     validation error reporting remains covered by "still reports validation
     errors after repeated validations").

### Implementation

- `packages/tools/src/utils/schemaValidator.ts`:
  - Remove `requireOne?: string[][];` from `ExtendedSchema`.
  - Remove `delete ajvSchema.requireOne;` from `deriveAjvSchema` (adjust its
    comment: the only internal keyword left to strip is `$schema`).
  - Remove the `if (extSchema.requireOne) { ... }` block from `validate`.
- `packages/core/src/utils/schemaValidator.ts`: the same three removals (plus
  the trailing comment on the type field and the "Handle our custom
  requireOne validation first" comment).
- `packages/tools/src/tools/tools.ts` `buildSchema()`: remove the two
  "Strip requireOne..." comment lines and `delete schemaClone.requireOne;`.
  The shallow clone stays: it preserves the memoized-identity contract and
  keeps the returned schema isolated from downstream mutation.
- Include `@plan:PLAN-20260914-ISSUE3293.P2` / `@requirement:REQ-3293-02`
  markers on new/edited tests.

### Verification

- `bun test packages/tools/src/tools/tools.schemaIdentity.test.ts
  packages/tools/src/utils/schemaValidator.compileCache.test.ts
  packages/core/src/utils/schemaValidator.test.ts
  packages/core/src/utils/schemaValidator.compileCache.test.ts`
- `grep -rn "requireOne" packages/ --include="*.ts" | grep -v dist | grep -v bundle`
  returns only the two new behavior-pin tests asserting the keyword is
  ignored.
- `npm run test --workspace @vybestack/llxprt-code-tools` and
  `npm run test --workspace @vybestack/llxprt-code-core`.
- `npm run lint` / `npm run typecheck` for both workspaces.

## Work stream 2 — Test-support removal (disposition)

Removals performed: the requireOne-specific test updates in P2 (tests whose
only subject was the removed keyword).

Removals rejected with evidence (recorded so the next audit does not
rediscover them):

1. `packages/mcp/src/auth/oauthProviderTestSetup.ts` — retained; consumers
   cover the live `MCPOAuthProvider` production contract.
2. `packages/mcp/src/client/mcp-client.oauth.fixtures.ts` — retained;
   consumers cover `connectToMcpServer` OAuth flows.
3. `packages/mcp/src/client/mcpClientTestHelpers.ts` — retained; consumers
   cover OAuth/auth-provider injection into real SDK transports (protected
   boundary).
4. `packages/mcp/src/fake/fakeMcpDiscovery.ts` and its root re-export —
   retained; shipped seam with live consumers (see Phase 0.5).

Test-support removal was not used as evidence that any production path is
dead; the reverse inference (live contracts ⇒ retain support) drove every
rejection.

## Repository verification cycle

Run after implementation and after every remediation round:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

## Deferred-implementation detection

`grep -rn -E "(TODO|FIXME|HACK|STUB|placeholder|not yet)"` over modified
files must return nothing new. Pure deletions introduce no implementation.

## Failure recovery

- `git checkout -- packages/tools packages/core` reverts both phases.
- Guard and behavior-pin tests are new files; delete to revert test-first
  scaffolding.

## Review cadence

Per repo policy: implementation by subagent, one deepthinker review round,
at most one remediation round; no OCR (disabled until re-enabled). CodeRabbit
on the PR is addressed per its own findings.

## Execution log (2026-09-14)

Implementation via `fallbacktypescriptcoder` subagent (typescriptexpert
profile unavailable: transport failures). All work performed on branch
`issue3293`, left uncommitted.

### TDD evidence

- P1 red: `removed-dead-modules.test.ts` — four absence assertions failed
  ("Received function did not throw") while all four live-module assertions
  passed, before deletion.
- P2 red: both new "treats requireOne as an unknown keyword" pins failed with
  `params must have at least one of required properties: old_string,
  new_string` before the production edits.
- Focused green after implementation: 44 pass / 0 fail across the five
  touched test files
  (`tools.schemaIdentity`, both `schemaValidator.compileCache` copies, core
  `schemaValidator.test`, removal guard).

### Reference sweeps

- `requireOne` in source exists only inside the two new behavior-pin tests
  (titles + fixtures). No production references, no stale test references.
- Deleted module paths appear only inside the new absence guard. No other
  source, script, or test consumers.

### Repository verification cycle (results)

| Step | Result |
| --- | --- |
| `npm run test` (full, all workspaces) | 27,115 pass / 88 fail with changes vs 27,105 pass / 87 fail on clean `main` (stash A/B, identical environment). Failure file sets identical except one file (below). Delta = exactly the +10 new tests, all passing. |
| Pre-existing failures | 44 files (CLI package + `packages/test-utils/src/test-rig.test.ts` + 4 runner self-test fixtures) reproduce identically on clean `main` in this checkout — machine/environment-specific, not caused by this change. `tools` (136/136), `core` (650/650), `mcp` (43/43) fully green. |
| Differing file | `src/utils/sandbox-podman-diagnostics.test.ts` (cli; podman/ssh subprocess timing test, no code path shared with this diff) failed once under full-suite load, passed on `main` baseline, and passed 3/3 in isolation with changes present → load-dependent flake, not a regression. |
| `npm run lint` | exit 0 |
| `npm run typecheck` | tools + core workspaces green. Remaining failure: `packages/agents` `profileRepositoryAdapter.test.ts` `disabled-tools` errors — proven byte-identical on clean `main` via stash A/B (pre-existing). `settings` TS6305 stale-`dist` errors disappeared after `npm run build` refreshed outputs. |
| `npm run format` | exit 0; `git status` shows only this change's files (no unrelated reformatting; diff stat unchanged +43/−326) |
| `npm run build` | exit 0 |
| Smoke | `bun scripts/start.ts --profile-load zai "write me a haiku and nothing else"` — clean startup, profile load, model turn (GLM-5.3), haiku returned, clean exit. (`stepfun-37` profile dead since StepFun subscription ended 2026-09-13; `zai` substituted.) |

Raw logs: `tmp/verify3293/` (full-test.log, full-test-main.log,
fails-with-changes.txt, fails-main.txt, lint-typecheck-build.log,
typecheck2.log, format.log, smoke.log); implementation-phase logs in
`tmp/verify3293-implementation/`.

## Execution log addendum (2026-09-14, post-PR)

PR #3675 opened; its first CI run failed the `core` shard on
`local-media-store-locking > LocalMediaStore quota enforcement >
deduplicates the same blob across concurrent child processes` (plus two
nested runner-fixture lines that are expected output of passing
runner-policy tests). No code path connects this change to media-store
locking; the canonical core suite passes locally.

While the PR ran, main advanced past this branch's base (e5ec3a161):
#3671 merged sibling issue #3294, which independently deleted the same
four tools modules this plan removes, and #3666 fixed the pre-existing
agents typecheck error documented above. Response:

- Merged `origin/main` into `issue3293` — clean, no conflicts. Upstream
  added no competing guard test, so `removed-dead-modules.test.ts`
  remains the only pin on those deletions.
- Post-merge unique diff vs main: 9 files (+421/−105) — the requireOne
  removal (both validator copies + `buildSchema` strip), behavior pins,
  schemaIdentity/compileCache updates, the guard test, and this plan.
  The four module deletions no longer appear (already in main via #3671).
- Post-merge verification: focused 44/44 green; canonical tools suite
  exit 0; canonical core suite exit 0 (media-store test green locally);
  tools/core/agents typechecks all exit 0 (agents fixed by #3666). A
  transient core typecheck failure (`toolOutputMaxTokens` TS2307) was
  stale local `dist` from the merge and cleared after `npm run build`
  (BUILD_EXIT=0, CORE_TC=0). Logs: `tmp/verify3293/post-merge-verify.log`,
  `tmp/verify3293/rebuild-typecheck.log`.

## Execution log addendum 2 (2026-09-14, review decision)

Removed `packages/tools/src/__tests__/removed-dead-modules.test.ts` at
Andrew's review. Rationale recorded: a module-absence guard pins a
historical deletion, not a live contract. Accidental reintroduction of a
deleted private file is not a plausible failure mode; a deliberate new
file at those paths is ordinary reviewed work. The live-leaf resolution
assertions were redundant with the package's own import graph. The
red-first evidence from the guard remains in the P1 logs
(`tmp/verify3293-implementation/p1-red.log`, `p1-green.log`); only the
permanent artifact is gone.

The `requireOne` behavior pins stay: they assert current `validate`
behavior — an unknown keyword in a schema must not fail validation —
which is a live contract for externally sourced schemas (MCP tool
schemas are third-party input and can carry arbitrary keys), not a
marker of this deletion. Focused suite after removal: 36/36 across the
four remaining files.
