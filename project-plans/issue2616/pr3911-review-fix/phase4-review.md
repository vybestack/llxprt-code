# Phase 4 review

Scope: T4.1 (`b5a3f9452`) and T4.2 (`863cf994c`), including the full diff from `56f5c3c5d` to HEAD.

Findings will be appended as verified.

## 1. Medium: the required two-root regression stops short of the CLI control boundary

- **Task:** T4.1 and T4.2
- **Commits:** `b5a3f9452`, `863cf994c`
- **Locations:** `packages/providers/src/auth/__tests__/oauth-manager.attempt-outcomes.behavior.test.ts:102`, `packages/providers/src/auth/__tests__/oauth-manager.dialog-state.behavior.test.ts:110`, `packages/cli/src/ui/hooks/useOAuthOrchestration.test.ts:153`, `packages/cli/src/ui/AppContainer.oauth-dismiss.test.ts:57`
- **Problem:** T4.1 explicitly requires concurrent live managers with each root's CLI OAuth control, and T4.2 requires the dialog isolation and surviving code entry through those controls. The new manager tests call managers/providers directly. The two-owner CLI test constructs two bare `OAuthUIBridge` instances and manually calls `failAuth`/`completeAuth`; it neither authenticates nor tears down a root. The real manager/control/CLI harness exercises only one root at a time and directly submits to the provider. Consequently no test proves that the production manager-to-control-to-CLI wiring keeps concurrent roots isolated during settlement and teardown, which is the reported B5 failure.
- **Concrete fix:** Add a CLI behavioral test using two live managers, real Anthropic manual-code providers and `assembleSessionAuthentication` for each root. Mount each root's orchestration and code-dialog host against its own control. Interleave requests and outcomes, dismiss/unmount/dispose A while B remains pending, then submit B's code through its CLI control and assert B persists credentials and closes only its own dialog. Include the A-fails/B-succeeds outcome case and show the test fails with shared state.

The recorded T4.2 red run (`tmp/pr3911/T4.2/red-1.log`) also never reaches an isolation assertion: all three cases time out waiting for the manager-local URL callback at `oauth-manager.dialog-state.behavior.test.ts:72-76,105,127,150`. With singleton delivery restored, that callback cannot announce readiness. The replacement regression should reach the competing logins and fail on an observable cross-root state error, rather than depending on this setup timeout.

## Review result

**Counts:** Critical 0; High 0; Medium 1; Low 0.

The full 43-file diff was reviewed. Production searches found no remaining OAuth UI/dialog/outcome globals, singleton bridge export, old global hook, or module-scope mutable dialog registry. Production OAuth construction is centralized in `oauth-provider-registration.ts`; its calls go through `OAuthManager.registerProvider`, which binds the UI port. Preferred, adopted, child and preflight creation paths, provider switching, and alias refresh were traced without finding a bypass. The new unconditional CLI member calls are confined to code-dialog render/submission paths; the only production opener is the availability-gated orchestration hook. The removed provider-absent case is no longer producible through `requestCode(provider: string)`: `needsCode` becomes true only together with its provider. No new timeout increases, allowlist entries, old-path aliases or catch-all wiring handlers were found.

Focused tests run during this review, each in its package directory with stdin closed and one file per Bun process:

| File | Passed | Failed |
| --- | ---: | ---: |
| providers: `src/auth/__tests__/oauth-manager.attempt-outcomes.behavior.test.ts` | 2 | 0 |
| providers: `src/auth/__tests__/oauth-manager.dialog-state.behavior.test.ts` | 3 | 0 |
| cli: `src/ui/hooks/useOAuthOrchestration.test.ts` | 6 | 0 |
| cli: `src/ui/hooks/useOAuthOrchestration.spec.ts` | 7 | 0 |
| cli: `src/ui/AppContainer.oauth-dismiss.test.ts` | 13 | 0 |
| cli: `src/ui/components/OAuthCodeDialog.test.tsx` | 12 | 0 |

No package suites were run. No source or plan files were edited.
