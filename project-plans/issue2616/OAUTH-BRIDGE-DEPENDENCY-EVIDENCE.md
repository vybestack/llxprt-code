# OAuth bridge deletion remains unfinished

This run added behavior characterization and traced the dependent construction and
shared-operation paths. It did not change production code, delete the bridge, or
introduce a replacement dependency API. Continue on `issue2616-pr2`, PR #3741.
The staged merge and the preceding OAuth registration changes remain intact.

## Reproduced behavior

`packages/providers/src/auth/oauth-owner-characterization.test.ts` constructs two
real `OAuthManager` instances, real `Config` and `SettingsService` instances,
standard Codex/Anthropic registration, real profile files, and one in-memory token
store. Sharing the store models persisted accounts available to both owners.
There are no identity ALS scopes, runtime registrations, bridge setup, module
mocks, network requests, or browser launches in this suite.

Six characterization cases pass:

- Explicit requested profiles select different accounts under interleaving.
- Explicit requested profiles override the owning settings profile.
- Explicit bucket strings override the owning settings profile.
- An explicitly requested missing profile rejects instead of using a default.
- Profile-scoped session bucket overrides remain on the manager that set them.
- Explicit bucket logout leaves the other account usable.

Five requirement cases fail against the current implementation:

- Implicit stored-token lookup returns the default account rather than the owner
  profile account. The test also requires subsequent owner profile changes to be
  visible, but execution currently stops at the initial wrong-account assertion.
- Implicit forced refresh returns the default account's replacement token rather
  than the owner account's replacement token.
- Bucket status marks no owner session bucket.
- Implicit logout leaves the owner profile account present.
- Multi-bucket authentication throws the missing-accessor-registration error even
  when all requested buckets already contain valid tokens.

These are ordinary failing tests, not skipped tests or assertions that bless the
wrong behavior. This working tree is therefore not ready for full verification or
landing. No green implementation claim is made.

## Auth reader inventory

The following source anchors refer to the preserved production tree based on
`d0211cc11`, with the resolved `bc4753868` merge still staged.

| Consumer | Current read | Required dependency boundary |
| --- | --- | --- |
| `auth/auth-flow-orchestrator.ts:787-790` | Bridge ephemeral settings before bucket filtering | Owner setting reads for prompt/delay policy |
| `auth/token-request-args.ts:23-39` | Bridge prompt setting with catch-to-false | Owner prompt setting, retaining an absent optional setting default |
| `auth/token-profile-resolver.ts:26-45` | Bridge current profile with catch-to-null | Owner current-profile read; explicit requested-profile branch must bypass it |
| `auth/interactive-auth-request.ts:68-79,123-140` | Ambient requester identity plus bridge timeout | Requester kind/id and timeout from the actual owner |
| `auth/auth-status-service.ts:358-409` | Bridge provider manager and runtime context | Provider lookup and runtime auth-scope invalidation for the owner |
| `auth/anthropic-oauth-provider.ts:193-201,268-286` | Bridge browserless setting and association lookup | Browser policy read and association lookup supplied before registration |
| `auth/codex-oauth-provider.ts:343-349,458-472` | Bridge browserless setting and association lookup | Same operations, retaining the per-request bucket capture |

`TokenAccessCoordinator` reaches the profile and prompt readers from token lookup,
peek, refresh, and escalation. It also independently reads `getActiveRuntimeKind`
at `auth/token-access-coordinator.ts:784`. `OAuthManager.activateNamedLoginBucket`
reaches the profile reader at `auth/oauth-manager.ts:388`.

`runtime/oauth-runtime-accessors.ts:40-98` supplies the ambient implementations.
Its profile operation prefers `SettingsService.getCurrentProfileName()` and only
uses `get('currentProfile')` when that method is absent. Its timeout default is
1,200,000 milliseconds. Its browser operation reads a separate singleton store,
although `OAuthManager` already owns a `BrowserProfileAssociationStore` and the
CLI browser commands write through that manager. The file-backed association
store intentionally persists shared provider/bucket associations; object ownership
does not imply separate persistence for identical provider/bucket keys.

The bridge's broad catch paths currently hide missing runtime state. Replacing
those catches with new lifecycle guards at every reader would obscure ownership.
Lifecycle validity must be established at the actual owner entry point.

## Construction dependencies

1. `composition/providerManagerInstance.ts:548-638` constructs a provider manager,
   constructs its OAuth manager, registers aliases that retain that OAuth manager,
   then registers standard OAuth providers. Auth dependencies must exist before
   `registerAllProviders`, including the actual manager used for cache clearing.
2. `runtime/runtimeContextFactory.ts:322-345,565-611` resolves and registers OAuth
   before constructing or adopting the provider manager. Supplied OAuth managers
   pass through `registerStandardOAuthProviders` and are returned unchanged.
   Retrofitting new owner bindings onto a supplied live manager would change its
   existing users. Construction ordering and adoption must be handled together.
3. `agents/src/api/createAgent.ts:572-625` calls `createProviderManager`, discards
   its returned OAuth manager, and transfers provider instances onto the isolated
   manager. Those instances retain the temporary OAuth manager. The isolated
   handle has a different OAuth manager. Binding only the handle's manager leaves
   model-side token requests on the other instance.
4. `agents/src/api/fromConfig.ts:81-112,190-204` adopts the provider manager before
   activation, but selects the Config-associated OAuth manager after activation.
   Its `createIsolatedRuntimeContext` call does not supply that existing OAuth
   manager. Activation can therefore register another OAuth manager while the
   final agent and existing providers continue using the caller's manager.
5. `runtime/runtimeContextFactory.ts:381-452` changes runtime id and kind at
   activation, changes the provider manager's context, runs `prepare`, and then
   registers infrastructure. Any owner identity used by auth must preserve those
   activation overrides without rebinding a shared live owner.
6. `runtime/assembleCliProviderRuntime.ts:126-171` registers ambient context before
   `createProviderManager` and registers infrastructure afterward. The bridge
   registration currently happens through `runtimeLifecycle.ts:252`, before
   provider registration. Moving auth dependency injection to infrastructure
   registration would be too late for construction-time registration.

## Shared operations that extend the boundary

The complete auth registration and runtime-kind behavior cannot be isolated to the
seven bridge reader files:

- `runtime/providerSwitch.ts:549,567,615` resolves the OAuth manager and runtime
  kind ambiently for lazy Claude Code login and defaults. It invokes
  `ensureOAuthProviderRegistered` on that resolved manager. The surrounding
  `switchActiveProvider` path builds its context through `getCliRuntimeServices`
  at line 804 and reads the active profile through `getActiveProfileName` at line
  913. Fixing only constructor wiring leaves this production registration caller
  selecting its owner through the ambient shared operation.
- `agents/src/api/providerActivationExecutor.ts:328,378,625` calls that shared
  switch operation. Its existing Config argument does not supply ownership to
  those calls. The explicit auth registration chain must reach these callers.
- `errors.ts:475-495,547-550` independently reads ambient runtime kind when
  building the reauthentication suffix of `AllBucketsExhaustedError`.
  `RetryOrchestrator.ts:860` constructs that error without an explicit kind.
  Preserving owner-specific recovery wording outside ALS requires this retry
  error path to carry owner kind as well.

These are concrete dependencies for the complete requested behavior. They do not
justify a whole-services object, an ambient adapter around injected methods, a
new identity registry, or migration of unrelated singleton families in this slice.

## Continuation

Continue the auth reader migration together with its provider-switch registration
caller and retry-error kind input. Resolve the temporary-manager transfer and
adopted-owner identity before choosing constructor arguments. Give each auth
collaborator only its used operations, with existing objects owning the state.
Then remove the bridge, its runtime registration module/call, obsolete exports
and setup, and add the requested AST/name deletion controls with positive and
negative cases.

Requester identity, browser routing, activation overrides, disposal behavior,
temporary provider transfer, and supplied-manager adoption still need dedicated
real-owner behavior tests. The characterization suite added here does not claim
coverage of those cases.

## Verification and preserved state

- New suite: 6 pass, 5 fail. The explicit-request group also ran separately and
  passed all 6 cases. No production fix or red-to-green cycle was completed.
- Related auth, composition, isolated-runtime, and agent-adoption regressions:
  130 pass across 13 files, each in a separate Bun process.
- Existing `ambient-runtime-symbols-guard.test.ts`: 26 pass. No bridge deletion
  controls were added; those remain part of implementation.
- `npm run typecheck --workspace @vybestack/llxprt-code-providers`: passed after
  adding the required model field to the new test fixture.
- Touched-file ESLint and Prettier checks: passed. The test-audit scanner completed
  with no findings for the new test file.
- An earlier direct `tsc -p packages/providers/tsconfig.json --noEmit` invocation
  failed with diagnostics across the broader test inventory, including the then
  missing fixture model field. The package-defined command above is the final
  successful typecheck; the broader config was not rerun.
- Remaining-symbol scan: 31 matching lines for the bridge/registration names in
  production source and comments, excluding test/spec/helper files. Deletion is
  not achieved. Full scan output is `remaining-bridge-symbols.txt` in the log dir.
- No full suite, build, smoke retry, OCR, or review was run.

Byte comparisons of the staged patch, original unstaged patch, and index entries
all returned equality. HEAD remains `d0211cc11`, MERGE_HEAD is `bc4753868`, and
nothing was staged, committed, pushed, reset, or aborted. `.llxprt/` and
`PR-C-PROVIDERS-INTERNALS.md` were not edited.

This run added only this document and `oauth-owner-characterization.test.ts`, both
untracked. At the final status check, two additional untracked files,
`scripts/tests/runtime-state-structure-guard.ts` and its `.test.ts` companion,
had appeared. This run did not create or modify them.
