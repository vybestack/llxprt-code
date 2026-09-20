# Issue #3639: Remove fabricated fallback tool names from the OpenAI provider; resolve dead ToolNameValidator

Branch: `issue3639` (from `main` @ `ea297be0c`)

## Research findings (verified on this branch)

1. `packages/providers/src/openai/toolNameUtils.ts` — the module containing
   `processFinalToolName` (fabricates `tool_name_not_found_<sanitized>` /
   `missing_tool_name`), `enhanceToolNameExtraction` (fabricates
   `missing_tool_name_check_stream_chunks`), `safeExtractToolName` (routes
   through both), and `validateToolName` (case/partial "correction" matching)
   has **zero production imports on current main**. Its only importer is its
   own test, `toolNameUtils.test.ts`. It is not listed in
   `packages/providers/package.json` exports. The issue body calls it "the
   live OpenAI streaming path"; that was true of the state observed during the
   #3535 review, but on current main the module is dead code.
2. `packages/providers/src/openai/ToolNameValidator.ts` — dead code, only
   imported by `__tests__/ToolNameValidator.test.ts`. Confirmed by the issue
   and re-verified here.
3. The actual live streaming path is `OpenAIStreamProcessor` →
   `ToolCallPipeline` → `ToolCallCollector` (raw fragment assembly, nameless
   calls never complete) → `ToolCallNormalizer` (trim + lowercase + Kimi
   prefix strip; no substitution, no fabrication). Raw model-emitted names flow
   through to Core dispatch, which fails unregistered names with
   `TOOL_NOT_REGISTERED` (`packages/tools/src/types/tool-error.ts`; dispatch
   behavior already covered by tests in `packages/agents`).
4. Repo-wide grep: after deleting the two modules and their two test files, no
   source, config, package-export, or doc reference to either file remains.

## Decision and rationale

The issue's Expected section offers two fates for `ToolNameValidator`: wire it
in or delete it. **Delete.** Wiring an unreachable validator into the live
pipeline would add new provider-side name matching (case/partial "correction")
that the live path deliberately does not do, and would be speculative
hardening beyond the issue's scope. This matches the repo's dead-source
cleanup precedent (#3295) and the fail-fast preference.

For `toolNameUtils.ts`: the github-actions plan comment on the issue proposes
fixing the fabrication in place, but it assumed the module is live. It is not.
Keeping a corrected-but-still-dead module preserves exactly the problem class
the issue flags (dead code) while fixing only its symptom. **Delete the module
and its test.** The fabrication is then gone from the repo entirely, which
satisfies "no live code path substitutes a fabricated stand-in" by
construction, and the live path's raw-name passthrough is pinned by a new
behavioral test (AC3) so the contract cannot silently regress.

## Acceptance criteria

- **AC1 — Fabrication module removed.** Delete
  `packages/providers/src/openai/toolNameUtils.ts` and
  `packages/providers/src/openai/toolNameUtils.test.ts`. After deletion, a
  repo-wide search finds no occurrence of `tool_name_not_found`,
  `missing_tool_name`, or `missing_tool_name_check_stream_chunks` in
  `packages/` source.
- **AC2 — Dead validator removed.** Delete
  `packages/providers/src/openai/ToolNameValidator.ts` and
  `packages/providers/src/openai/__tests__/ToolNameValidator.test.ts`. No
  remaining imports or references (build, lint, typecheck all clean).
- **AC3 — Raw-name passthrough pinned behaviorally in the live path.** A new
  bun test at the live `ToolCallPipeline` level (the streaming collection +
  normalization path `OpenAIStreamProcessor` drives) asserts, for a tool name
  the model emits that is not a registered/available tool:
  - the name is emitted exactly as the model sent it, modulo the pipeline's
    existing trim/lowercase normalization (e.g. `Totally_Bogus_Tool` →
    `totally_bogus_tool`), with no fuzzy/case "correction" toward any other
    name;
  - no fabricated stand-in (`tool_name_not_found_*`, `missing_tool_name*`)
    appears anywhere in the pipeline result;
  - boundary: a name with punctuation/whitespace (e.g. `invalid-tool name!`)
    flows through as-is after trim/lowercase rather than being rewritten;
  - boundary: a call with no name fragment at all is never emitted with a
    stand-in name (existing behavior: dropped as incomplete), and
  - boundary: a name split across streaming fragments still assembles via the
    collector's override semantics (last non-empty name wins).
  Naming: `packages/providers/src/openai/ToolCallPipeline.rawToolName.issue3639.test.ts`
  following the existing `<file>.<topic>.test.ts` convention in this directory.
- **AC4 — Full verification cycle passes.** `npm run test`, `npm run lint`,
  `npm run typecheck`, `npm run format`, `npm run build`, and the
  `zai-glm-flash` smoke test all pass on the branch head.

## Out of scope (explicit)

- Wiring `ToolNameValidator` (or any new validator) into the live path.
- Changing `ToolCallNormalizer` lowercase/Kimi-prefix-strip behavior or
  `ToolCallCollector` nameless-call drop behavior.
- Any change to the agents-side raw-name passthrough (#3535 already fixed).
- `packages/tools/src/formatters/toolNameUtils.ts` — a different, live module
  (normalizeToolName/findMatchingTool) used by production; untouched.
- Any new public abstraction, workflow, dependency, or memory/quality-tool
  change.

## Tests

- Delete the two dead test files alongside their modules (they only test dead
  code).
- Add AC3 behavioral test (new file above, bun:test, no mocks of the pipeline
  internals — drive `ToolCallPipeline` exactly as `OpenAIStreamProcessor`
  does via `addFragment`/`process`).
- Existing live-path suites (`ToolCallPipeline.test.ts`,
  `ToolCallPipeline.integration.test.ts`, `ToolCallNormalizer.test.ts`,
  `ToolCallCollector.test.ts`) must stay green unchanged.

## Review policy

- deepthinker compliance review: max 2 rounds (initial + one remediation).
- OCR is NOT run for this effort: standing instruction (2026-09-13) says do not
  run OCR/open-code-review until Andrew explicitly re-enables it. This plan
  records that deviation from the standard workflow.

## Verification log

All on branch head (issue3639), 2026-09-18/19. Logs under `tmp/verify3639/`
(gitignored).

- **AC1 grep proof:** `tool_name_not_found|missing_tool_name` under
  `packages/` matches only the new test's negative assertions
  (`ToolCallPipeline.rawToolName.issue3639.test.ts:50,57-58,90`) and a
  deletion-documenting comment (`move-map-validation.test.ts:210`).
  `missing_tool_name_check_stream_chunks`: 0 matches. Zero executable
  fabrication paths remain.
- **AC2:** reviewer-verified independently: no imports of the deleted modules
  anywhere (incl. dynamic imports, barrels, package.json exports, configs,
  docs); `packages/tools/src/formatters/toolNameUtils.ts` (the distinct live
  module) untouched.
- **AC3:** new test file: 6/6 pass. Focused live-path suites
  (ToolCallPipeline, integration, Normalizer, Collector + new test): 70 pass,
  0 fail. `move-map-validation.test.ts` run alone: 20 pass, 0 fail (note: it
  times out if run concurrently with other files — IO contention flake, passes
  standalone in ~1.4s).
- **AC4:**
  - `npm run test`: complete. Only failures: (a) `(fail) hangs` / `(fail)
    fails` lines are expected fixture output echoed by
    `packages/core/test/run-bun-tests.test.ts` (parent passes, 0 fail); (b)
    `packages/cli/src/integration-tests/cli-args.integration.test.ts` —
    pre-existing/environmental: control run in a clean worktree of unmodified
    main fails the same file with 11 failures (CLI-spawn timeouts with
    isolated HOME / OAuth credential state) vs 5 on this branch. Not caused
    by this change; change touches no CLI/profile/auth code.
  - `npm run lint`: exit 0. All reported eslint errors are in files outside
    this changeset (packages/agents, packages/cli; verified no overlap with
    `git diff --name-only`).
  - `npm run typecheck`: exit 0, 0 TS errors.
  - `npm run format`: exit 0, zero file changes (new files prettier-clean).
  - `npm run build`: clean, incl. lazy-MCP registry coherence check.
  - Smoke: `bun scripts/start.ts --profile-load zai-glm-flash "write me a
    haiku and nothing else"` → exit 0, haiku produced.
- **Incidental-file note:** a subagent `bun install` churned `bun.lock` and a
  test run touched `packages/vscode-ide-companion/NOTICES.txt` line endings;
  both reverted — not part of this change.

## Review log

- Implementation: tscoder-zai subagent (hit the 30-min task ceiling after
  completing all code changes; verification completed by the orchestrator).
- Compliance review: `reviewer` subagent, verdict **compliant**, no HIGH/MEDIUM
  findings. Findings triage:
  - LOW, fabrication strings appear textually in the new test's negative
    assertions and one comment → **Reject** (intent satisfied; negative
    assertions require the literals).
  - LOW, this verification log was unfilled at review time → **In-scope-Fix**
    (filled; this section).
  - LOW, split-fragment test relies on stable sort → **Reject** (ES2019+
    guarantees stability; Bun conforms).
- deepthinker review could not run: astra profile quota exhausted
  ("usage limit reached"); `reviewer` (zai) used instead.
- OCR not run: disabled by standing instruction (2026-09-13) until Andrew
  re-enables it.

## Round 2 — CodeRabbit remediation + review-of-review

- CodeRabbit round 1 on PR #3733 raised 2 minor findings on the new test file
  (provider-to-dispatch boundary coverage; explicit trim/Kimi-prefix
  normalization tests). Both classified In-scope-Fix, test-only. Remediated by
  tscoder-flash in commit c7b200418: file extended from 6 to 11 tests — added
  'ToolCallPipeline -> emitCombinedTerminalContent emission handoff (issue
  #3639)' describe (verbatim unregistered name emitted as tool_call block via
  emitCombinedTerminalContent with real GemmaToolCallParser/DebugLogger deps,
  no mocks; nameless call emits nothing) and 3 normalization-boundary tests
  (outer-whitespace trim; 'functions' concatenated prefix strip;
  'call_functions' prefix + trailing digits strip). Cross-package
  ToolDispatcher/TOOL_NOT_REGISTERED coverage deliberately not duplicated in
  providers — existing agents-package tests cover dispatch.
- Full verification cycle round 2 on head c7b200418: `npm run test` 9790
  passed / 12 failed confined to the 2 known pre-existing cli-args integration
  files (proven environmental on clean main; green in ubuntu CI); lint,
  typecheck, format, build all pass; zai-glm-flash smoke pass. CI on
  c7b200418 fully green (39 pass / 0 fail / 3 intentional skips). Both
  CodeRabbit threads resolved after remediation comment
  https://github.com/vybestack/llxprt-code/pull/3733#issuecomment-5737971184.
- Round-2 external review raised 3 concerns, classified:
  (1) split-name test title misdescribed collector override semantics as
  split-name handling — In-scope-Fix, fixed by renaming the test to 'keeps
  the latest complete name fragment via collector override (no
  concatenation)' with an explanatory comment;
  (2) claim that the issue expects literal raw-name preservation incl. no
  lowercase/Kimi strip and dispatch errors for nameless calls — Reject: those
  normalizations are pre-existing, deliberate, separately tested behavior
  (ToolCallNormalizer), and a nameless call has no name to attribute or
  dispatch; removing them would change live behavior outside issue scope.
  Accepted sub-point: PR-body/auto-summary framing must not describe
  unchanged behavior as newly fixed — PR body amended to state production
  behavior is unchanged;
  (3) PR body/plan.md reported 6 tests vs actual 11 — In-scope-Fix, PR body
  amended (11 tests, c4a133a93 deletions vs c7b200418 test-additions
  distinguished) and this round-2 record added.
- Note that CodeRabbit's auto-generated release-notes summary block on the PR
  is derived from the diff and was framed as behavior fixes; the body
  amendment and test rename are the levers we control to keep the regenerated
  summary accurate.
