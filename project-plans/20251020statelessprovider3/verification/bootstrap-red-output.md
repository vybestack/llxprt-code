# Bootstrap RED Output

<!-- @plan:PLAN-20251020-STATELESSPROVIDER3.P05a -->

Plan command:
```bash
npm run test --workspace @vybestack/llxprt-code -- --run packages/cli/src/config/__tests__/profileBootstrap.test.ts
```

Output:
```text

> @vybestack/llxprt-code@0.5.0 test
> vitest run --run packages/cli/src/config/__tests__/profileBootstrap.test.ts


 RUN  v3.2.4 /Users/acoliver/projects/llxprt-code/packages/cli
      Coverage enabled with v8

No test files found, exiting with code 1

filter: packages/cli/src/config/__tests__/profileBootstrap.test.ts
include: **/*.{test,spec}.?(c|m)[jt]s?(x), config.test.ts
exclude:  **/node_modules/**, **/dist/**, **/cypress/**, **/*.integration.{test,spec}.?(c|m)[jt]s?(x), **/*.test.tsx, **/gemini.test.tsx, **/ui/components/**/*.test.ts, **/ui/hooks/**/*.test.ts, **/ui/hooks/**/*.spec.ts, **/ui/commands/toolformatCommand.test.ts

JUNIT report written to /Users/acoliver/projects/llxprt-code/packages/cli/junit.xml
npm error Lifecycle script `test` failed with error:
npm error code 1
npm error path /Users/acoliver/projects/llxprt-code/packages/cli
npm error workspace @vybestack/llxprt-code@0.5.0
npm error location /Users/acoliver/projects/llxprt-code/packages/cli
npm error command failed
npm error command sh -c vitest run --run packages/cli/src/config/__tests__/profileBootstrap.test.ts
```

Working command:
```bash
npm run test --workspace @vybestack/llxprt-code -- --run src/config/__tests__/profileBootstrap.test.ts
```

Output:
```text

> @vybestack/llxprt-code@0.5.0 test
> vitest run --run src/config/__tests__/profileBootstrap.test.ts


 RUN  v3.2.4 /Users/acoliver/projects/llxprt-code/packages/cli
      Coverage enabled with v8

 ❯ src/config/__tests__/profileBootstrap.test.ts (4 tests | 4 failed) 4ms
   × profileBootstrap helpers > parses CLI args without --profile-load @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001 3ms
     → NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P04
   × profileBootstrap helpers > parses CLI args with --profile-load @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001 0ms
     → NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P04
   × profileBootstrap helpers > prepares runtime before applying profile state @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001 0ms
     → NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P04
   × profileBootstrap helpers > includes runtime metadata in bootstrap result @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001 0ms
     → NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P04

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/config/__tests__/profileBootstrap.test.ts > profileBootstrap helpers > parses CLI args without --profile-load @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001
Error: NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P04
 ❯ parseBootstrapArgs src/config/profileBootstrap.js:10:8
      8|  */
      9| export function parseBootstrapArgs() {
     10|  throw new Error('NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P04');
       |        ^
     11| }
     12| 
 ❯ src/config/__tests__/profileBootstrap.test.ts:80:22

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  src/config/__tests__/profileBootstrap.test.ts > profileBootstrap helpers > parses CLI args with --profile-load @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001
Error: NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P04
 ❯ parseBootstrapArgs src/config/profileBootstrap.js:10:8
      8|  */
      9| export function parseBootstrapArgs() {
     10|  throw new Error('NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P04');
       |        ^
     11| }
     12| 
 ❯ src/config/__tests__/profileBootstrap.test.ts:94:22

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  src/config/__tests__/profileBootstrap.test.ts > prepares runtime before applying profile state @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001
Error: NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P04
 ❯ parseBootstrapArgs src/config/profileBootstrap.js:10:8
      8|  */
      9| export function parseBootstrapArgs() {
     10|  throw new Error('NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P04');
       |        ^
     11| }
     12| 
 ❯ src/config/__tests__/profileBootstrap.test.ts:107:22

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  src/config/__tests__/profileBootstrap.test.ts > includes runtime metadata in bootstrap result @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001
Error: NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P04
 ❯ prepareRuntimeForProfile src/config/profileBootstrap.js:19:8
     17|  */
     18| export function prepareRuntimeForProfile() {
     19|  throw new Error('NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P04');
       |        ^
     20| }
     21| 
 ❯ src/config/__tests__/profileBootstrap.test.ts:141:34

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯


 Test Files  1 failed (1)
      Tests  4 failed (4)
   Start at  03:09:44
   Duration  1.44s (transform 24ms, setup 27ms, collect 7ms, tests 4ms, environment 335ms, prepare 44ms)

JUNIT report written to /Users/acoliver/projects/llxprt-code/packages/cli/junit.xml
npm error Lifecycle script `test` failed with error:
npm error code 1
npm error path /Users/acoliver/projects/llxprt-code/packages/cli
npm error workspace @vybestack/llxprt-code@0.5.0
npm error location /Users/acoliver/projects/llxprt-code/packages/cli
npm error command failed
npm error command sh -c vitest run --run src/config/__tests__/profileBootstrap.test.ts
```
