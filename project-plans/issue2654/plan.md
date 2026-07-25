# Issue #2654 — Documentation audience, placement, and writing standards

## Verified ground truth (measured on branch `issue2654`, not copied from the issue)

| Claim in issue | Verified state |
| --- | --- |
| 77 `docs/**/*.md`, 22 `dev-docs/**/*.md` | 77 in `docs/`; **23** in `dev-docs/` (`ocr-version-1.7.16-comparison.md` landed after the audit). Total 100. |
| 3 broken repo-relative links | **10 broken links** across 6 files (measured; see below). The issue undercounted. |
| Telemetry "initialization is commented out / source changes required" | **False.** `packages/core/src/config/configConstructor.ts:499` calls `initializeTelemetry(config)` unconditionally; `packages/telemetry/src/telemetry/sdk.ts:44` early-returns only when `getTelemetryEnabled()` is false, then starts a real `NodeSDK`. Exporters are `File*Exporter` when `telemetryOutfile` is set, else `Console*Exporter`. OTLP/network exporters are genuinely absent from the code path. So `telemetry.enabled: true` **works**, locally, file/console only. `docs/telemetry.md` is actively wrong in three places. |
| `docs/hooks/best-practices.md` has an orphaned `Promise.all` fragment | **True**, lines 806–813: a `Promise.all` snippet sits outside any fence, immediately after the "Learn more" list, before `## Using Hooks Securely`. |
| Duplicated security guidance in best-practices | **True.** `SECRET_PATTERNS`/`containsSecret` appears at lines 88–98 **and** 971–981; "Security considerations" (line 7) and "Authoring Secure Hooks" (line 892) overlap heavily. |
| Six misplaced internal docs under `docs/` | **True**; all six exist. |
| Two overlapping keyboard-shortcut docs | **True.** Both `docs/keyboard-shortcuts.md` and `docs/cli/keyboard-shortcuts.md` carry `KEYBINDINGS-AUTOGEN` markers, but `scripts/generate-keybindings-doc.ts:25` only writes `docs/keyboard-shortcuts.md`. So `docs/cli/keyboard-shortcuts.md` is a **stale orphan** — nothing references it and nothing regenerates it. |
| `.lycheeignore` is orphaned | **True.** No `lychee` reference anywhere in `.github/`, `package.json`, or `scripts/`. |

### Measured broken links (10)

```
docs/cli/configuration.md          -> ../core/tools-api.md#built-in-tools
docs/cli/enterprise.md             -> ../get-started/configuration.md
docs/cli/enterprise.md             -> ../core/tools-api.md
docs/cli/enterprise.md             -> ./sandbox.md
docs/cli/enterprise.md             -> ./telemetry.md
docs/cli/profiles.md               -> ./sandboxing.md
docs/cli/skills.md                 -> ./llxprt-md.md
docs/cli/skills.md                 -> ../extensions/index.md
docs/cli/tutorials/skills-getting-started.md -> ../../extensions/index.md
docs/hooks/best-practices.md       -> ../hooks-design.md
```

Retarget map (each target verified to exist):

| Broken | Retarget to |
| --- | --- |
| `../core/tools-api.md#built-in-tools` (configuration.md) | `../tools/index.md` |
| `../get-started/configuration.md` (enterprise.md) | `./configuration.md` |
| `../core/tools-api.md` (enterprise.md) | `../tools/index.md` |
| `./sandbox.md` (enterprise.md) | `../sandbox.md` |
| `./telemetry.md` (enterprise.md) | `../telemetry.md` |
| `./sandboxing.md` (profiles.md) | `./sandbox-profiles.md` |
| `./llxprt-md.md` (skills.md) | `../tools/memory.md` |
| `../extensions/index.md` (skills.md) | `../extension.md` |
| `../../extensions/index.md` (skills-getting-started.md) | `../../extension.md` |
| `../hooks-design.md` (best-practices.md) | `../../dev-docs/hooks/architecture.md` (after relocation) |

## Scope decision

The issue is an audit with a P0/P1/P2 plan spanning ~30 documents. Attempting all three phases in one PR would produce an unreviewable diff and mix mechanical moves with subjective prose rewrites. **This PR delivers P0 + the mechanical, verifiable parts of P1/P2, plus the prevention machinery that makes the rest enforceable.** Subjective full-page rewrites (agent-api, mcp-server, sandbox tone, quick-reference pricing split) are deferred to a follow-up issue, because they are prose-quality work with no mechanical acceptance test and they would swamp review of the correctness fixes.

### In scope

1. **P0 correctness/safety**
   - Rewrite `docs/Uninstall.md` (remove `gemini-cli`; global npm first; npx cache clearing demoted to optional troubleshooting with a collateral-deletion warning).
   - Rewrite `docs/telemetry.md` to match verified source behavior; move re-enable/network internals to `dev-docs/telemetry-internals.md`.
   - Repair `docs/hooks/best-practices.md`: delete the orphaned fragment, merge the duplicated security sections, preserve the `#using-hooks-securely` anchor (`docs/extension.md` links to it).
   - Fix **all 10** broken relative links.

2. **P1 placement (mechanical, `git mv` + inbound-link updates)** — the six relocations, with `docs/tool-parsing.md` leaving behind a user-facing settings/`/toolformat` page.

3. **P2 prevention (the part that stops regression)**
   - `scripts/check-doc-links.ts` + `npm run lint:doc-links`, wired into `ci.yml` and `scripts/lint-all.sh`. Recursive, fails on broken repo-relative links and on broken in-file anchors.
   - `scripts/check-doc-placement.ts` + `npm run lint:doc-placement`: fails if `docs/` regains an internal-only directory (`architecture/`, `plans/`, `merge-notes/`) or if a `docs/` page carries plan/requirement bookkeeping markers (`@plan:`, `@requirement:`, `PLAN-`, `REQ-`).
   - Delete the stale orphan `docs/cli/keyboard-shortcuts.md` (nothing references it; generator does not target it) and assert single-generator-target in a test.
   - `dev-docs/documentation-style-guide.md` + docs review checklist, referenced from `CONTRIBUTING.md`.

Both new guards are pure Node/Bun scripts with unit tests — no lint-rule loosening, no suppression directives.

### Out of scope (follow-up issue to be filed)

Prose rewrites of `docs/agent-api.md` (1373 lines), `docs/tools/mcp-server.md` (730), `docs/migration/approval-mode-to-policies.md` (734), `docs/providers/quick-reference.md` (667), `docs/hooks/writing-hooks.md`/`creating-custom-hooks.md` consolidation (1592 combined), `docs/sandbox.md` tone, `docs/message-bus.md`/`todo-system.md`/`memport.md`/`deployment.md` splits, `docs/release-notes/2025Q4.md` reorganization. The new placement/bookkeeping guard makes the *placement* half of that work mechanically enforced once done.

## Test-first plan (behavioral, per dev-docs/RULES.md — no mock theater)

Tests assert **observable behavior of the guard scripts** and **verifiable facts about the doc tree**. They operate on real fixture directories in temp dirs (guards) and on the real repo (tree assertions). Shared temp-dir lifecycle goes in one `useTempDir()` helper per RULES.md — no repeated `beforeEach` boilerplate.

### `scripts/tests/doc-links-guard.test.ts`

Behavioral tests against fixture trees:

1. Reports a link to a nonexistent sibling file as broken.
2. Accepts a link to an existing sibling file.
3. Ignores `http:`, `https:`, and `mailto:` links.
4. Ignores link-shaped text inside fenced code blocks.
5. Ignores link-shaped text inside inline code spans.
6. Resolves `../` links relative to the containing file, not the CWD.
7. Strips `#fragment` before existence checks.
8. Reports a `#fragment` that matches no heading in the target file.
9. Accepts a `#fragment` matching a GitHub-slugged heading (punctuation stripped, spaces → hyphens).
10. Accepts a link to a directory that contains `index.md`.
11. Accepts links to non-Markdown assets that exist (e.g. `assets/x.png`).
12. Honors `.lycheeignore` entries for external URLs.
13. Exits non-zero and prints `file -> target` for each break.
14. Exits zero on a clean tree.
15. Handles percent-encoded targets (`my%20file.md`).
16. Reference-style links (`[a]: ./b.md`) are checked.

### `scripts/tests/doc-placement-guard.test.ts`

1. Fails when `docs/architecture/` exists.
2. Fails when `docs/plans/` exists.
3. Fails when `docs/merge-notes/` exists.
4. Passes when those directories are absent.
5. Fails on a `docs/` file containing `@plan:`.
6. Fails on a `docs/` file containing `@requirement:`.
7. Fails on a `docs/` file containing a `PLAN-` marker.
8. Fails on a `docs/` file containing a `REQ-` marker.
9. Permits those markers under `dev-docs/`.
10. Permits those markers inside fenced code blocks in `docs/` (they may be legitimately quoted).
11. Reports every violation, not just the first.
12. Exits zero on a clean tree.

### `scripts/tests/doc-tree-invariants.test.ts` (asserts real repo state)

1. `docs/` contains no `architecture/`, `plans/`, or `merge-notes/` directory.
2. Each relocated document exists at its new `dev-docs/` path.
3. No relocated document remains at its old `docs/` path.
4. `docs/tool-parsing.md` still exists (user-facing settings page left behind).
5. Exactly one file in the repo carries `KEYBINDINGS-AUTOGEN:START`, and it is the generator's declared output path.
6. `docs/telemetry.md` does not claim telemetry is commented out or requires source modification.
7. `docs/Uninstall.md` does not mention `gemini-cli`.
8. `docs/Uninstall.md` presents `npm uninstall -g` before any cache-deletion command.
9. `docs/hooks/best-practices.md` retains a heading slugging to `using-hooks-securely` (`docs/extension.md` depends on it).
10. `SECRET_PATTERNS` appears at most once in `docs/hooks/best-practices.md`.
11. Every fenced code block in `docs/hooks/best-practices.md` is balanced (no orphaned fragment).
12. `CONTRIBUTING.md` links to the style guide.

### `scripts/tests/telemetry-doc-accuracy.test.ts`

Guards the doc against the source, so the two cannot silently diverge again:

1. `initializeTelemetry` is invoked unconditionally from the config constructor (documents "enabling the setting is sufficient").
2. `sdk.ts` constructs no OTLP exporter (documents "network exporters are disabled").
3. `sdk.ts` uses `File*Exporter` when an outfile is configured and `Console*Exporter` otherwise (documents the output-location claim).
4. `docs/telemetry.md` states the `telemetry.enabled` default is `false`.
5. `docs/telemetry.md` documents CLI-over-settings precedence.

Order: write all four suites first and watch them fail for the right reasons, then implement.

## Implementation order

1. Guard scripts + their tests (red → green on fixtures).
2. Wire `lint:doc-links` / `lint:doc-placement` into `package.json`, `scripts/lint-all.sh`, `.github/workflows/ci.yml`.
3. Fix the 10 broken links → link guard goes green on the real tree.
4. `git mv` the six relocations; update the 2 inbound `docs/` links (`docs/message-bus.md:238`, `docs/migration/approval-mode-to-policies.md:733`); leave the user-facing `docs/tool-parsing.md` behind.
5. Delete stale `docs/cli/keyboard-shortcuts.md`.
6. Rewrite `Uninstall.md`, `telemetry.md` (+ `dev-docs/telemetry-internals.md`), repair `hooks/best-practices.md`.
7. Style guide + review checklist + `CONTRIBUTING.md` reference.
8. Full verification: `npm run test`, `lint`, `typecheck`, `format`, `build`, and the ollamakimi smoke.

## Constraints for the implementer

- **No lint loosening and no suppressions.** No new `eslint-disable*`, no `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`, no severity downgrades, no complexity/size threshold increases, no `.eslintignore`/`ignores:` additions. `scripts/check-eslint-guard.js` enforces this in CI. Fix root causes.
- **Fail fast over defense in depth.** Guards should throw on malformed input rather than silently skipping files. Defensive parsing is acceptable only for the genuinely external input the guards read (arbitrary Markdown).
- **No tests that enshrine defects.** If a doc is wrong, the test asserts the correct state and the doc gets fixed.
- **One canonical helper for temp-dir lifecycle**, not copy-pasted `beforeEach`/`afterEach` blocks.
- Do not touch `.llxprt/`.
- Guards must be reasonably fast — they run in the CI lint job over ~100 files.
