# Issue #3437: Rip the dead TokenStore deprecation shim out of AnthropicOAuthProvider

Branch: `issue3437` (from `main` @ 48e22bdbf at branch creation)

## Problem

`AnthropicOAuthProvider` (packages/providers/src/auth/anthropic-oauth-provider.ts)
still carries the PLAN-20250823-AUTHFIXES.P16 deprecation shim:

- Constructor parameter `private _tokenStore?: TokenStore` is optional.
- When omitted, the constructor logs
  `DEPRECATION: claudecode OAuth provider created without TokenStore. ...`
  and continues.
- Downstream methods guard the optional store:
  - `initializeToken()` early-returns when `!this._tokenStore` (L434-436).
  - `getToken()` returns `null` when `!this._tokenStore` (L462-464).
  - `this._tokenStore!` non-null assertions (L441, L468).

Production can never hit this path: the only production construction site,
`ensureOAuthProviderRegistered()` in
packages/providers/src/composition/oauth-provider-registration.ts, resolves
`effectiveTokenStore = tokenStore ?? oauthManager.getTokenStore?.()` and returns
early (with a warning) when no store exists. The only construction with
`undefined` is a test exercising the shim itself
(packages/providers/src/auth/anthropic-oauth-provider.no-refresh-on-gettoken.spec.ts
L104-110, "returns null when no token store is configured").

`CodexOAuthProvider` (same directory) already uses the target shape:
`constructor(tokenStore: TokenStore, addItem?: OAuthUICallback)` with a
non-optional private `tokenStore` field and no guards. Anthropic is the laggard.

## Accepted behavior (acceptance criteria)

1. **Required parameter.** The `AnthropicOAuthProvider` constructor takes
   `tokenStore: TokenStore` (non-optional), `addItem?: OAuthUICallback` second.
   Private field named `tokenStore` (matches CodexOAuthProvider; drops the
   misleading `_` prefix). Omitting the argument is a compile-time error.
2. **Runtime fail-fast.** Constructing with a falsy store (e.g. a JS caller
   passing `undefined`) throws immediately from the constructor with an Error
   whose message names the provider and the missing token store. No warning, no
   continuing.
3. **No DEPRECATION shim remains.** The `DEPRECATION: ... created without
   TokenStore` warn block and its PLAN-20250823-AUTHFIXES.P16 annotations are
   deleted.
4. **Dead optional-store guards removed.** The `if (!this._tokenStore)`
   early-returns in `initializeToken()` and `getToken()` and the `!` non-null
   assertions are removed; they existed only to serve the optional path and are
   unreachable once the constructor enforces the store (mirrors CodexOAuthProvider).
5. **Test coverage.** The test "returns null when no token store is configured"
   (constructing with `undefined`, asserting `getToken()` returns null) is
   replaced with fail-fast coverage: constructing without a store throws.
   Constructor behavior coverage lives in anthropic-oauth-provider.test.ts.
   All other existing tests construct with a store and must keep passing.

## Inputs and boundary cases

| Input | Expected |
| --- | --- |
| `new AnthropicOAuthProvider(store)` | Works, unchanged behavior |
| `new AnthropicOAuthProvider(store, addItem)` | Works, unchanged behavior |
| `new AnthropicOAuthProvider(undefined)` (cast; runtime boundary) | Throws from constructor |
| `new AnthropicOAuthProvider()` (arg omitted) | Compile-time error (typecheck proves) |
| Production registration path with no store | Unchanged: warns "Token store unavailable ... registration skipped", never constructs |

## Tests that prove it (TDD)

1. RED: add to `anthropic-oauth-provider.test.ts` a constructor test:
   `new AnthropicOAuthProvider(undefined as unknown as TokenStore)` throws,
   message matches `/TokenStore/`. Fails against current shim (no throw today).
2. GREEN: implement the constructor change + guard removal.
3. Remove the obsolete "returns null when no token store is configured" test
   from `anthropic-oauth-provider.no-refresh-on-gettoken.spec.ts` (its premise
   is the removed shim).
4. Full suite + typecheck prove no other construction site relied on the
   optional parameter.

## Out of scope (explicitly)

- `CodexOAuthProvider` (already clean) and any other deprecation shims
  elsewhere (audit #3436's business).
- No public API changes beyond the constructor parameter type (internal API).
- No new abstractions, workflows, dependencies, or refactors.
- Historical project-plans/* documents that quote the old message stay
  untouched (they are records, not live docs).

## Verification

Full cycle per llxprt-issue-workflow: `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, then
`bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"`.

Review: deepthinker compliance review (max 2 rounds). OCR is skipped:
standing instruction is to not run OCR until Andrew re-enables it.

## Implementation notes for the subagent

- Match CodexOAuthProvider style for the field/constructor.
- Keep the existing constructor docblock lines that still apply (P06 sync
  constructor note); remove only the P16 deprecation annotation block.
- The throw must happen before any other constructor work (fail fast), message
  should identify `AnthropicOAuthProvider` / claudecode and state that a
  TokenStore is required.
- Do not touch anything outside the files named above.

## Results (2026-09-16)

### Implementation

- `anthropic-oauth-provider.ts`: constructor `constructor(tokenStore: TokenStore, addItem?: OAuthUICallback)`; module-level `assertTokenStore()` (assertion-function pattern per runtimeFactories.ts precedent) throws on undefined/null as the first constructor statement; P16 block deleted; dead guards and `!` assertions removed; field renamed `tokenStore`.
- `anthropic-oauth-provider.test.ts`: new behavioral test `throws when constructed without a TokenStore` (RED first: failed against the shim, see tmp/issue3437-verify/red-fail.log; GREEN: 13/13 in green-pass.log).
- `no-refresh-on-gettoken.spec.ts`: obsolete undefined-store test deleted (its premise is the removed shim).
- BOUNDED CI-unblock (authorized by scope rule "CI/lint failures authorize bounded scope expansion"): `OpenAIStreamProcessor.ts` was at 801 effective lines vs the 800 max-lines cap, pre-existing on main from e75c46a59 (#3658). This PR touches packages/providers, so CI's affected-targets lint would fail. Fix: behavior-identical consolidation of `boundFrameKeys` (named `cutKey` mapper keeps prettier's chain-expansion rule satisfied) → 800 effective lines. No eslint policy or threshold changes.

### Verification (tmp/issue3437-verify/cycle2-results.txt)

- npm run test: exit 0 (full suite)
- npm run lint: exit 0 (includes providers; both constructor lint rules and max-lines now clean)
- npm run typecheck: exit 0
- npm run format: exit 0
- npm run build: exit 0
- Smoke: exit 0, haiku produced via zai-glm-flash (glm-5.3-flash)
- AST test-audit scanner: no findings on touched test files (pre-existing baseline finding in an untouched file only)

### Review

- Round 1 (tscoder-zai; deepthinker/reviewer unavailable: provider rate limits): **APPROVE**. Zero HIGH/MEDIUM findings; two LOW observations classified Reject (optional message-regex tightening; optional inlining of the assert). Independent spot-checks green: 13/13 tests on the touched files, eslint clean on all four changed files. Effective-line math independently confirmed (main 801 → branch 800). No remediation round needed; review cap used: 1 of 2.
- OCR: not run, per standing suspension instruction (Andrew, 2026-09-13) until re-enabled.
