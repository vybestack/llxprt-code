# Issue #3172 — Wire the system-prompt placement contract

## Purpose

Connect the existing provider declaration and shared placement policy to the live Anthropic request path without changing wire bytes. Reconcile OAuth classification first so both prompt placement and transport are driven by the resolved token rather than by the unresolved token/provider shape.

## Accepted behavior

### AC-1 — One resolved-token OAuth predicate

- Anthropic OAuth classification is defined in one helper and recognizes a resolved token as OAuth exactly when it starts with `sk-ant-oat`.
- Client authentication, transport behavior, projection, and system-prompt placement use that same predicate or a fact produced by it; no second Anthropic OAuth-prefix predicate is introduced.
- A runtime auth-token provider is resolved before placement is declared.
- A runtime provider that resolves to an `sk-ant-oat...` token produces OAuth transport behavior and `context-prefix` placement.
- A runtime provider that resolves to an `sk-ant-api...` token produces API-key transport behavior and `system-field` placement. The provider object's structural shape alone must not imply OAuth.

### AC-2 — The declared placement capability controls the live request

- The live Anthropic request path invokes `AnthropicProvider.getSystemPromptPlacement` with the resolved-token fact.
- The returned declaration is passed through `resolveSystemPromptPlacement`.
- `AnthropicRequestPreparation` selects its system-context representation from the resolved `SystemPromptPlacement`; it does not select placement from `params.isOAuth`.
- `isOAuth` remains available only for Anthropic transport concerns that are independent of placement, such as authentication headers, tool-name handling, and the vendor-required Claude Code system value.

### AC-3 — Preserve current wire behavior

- For an OAuth token, the Anthropic `system` field remains exactly `You are Claude Code, Anthropic's official CLI for Claude.` and contains no assembled prompt bytes.
- For an OAuth token, the assembled instruction remains the first user context item with the existing `<system>...</system>` wrapper, boundary text, caching shape, and TTL behavior.
- For a non-OAuth token, the assembled instruction remains in the Anthropic `system` field with the existing caching shape.
- No non-Anthropic prompt assembly, formatting, or transport code changes. Existing non-Anthropic prompt bytes remain unchanged by construction and by the full providers test suite.

### AC-4 — Structural enforcement

- ESLint has an error-level, provider-scoped structural rule that rejects the local placement decision pattern this issue removes from `AnthropicRequestPreparation`.
- The rule does not disable, downgrade, or loosen any existing lint or complexity policy.
- CI exercises the rule through the existing lint workflow.

### AC-5 — Remove the directly duplicated runtime-token guard

- `AnthropicProvider` uses the existing shared `utils/authToken.ts` runtime-token type guard while resolving tokens.
- The duplicate local `isRuntimeAuthTokenProvider` implementation is removed.
- This cleanup is accepted only because it is on the predicate-reconciliation path; no broader auth-token refactor is included.

## Inputs and boundary cases

| Input | Expected OAuth fact | Expected placement | Expected Anthropic prompt location |
| --- | --- | --- | --- |
| Resolved string `sk-ant-oat...` | true | `context-prefix` | first user context item; fixed Claude Code string alone in `system` |
| Resolved string `sk-ant-api...` | false | `system-field` | assembled instruction in `system` |
| Runtime token provider resolving to `sk-ant-oat...` | true after resolution | `context-prefix` | same bytes as direct OAuth string |
| Runtime token provider resolving to `sk-ant-api...` | false after resolution | `system-field` | same bytes as direct API-key string |
| Provider with no placement declaration | n/a | shared default `system-field` | unchanged existing default policy |
| Prepared prompt-envelope transport token | reuse the auth fact produced when the resolved token was prepared | same declaration and policy result as its underlying token | projection and transport remain byte-identical |

Existing fail-fast behavior for a missing/blank system instruction is unchanged and remains outside the predicate change.

## Behavioral proof (test first)

1. Extend the Bun placement/provider tests with a failing case proving that an unresolved runtime provider object is not classified by shape: its resolved `sk-ant-api...` value declares `system-field` and reaches the non-OAuth wire shape.
2. Add the complementary runtime-provider `sk-ant-oat...` case proving it declares `context-prefix` and preserves the OAuth wire shape.
3. Add or extend a focused test proving the live path consumes the provider declaration through the shared resolver rather than selecting placement from `isOAuth`. The assertion must be against the resulting request payload, not a mock-call count.
4. Keep `AnthropicProvider.systemPrompt.characterization.test.ts` unchanged and run it as the byte-for-byte tripwire.
5. Run the focused Bun tests for system-prompt placement, Anthropic auth/prompt-envelope parity, and Anthropic prompt characterization; then run the complete repository verification suite.
6. Run ESLint over the affected provider source. The removed `if (params.isOAuth)` placement branch is the forbidden structural form; the candidate source must pass while that form is rejected by the configured rule.

All new or changed tests use `bun:test`; no Vitest or Node test suite is added or modified.

## Implementation sequence

1. RED: add runtime-token boundary tests that expose the current shape-versus-resolved-token disagreement and live placement wiring gap.
2. GREEN: centralize Anthropic OAuth-token classification and make the declaration consume the resolved token.
3. GREEN: resolve the declaration through `resolveSystemPromptPlacement`, pass placement into request preparation, and branch system-context construction on placement.
4. REFACTOR: replace the duplicate local runtime-token guard with the existing shared guard.
5. Add the error-level structural lint rule and verify the focused tests/lint.
6. Run full verification, reviews, and PR gates.

## Scope boundaries

Included: Anthropic OAuth classification needed for placement parity, the existing `IProvider` placement capability signature/usage, Anthropic request preparation, shared auth/placement utilities as needed, focused Bun tests, and the required ESLint structural guard.

Excluded: prompt content changes; changes to non-Anthropic providers; new provider/public subsystems; auth redesign; OAuth refresh behavior changes; caching changes; unrelated cleanup; dependencies; workflows; agent memory; quality-rule weakening; and edits to the characterization tripwire.

## Review triage policy

Every finding is recorded as one of:

- **Blocker-Fix** — prevents an accepted behavior, verification gate, CI gate, conflict-free ancestry, or safe/correct delivery.
- **In-scope-Fix** — improves or corrects implementation of an accepted behavior without expanding these boundaries.
- **Reject** — factually incorrect, already satisfied, or harmful to an accepted invariant.
- **Defer** — valid but outside the accepted scope; optional cleanup and speculative hardening are not implemented here.

At most two local Open Code Review runs and two PR Open Code Review runs are permitted for this issue.