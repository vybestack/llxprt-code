# Issue #2159 unknown-type audit and follow-up plan

## Decision

Issue #2159 is an analysis and tracking change. It does not change production code, tests, dependencies, workflows, settings, quality tools, or lint policy. The complete row-level result is in [INVENTORY.md](./INVENTORY.md).

At commit `2fadb59ac222308eee31e367a1c5b736f9ee7871`, the in-scope result is **4,359 rows: 4,340 casts and 19 retained production state annotations**. The binary verdict result is **14 `ABUSE` and 4,345 `LEGITIMATE BOUNDARY`**. The accepted 14 rows are the complete abuse set. Source inspection found no additional abuse candidate.

The previously reported 4,211 cast count is not valid for the stated scope. It omitted 129 casts in TypeScript files directly below package `src` directories.

## Audited revision and scope

- Repository: `vybestack/llxprt-code`
- Branch: `issue2159`
- Commit: `2fadb59ac222308eee31e367a1c5b736f9ee7871`
- Subject: `fix(sandbox): forward the capability descriptor through the bin shim (Fixes #3389) (#3390)`
- Audit date: 2026-08-27
- Tracked TypeScript and TSX files selected: 4,628
- Declaration files excluded: 9
- Files parsed: 4,619

Included:

- Every tracked `packages/**/src/**/*.{ts,tsx}` file.
- Files directly below each package `src` directory.
- Production files, tests, specs, Bun tests, helpers, harnesses, and fixtures.
- Every TypeScript `AsExpression` whose target is `unknown` or `unknown[]`.
- Each `as unknown as T` chain as one row at its inner `unknown` target.
- The 19 accepted retained production internal-state annotations listed by the scanner allowlist.

Excluded:

- `.d.ts`, including declaration-test files.
- Genuinely generated tracked TypeScript source. No such source was found at this revision. The generated-path candidate command returned zero.
- Ordinary parameter, return, local, event, DTO, index-signature, and parser annotations that are not one of the 19 accepted retained-state rows.

A test fixture, helper, or mock assertion is `LEGITIMATE BOUNDARY` when it intentionally constructs a malformed or partial runtime value and does not retain a production lint-invalid check. The verdict does not approve every local design. It answers whether the row is issue #2159 lint abuse.

## Scan resolution, 4,340 versus 4,211

The repaired AST scan returns:

| Form | Repaired in-scope scan | Omitted by recursive-only glob | Prior deep result |
|---|---:|---:|---:|
| `as unknown as T` | 3,960 | 128 | 3,832 |
| direct `as unknown` | 307 | 0 | 307 |
| `as unknown[]` | 73 | 1 | 72 |
| **Cast total** | **4,340** | **129** | **4,211** |

The 129-row difference is exact. A recursive-only filesystem glob interpreted `src/**/*` as requiring at least one directory after `src`. It omitted tracked files such as `packages/cli/src/cli.test.tsx`, `packages/lsp/src/main.ts`, `packages/providers/src/BaseProvider.test.ts`, `packages/test-utils/src/pty-backend.ts`, and `packages/vscode-ide-companion/src/ide-server.test.ts`. Filtering the repaired TSV to paths matching `packages/<package>/src/<file>` produces exactly 128 double casts and one array cast. Subtracting those rows reproduces all three prior form counts.

This was not a cast-chain classification difference. The AST visitor counts the inner `unknown` target once for each double-cast chain. It was not a generated-source difference. Tracked generated-path candidates were zero, and no generation marker identified an omitted tracked source.

The original audit also used the start of the whole cast expression as its line number. Multi-stage chains on separate lines could therefore share a path, line, and kind even though their `unknown` targets differed. The repaired scanner records `node.type.getStart(sourceFile)`. Its path, line, and kind keys are unique before inventory generation.

## Reproducibility method

The temporary scanner and reconciler are in `tmp/issue2159/` for this worktree. Their SHA-256 values are:

```text
6dd34a15a2707fe5a634ee06f300f3b6ac715e26d40ccf280b469ed8da9b37df  tmp/issue2159/audit.ts
5c95bce2b6f8d82635eb70b78d4cca3e44ef25a956a6599b25e7e0ecaa7fdbe9  tmp/issue2159/reconcile.ts
```

Run the following commands from the repository root. They select tracked files through Git, parse source with the installed TypeScript compiler, fail on duplicate reconciliation keys, produce package-root omission evidence, and reconcile every row against the inventory. The package diff guard permits the documentation-only audit commit while rejecting source drift from the audited revision.

```bash
set -euo pipefail

git diff --quiet 2fadb59ac222308eee31e367a1c5b736f9ee7871 -- packages
test -z "$(git status --porcelain --untracked-files=no)"
mkdir -p tmp/issue2159

shasum -a 256 tmp/issue2159/audit.ts tmp/issue2159/reconcile.ts
bun tmp/issue2159/audit.ts \
  > tmp/issue2159/audit.tsv \
  2> tmp/issue2159/audit-summary.txt
cat tmp/issue2159/audit-summary.txt

git ls-files 'packages/**/src/*.ts' 'packages/**/src/*.tsx' \
  | sort -u > tmp/issue2159/all-tracked-typescript.txt
git ls-files 'packages/**/src/*.d.ts' \
  | sort -u > tmp/issue2159/declaration-files.txt
printf 'tracked=%s declarations=%s scanned=%s\n' \
  "$(wc -l < tmp/issue2159/all-tracked-typescript.txt | tr -d ' ')" \
  "$(wc -l < tmp/issue2159/declaration-files.txt | tr -d ' ')" \
  "$(git ls-files 'packages/**/src/*.ts' 'packages/**/src/*.tsx' \
      | grep -vE '\.d\.ts$' | sort -u | wc -l | tr -d ' ')"

git ls-files 'packages/**/src/*.ts' 'packages/**/src/*.tsx' \
  | grep -Ei '(^|/)(generated|gen)(/|\.)|\.generated\.|\.gen\.' \
  > tmp/issue2159/generated-path-candidates.txt || true
test ! -s tmp/issue2159/generated-path-candidates.txt

perl -F'\t' -lane '
  next if $F[0] eq "state : unknown";
  if ($F[1] =~ m{^packages/[^/]+/src/[^/]+$}) {
    $count{$F[0]}++;
  }
  END {
    print "root direct=", $count{"as unknown"} // 0;
    print "root double=", $count{"as unknown as T"} // 0;
    print "root array=", $count{"as unknown[]"} // 0;
  }
' tmp/issue2159/audit.tsv \
  > tmp/issue2159/package-src-root-counts.txt
cat tmp/issue2159/package-src-root-counts.txt

bun tmp/issue2159/reconcile.ts \
  | tee tmp/issue2159/reconciliation-result.txt
```

Expected scanner status:

```text
AUDIT SUMMARY (files=4619): as unknown=307 as unknown as T=3960 as unknown[]=73 state : unknown=19 TOTAL=4359
```

Expected package-root evidence:

```text
root direct=0
root double=128
root array=1
```

Expected reconciliation status:

```text
RECONCILED audit=4359 inventory=4359 unique=4359 abuse=14 legitimate=4345 missing=0 extra=0 duplicate=0 invalidVerdict=0 emptyJustification=0
```

The scanner implementation must retain these properties when reconstructed: use `git ls-files` with both TS and TSX pathspecs; exclude only paths ending in `.d.ts`; parse with `typescript.createSourceFile`; visit every `AsExpression`; classify an `unknown` target as double only when its parent is an `AsExpression` whose expression is that node; classify `ArrayTypeNode(UnknownKeyword)` as array; use the target type start for the line; include the explicit 19-row state allowlist; sort by path and source position; and reject duplicate path, line, and kind keys. The reconciler must parse each inventory table row, compare the same path, line, and kind key, reject missing, extra, or duplicate keys, require one of the two binary verdicts, and require a non-empty justification.

## Counts by package, form, and verdict

| Package | Direct | Double | Array | State | Total | Abuse | Legitimate |
|---|---:|---:|---:|---:|---:|---:|---:|
| a2a-server | 0 | 29 | 0 | 0 | 29 | 0 | 29 |
| agents | 173 | 920 | 16 | 3 | 1,112 | 1 | 1,111 |
| auth | 1 | 5 | 0 | 0 | 6 | 0 | 6 |
| cli | 95 | 1,208 | 8 | 4 | 1,315 | 3 | 1,312 |
| core | 20 | 543 | 7 | 0 | 570 | 6 | 564 |
| ide-integration | 1 | 28 | 0 | 0 | 29 | 0 | 29 |
| lsp | 0 | 0 | 1 | 0 | 1 | 0 | 1 |
| mcp | 3 | 327 | 0 | 0 | 330 | 2 | 328 |
| providers | 10 | 816 | 33 | 11 | 870 | 0 | 870 |
| settings | 0 | 1 | 0 | 0 | 1 | 0 | 1 |
| storage | 2 | 1 | 0 | 0 | 3 | 0 | 3 |
| telemetry | 1 | 19 | 0 | 0 | 20 | 1 | 19 |
| test-utils | 0 | 2 | 0 | 0 | 2 | 0 | 2 |
| tools | 1 | 39 | 8 | 1 | 49 | 1 | 48 |
| vscode-ide-companion | 0 | 22 | 0 | 0 | 22 | 0 | 22 |
| **Total** | **307** | **3,960** | **73** | **19** | **4,359** | **14** | **4,345** |

## Accepted abuse rows and remediation design

| Row | Likely rule | Current flow | Root cause | Correct fix | Severity | Work class | Evidence |
|---|---|---|---|---|---|---|---|
| `packages/agents/src/core/TodoContinuationService.ts:33` | `@typescript-eslint/no-unnecessary-condition` | `ContentBlock` becomes `unknown`, then receives object and text guards. | The internal union promises normalized content while the service still expects malformed provider parts. | Validate or normalize provider content at ingestion, then consume an accurate discriminated content union here. | Medium | Boundary redesign | The parameter is `ContentBlock`; lines 29-30 state that malformed provider data is expected despite that declaration. |
| `packages/cli/src/ui/contexts/UIStateContext.tsx:129` | N/D, internal type widening | Known `Profile | null` data is retained as `unknown | null` in UI state context, shifting type recovery to consumers. | The context dropped the known profile type. | Use `Profile | null` through context and dialog props. | Low | Quick win | `DialogManager.tsx:369,392` cast this field back to `Profile`. Covered by #2194 and PR #3316. |
| `packages/cli/src/ui/containers/AppContainer/builders/buildUIState.ts:124` | N/D, internal type widening | The builder mirrors selected profile data as `unknown | null`. | The builder contract copied the widened context type instead of its source type. | Preserve `Profile | null` from `useAppDialogs` through `buildUIState`. | Low | Quick win | `useAppDialogs.ts:364` supplies `profileMgmt.selectedProfile`. Covered by #2194 and PR #3316. |
| `packages/cli/src/ui/containers/AppContainer/hooks/useKeybindings.ts:74` | N/D, internal type widening | `IdeContext | undefined` becomes `unknown`, then keybinding code repeats null checks. | The dependency interface discarded the known IDE context contract. | Use `IdeContext | undefined` and retain only behavior-relevant presence checks. | Low | Quick win | `UIStateContext.tsx:160` and `buildUIState.ts:155` already use `IdeContext | undefined`. Covered by #2194 and PR #3316. |
| `packages/core/src/prompt-config/prompt-loader.ts:303` | `@typescript-eslint/no-unnecessary-condition` | Required `baseDir: string` becomes `unknown` for a nullish check. | Signature and retained nullish behavior disagree. | Decide the public contract, then either accept nullish input explicitly or remove the unreachable branch. | Low | Quick win after contract choice | `loadAllFiles` declares `baseDir: string` at line 297. Covered by #2196 and PR #3280. |
| `packages/core/src/prompt-config/prompt-loader.ts:305` | `@typescript-eslint/no-unnecessary-condition` | Required `fileList: string[]` becomes `unknown` for a nullish check. | Signature and retained nullish behavior disagree. | Apply the same contract decision to `fileList` and its behavioral tests. | Low | Quick win after contract choice | `loadAllFiles` declares `fileList: string[]` at line 298. Covered by #2196 and PR #3280. |
| `packages/core/src/prompt-config/prompt-service.ts:199` | `@typescript-eslint/no-unnecessary-condition` | Required `PromptContext` becomes `unknown` before `isFalsyLike`. | The method promises a context while retaining a runtime missing-context branch. | Make missing context an explicit input state or remove the unreachable guard after proving callers. | Low | Quick win after contract choice | `getPrompt` declares `context: PromptContext` at line 191 and throws for falsy context at lines 199-201. |
| `packages/core/src/services/history/IContent.ts:417` | `@typescript-eslint/no-unnecessary-condition` | Typed `encryptedContent` becomes `unknown`, then receives string and truthiness checks. | Provider payload validation occurs after data has entered the trusted thinking-block type. | Normalize encrypted thinking content at the provider/history boundary and keep the internal field type accurate. | Medium | Boundary redesign | The thinking branch rechecks a typed internal property before calling `trim`. |
| `packages/core/src/utils/tool-utils.ts:141` | `@typescript-eslint/no-unnecessary-condition` | Invocation parameters become `unknown`, then receive object, null, and command checks. | The generic invocation contract and shell-command shape are not represented as a discriminated boundary. | Parse or narrow the shell invocation at registration/dispatch and pass a typed shell parameter object. | Medium | Boundary redesign | Lines 141-146 widen parameters, inspect `command`, and cast again to recover the field. |
| `packages/core/src/utils/toolOutputLimiter.ts:310` | `sonarjs/different-types-comparison`; `@typescript-eslint/no-unnecessary-condition` | A runtime value that can still be `false` or empty string is asserted as `number | undefined`, then becomes `unknown` so skip logic can compare the preserved sentinels. | `getOutputLimits` mis-types preserved runtime sentinels as `number | undefined`, erasing their static union. | Parse raw settings once into an explicit disabled, unset, or numeric result, then derive truncation behavior. | Medium | Boundary redesign | `rawMaxTokens` is created from `limits.maxTokens`; #2195 covers both limiter copies and no PR was found. |
| `packages/mcp/src/auth/oauth-token-storage.ts:131` | `@typescript-eslint/no-unnecessary-condition` | Typed `expiresAt` becomes `unknown` before expiry validation. | Persisted token data is trusted as `MCPOAuthToken` before runtime validation. | Parse persisted tokens once at storage load, including expiry shape, and keep validated tokens typed. | Medium | Boundary redesign | `isTokenExpired` accepts `MCPOAuthToken` but calls `isInvalidExpiry` only after re-widening. |
| `packages/mcp/src/auth/token-store.ts:110` | `@typescript-eslint/no-unnecessary-condition` | The base token-store helper repeats the typed-expiry re-widening. | The token contract does not distinguish unparsed persistence data from validated tokens. | Share the persisted-token parser and pass only validated expiry data to this helper. | Medium | Boundary redesign | Lines 110-116 re-widen, validate, cast to number, and compare. |
| `packages/telemetry/src/telemetry/uiTelemetry.ts:501` | `sonarjs/different-types-comparison` | `ToolCallDecision | undefined` becomes `unknown` only for an impossible empty-string comparison. | A legacy sentinel branch remains after `ToolCallEvent` construction narrowed the decision to its declared union. | Remove the unsupported empty-string branch and consume the typed decision directly. | Low | Quick win | `ToolCallEvent` derives the value through `getDecisionFromOutcome`; `coreToolScheduler.ts:857` constructs the production event, and no current producer supplies `''`. |
| `packages/tools/src/utils/toolOutputLimiter.ts:140` | `sonarjs/different-types-comparison`; `@typescript-eslint/no-unnecessary-condition` | The tools limiter repeats the runtime-union-to-static-number-to-unknown flow. | This copy also mis-types preserved runtime sentinels as `number | undefined`, erasing their static union. | Apply the explicit parsed-limit result without introducing a tools-to-core dependency. | Medium | Boundary redesign | `rawMaxTokens` is created from `limits.maxTokens`; #2195 covers both limiter copies and no PR was found. |

No other production cast is an abuse candidate. The 127 non-test production cast rows were matched to source-inspection notes. Test-support rows were checked under the malformed/partial-value rule above. `packages/cli/src/zed-integration/zed-terminal-manager.ts:49` remains legitimate because terminal wait state retains an arbitrary thrown error until it can be reported.

## SettingsService status

The SettingsService example that triggered the audit is fixed at this revision.

- `packages/settings/src/settings/SettingsService.ts` has no `as unknown` expression.
- Its provider state is `TrustedProvidersMap`.
- Read paths return trusted provider records directly.
- Load and write paths use `parseProviderSettingsRecord` and validation helpers from `packages/settings/src/settings/validation.ts`.
- The one settings-package inventory cast is in `packages/settings/src/__tests__/SettingsService.test.ts:394`; it is test support, not the former production re-widening cluster.

No SettingsService remediation remains for #2159.

## June audit reconciliation

The June 26, 2026 issue comment reported 211 rows: 207 textual cast rows and four state annotations. Its verdicts were 8 abuse, 29 design concern, and 174 legitimate boundary. The current result is not a deletion or growth delta from that comment because this audit changes four dimensions:

1. It parses AST nodes instead of counting textual matches.
2. It includes all tracked tests, helpers, harnesses, and fixtures under package `src` directories.
3. It includes 19 specifically retained production state annotations.
4. It audits commit `2fadb59ac222308eee31e367a1c5b736f9ee7871` and uses the required binary verdict.

The June list remains useful as historical evidence, but its totals and third verdict category cannot be compared directly with the current 4,359-row inventory. The current accepted abuse set is the 14-row table above. The SettingsService production cluster from the original report has been removed through typed validation. The 129-row scan discrepancy is separate from the June reconciliation and is fully explained by package `src` root files.

## Follow-up tracking

| Scope | Existing tracking | Current status | Required action |
|---|---|---|---|
| Three CLI state rows | #2194, PR #3316 | Covers `UIStateContext.tsx:129`, `buildUIState.ts:124`, and `useKeybindings.ts:74`. | Verify behavioral coverage and merge through the normal review process. |
| Both output limiter rows | #2195 | Covers core:310 and tools:140. No PR was found. | Implement the explicit parsed-limit design in both packages with equivalent behavior. |
| Prompt loader and adjacent utility review | #2196, PR #3280 | Covers `prompt-loader.ts:303,305` and reviews adjacent `partUtils.ts` and `tool-utils.ts`; PR #3280 intentionally leaves the audited `tool-utils.ts:141` cast unchanged. | Retain `tool-utils.ts:141` in the new core follow-up because its accepted abuse finding remains unresolved. Do not expand PR #3280. |
| Agents content normalization | #3398 | Covers `TodoContinuationService.ts:33`. | Normalize provider content before Todo continuation narrowing. |
| Core prompt, history, and tool parameter contracts | #3399 | Covers `prompt-service.ts:199`, `IContent.ts:417`, and `tool-utils.ts:141`. | Correct the three internal trust boundaries without expanding PR #3280. |
| MCP persisted expiry parsing | #3397 | Covers both MCP expiry rows. | Parse persisted tokens once and pass validated expiry data downstream. |
| Telemetry decision sentinel cleanup | #3396 | Covers `uiTelemetry.ts:501`. | Remove the unsupported empty-string branch and preserve metrics behavior for typed decisions. |

#2197 with PR #3371 concerns auth proxy payload validation. #2198 with PR #3286 concerns ToolFormatter accumulator state. The IDE singleton reset is another non-abuse cleanup. These three concerns are separate from the accepted abuse set and are not prerequisites for completing #2159.

## Behavioral evidence required in follow-ups

- **#2194 and PR #3316:** Prove that a selected `Profile` reaches both profile dialogs unchanged and that IDE keybindings use `IdeContext | undefined` without altering focus or copy-mode behavior.
- **#2195:** In both core and tools, exercise the public limit behavior for `false`, empty string, zero, unset, positive numbers, and malformed non-number settings. Verify disabled, warning, and truncation results rather than helper calls.
- **#2196 and PR #3280:** Decide the `loadAllFiles` nullish contract. Exercise nullish inputs only if they remain supported, plus empty path/list and valid file loading. Preserve the PR's adjacent utility review record, while leaving the unresolved `tool-utils.ts:141` finding to the new core follow-up.
- **Agents follow-up:** Exercise valid text blocks, provider-specific blocks, null entries, malformed objects, and non-text values through the real normalization and Todo continuation path.
- **Core contracts follow-up:** Exercise required prompt context behavior, encrypted thinking content round trips and malformed payload rejection, and shell invocation allowlisting for valid and malformed parameter values.
- **MCP follow-up:** Load persisted tokens with missing, numeric, expired, future, string, null, and non-finite expiry values through the real persistence parser. Do not mock the parser.
- **Telemetry follow-up:** Construct events for `undefined` and every value returned by `getDecisionFromOutcome`, then assert unchanged metrics totals after removing the unreachable empty-string branch.

Every production follow-up must use behavioral tests and run its normal repository verification cycle. Typecheck-only tests and mocks of the parser or normalizer under test are insufficient.

## Lint-policy conclusion

No lint-policy change is justified. Keep the existing TypeScript ESLint and SonarJS rules. Do not add suppressions, broad exceptions, or a blanket ban on `as unknown`.

The 4,345 legitimate rows include JSON, persistence, SDK, IPC, reflection, runtime adapter, opaque pass-through, and test-construction boundaries. The 14 abuse rows arise when local types discard a runtime state and code later re-widens the value to recover a check. Each fix belongs at that local type or ingestion boundary.

No production remediation belongs in the #2159 documentation change.

## Review triage

| Initial compliance finding | Disposition |
|---:|---|
| 1 | Blocker-Fix |
| 2 | Blocker-Fix |
| 3 | Blocker-Fix |
| 4 | Blocker-Fix |
| 5 | In-scope-Fix |
| 6 | Reject |
| 7 | Blocker-Fix |

Initial finding 6 is rejected because #2159 is an audit and tracking artifact, and the current task explicitly excludes production remediation. Initial findings 1, 2, 3, 4, and 7 affect scan correctness, inventory completeness, accepted verdicts, or tracking completeness. Initial finding 5 is a bounded documentation correction.

| Artifact review finding | Disposition | Resolution |
|---:|---|---|
| 1 | Blocker-Fix | Restored the full local cycle, local review, rebase, ancestry, conflict, CI, and PR-thread gates. |
| 2 | In-scope-Fix | Recorded #2196 and PR #3280's adjacent utility review and the unresolved `tool-utils.ts:141` verdict without expanding that PR. |
| 3 | In-scope-Fix | Replaced the unsupported telemetry-ingestion account with the current typed event flow and unreachable legacy sentinel branch. |
| 4 | In-scope-Fix | Corrected both limiter descriptions to distinguish preserved runtime sentinels from erased static types. |

The final ZAI GLM 4.7 OCR reported two comments about the same `UIStateContext.tsx:129` description. Both are **In-scope-Fix**. The corrected row now describes a retained `unknown | null` state annotation and the resulting consumer-side type recovery, rather than implying that the annotation itself is a cast. No other finding was reported. OCR selected `PLAN.md`; the 1.39 MB inventory is instead covered by the deterministic 4,359-row reconciliation, binary-verdict checks, and source-linked row generation described above.

## GitHub execution evidence

GitHub tracking was completed on 2026-08-27:

1. The [audit summary](https://github.com/vybestack/llxprt-code/issues/2159#issuecomment-5447785675) records the counts, scan resolution, 14 abuse rows, policy conclusion, and tracking links.
2. The exact 4,359-row inventory is attached to #2159 in 25 size-bounded comments. [Part 1](https://github.com/vybestack/llxprt-code/issues/2159#issuecomment-5447786601) through [part 25](https://github.com/vybestack/llxprt-code/issues/2159#issuecomment-5447790685) preserve every Markdown table row.
3. #2159's acceptance checklist records completion of the inventory, classification, root-cause analysis, grouping, follow-up creation, and policy review.
4. Comments on #2194, #2195, and #2196 record exact coverage, current PR status, and the `tool-utils.ts:141` disposition.
5. Follow-ups #3398, #3399, #3397, and #3396 cover the remaining agents, core, MCP, and telemetry abuse clusters with behavioral requirements.
6. The summary keeps #2197/PR #3371, #2198/PR #3286, and IDE singleton reset separate from #2159 because they are non-abuse concerns.
7. #2159 remains open for the documentation PR. The PR will use `fixes #2159`; no production remediation belongs in this change.

## Completion verification

Run the complete local cycle on the candidate head and store logs under `tmp/issue2159/`:

```bash
set -o pipefail
npm run test 2>&1 | tee tmp/issue2159/test.log
npm run lint 2>&1 | tee tmp/issue2159/lint.log
npm run typecheck 2>&1 | tee tmp/issue2159/typecheck.log
npm run format 2>&1 | tee tmp/issue2159/format.log
npm run build 2>&1 | tee tmp/issue2159/build.log
bun scripts/start.ts --profile-load stepfun-37 \
  "write me a haiku and nothing else" \
  2>&1 | tee tmp/issue2159/smoke.log
npm exec prettier -- --check \
  project-plans/issue2159/PLAN.md \
  project-plans/issue2159/INVENTORY.md \
  2>&1 | tee tmp/issue2159/prettier-check.log
npm run lint:doc-placement 2>&1 | tee tmp/issue2159/doc-placement.log
git diff --check 2>&1 | tee tmp/issue2159/git-diff-check.log
```

Then complete these gates before declaring the issue effort complete:

1. Final local review is complete. The requested OpenCode model identifier was unavailable in the local OpenCode registry, so the configured OCR transport ran ZAI GLM 4.7 explicitly through `zai-anthropic`. Both duplicate `UIStateContext.tsx:129` comments were classified as In-scope-Fix and resolved above.
2. Commit the reviewed artifacts, fetch `origin/main`, rebase the issue branch, and rerun the complete local cycle on the rebased candidate.
3. Verify correct ancestry with `git merge-base --is-ancestor origin/main HEAD` and inspect `git log --oneline --decorate origin/main..HEAD`.
4. Push the issue branch and create the PR with `fixes #2159` after the GitHub audit comment and follow-up links are visible.
5. Confirm GitHub reports the PR mergeable and conflict-free.
6. Watch all required CI checks to completion on the candidate head.
7. Triage every actionable PR review thread with the same four dispositions and resolve every Blocker-Fix and In-scope-Fix item.
8. Request final CodeRabbit review after the candidate head stops changing, then confirm CI remains green and all actionable threads are resolved.

Any formatting change outside `project-plans/issue2159/` must be inspected before proceeding. Do not include unrelated changes.

## Appendix: executable temporary audit scripts

Recreate the scanner and reconciler exactly by copying these blocks to the paths used above.

### `tmp/issue2159/audit.ts`

```typescript
/**
 * Deterministic TypeScript AST audit for issue #2159.
 *
 * Scans every tracked TypeScript file under each package src directory,
 * including files directly below src, and excludes declaration files. No
 * tracked generated TypeScript source exists at the audited revision.
 *
 * Usage:
 *   bun tmp/issue2159/audit.ts > tmp/issue2159/audit.tsv \
 *     2> tmp/issue2159/audit-summary.txt
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';

const dirty = execSync('git status --porcelain --untracked-files=no', {
  encoding: 'utf8',
}).trim();
if (dirty.length > 0) {
  console.error(`AUDIT ABORTED: tracked worktree is dirty:\n${dirty}`);
  process.exit(2);
}

const trackedFiles = execFileSync(
  'git',
  ['ls-files', 'packages/**/src/*.ts', 'packages/**/src/*.tsx'],
  { encoding: 'utf8' },
)
  .split('\n')
  .map((path) => path.trim())
  .filter((path) => path.length > 0 && !path.endsWith('.d.ts'))
  .sort();

const retainedStateLocations = new Set([
  'packages/agents/src/api/agentBootstrap.ts:373',
  'packages/agents/src/api/agentBootstrap.ts:375',
  'packages/agents/src/tools/task.ts:463',
  'packages/cli/src/ui/contexts/UIStateContext.tsx:129',
  'packages/cli/src/ui/containers/AppContainer/builders/buildUIState.ts:124',
  'packages/cli/src/ui/containers/AppContainer/hooks/useKeybindings.ts:74',
  'packages/cli/src/zed-integration/zed-terminal-manager.ts:49',
  'packages/providers/src/auth/proxy/oauth-session-manager.ts:21',
  'packages/providers/src/auth/proxy/oauth-session-manager.ts:26',
  'packages/providers/src/auth/proxy/oauth-session-manager.ts:28',
  'packages/providers/src/runtime/providerSwitch.ts:100',
  'packages/providers/src/runtime/providerSwitch.ts:101',
  'packages/providers/src/runtime/providerSwitch.ts:102',
  'packages/providers/src/runtime/providerSwitch.ts:103',
  'packages/providers/src/runtime/providerSwitch.ts:289',
  'packages/providers/src/runtime/providerSwitch.ts:290',
  'packages/providers/src/runtime/providerSwitch.ts:291',
  'packages/providers/src/runtime/providerSwitch.ts:292',
  'packages/tools/src/tools/tools.ts:501',
]);

type RowKind =
  | 'as unknown'
  | 'as unknown as T'
  | 'as unknown[]'
  | 'state : unknown';

interface Row {
  readonly kind: RowKind;
  readonly path: string;
  readonly line: number;
  readonly position: number;
  readonly snippet: string;
}

const rows: Row[] = [];
const foundStateLocations = new Set<string>();

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function tail(text: string, length: number): string {
  const value = compact(text);
  return value.length <= length ? value : `…${value.slice(-length)}`;
}

function head(text: string, length: number): string {
  const value = compact(text);
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

for (const path of trackedFiles) {
  const sourceText = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const lineAt = (position: number): number =>
    sourceFile.getLineAndCharacterOfPosition(position).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node)) {
      const type = node.type;
      const expression = tail(node.expression.getText(sourceFile), 72);
      if (type.kind === ts.SyntaxKind.UnknownKeyword) {
        const parent = node.parent;
        const isDouble = ts.isAsExpression(parent) && parent.expression === node;
        rows.push({
          kind: isDouble ? 'as unknown as T' : 'as unknown',
          path,
          line: lineAt(type.getStart(sourceFile)),
          position: type.getStart(sourceFile),
          snippet: isDouble
            ? `${expression} as unknown as ${head(parent.type.getText(sourceFile), 56)}`
            : `${expression} as unknown`,
        });
      } else if (
        ts.isArrayTypeNode(type) &&
        type.elementType.kind === ts.SyntaxKind.UnknownKeyword
      ) {
        rows.push({
          kind: 'as unknown[]',
          path,
          line: lineAt(type.getStart(sourceFile)),
          position: type.getStart(sourceFile),
          snippet: `${expression} as unknown[]`,
        });
      }
    }

    if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
      const line = lineAt(node.getStart(sourceFile));
      const location = `${path}:${line}`;
      if (
        retainedStateLocations.has(location) &&
        !foundStateLocations.has(location)
      ) {
        rows.push({
          kind: 'state : unknown',
          path,
          line,
          position: node.getStart(sourceFile),
          snippet: head(node.getText(sourceFile), 130),
        });
        foundStateLocations.add(location);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

const missingStateLocations = [...retainedStateLocations].filter(
  (location) => !foundStateLocations.has(location),
);
if (missingStateLocations.length > 0) {
  throw new Error(
    `Missing retained state locations: ${missingStateLocations.join(', ')}`,
  );
}

rows.sort((left, right) =>
  left.path === right.path
    ? left.position - right.position
    : left.path.localeCompare(right.path),
);

const keys = new Set<string>();
for (const row of rows) {
  const key = `${row.path}:${row.line}:${row.kind}`;
  if (keys.has(key)) {
    throw new Error(`Duplicate reconciliation key: ${key}`);
  }
  keys.add(key);
  console.log(`${row.kind}\t${row.path}\t${row.line}\t${row.snippet}`);
}

const count = (kind: RowKind): number =>
  rows.filter((row) => row.kind === kind).length;
console.error(
  `AUDIT SUMMARY (files=${trackedFiles.length}): ` +
    `as unknown=${count('as unknown')} ` +
    `as unknown as T=${count('as unknown as T')} ` +
    `as unknown[]=${count('as unknown[]')} ` +
    `state : unknown=${count('state : unknown')} ` +
    `TOTAL=${rows.length}`,
);

```

### `tmp/issue2159/reconcile.ts`

```typescript
import { readFileSync } from 'node:fs';

interface InventoryRow {
  readonly key: string;
  readonly verdict: string;
  readonly justification: string;
}

const auditRows = readFileSync('tmp/issue2159/audit.tsv', 'utf8')
  .trim()
  .split('\n')
  .map((line) => {
    const [kind = '', path = '', lineText = ''] = line.split('\t');
    return `${path}:${lineText}:${kind}`;
  });

const inventoryRows: InventoryRow[] = [];
for (const line of readFileSync('project-plans/issue2159/INVENTORY.md', 'utf8').split('\n')) {
  const match = /^\| `([^`]+):(\d+)` \| (as unknown(?: as T|\[\])?|state : unknown) \| .* \| (LEGITIMATE BOUNDARY|ABUSE) \| (.+) \|$/.exec(line);
  if (match) {
    inventoryRows.push({
      key: `${match[1]}:${match[2]}:${match[3]}`,
      verdict: match[4],
      justification: match[5].trim(),
    });
  }
}

const auditCounts = new Map<string, number>();
for (const key of auditRows) auditCounts.set(key, (auditCounts.get(key) ?? 0) + 1);
const inventoryCounts = new Map<string, number>();
for (const row of inventoryRows) inventoryCounts.set(row.key, (inventoryCounts.get(row.key) ?? 0) + 1);

const errors: string[] = [];
for (const [key, count] of auditCounts) {
  if (count !== 1) errors.push(`audit key count ${count}: ${key}`);
  const inventoryCount = inventoryCounts.get(key) ?? 0;
  if (inventoryCount !== 1) errors.push(`inventory key count ${inventoryCount}: ${key}`);
}
for (const key of inventoryCounts.keys()) {
  if (!auditCounts.has(key)) errors.push(`unexpected inventory key: ${key}`);
}
for (const row of inventoryRows) {
  if (row.verdict !== 'ABUSE' && row.verdict !== 'LEGITIMATE BOUNDARY') {
    errors.push(`invalid verdict: ${row.key}`);
  }
  if (row.justification.length === 0) errors.push(`empty justification: ${row.key}`);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const abuse = inventoryRows.filter((row) => row.verdict === 'ABUSE').length;
console.log(`RECONCILED audit=${auditRows.length} inventory=${inventoryRows.length} unique=${inventoryCounts.size} abuse=${abuse} legitimate=${inventoryRows.length - abuse} missing=0 extra=0 duplicate=0 invalidVerdict=0 emptyJustification=0`);

```
