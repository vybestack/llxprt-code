# RS-V3: vitest/no-conditional-expect

Baseline (post RS-V2, commit 2749a9bb7): **440 warnings across 60 files**.

## Rule semantics

`vitest/no-conditional-expect` forbids `expect(...)` calls inside `if` / `else` / `switch` / `try` / `catch` / `finally` / loops. Most sites in this repo follow the discriminated-union narrowing pattern:

```ts
const result = await performResume(...);
expect(result.ok).toBe(true);
if (result.ok) {
  expect(result.history).toHaveLength(1); // <-- flagged
}
```

## Transformation pattern

Replace narrowing `if (discriminator) { expect(...) }` with an unconditional narrowing throw after the boolean assertion:

```ts
const result = await performResume(...);
expect(result.ok).toBe(true);
if (!result.ok) throw new Error("expected result.ok to be true");
expect(result.history).toHaveLength(1);
```

For `expect(x).toBe(false)` followed by `if (!x) { expect(...) }`, invert the narrowing throw. When the conditional is a `try`/`catch` used to assert thrown errors, convert to `.rejects.toThrow(...)` or wrap in `expect(() => { ... }).toThrow(...)` with a real matcher. When the conditional is a loop aggregating assertions, hoist all items into an array and assert the collection shape.

## Sub-batches

Ordered by offender count, clustered into tiers:

### RS-V3a: Top 5 files (~203 sites, 46% of total)

- `packages/cli/src/services/__tests__/performResume.spec.ts`: 56 warnings
- `packages/cli/src/__tests__/sessionBrowserE2E.spec.ts`: 49 warnings
- `packages/cli/src/config/settings-validation.test.ts`: 38 warnings
- `packages/core/src/storage/secure-store.test.ts`: 37 warnings
- `packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts`: 23 warnings

### RS-V3b: Mid tier, >= 5 sites (~long list)

- `packages/cli/src/ui/__tests__/integrationWiring.spec.tsx`: 17 warnings
- `packages/core/src/tools/__tests__/ast-edit-characterization.test.ts`: 16 warnings
- `packages/core/src/storage/secure-store-integration.test.ts`: 14 warnings
- `packages/core/src/utils/__tests__/resolveTextSearchTarget.test.ts`: 13 warnings
- `packages/cli/src/ui/components/InputPrompt.test.tsx`: 9 warnings
- `packages/cli/src/ui/utils/clipboardUtils.test.ts`: 8 warnings
- `packages/core/src/scheduler/tool-dispatcher.test.ts`: 8 warnings
- `packages/core/src/auth/qwen-device-flow.spec.ts`: 7 warnings
- `packages/core/src/core/coreToolScheduler.hooks.characterization.test.ts`: 7 warnings
- `packages/core/src/providers/__tests__/RetryOrchestrator.test.ts`: 7 warnings
- `packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts`: 6 warnings
- `packages/core/src/auth/auth-integration.spec.ts`: 6 warnings
- `packages/core/src/core/compression/MiddleOutStrategy.test.ts`: 6 warnings
- `packages/core/src/utils/googleQuotaErrors.test.ts`: 6 warnings
- `packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts`: 5 warnings
- `packages/core/src/core/compression/OneShotStrategy.test.ts`: 5 warnings
- `packages/core/src/core/compression/TopDownTruncationStrategy.test.ts`: 5 warnings
- `packages/core/src/core/compression/__tests__/high-density-compress.test.ts`: 5 warnings
- `packages/core/src/core/compression/__tests__/high-density-optimize.test.ts`: 5 warnings
- `packages/core/src/tools/__tests__/ast-edit-empty-file.test.ts`: 5 warnings

### RS-V3c: Long tail, < 5 sites

- `packages/cli/src/runtime/runtimeRegistry.spec.ts`: 4 warnings
- `packages/cli/src/ui/commands/setupGithubCommand.test.ts`: 4 warnings
- `packages/core/src/core/compression/__tests__/compression-usage-sync.test.ts`: 4 warnings
- `packages/core/src/lsp/__tests__/lsp-entry-path.test.ts`: 4 warnings
- `packages/core/src/tools/activate-skill.test.ts`: 4 warnings
- `packages/core/src/tools/confirmation-policy.test.ts`: 4 warnings
- `packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts`: 3 warnings
- `packages/cli/src/ui/components/Footer.test.tsx`: 3 warnings
- `packages/cli/src/ui/components/shared/buffer-types.test.ts`: 3 warnings
- `packages/cli/src/ui/utils/iContentToHistoryItems.test.ts`: 3 warnings
- `packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts`: 3 warnings
- `packages/cli/src/auth/BucketFailoverHandlerImpl.spec.ts`: 2 warnings
- `packages/cli/src/auth/__tests__/auth-status-service.spec.ts`: 2 warnings
- `packages/cli/src/auth/proxy/__tests__/platform-matrix.test.ts`: 2 warnings
- `packages/cli/src/config/extensions/settingsStorage.test.ts`: 2 warnings
- `packages/cli/src/ui/commands/keyCommand.subcommands.test.ts`: 2 warnings
- `packages/cli/src/utils/windowTitle.test.ts`: 2 warnings
- `packages/core/src/auth/__tests__/keyring-token-store.test.ts`: 2 warnings
- `packages/core/src/commands/types.test.ts`: 2 warnings
- `packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts`: 2 warnings
- `packages/core/src/providers/anthropic/AnthropicProvider.issue1494.test.ts`: 2 warnings
- `packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts`: 2 warnings
- `packages/core/src/tools/ast-edit.test.ts`: 2 warnings
- `packages/core/src/tools/todo-pause.spec.ts`: 2 warnings
- `packages/core/src/utils/checkpointUtils.test.ts`: 2 warnings
- `packages/cli/src/auth/__tests__/oauth-provider-base.spec.ts`: 1 warnings
- `packages/cli/src/auth/oauth-manager.logout.spec.ts`: 1 warnings
- `packages/cli/src/auth/oauth-manager.refresh-race.spec.ts`: 1 warnings
- `packages/cli/src/auth/proxy/__tests__/platform-uds-probe.test.ts`: 1 warnings
- `packages/cli/src/runtime/agentRuntimeAdapter.spec.ts`: 1 warnings
- `packages/cli/src/ui/commands/todoCommand.test.ts`: 1 warnings
- `packages/core/src/services/history/__tests__/density-history.test.ts`: 1 warnings
- `packages/core/src/tools/__tests__/shell-params.test.ts`: 1 warnings
- `packages/core/src/utils/shellPathCompletion.test.ts`: 1 warnings
- `packages/core/src/utils/terminalSerializer.test.ts`: 1 warnings

## Scope freeze

**Files in scope**: exactly the 60 listed above. No scope expansion without a new freeze commit.

## Non-goals

- No API changes to `performResume`, `SessionDiscovery`, `SecureStore`, etc.
- No test semantic changes — same behavior asserted, just via non-conditional expect chain.
- No switching away from fast-check property tests.

## Promotion

After all three sub-batches reach zero repo-wide, flip `vitest/no-conditional-expect` from `warn` to `error` in `eslint.config.js` (line ~497 in the test-file block).
