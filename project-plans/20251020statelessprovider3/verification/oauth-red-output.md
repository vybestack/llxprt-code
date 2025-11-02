@plan:PLAN-20251020-STATELESSPROVIDER3.P11a

Command:
```bash
npm run test --workspace @vybestack/llxprt-code -- --run src/auth/__tests__/oauthManager.safety.test.ts
```

Output:
```text
> @vybestack/llxprt-code@0.5.0 test
> vitest run --run src/auth/__tests__/oauthManager.safety.test.ts


 RUN  v3.2.4 /Users/acoliver/projects/llxprt-code/packages/cli
      Coverage enabled with v8

 ❯ src/auth/__tests__/oauthManager.safety.test.ts (3 tests | 3 failed) 4ms
   × unwrapLoggingProvider safety net > unwraps nested LoggingProviderWrapper instances @plan:PLAN-20251020-STATELESSPROVIDER3.P11 @requirement:REQ-SP3-003 @pseudocode oauth-safety.md lines 17-20 3ms
     → PLAN-20251020-STATELESSPROVIDER3.P10
   × unwrapLoggingProvider safety net > no-ops when provider is undefined @plan:PLAN-20251020-STATELESSPROVIDER3.P11 @requirement:REQ-SP3-003 @pseudocode oauth-safety.md lines 4-6 0ms
     → PLAN-20251020-STATELESSPROVIDER3.P10
   × unwrapLoggingProvider safety net > preserves behaviour when no wrappers are present @plan:PLAN-20251020-STATELESSPROVIDER3.P11 @requirement:REQ-SP3-003 @pseudocode oauth-safety.md lines 17-20 0ms
     → PLAN-20251020-STATELESSPROVIDER3.P10

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/auth/__tests__/oauthManager.safety.test.ts > unwrapLoggingProvider safety net > unwraps nested LoggingProviderWrapper instances @plan:PLAN-20251020-STATELESSPROVIDER3.P11 @requirement:REQ-SP3-003 @pseudocode oauth-safety.md lines 17-20
NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P10
 ❯ unwrapLoggingProvider src/auth/oauth-manager.js:9:9
      7|  */
      8| export function unwrapLoggingProvider() {
      9|   throw new NotYetImplemented('PLAN-20251020-STATELESSPROVIDER3.P10');
       |         ^
     10| }
     11| 
 ❯ src/auth/__tests__/oauthManager.safety.test.ts:48:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  src/auth/__tests__/oauthManager.safety.test.ts > unwrapLoggingProvider safety net > no-ops when provider is undefined @plan:PLAN-20251020-STATELESSPROVIDER3.P11 @requirement:REQ-SP3-003 @pseudocode oauth-safety.md lines 4-6
NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P10
 ❯ unwrapLoggingProvider src/auth/oauth-manager.js:9:9
      7|  */
      8| export function unwrapLoggingProvider() {
      9|   throw new NotYetImplemented('PLAN-20251020-STATELESSPROVIDER3.P10');
       |         ^
     10| }
     11| 
 ❯ src/auth/__tests__/oauthManager.safety.test.ts:54:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  src/auth/__tests__/oauthManager.safety.test.ts > unwrapLoggingProvider safety net > preserves behaviour when no wrappers are present @plan:PLAN-20251020-STATELESSPROVIDER3.P11 @requirement:REQ-SP3-003 @pseudocode oauth-safety.md lines 17-20
NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P10
 ❯ unwrapLoggingProvider src/auth/oauth-manager.js:9:9
      7|  */
      8| export function unwrapLoggingProvider() {
      9|   throw new NotYetImplemented('PLAN-20251020-STATELESSPROVIDER3.P10');
       |         ^
     10| }
     11| 
 ❯ src/auth/__tests__/oauthManager.safety.test.ts:62:20
```
