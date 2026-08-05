# Issue 3062: Restore PR walkthrough generation without public prompt leakage

Plan ID: ISSUE-3062-WALKTHROUGH-BURP
Generated: 2026-08-05

## Observed failure and root cause

The linked PR review run installed the published nightly CLI and invoked it with
`--provider openai`. Every model call failed before reaching the API because the
prebuilt bundle registered no built-in providers:

    Could not activate explicitly-configured provider 'openai': Provider 'openai' not found

The same defect reproduces on the current source tree: the unbundled CLI
activates `openai` and reaches the configured endpoint, while the freshly built
`packages/cli/bundle/llxprt.js` reports that the provider is absent.

Built-in provider definitions are data files under
`packages/providers/src/composition/aliases`. The bundled provider loader
already searches for the documented publish layout at
`bundle/providers/aliases`, but `buildCliBundle()` emits only `bundle/llxprt.js`.
Consequently `loadProviderAliasEntries()` finds no built-in entries and
`createProviderManager()` cannot register `openai`.

A second issue turned that internal failure into the reported public “burp”:
`runMapPhase()` copied each rejected process error into the per-file placeholder
summary. Node's failed-command message includes the complete argument vector,
including the prompt and its `UNTRUSTED DATA (JSON)` payload. The public
walkthrough therefore reproduced internal command and prompt diagnostics.

## Accepted behavior

### AC1: Published CLI bundles include built-in provider aliases

- **Given** the normal CLI prepack/bundle build
- **When** `buildCliBundle()` completes successfully
- **Then** the bundle layout contains the built-in provider alias data expected
  by the existing bundled provider loader.
- **And** running the built bundle with an explicitly configured `openai`
  provider activates that provider and reaches an OpenAI-compatible endpoint,
  rather than failing with `Provider 'openai' not found`.

### AC2: Successful provider calls can produce the walkthrough

- **Given** valid review artifacts and successful structured responses from the
  configured LLxprt provider
- **When** the walkthrough pipeline runs through the same command boundary used
  by CI
- **Then** it writes a rendered walkthrough comment from those responses rather
  than a list of failed per-file summaries.

### AC3: Per-file failures never publish process or prompt diagnostics

- **Given** a per-file LLxprt invocation that fails and whose internal error
  contains its command, prompt, `UNTRUSTED DATA (JSON)` payload, or provider
  stack details
- **When** the pipeline renders a fallback walkthrough
- **Then** the public comment contains only a fixed generic per-file failure
  summary and the affected file path.
- **And** the public comment does not contain the failed command, prompt content,
  untrusted-data payload, API details, or stack trace.
- **And** internal diagnostics remain available through workflow stderr/logs.

## Relevant inputs and boundary cases

- Built-in alias files are runtime package assets, not user alias files. User
  provider configuration behavior is unchanged.
- The `UNTRUSTED DATA (JSON)` prompt boundary is intentional injection
  hardening and remains unchanged; only accidental publication of a failed
  prompt is prevented.
- The established generic placeholder for an oversized file remains unchanged.
- A mixture of successful and failed per-file calls keeps successful summaries
  and substitutes the same generic placeholder only for failures.
- Missing required configuration and whole-pipeline failures retain their
  existing behavior; this issue does not redesign error handling.
- The trusted-base checkout, nightly installation step, workflow triggers,
  credentials, models, quota selection, and comment-posting workflow remain
  unchanged. No workflow file change is required or accepted.
- No dependency, public package API, agent-memory, quality-tool, or lint-rule
  change is accepted.

## Test-first evidence

1. **RED — bundle behavior.** Add a Bun behavioral regression that performs the
   real CLI bundle build, verifies the expected alias assets are emitted, and
   runs the generated bundle against a local OpenAI-compatible HTTP fixture.
   It must fail on the issue baseline because the assets are absent and the
   bundle reports `Provider 'openai' not found`.
2. **GREEN — bundle behavior.** Make the minimal build change that emits the
   existing provider alias assets at the path already consumed by the bundle.
   The same test must prove the built-in provider activates and receives the
   fixture response.
3. **RED — public fallback.** Add a Bun process-level walkthrough regression
   using real review artifacts and a deliberately failing `llxprt` executable
   whose error contains a unique command/prompt diagnostic sentinel and the
   `UNTRUSTED DATA (JSON)` marker. It must fail on the baseline because the
   rendered comment contains those diagnostics.
4. **GREEN — public fallback.** Replace the dynamic per-file public failure
   reason with a fixed generic summary. The process-level test must prove the
   comment still identifies the file, contains the generic summary, and contains
   none of the sentinels, command, prompt marker, or stack detail. It must also
   prove the internal process output retains the diagnostic sentinel.
5. Run focused Bun tests, then the complete project verification suite and the
   required profile smoke test.

## Implementation boundary

The production change is limited to:

- the existing CLI bundle build function, to place existing built-in alias data
  in its already-documented runtime location; and
- the existing per-file failure projection in the walkthrough script, to use a
  fixed public placeholder rather than the internal process error.

No adjacent cleanup, provider-loader redesign, workflow edit, new subsystem,
new dependency, or public abstraction is in scope.

## Review triage policy

Every review finding will be classified as one of:

- **Blocker-Fix**: violates accepted behavior, TDD/architecture/safety gates,
  candidate ancestry, conflict-free delivery, or required verification.
- **In-scope-Fix**: corrects implementation or behavioral evidence for AC1-AC3
  without adding behavior beyond this plan.
- **Reject**: factually incorrect, already satisfied, or contrary to accepted
  behavior.
- **Defer**: potentially valid but outside AC1-AC3 or requiring an unaccepted
  workflow, subsystem, dependency, abstraction, or unrelated refactor.

Open Code Review is capped at two local reviews and two PR reviews for this
issue. Completion requires behavioral evidence for every acceptance criterion,
full local verification, completed and triaged reviews, green CI on the
candidate head, correct ancestry, and a conflict-free PR.
