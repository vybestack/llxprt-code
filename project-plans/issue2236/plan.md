# Issue #2236 plan: Remove confirmed unused workspace dependencies

## Purpose

Remove the dependency declarations that the 0.12.0 dead dependency inventory
(`project-plans/issue2233/inventory.md`, analyzed at commit `3549572` on
2026-08-26) classified as cleanup candidates, after re-verifying every
candidate against the current branch head. The inventory is advisory; this
plan records the current-head evidence that authorizes each removal.

## Accepted behavior

### AC-1: Candidate re-verification on current head

Every inventory candidate that still exists in a manifest is re-verified
against current main before removal. A candidate is removable only when the
owning workspace (plus its scripts, config, bundle configuration, dynamic
import strings, and package metadata) has no reference to it. Candidates that
gained importers since the inventory are retained and documented.

### AC-2: Evidence for every removal

Every removed declaration has PR-note evidence citing either the inventory
row or fresh current-head search results. Removals are grouped by package
family in one PR because cross-workspace lockfile churn is the main change.

### AC-3: Lockfile consistency

After the manifest edits, `npm install` (npm 11.6.2 per `packageManager`)
updates `package-lock.json`, plain `bun install` updates `bun.lock` (never
`--frozen-lockfile`; see workflow gotchas), and `npm run check:lockfile`
passes. `npm install` completing against the edited manifests is the npm
lockfile validation required by the issue.

### AC-4: Full verification passes

The full verification cycle passes on the candidate head:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load zai "write me a haiku and nothing else"
```

Long-running commands are launched with `nohup ... &` and polled (the
external watchdog SIGTERM-kills long foreground commands), with logs under
`tmp/verify2236/` (gitignored, unique per this effort).

Additional targeted verification beyond the cycle:

- CLI candidates: run the 15 CLI test files that `vi.mock('read-package-up')`,
  `npm run bundle:cli`, and `node scripts/tests/issue-2603-release-install-smoke.cjs`
  (non-hoisted packed-CLI smoke; it packs the CLI tarball, installs into an
  isolated consumer, and runs `--version`).
- Core candidates: core workspace tests, typecheck (including declaration
  emission via `npm run build --workspace @vybestack/llxprt-code-core`), and
  consumer checks through the normal cycle.
- test-utils: test-utils workspace tests plus a consumer workspace (tools)
  test run to prove the storage preload still works after the manifest change.
- ast-grep family: `scripts/tests/issue-3055-cli-externals-ownership.bun.test.ts`
  and `scripts/tests/issue-3181-pwsh-resolution.bun.test.ts` must still pass
  (they guard CLI externals ownership; this PR must not touch CLI ast-grep or
  tree-sitter-pwsh declarations).

### AC-5: Ambiguous dependencies retained and documented

Candidates whose current-head evidence is ambiguous are retained and the
ambiguity documented in the PR notes rather than removed speculatively.

### AC-6: No metadata changes without stale confirmation

The inventory found no confirmed-stale `exports`/`bin`/`files` metadata.
This effort makes no package metadata changes.

## Current-head candidate disposition

Re-verified on branch `issue2236` from `main` at `e5ec3a161` (2026-09-14).
Inventory candidates already removed from manifests by earlier work are
skipped and listed here for the record: CLI `@anthropic-ai/sdk` and `openai`;
core `@ai-sdk/openai`, `@anthropic-ai/sdk`, `ai`, `cheerio`, `node-fetch`,
and `openai`.

### Removals

| Manifest | Declaration | Section | Current-head evidence |
| --- | --- | --- | --- |
| root `package.json` | `@types/html-to-text` | devDependencies | No importer; html-to-text types move to tools (its only runtime importer). See ownership corrections. |
| `packages/auth/package.json` | `fast-check` | devDependencies | Zero `fast-check` references in auth outside the manifest; importers live in agents/cli/core/lsp/mcp/providers/telemetry (root and own declarations serve them). |
| `packages/ide-integration/package.json` | `fast-check` | devDependencies | Same: zero package references. |
| `packages/policy/package.json` | `fast-check` | devDependencies | Same: zero package references. |
| `packages/cli/package.json` | `@babel/runtime` | devDependencies | No static/type/test/script/bundle/dynamic/metadata reference in CLI. |
| `packages/cli/package.json` | `@testing-library/dom` | devDependencies | Same. |
| `packages/cli/package.json` | `dom-accessibility-api` | devDependencies | Same. |
| `packages/cli/package.json` | `lz-string` | devDependencies | Same. |
| `packages/cli/package.json` | `pretty-format` | devDependencies | Same. |
| `packages/cli/package.json` | `gradient-string` | dependencies | No CLI import; not a bundle external (EXTERNALS + CLI_DIRNAME_DEPENDENT_EXTERNALS in `scripts/bun-build.config.ts`). |
| `packages/cli/package.json` | `highlight.js` | dependencies | Same. |
| `packages/cli/package.json` | `ink-select-input` | dependencies | Same. |
| `packages/cli/package.json` | `wrap-ansi` | dependencies | Same. |
| `packages/cli/package.json` | `mime-types` | dependencies | No CLI import; core and tools import it and both declare it. |
| `packages/cli/package.json` | `read-package-up` | dependencies | Inventory manual-validation row. No CLI source import (production importer is `packages/core/src/utils/package.ts`; core declares it). 15 CLI test files `vi.mock('read-package-up')`, which intercepts the specifier. Removal decided by the AC-4 CLI experiment: mocked tests + build + `bundle:cli` + 2603 release-install smoke all green. |
| `packages/core/package.json` | `@ast-grep/lang-c`, `-cpp`, `-csharp`, `-go`, `-java`, `-json`, `-kotlin`, `-php`, `-python`, `-ruby`, `-rust`, `-scala`, `-swift`, `@ast-grep/napi` (14 declarations) | dependencies | Zero `@ast-grep/` imports anywhere under `packages/core` (src, index, tests). Runtime resolution owners: root manifest (all 14, in-repo hoisting), CLI manifest (all 14, bundle externals enforced by issue-3055 test), tools manifest (subset it imports). Core's published `dist` cannot emit a specifier its source never imports. |
| `packages/core/package.json` | `@types/debug` | devDependencies | No `debug` import in core (only telemetry imports debug); no tsconfig `types` entry references it. |
| `packages/core/package.json` | `@types/diff` | devDependencies | No `diff` import in core (tools owns diff); no tsconfig reference. |
| `packages/core/package.json` | `@types/minimatch` | devDependencies | Zero `minimatch` importers repo-wide; no tsconfig reference. |
| `packages/core/package.json` | `@types/html-to-text` | devDependencies | Types move to tools; core has no html-to-text import. |
| `packages/core/package.json` | `ajv-formats` | dependencies | Zero importers repo-wide (root also declares it; root's declaration is out of scope — not an inventory candidate). |
| `packages/core/package.json` | `diff` | dependencies | Tools imports and declares it; core does not import it. |
| `packages/core/package.json` | `fast-glob` | dependencies | Tools imports and declares it; core does not. |
| `packages/core/package.json` | `html-to-text` | dependencies | Tools imports and declares it; core does not. |
| `packages/core/package.json` | `https-proxy-agent` | dependencies | Zero importers in core; no script/config/bundle reference from core. |
| `packages/core/package.json` | `micromatch` | dependencies | Zero importers repo-wide. |
| `packages/core/package.json` | `nock` | devDependencies | Zero imports in core tests/runners. |
| `packages/core/package.json` | `open` | dependencies | CLI imports and declares it; core does not import it. |
| `packages/core/package.json` | `turndown` | dependencies | Tools imports and declares it; core does not. |
| `packages/core/package.json` | `vscode-jsonrpc` | dependencies | LSP and ide-integration import and declare it; core does not. |
| `packages/core/package.json` | `html-to-text` pairing note | dependencies | Covered above. |
| `packages/test-utils/package.json` | `@vybestack/llxprt-code-storage` | dependencies | Inventory S-row. `test-setup-storage-isolation.ts` imports `../storage/src/testing.js` relatively; no name-based import of the storage package exists in test-utils. Private package, never published (NON_NPM_RELEASE_PACKAGES). Removal decided by AC-4 test-utils + tools consumer verification. |
| `packages/vscode-ide-companion/package.json` | `npm-run-all` | devDependencies | Nothing invokes `npm-run-all`/`run-s`/`run-p` anywhere. The `watch` script invokes `npm-run-all2`, which is a different package and is NOT in the lockfile — the script is already broken independent of this removal. Document the pre-existing breakage in PR notes; fixing it requires adding `npm-run-all2` (a dependency addition, out of scope for this removal issue). |

### Ownership corrections (no net-new functionality)

| Correction | Reason |
| --- | --- |
| `execa`: remove only the unused `packages/core` dependencies declaration | Core has zero execa imports. Root `dependencies` already declares `execa` (`^9.6.0`) for scripts, including `scripts/run-lint.ts:34`; that declaration remains unchanged. No root devDependencies addition is needed. |
| `@types/html-to-text`: remove from root and core devDependencies, add to `packages/tools` devDependencies (`^9.0.4`) | `html-to-text@9.0.5` ships no bundled types; `@types/html-to-text` supplies them; tools' `direct-web-fetch.ts` is the only runtime importer and tools is the only workspace that needs the types at compile time. Keeps typecheck green after root/core removals. |

These corrections preserve dependency ownership for the import sites above:
root already owns execa, and tools gains the html-to-text type declaration.

### Retained and documented

| Declaration | Reason |
| --- | --- |
| Root `html-to-text`: RETAIN in dependencies | Publish-integrity S6 (`scripts/tests/publish-integrity.test.ts:631`) requires root coverage of shipped workspace dependencies. Removing it failed with `packages/tools: html-to-text (mandatory) is not declared in root dependencies, optionalDependencies, or peerDependencies`. Only `@types/html-to-text` moves to tools; the root runtime declaration remains `^9.0.5`. |
| CLI `sharp`: RETAIN | Review found a direct importer: `packages/cli/scripts/verify-sandbox-runtime.ts:10` (`import sharp from 'sharp'`). |
| Core `msw`: RETAIN/DEFER | No core importers, but `scripts/tests/bun-workspaces.test.ts:105` classifies msw and lines 657-667 assert stale-list entries. Removing msw from the npm graph requires updating that test; defer to a follow-up. |
| `packages/tools` `html-to-text` (runtime) | Inventory candidate is superseded by current-head drift: `direct-web-fetch.ts:23` imports it. |
| Root `depcheck`, `ts-prune` devDependencies | Not inventory candidates; the inventory explicitly classified them as invoked analysis tools. Retained for future inventory work. |
| CLI `@ast-grep/*` (14), `tree-sitter-pwsh`, `@dqbd/tiktoken`, `update-notifier`, `yargs` | Bundle externals; direct CLI ownership enforced by `issue-3055` and `issue-3181` tests. Not candidates. |
| vscode `watch` script invoking undeclared `npm-run-all2` | Pre-existing breakage; fixing requires a dependency addition, out of scope. Documented as follow-up. |

## Bounded exceptions

`packages/agents/src/core/profile/__tests__/profileRepositoryAdapter.test.ts`
includes a three-line fix replacing the legacy `disabled-tools` setting with
`tools.disabled`. Settings commit `74269d2b2` removed the legacy key and left
this test failing `tsc -p tsconfig.noemit.json` on clean main. This exception
is required to keep the typecheck gate green; no other test edits are included.

## Out of scope

- No production source, workflow, or package metadata (`exports`, `bin`,
  `files`) changes. Test changes are limited to the bounded exception above.
- No new quality tooling, no analyzer configuration, no agent-memory changes.
- No removals beyond the inventory candidate table plus the two documented
  ownership corrections and the two inventory-flagged experiments
  (`read-package-up`, test-utils storage) that AC-4 decides.
- Root manifest dependencies that are not inventory candidates stay
  untouched (the root manifest serves workspace hoisting broadly).

## Lockfile procedure

1. Edit the nine manifests (root, auth, cli, core, ide-integration, policy,
   test-utils, tools, vscode-ide-companion).
2. `npm install` (regenerates `package-lock.json`; completes = npm validation).
3. `bun install` (regenerates `bun.lock`; plain install only).
4. `npm run check:lockfile`.
5. `git diff` review: manifest edits, the two lockfiles, this plan, and only
   the bounded `profileRepositoryAdapter.test.ts` exception above.

## Review policy

- One implementation review by deepthinker (max 2 rounds: initial + one
  remediation). Reviewer must re-verify a sample of removals against imports
  and bundle config and confirm the AC-4 evidence.
- Open Code Review is NOT run for this effort: OCR is disabled until Andrew
  explicitly re-enables it (standing instruction 2026-09-13).
- Findings classified Blocker-Fix / In-scope-Fix / Reject / Defer; reviewer
  suggestions do not authorize scope expansion.
