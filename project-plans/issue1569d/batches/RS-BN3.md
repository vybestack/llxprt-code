# Batch RS-BN3 — `@typescript-eslint/no-misused-promises`

## Target rule

`@typescript-eslint/no-misused-promises`

Reports calls, spreads, attributes, arguments, and property assignments
where a Promise-returning value is supplied in a position that expects
a void or non-Promise value. Fix by either awaiting, wrapping in `void`,
routing through an explicit sync wrapper that calls `.catch(...)`, or
rewriting the hook/attribute to accept an async callback.

## Baseline (at commit `dbd5138c6`)

- Warnings: 5
- Offending files: 5

## Frozen file list (do not deviate)

1. `packages/cli/src/ui/__tests__/AppContainer.mount.test.tsx` — 1
2. `packages/cli/src/ui/components/WelcomeOnboarding/WelcomeDialog.tsx` — 1
3. `packages/cli/src/ui/hooks/geminiStream/useGeminiStream.ts` — 1
4. `packages/cli/src/ui/hooks/useWelcomeOnboarding.ts` — 1
5. `packages/core/src/code_assist/oauth2.ts` — 1

## Warning locations

- `packages/cli/src/ui/__tests__/AppContainer.mount.test.tsx:336:8` — "Expected a non-Promise value to be spreaded in an object."
- `packages/cli/src/ui/components/WelcomeOnboarding/WelcomeDialog.tsx:86:22` — "Promise-returning function provided to attribute where a void return was expected."
- `packages/cli/src/ui/hooks/geminiStream/useGeminiStream.ts:333:7` — "Promise returned in function argument where a void return was expected."
- `packages/cli/src/ui/hooks/useWelcomeOnboarding.ts:395:7` — "Promise-returning function provided to property where a void return was expected."
- `packages/core/src/code_assist/oauth2.ts:417:38` — "Promise returned in function argument where a void return was expected."

## Additional cleanup (stale disable directives found in same lint pass)

Nine `// eslint-disable-next-line ...` directives are now reported as
"Unused eslint-disable directive" since the underlying rules either no
longer fire or were eliminated by earlier batches. Remove them in the
same commit because they block CI once `reportUnusedDisableDirectives`
is active:

1. `packages/cli/src/auth/oauth-manager.logout.spec.ts:110` — stale `vitest/no-conditional-expect`
2. `packages/cli/src/config/configBuilder.ts:244` — stale `@typescript-eslint/prefer-nullish-coalescing`
3. `packages/cli/src/nonInteractiveCli.ts:245` — stale `@typescript-eslint/prefer-nullish-coalescing`
4. `packages/cli/src/ui/__tests__/AppContainer.mount.test.tsx:341` — stale `@typescript-eslint/no-misused-promises`
5. `packages/cli/src/ui/commands/todoCommand.test.ts:641` — stale `vitest/no-conditional-expect`
6. `packages/cli/src/ui/components/ProfileCreateWizard/ProfileSaveStep.tsx:178` — stale `@typescript-eslint/no-floating-promises`
7. `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts:361` — stale `@typescript-eslint/prefer-nullish-coalescing`
8. `packages/core/src/providers/openai/ToolCallPipeline.ts:178` — stale `@typescript-eslint/prefer-nullish-coalescing`
9. `packages/core/src/providers/providerInterface.compat.test.ts:120` — stale `vitest/no-conditional-in-test`

## Severity change

The implementer MUST NOT modify `eslint.config.js`. The coordinator
promotes `@typescript-eslint/no-misused-promises` from `'warn'` to
`'error'` in a separate step after verification passes.

## Exit criteria

- `npx eslint <listed-files> --ext .ts,.tsx` reports 0 warnings for
  `@typescript-eslint/no-misused-promises` in the listed files.
- Full-repo `npm run lint` reports 0 errors AND 0 warnings for
  `@typescript-eslint/no-misused-promises` AND 0 "Unused eslint-disable
  directive" messages.
- Full verification suite green.
