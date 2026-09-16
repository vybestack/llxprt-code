# Slice A implementation plan

Date: 2026-09-14. Issue: [#3633](https://github.com/vybestack/llxprt-code/issues/3633).
Source baseline: `8921d849d8f5e67629b38064648b7dec2deb23b2` (main, clean before branch creation; fast-forward pull reported up to date).
Branch: `issue3633`. No commit or push in this implementation task.

## Scope and sequence

1. Read the recovered report, issue body/comments, epic P01 and clarification, and PRs #3647/#3392. Preserve the full report definitions rather than the abbreviated P01 names. Verify the recovered source hashes.
2. Run existing behavioral suites and the full-corpus test-audit scanner before adding artifacts. These are baseline measurements, not target conformance passes.
3. Add `integration-tests/conformance/scenarios.s1-s12.test.ts`: exactly twelve skipped Bun entries, each with the complete criteria, verification, gates, client lanes, and tracked implementation gap. No production code requires a red/green cycle in this docs-and-tests-only slice. No assertion that an existing defect is correct, and no passing placeholder assertion.
4. Add `dev-docs/architecture/ownership-inventory.md`: report ownership boundaries and concrete present owners for all responsibilities; source/release provenance; shared verification and lifecycle rules; a per-scenario evidence/gap ledger. No duplicate inventory for A2A.
5. Run the scaffold, rerun baseline suites, compare test-audit outputs, then run full format, lint, typecheck, test, build and the AGENTS-required ollamakimi smoke. Use managed background jobs and repository-local `tmp/verify3633/` logs. Do not repair unrelated failures or modify quality tools.
6. Record results and blockers here, preserving source revision and command/log references. Parent posts artifact links and delegates independent review. OCR remains disabled.

## Boundaries

Only new Markdown and tests. Existing tests remain unchanged. No production, configuration, dependencies, workflow, memory, or tooling edits. No new runtime abstraction or subsystem. Fixture profile discovery is current behavior, not the product contract. Skips are not proof. Release metadata/source inspection is not installed SDK proof.

Epic hygiene was completed separately: [itemized evidence](https://github.com/vybestack/llxprt-code/issues/3633#issuecomment-5673029273) and [P01 clarification](https://github.com/vybestack/llxprt-code/issues/2619#issuecomment-5673024973). Do not repeat these edits or revive #2615's abandoned plans.

## Verification status

The bounded artifacts are implemented. The scaffold carries all twelve report rows; a whitespace-normalized comparison after rendering TeX code/issue/source macros confirmed every full criterion and verification string is present. Both recovered hashes match the supplied values. Every full repository source path in the inventory resolves in the pinned tree.

| Check | Result | Repository-local evidence |
| --- | --- | --- |
| `bun test ./integration-tests/conformance/scenarios.s1-s12.test.ts` | Exit 0; 0 pass, 12 skip, 0 fail | `tmp/verify3633/scaffold.log`, `scaffold.exit` |
| Ten existing behavioral suites, baseline | 154 tracked tests passed. The first repository-adapter invocation also selected an ignored scratch copy via Bun's name-filter semantics and exited 1; exact-file rerun passed 42/42, exit 0. | `tmp/verify3633/scoped-baseline.log`, `scoped-baseline-repository-exact.log` |
| Same ten suites, candidate | 154 pass, zero fail; all ten exact-file commands exit 0 | `tmp/verify3633/scoped-candidate.log`; paths/counts in ownership inventory |
| Full-corpus test-audit baseline/candidate | Both exit 0; 3001/3002 files scanned, zero parse errors; same 2103 existing findings; `findings.tsv` diff empty | `tmp/verify3633/scan-baseline/`, `scan-candidate/`, `audit.diff`, `audit-diff.exit` |
| `bunx eslint integration-tests/conformance/scenarios.s1-s12.test.ts` | Exit 0 | `tmp/verify3633/scaffold-lint.log`, `scaffold-lint.exit` |
| `npm run format` | Exit 0 on initial, final artifact, and handoff runs; no existing tracked files changed | `tmp/verify3633/format.log`, `format-final.log`, `format-handoff.log`, matching `.exit` files |
| `npm run lint` | Exit 0; all 19 lint groups completed | `tmp/verify3633/lint.log`, `lint.exit` |
| `npm run typecheck` | Exit 0 on rerun after build. First attempt exit 2 with TS6305 errors against stale generated `packages/settings` dist outputs predating the build step; resolved by the completed build, no code change. | `tmp/verify3633/typecheck.log`, `typecheck.exit`, `rerun-typecheck.log`, `rerun-typecheck.exit` |
| `npm run test` | Exit 0 on rerun after build. First attempt exit 1 from CLI integration suites reading a stale `packages/tools` dist missing the `canonicalizePolicyToolEntry` export; resolved by the completed build. Four nested `(fail)` strings in the rerun log are fixture output spawned by the core test-runner suites themselves, inside passing parents. | `tmp/verify3633/test.log`, `test.exit`, `rerun-test.log`, `rerun-test.exit` |
| `npm run build` | Exit 0 | `tmp/verify3633/build.log`, `build.exit` |
| `bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"` | Exit 0; actual haiku output. Run and passed; not counted as the binding gate without owner sign-off on the substitution. | `tmp/verify3633/smoke-zai-glm-flash.log`, `smoke-zai-glm-flash.exit` |
| `bun scripts/start.ts --profile-load ollamakimi "write me a haiku and nothing else"` (AGENTS.md smoke) | Exit 1, provider-side: 404 model `kimi-k2.7` not found at the `ollama.com` endpoint | `tmp/verify3633/smoke-ollamakimi.log`, `smoke-ollamakimi.exit` |
| `git diff --check`, scope check | No tracked diff; only the three new Markdown/test artifacts are untracked | Working tree on `issue3633` |

The managed full-project verification job ran each command with independent exit capture, in this order: `npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, then the AGENTS-required ollamakimi smoke. After the build completed, `npm run typecheck` and `npm run test` were rerun and both exited 0. Every command's final exit code is 0 except the ollamakimi smoke noted above. The two non-final first attempts (typecheck exit 2, test exit 1) are recorded in the table with their causes; each pointed at stale dist outputs predating the build step and was resolved by the completed build with no code change. No unrelated failures have been repaired.

The binding StepFun smoke cannot be satisfied with the cancelled subscription. The `zai-glm-flash` haiku smoke was run and passed (exit 0, actual haiku output) but is not counted as satisfying that gate; the substitution still needs the owner's decision and sign-off. The AGENTS-required `ollamakimi` smoke failed provider-side: 404 model `kimi-k2.7` not found at the `ollama.com` endpoint. OCR was not run. Independent review, artifact posting, commit and push remain with the parent; no merge is authorized.
