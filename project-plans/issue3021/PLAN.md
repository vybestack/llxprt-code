# PLAN-20260804-ISSUE3021 — Diagnose ad-hoc PATH Bun on macOS

Issue: #3021 — macOS launcher should warn when the selected PATH Bun is ad-hoc signed

## Accepted behavior

1. When the POSIX launcher is running on Darwin and the existing #2962 version gate selects a Bun from `PATH`, inspect that exact executable's designated code-signing requirement before `exec`.
2. Treat a requirement containing a certificate team-identity clause (`certificate leaf[subject.OU]`) as identity-based. Continue without a warning; this includes Oven-signed Bun.
3. If the requirement is ad-hoc, cdhash-only, unsigned, or otherwise contains no team-identity clause, emit one warning block to stderr. The warning explains the repeated macOS Keychain password prompts, states that “Always Allow” will not persist, and names both supported remedies:
   - `brew uninstall bun && brew install oven-sh/bun/bun`
   - `curl -fsSL https://bun.com/install | bash`
4. The warning is advisory. The selected PATH Bun must still receive the entry path and user arguments and be executed normally.
5. Do not inspect signatures or emit this warning outside Darwin. Existing Linux and Windows runtime selection remains unchanged.
6. Document the warning and remedies in the macOS Keychain recovery guidance, including why #3020 makes “Always Allow” ineffective.

## Decision: warn, do not skip

The launcher will not skip an ad-hoc PATH Bun and will not fail startup. An ad-hoc Bun is valid for users who do not access Keychain credentials, while falling through to the bundled Bun would silently restore the npm-unlink failure mode that #2962 avoids. This issue therefore adds diagnosis and recovery guidance only.

## Relevant inputs and boundaries

| Input | Accepted result |
| --- | --- |
| Darwin; PATH Bun meets pinned version; designated requirement has Oven's `certificate leaf[subject.OU]` clause | Execute PATH Bun with no ad-hoc warning |
| Darwin; PATH Bun meets pinned version; designated requirement is cdhash-only | Emit one actionable warning, then execute PATH Bun |
| Darwin; PATH Bun meets pinned version; signature inspection reports unsigned/no team identity | Emit one actionable warning, then execute PATH Bun |
| Darwin; PATH Bun is below the pinned version or pin is unavailable | Preserve existing bundled-Bun fallback; no PATH-Bun signature inspection requirement |
| Linux or Windows-equivalent kernel result | No signature inspection and no ad-hoc warning |
| User arguments contain spaces, Unicode, or shell metacharacters | Preserve existing argument forwarding unchanged |

No new configuration, dependency, public API, abstraction, workflow, or signature policy is accepted. In particular, this issue does not add a hard failure, automatically choose the bundled Bun, alter Keychain storage, or implement the #2928 keyring opt-out.

## Test-first evidence

Extend `scripts/tests/issue-2962-system-bun-preference.bun.test.ts` using executable filesystem fixtures and the real launcher; use Bun and `bun:test` only.

1. **RED — cdhash/ad-hoc warning is actionable and non-fatal**
   - Put a version-compatible Bun stub and a `codesign` stub on `PATH`.
   - Return a cdhash-only designated requirement.
   - Assert one warning block on stderr contains the Keychain consequence and both remedies.
   - Assert exit status 0 and stdout proves the PATH Bun executed.
2. **RED — unsigned/no-identity output warns**
   - Make `codesign` report no signed requirement.
   - Assert the same single warning and successful PATH-Bun execution.
3. **RED — Oven identity does not warn**
   - Return a designated requirement containing `certificate leaf[subject.OU] = "7FRXF46ZSN"`.
   - Assert successful PATH-Bun execution and absence of the warning.
4. **RED — non-Darwin kernels do not inspect or warn**
   - Exercise the launcher with controlled Linux and Windows-like `uname` results while a warning-triggering `codesign` stub is present.
   - Assert the bundled entry executes and stderr has no ad-hoc warning.
5. Preserve the existing #2962 version-floor, bundled-fallback, and argument-forwarding tests.
6. Run the focused test before implementation and record that the new assertions fail because the warning behavior is absent. Implement only enough launcher and documentation change to turn them green.

## Verification gates

- Focused Bun launcher test
- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
- DeepThinker review and Open Code Review, with each finding classified as Blocker-Fix, In-scope-Fix, Reject, or Defer
- PR checks green on the candidate head, all review threads resolved or explicitly deferred for user judgment, branch conflict-free, and ancestry based on current `origin/main`

## Guardrails

- No lint, complexity, coverage, or source-size rule changes or suppressions.
- No new JavaScript or Vitest/Node test suite changes; changed tests use Bun and `bun:test`.
- No adjacent launcher cleanup, speculative signature hardening, unrelated refactor, dependency change, workflow change, or `.llxprt/` modification.
- Local OCR and PR OCR are each capped at two runs.
