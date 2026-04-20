# Batch RS-V1 — `vitest/require-to-throw-message`

## Target rule
`vitest/require-to-throw-message`

Every `.toThrow()`, `.toThrowError()`, `.rejects.toThrow()`, `.rejects.toThrowError()` must be called with a matcher argument (string, RegExp, Error subclass, or error-shaped object). Bare `.toThrow()` with no argument is what triggers the rule.

## Baseline (at commit `7b99f2f66`)
- Warnings: 137
- Offending files: 52

## Frozen file list (do not deviate)

Ordered by descending warning count.

1. `packages/core/src/tools/todo-schemas.test.ts` — 20
2. `packages/core/src/tools/mcp-client.test.ts` — 11
3. `packages/cli/src/config/__tests__/profileBootstrap.test.ts` — 7
4. `packages/cli/src/config/extension.test.ts` — 7
5. `packages/cli/src/config/extensions/extensionSettings.test.ts` — 7
6. `packages/core/src/providers/__tests__/LoadBalancingProvider.test.ts` — 7
7. `packages/core/src/tools/modifiable-tool.test.ts` — 5
8. `packages/cli/src/runtime/agentRuntimeAdapter.spec.ts` — 4
9. `packages/core/src/runtime/AgentRuntimeState.spec.ts` — 4
10. `packages/core/src/auth/__tests__/keyring-token-store.test.ts` — 3
11. `packages/core/src/auth/qwen-device-flow.spec.ts` — 3
12. `packages/cli/src/auth/__tests__/OAuthBucketManager.spec.ts` — 2
13. `packages/cli/src/config/config.integration.test.ts` — 2
14. `packages/cli/src/integration-tests/security.integration.test.ts` — 2
15. `packages/cli/src/runtime/runtimeRegistry.spec.ts` — 2
16. `packages/cli/src/services/todo-continuation/todoContinuationService.spec.ts` — 2
17. `packages/cli/src/ui/commands/todoCommand.test.ts` — 2
18. `packages/core/src/auth/oauth-errors.spec.ts` — 2
19. `packages/core/src/auth/proxy/__tests__/framing.test.ts` — 2
20. `packages/core/src/auth/proxy/__tests__/proxy-socket-client.test.ts` — 2
21. `packages/core/src/auth/token-store.spec.ts` — 2
22. `packages/core/src/core/compression/__tests__/migration-compatibility.test.ts` — 2
23. `packages/core/src/providers/__tests__/LoadBalancingProvider.failover.test.ts` — 2
24. `packages/core/src/providers/__tests__/RetryOrchestrator.test.ts` — 2
25. `packages/core/src/recording/integration.test.ts` — 2
26. `packages/core/src/tools/activate-skill.test.ts` — 2
27. `packages/core/src/tools/shell.test.ts` — 2
28. `packages/core/src/tools/write-file.test.ts` — 2
29. `packages/core/src/types/__tests__/modelParams.bucket.spec.ts` — 2
30. `packages/cli/src/auth/__tests__/auth-flow-orchestrator.spec.ts` — 1
31. `packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts` — 1
32. `packages/cli/src/auth/proxy/__tests__/credential-proxy-server.test.ts` — 1
33. `packages/cli/src/config/extensions/consent.test.ts` — 1
34. `packages/cli/src/config/extensions/update.test.ts` — 1
35. `packages/cli/src/integration-tests/profile-keyfile.integration.test.ts` — 1
36. `packages/cli/src/integration-tests/runtime-isolation.test.ts` — 1
37. `packages/cli/src/integration-tests/test-utils.test.ts` — 1
38. `packages/cli/src/integration-tests/todo-continuation.integration.test.ts` — 1
39. `packages/cli/src/services/CommandService.test.ts` — 1
40. `packages/core/src/auth/__tests__/codex-device-flow.test.ts` — 1
41. `packages/core/src/auth/codex-device-flow.spec.ts` — 1
42. `packages/core/src/code_assist/server.test.ts` — 1
43. `packages/core/src/confirmation-bus/integration.test.ts` — 1
44. `packages/core/src/core/__tests__/compression-dispatcher.test.ts` — 1
45. `packages/core/src/core/compression/__tests__/compression-retry.test.ts` — 1
46. `packages/core/src/mcp/oauth-utils.test.ts` — 1
47. `packages/core/src/prompt-config/prompt-service.test.ts` — 1
48. `packages/core/src/providers/anthropic/AnthropicProvider.dumpContext.test.ts` — 1
49. `packages/core/src/tools/__tests__/ensure-dirs.test.ts` — 1
50. `packages/core/src/tools/codesearch.test.ts` — 1
51. `packages/core/src/tools/tool-key-storage.test.ts` — 1
52. `packages/core/src/utils/retry.test.ts` — 1

## What the fix looks like

The rule fires when an assertion throws without a matcher. Fix patterns:

- `expect(() => foo()).toThrow()` → `expect(() => foo()).toThrow('<substring of actual message>')`
- `await expect(foo()).rejects.toThrow()` → `await expect(foo()).rejects.toThrow(/<regex>/)`
- `.toThrow(ErrorClass)` — this is already valid (the class counts as a matcher).

The implementer is responsible for determining the correct expected message from the code under test. The message should be specific enough that the test would fail if the error changed to something unrelated, but not so specific that a trivial rewording of the message would break the test. Regex is preferred when the message contains dynamic substrings.

If the implementer finds a site where **any** throw is truly what the test wants (e.g. the test is checking the shape of a rejection callback and the exact error is irrelevant), use `.toThrow(Error)` to match any `Error` — but this should be rare. Do not add `// eslint-disable-next-line` comments to silence the rule.

## Severity change

**The implementer must NOT modify `eslint.config.js`.** The coordinator promotes the rule to `'error'` in a separate step only after both the implementer and the verifier return green.

## Exit criteria

- `npx eslint <listed-files> --ext .ts,.tsx` reports 0 warnings for `vitest/require-to-throw-message` in the listed files.
- Full verification suite passes on the implementer's machine before handoff.
