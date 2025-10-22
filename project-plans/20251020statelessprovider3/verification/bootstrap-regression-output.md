# Bootstrap Regression Failure Output

<!-- @plan:PLAN-20251020-STATELESSPROVIDER3.P03a -->

Command:
```bash
npm run test:integration --workspace @vybestack/llxprt-code -- --run src/integration-tests/profile-bootstrap.integration.test.ts
```

Output:
```text

> @vybestack/llxprt-code@0.5.0 test:integration
> vitest run -c vitest.integration.config.ts --run src/integration-tests/profile-bootstrap.integration.test.ts


 RUN  v3.2.4 /Users/acoliver/projects/llxprt-code/packages/cli

 ❯ src/integration-tests/profile-bootstrap.integration.test.ts (1 test | 1 failed) 2432ms
   × CLI stateless provider bootstrap > loads a profile without losing provider metadata 2431ms
     → expected '[ProviderManager] Initializing OpenAI…' not to match /Error when talking to openai API/

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/integration-tests/profile-bootstrap.integration.test.ts > CLI stateless provider bootstrap > loads a profile without losing provider metadata
AssertionError: expected '[ProviderManager] Initializing OpenAI…' not to match /Error when talking to openai API/

[32m- Expected:[39m 
/Error when talking to openai API/

[31m+ Received:[39m 
"[ProviderManager] Initializing OpenAI provider with: { hasApiKey: false, baseUrl: 'default' }
Error when talking to openai API Full report available at: /var/folders/9v/l7wpbxmx1lz338tpwz3lh0nh0000gn/T/llxprt-client-error-Turn.run-sendMessageStream-2025-10-21T02-50-08-918Z.json"

 ❯ src/integration-tests/profile-bootstrap.integration.test.ts:137:35
    135|         .trim();
    136| 
    137|       expect(sanitizedStderr).not.toMatch(
       |                                   ^
    138|         /Error when talking to openai API/,
    139|       );

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed (1)
   Start at  23:50:06
   Duration  2.67s (transform 30ms, setup 0ms, collect 24ms, tests 2.43s, environment 0ms, prepare 42ms)

npm error Lifecycle script `test:integration` failed with error:
npm error code 1
npm error path /Users/acoliver/projects/llxprt-code/packages/cli
npm error workspace @vybestack/llxprt-code@0.5.0
npm error location /Users/acoliver/projects/llxprt-code/packages/cli
npm error command failed
npm error command sh -c vitest run -c vitest.integration.config.ts --run src/integration-tests/profile-bootstrap.integration.test.ts

```
