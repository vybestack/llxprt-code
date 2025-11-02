# Merge Plan: agentic <- origin/main (2025-11-01)

## Objectives
- Integrate upstream main changes (release 0.4.7 line) into the `agentic` branch without regressing runtime/subagent functionality.
- Preserve agentic-specific governance, runtime isolation, and tooling while adopting main’s auth, alias, and CLI UX improvements.
- Deliver a clean merge commit validated by the full repo checklist.

## Constraints & Guardrails
- Do not rewrite history; keep merge commit structure.
- Preserve both branches’ feature sets (no regressions to runtime subagents or main fixes like mixed-content tool responses and `/set` flag support).
- Maintain Node 20 compatibility and ensure package versions align with `0.4.7` release train.
- Follow repository checklist before completion.

## Work Phases
1. **Analysis & Strategy**
   - Enumerate conflicts (done) and map each to desired end state.
   - Prioritize files impacting runtime/auth/provider pipelines.
2. **Core Runtime & Provider Resolution**
   - Merge `packages/core` conflicts (index exports, provider implementations, geminiChat, complexity analyzer, todo tools).
   - Confirm runtime governance hooks remain while incorporating main bug fixes/tests.
3. **CLI Platform Resolution**
   - Reconcile `packages/cli` config/auth/providerManager files and alias registration.
   - Update UI commands/components ensuring new alias/status UX + tools governance coexist.
   - Ensure new tests (`anthropic-oauth-provider.local-flow`, alias tests, etc.) compile against merged APIs.
4. **Docs & Manifest Alignment**
   - Combine documentation edits and adopt version/sandbox updates in package manifests.
   - Regenerate `package-lock.json` after code resolution.
5. **Validation & Review**
   - Run checklist (`format:check`, `lint`, `typecheck`, `test`, `build`, CLI smoke start`).
   - Inspect UI/manual hotspots if needed (e.g., `/tools`, `/provider`, auth status output).
   - Summarize changes, outstanding risks, and next steps for final review.

## Risk Mitigations
- Keep intermediate saves via logical commit points (but single merge commit final output).
- Back up conflicted files before large refactors using `git checkout --theirs/--ours` as needed (without losing context).
- Run targeted tests (vitest suites) after major subsystem merges before full checklist.
- If new regressions surface, bisect by staging subsets of files.

## Exit Criteria
- All conflicts resolved; `git status` clean except intended files.
- Full checklist passes with exit code 0.
- Merge commit message documents integration and no functionality regressions observed.
- Ready for maintainer review / follow-up strategy discussion.
