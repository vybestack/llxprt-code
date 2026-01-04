# Subagent Execution Runbook (Required)

This plan is executed via subagents with mandatory cross-review. Treat the per-batch “DONE” state as: desired functionality implemented, verification per `dev-docs/RULES.md` completed, and paperwork updated (`PROGRESS.md`, `NOTES.md`, `AUDIT.md`).

## Roles

- **`typescriptexpert`**: Implements **REIMPLEMENT** batches (TDD-first per `dev-docs/RULES.md`).
- **`cherrypicker`**: Executes **PICK** batches (git cherry-pick + conflict resolution + verification).
- **`deepthinker`**: Reviews every batch result and either approves or returns actionable change requests.

## Batch Execution Protocol

For each batch in `PLAN.md`, follow this loop:

1. **Check the plan**
   - Read `project-plans/20260104gmerge/PLAN.md` and the batch row.
   - For REIMPLEMENT batches, also read the linked playbook `project-plans/20260104gmerge/<sha>-plan.md`.

2. **Execute (primary agent)**
   - If batch type is **REIMPLEMENT**: launch `typescriptexpert` to implement the batch, including tests (RED → GREEN → REFACTOR).
   - If batch type is **PICK**: launch `cherrypicker` to apply the upstream commits per the batch definition.

3. **Review**
   - Launch `deepthinker` to review changes, focusing on:
     - Functional correctness and alignment with the batch intent.
     - Conformance to `dev-docs/RULES.md` (tests-first for production code).
     - Verification commands run per batch cadence.
     - Paperwork updates are complete and consistent.

4. **If review fails (escalation/repair loop)**
   - Run at most **2** repair cycles:
     1) launch a new `typescriptexpert` to address review feedback,
     2) re-run `deepthinker` review.
   - If still failing after 2 cycles:
     - `deepthinker` becomes the implementer to finish the batch,
     - `typescriptexpert` becomes the reviewer.
     - Repeat up to **3** cycles until both agree the batch is DONE.

5. **Paperwork + TODO discipline (non-optional)**
   - After a batch is accepted:
     - Update `project-plans/20260104gmerge/PROGRESS.md` (status + last updated + checkboxes).
     - Append a short entry to `project-plans/20260104gmerge/NOTES.md`.
     - Update `project-plans/20260104gmerge/AUDIT.md` (Status column + any Local commit refs if applicable).
   - Maintain the session TODO list so it always contains, after the current item:
     - `check PLAN` → `do batch NN` → `check PLAN` → `do batch NN+1`.

---


# gemini-cli v0.10.0 → v0.11.3: Batch Plan

References:
- `dev-docs/cherrypicking-runbook.md`
- `dev-docs/cherrypicking.md`
- `project-plans/20260104gmerge/CHERRIES.md`
- `project-plans/20260104gmerge/SUMMARY.md`
- Tracking issue: https://github.com/vybestack/llxprt-code/issues/708

## Non-negotiables
- Keep LLxprt multi-provider architecture; avoid Google-only auth changes.
- Do not reintroduce ClearcutLogger/Google telemetry (no Clearcut logger, no settings-to-Google logging).
- Never reintroduce removed features: `NextSpeakerChecker`, `nextSpeakerChecker.ts`, `FlashFallback`, `smart_edit`, `useSmartEdit`.
- Keep A2A server private (no publishable changes).
- Preserve LLxprt tool names (replace/search_file_content/list_directory/google_web_fetch/direct_web_fetch).
- Maintain emoji-free policy and skip next-speaker checks.

## File Existence Pre-Check
The following upstream files are missing in LLxprt. If still missing during execution, follow playbook SKIP/NO_OP guidance and record in AUDIT.md.

| File | Upstream SHAs |
|---|---|
| `docs/cli/headless.md` | 937c15c6 |
| `docs/get-started/configuration-v1.md` | 937c15c6 |
| `docs/get-started/configuration.md` | 937c15c6 |
| `integration-tests/flicker.test.ts` | dcf362bc |
| `packages/cli/src/config/policy.test.ts` | bf80263b, c9c633be |
| `packages/cli/src/config/policy.ts` | bf80263b, c8518d6a, c9c633be |
| `packages/cli/src/services/prompt-processors/atFileProcessor.ts` | 995ae717 |
| `packages/cli/src/ui/AppContainer.test.tsx` | f4330c9f |
| `packages/cli/src/ui/auth/AuthDialog.tsx` | b364f376 |
| `packages/cli/src/ui/auth/useAuth.ts` | b364f376 |
| `packages/cli/src/ui/components/views/ExtensionsList.test.tsx` | cc7e1472 |
| `packages/cli/src/ui/components/views/ExtensionsList.tsx` | cc7e1472 |
| `packages/cli/src/ui/components/views/McpStatus.tsx` | cc7e1472 |
| `packages/cli/src/ui/hooks/useSlashCompletion.ts` | b364f376 |
| `packages/core/src/routing/strategies/classifierStrategy.ts` | b364f376 |
| `packages/core/src/telemetry/activity-monitor.ts` | b364f376 |
| `packages/core/src/telemetry/clearcut-logger/clearcut-logger.test.ts` | 08e87a59 |
| `packages/core/src/telemetry/clearcut-logger/clearcut-logger.ts` | 08e87a59, b364f376 |
| `packages/core/src/tools/message-bus-integration.test.ts` | b8df8b2a |
| `packages/core/src/tools/web-fetch.test.ts` | 05930d5e, b8df8b2a, bf80263b |
| `packages/core/src/tools/web-fetch.ts` | 05930d5e, 7dd2d8f7, 98eef9ba, b364f376, b8df8b2a, bf80263b, c8518d6a, c9c633be |
| `packages/core/src/tools/web-search.ts` | 7dd2d8f7, bf80263b, c8518d6a |
| `packages/core/src/tools/write-todos.ts` | 7dd2d8f7, c8518d6a |
| `packages/core/src/utils/debugLogger.test.ts` | 9b9ab609 |
| `packages/core/src/utils/debugLogger.ts` | 9b9ab609 |
| `packages/core/src/utils/delay.test.ts` | 8731309d |
| `packages/core/src/utils/delay.ts` | 8731309d |
| `packages/core/src/utils/editCorrector.test.ts` | 937c15c6 |
| `packages/core/src/utils/nextSpeakerChecker.ts` | b364f376 |

## Branding Substitutions
- Use @vybestack/llxprt-code-* packages, .llxprt config dir, LLXPRT.md, and LLXPRT_CODE_* env vars.
- Keep llxprt CLI naming instead of gemini where applicable.
- Canonical tool names: list_directory, search_file_content, replace, google_web_search, google_web_fetch, direct_web_fetch.

## Subagent Workflow
- **Picker:** `typescriptexpert` (claude) selects the next batch and validates prerequisites.
- **PICK execution:** `llxprtcherrypicker` (claude opus) performs the cherry-pick batches.
- **REIMPLEMENT execution:** `hardproblemcoder` (gpt52) follows the per-commit playbook.
- **Skeptical verification:** `codereviewer` (claude) inspects the batch result against upstream intent and LLxprt invariants.
- **Remediation:** `typescriptarchitect` (gpt52) fixes any verification failures.

## Verification Cadence
- After every batch (Quick): `npm run lint`, `npm run typecheck`
- After every 2nd batch (Full): `npm run lint`, `npm run typecheck`, `npm run test`, `npm run format`, `npm run build`, `node scripts/start.js --profile-load synthetic --prompt "write me a haiku"`
- If npm run format modifies files during full verify, commit those changes without rerunning checks.
- Skeptical verification happens after every batch before updating PROGRESS/NOTES/AUDIT.

## Batch Schedule

| Batch | Type | Upstream SHA(s) | Command / Playbook | Commit Message | Verify |
|---:|:---|:---|:---|:---|:---|
| 01 | REIMPLEMENT | `b8df8b2a` | `project-plans/20260104gmerge/b8df8b2a-plan.md` | `reimplement: feat(core): wire up UI for ASK_USER policy decisions in message bus (#10630) (upstream b8df8b2a)` | QUICK |
| 02 | PICK | `4f17eae5, d38ab079, 2e6d69c9, 47f69317, 8c1656bf` | `git cherry-pick 4f17eae5 d38ab079 2e6d69c9 47f69317 8c1656bf` | `cherry-pick: upstream 4f17eae5..8c1656bf batch 02` | FULL |
| 03 | PICK | `cfaa95a2` | `git cherry-pick cfaa95a2` | `cherry-pick: upstream cfaa95a2..cfaa95a2 batch 03` | QUICK |
| 04 | REIMPLEMENT | `130f0a02` | `project-plans/20260104gmerge/130f0a02-plan.md` | `reimplement: chore(subagents): Remove legacy subagent code (#11175) (upstream 130f0a02)` | FULL |
| 05 | REIMPLEMENT | `c9c633be` | `project-plans/20260104gmerge/c9c633be-plan.md` | `reimplement: refactor: move `web_fetch` tool name to `tool-names.ts` (#11174) (upstream c9c633be)` | QUICK |
| 06 | PICK | `60420e52, a9083b9d, b734723d` | `git cherry-pick 60420e52 a9083b9d b734723d` | `cherry-pick: upstream 60420e52..b734723d batch 06` | FULL |
| 07 | REIMPLEMENT | `05930d5e` | `project-plans/20260104gmerge/05930d5e-plan.md` | `reimplement: fix(web-fetch): respect Content-Type header in fallback mechanism (#11284) (upstream 05930d5e)` | QUICK |
| 08 | PICK | `6ded45e5, d2c9c5b3` | `git cherry-pick 6ded45e5 d2c9c5b3` | `cherry-pick: upstream 6ded45e5..d2c9c5b3 batch 08` | FULL |
| 09 | REIMPLEMENT | `937c15c6` | `project-plans/20260104gmerge/937c15c6-plan.md` | `reimplement: refactor: Remove deprecated --all-files flag (#11228) (upstream 937c15c6)` | QUICK |
| 10 | PICK | `c71b7491, 991bd373, a4403339` | `git cherry-pick c71b7491 991bd373 a4403339` | `cherry-pick: upstream c71b7491..a4403339 batch 10` | FULL |
| 11 | REIMPLEMENT | `9049f8f8` | `project-plans/20260104gmerge/9049f8f8-plan.md` | `reimplement: feat: remove deprecated telemetry flags (#11318) (upstream 9049f8f8)` | QUICK |
| 12 | PICK | `22f725eb` | `git cherry-pick 22f725eb` | `cherry-pick: upstream 22f725eb..22f725eb batch 12` | FULL |
| 13 | REIMPLEMENT | `dcf362bc` | `project-plans/20260104gmerge/dcf362bc-plan.md` | `reimplement: Inline tree-sitter wasm and add runtime fallback (#11157) (upstream dcf362bc)` | QUICK |
| 14 | PICK | `406f0baa, d42da871` | `git cherry-pick 406f0baa d42da871` | `cherry-pick: upstream 406f0baa..d42da871 batch 14` | FULL |
| 15 | PICK | `3a1d3769` | `git cherry-pick 3a1d3769` | `cherry-pick: upstream 3a1d3769..3a1d3769 batch 15` | QUICK |
| 16 | PICK | `f3ffaf09, 0ded546a, 659b0557, 4a0fcd05, 2b61ac53` | `git cherry-pick f3ffaf09 0ded546a 659b0557 4a0fcd05 2b61ac53` | `cherry-pick: upstream f3ffaf09..2b61ac53 batch 16` | FULL |
| 17 | PICK | `8da47db1, 7c086fe5, e4226b8a, 4d2a1111, 426d3614` | `git cherry-pick 8da47db1 7c086fe5 e4226b8a 4d2a1111 426d3614` | `cherry-pick: upstream 8da47db1..426d3614 batch 17` | QUICK |
| 18 | PICK | `b4a405c6, d3bdbc69` | `git cherry-pick b4a405c6 d3bdbc69` | `cherry-pick: upstream b4a405c6..d3bdbc69 batch 18` | FULL |
| 19 | REIMPLEMENT | `08e87a59` | `project-plans/20260104gmerge/08e87a59-plan.md` | `reimplement: Log all user settings to enable measurement of experiment impacts (#11354) (upstream 08e87a59)` | QUICK |
| 20 | PICK | `21163a16` | `git cherry-pick 21163a16` | `cherry-pick: upstream 21163a16..21163a16 batch 20` | FULL |
| 21 | REIMPLEMENT | `9b9ab609` | `project-plans/20260104gmerge/9b9ab609-plan.md` | `reimplement: feat(logging): Centralize debug logging with a dedicated utility (#11417) (upstream 9b9ab609)` | QUICK |
| 22 | REIMPLEMENT | `f4330c9f` | `project-plans/20260104gmerge/f4330c9f-plan.md` | `reimplement: remove support for workspace extensions and migrations (#11324) (upstream f4330c9f)` | FULL |
| 23 | PICK | `cedf0235` | `git cherry-pick cedf0235` | `cherry-pick: upstream cedf0235..cedf0235 batch 23` | QUICK |
| 24 | PICK | `2ef38065` | `git cherry-pick 2ef38065` | `cherry-pick: upstream 2ef38065..2ef38065 batch 24` | FULL |
| 25 | PICK | `dd42893d` | `git cherry-pick dd42893d` | `cherry-pick: upstream dd42893d..dd42893d batch 25` | QUICK |
| 26 | REIMPLEMENT | `f22aa72c` | `project-plans/20260104gmerge/f22aa72c-plan.md` | `reimplement: Making shell:true as default and adding -I to  grep (#11448) (upstream f22aa72c)` | FULL |
| 27 | PICK | `d065c3ca` | `git cherry-pick d065c3ca` | `cherry-pick: upstream d065c3ca..d065c3ca batch 27` | QUICK |
| 28 | REIMPLEMENT | `98eef9ba` | `project-plans/20260104gmerge/98eef9ba-plan.md` | `reimplement: fix: Update web_fetch tool definition to instruct the model to provid… (#11252) (upstream 98eef9ba)` | FULL |
| 29 | PICK | `23e52f0f` | `git cherry-pick 23e52f0f` | `cherry-pick: upstream 23e52f0f..23e52f0f batch 29` | QUICK |
| 30 | PICK | `0fd9ff0f` | `git cherry-pick 0fd9ff0f` | `cherry-pick: upstream 0fd9ff0f..0fd9ff0f batch 30` | FULL |
| 31 | REIMPLEMENT | `c8518d6a` | `project-plans/20260104gmerge/c8518d6a-plan.md` | `reimplement: refactor(tools): Move all tool names into tool-names.ts (#11493) (upstream c8518d6a)` | QUICK |
| 32 | REIMPLEMENT | `8731309d` | `project-plans/20260104gmerge/8731309d-plan.md` | `reimplement: chore: do not retry the model request if the user has aborted the request (#11224) (upstream 8731309d)` | FULL |
| 33 | PICK | `518a9ca3, d0ab6e99, 397e52da` | `git cherry-pick 518a9ca3 d0ab6e99 397e52da` | `cherry-pick: upstream 518a9ca3..397e52da batch 33` | QUICK |
| 34 | REIMPLEMENT | `36de6862` | `project-plans/20260104gmerge/36de6862-plan.md` | `reimplement: feat: Propagate traceId from code assist to response metadata (Fixes … (#11360) (upstream 36de6862)` | FULL |
| 35 | PICK | `49bde9fc, 61a71c4f, d5a06d3c` | `git cherry-pick 49bde9fc 61a71c4f d5a06d3c` | `cherry-pick: upstream 49bde9fc..d5a06d3c batch 35` | QUICK |
| 36 | REIMPLEMENT | `995ae717` | `project-plans/20260104gmerge/995ae717-plan.md` | `reimplement: refactor(logging): Centralize all console messaging to a shared logger (part 1) (#11537) (upstream 995ae717)` | FULL |
| 37 | REIMPLEMENT | `cc7e1472` | `project-plans/20260104gmerge/cc7e1472-plan.md` | `reimplement: Pass whole extensions rather than just context files (#10910) (upstream cc7e1472)` | QUICK |
| 38 | PICK | `31f58a1f, 70a99af1, 72b16b3a` | `git cherry-pick 31f58a1f 70a99af1 72b16b3a` | `cherry-pick: upstream 31f58a1f..72b16b3a batch 38` | FULL |
| 39 | REIMPLEMENT | `7dd2d8f7` | `project-plans/20260104gmerge/7dd2d8f7-plan.md` | `reimplement: fix(tools): restore static tool names to fix configuration exclusions (#11551) (upstream 7dd2d8f7)` | QUICK |
| 40 | PICK | `654c5550, 0658b4aa` | `git cherry-pick 654c5550 0658b4aa` | `cherry-pick: upstream 654c5550..0658b4aa batch 40` | FULL |
| 41 | REIMPLEMENT | `bf80263b` | `project-plans/20260104gmerge/bf80263b-plan.md` | `reimplement: feat: Implement message bus and policy engine (#11523) (upstream bf80263b)` | QUICK |
| 42 | PICK | `62dc9683, e72c00cf, cf16d167` | `git cherry-pick 62dc9683 e72c00cf cf16d167` | `cherry-pick: upstream 62dc9683..cf16d167 batch 42` | FULL |
| 43 | REIMPLEMENT | `dd3b1cb6` | `project-plans/20260104gmerge/dd3b1cb6-plan.md` | `reimplement: feat(cli): continue request after disabling loop detection (#11416) (upstream dd3b1cb6)` | QUICK |
| 44 | REIMPLEMENT | `b364f376` | `project-plans/20260104gmerge/b364f376-plan.md` | `reimplement: refactor(logging): Centralize console logging with debugLogger (#11590) (upstream b364f376)` | FULL |
| 45 | PICK | `16f5f767, ccf8d0ca, 5b750f51, ed9f714f, 306e12c2` | `git cherry-pick 16f5f767 ccf8d0ca 5b750f51 ed9f714f 306e12c2` | `cherry-pick: upstream 16f5f767..306e12c2 batch 45` | QUICK |
| 46 | PICK | `c7243997, 2940b508, 0d7da7ec` | `git cherry-pick c7243997 2940b508 0d7da7ec` | `cherry-pick: upstream c7243997..0d7da7ec batch 46` | FULL |
| 47 | PICK | `847c6e7f` | `git cherry-pick 847c6e7f` | `cherry-pick: upstream 847c6e7f..847c6e7f batch 47` | QUICK |
| 48 | PICK | `ce40a653` | `git cherry-pick ce40a653` | `cherry-pick: upstream ce40a653..ce40a653 batch 48` | FULL |
| 49 | PICK | `b1bbef43` | `git cherry-pick b1bbef43` | `cherry-pick: upstream b1bbef43..b1bbef43 batch 49` | QUICK |

## Failure Recovery
- Abort a conflicted cherry-pick: `git cherry-pick --abort`.
- After resolving conflicts, continue with `git cherry-pick --continue`.
- If verification fails, fix immediately and add `fix: post-batch NN verification` commit before next batch.

## Note-taking Requirement
- After each batch, update PROGRESS.md, append NOTES.md, and update AUDIT.md with LLxprt commit hashes.
