@plan:PLAN-20251020-STATELESSPROVIDER3.P13a

Command
`npm run test:integration --workspace @vybestack/llxprt-code -- --run src/integration-tests/profile-bootstrap.integration.test.ts --reporter verbose`

Exit Code
1

Stdout/Stderr
```text
> @vybestack/llxprt-code@0.5.0 test:integration
> vitest run -c vitest.integration.config.ts --run src/integration-tests/profile-bootstrap.integration.test.ts --reporter verbose


 RUN  v3.2.4 /Users/acoliver/projects/llxprt-code/packages/cli

x src/integration-tests/profile-bootstrap.integration.test.ts > CLI stateless provider bootstrap > @plan:PLAN-20251020-STATELESSPROVIDER3.P13 @requirement:REQ-SP3-001 @requirement:REQ-SP3-002 @requirement:REQ-SP3-004 loads a profile without losing provider metadata 1950ms
  -> expected '[ProviderManager] Initializing OpenAI...' not to match /Error when talking to openai API/
x src/integration-tests/profile-bootstrap.integration.test.ts > CLI stateless provider bootstrap > @plan:PLAN-20251020-STATELESSPROVIDER3.P13 @requirement:REQ-SP3-001 @requirement:REQ-SP3-002 @requirement:REQ-SP3-004 --profile-load synthetic retains base URL and auth key 1615ms
  -> expected '[ProviderManager] Initializing OpenAI...' not to match /Error when talking to openai API/
x src/integration-tests/profile-bootstrap.integration.test.ts > CLI stateless provider bootstrap > @plan:PLAN-20251020-STATELESSPROVIDER3.P13 @requirement:REQ-SP3-001 @requirement:REQ-SP3-002 @requirement:REQ-SP3-004 /profile load applies helpers during interactive session 25009ms
  -> expected -1 to be +0 // Object.is equality

------- Failed Tests 3 -------

 FAIL  src/integration-tests/profile-bootstrap.integration.test.ts > CLI stateless provider bootstrap > @plan:PLAN-20251020-STATELESSPROVIDER3.P13 @requirement:REQ-SP3-001 @requirement:REQ-SP3-002 @requirement:REQ-SP3-004 loads a profile without losing provider metadata
AssertionError: expected '[ProviderManager] Initializing OpenAI...' not to match /Error when talking to openai API/

- Expected:
/Error when talking to openai API/

+ Received:
"[ProviderManager] Initializing OpenAI provider with: { hasApiKey: false, baseUrl: 'default' }
Error when talking to openai API Full report available at: /var/folders/9v/l7wpbxmx1lz338tpwz3lh0nh0000gn/T/llxprt-client-error-Turn.run-sendMessageStream-2025-10-21T15-58-06-121Z.json"

 > src/integration-tests/profile-bootstrap.integration.test.ts:261:35
    259|       const sanitizedStderr = sanitizeBuildWarnings(result.stderr);
    260|
    261|       expect(sanitizedStderr).not.toMatch(
       |                                   ^
    262|         /Error when talking to openai API/,
    263|       );

-------[1/3]-------

 FAIL  src/integration-tests/profile-bootstrap.integration.test.ts > CLI stateless provider bootstrap > @plan:PLAN-20251020-STATELESSPROVIDER3.P13 @requirement:REQ-SP3-001 @requirement:REQ-SP3-002 @requirement:REQ-SP3-004 --profile-load synthetic retains base URL and auth key
AssertionError: expected '[ProviderManager] Initializing OpenAI...' not to match /Error when talking to openai API/

- Expected:
/Error when talking to openai API/

+ Received:
"[ProviderManager] Initializing OpenAI provider with: { hasApiKey: false, baseUrl: 'default' }
Error when talking to openai API Full report available at: /var/folders/9v/l7wpbxmx1lz338tpwz3lh0nh0000gn/T/llxprt-client-error-Turn.run-sendMessageStream-2025-10-21T15-58-07-742Z.json"

 > src/integration-tests/profile-bootstrap.integration.test.ts:301:35
    299|       const sanitizedStderr = sanitizeBuildWarnings(result.stderr);
    300|       expect(result.exitCode).toBe(0);
    301|       expect(sanitizedStderr).not.toMatch(
       |                                   ^
    302|         /Error when talking to openai API/,
    303|       );

-------[2/3]-------

 FAIL  src/integration-tests/profile-bootstrap.integration.test.ts > CLI stateless provider bootstrap > @plan:PLAN-20251020-STATELESSPROVIDER3.P13 @requirement:REQ-SP3-001 @requirement:REQ-SP3-002 @requirement:REQ-SP3-004 /profile load applies helpers during interactive session
AssertionError: expected -1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ -1

 > src/integration-tests/profile-bootstrap.integration.test.ts:351:38
    349|       const sanitizedStderr = sanitizeBuildWarnings(sessionResult.stderr);
    350|
    351|       expect(sessionResult.exitCode).toBe(0);
       |                                      ^
    352|       expect(sanitizedOutput).toContain("Profile 'synthetic' loaded");
    353|       expect(sanitizedOutput).not.toContain(

-------[3/3]-------


 Test Files  1 failed (1)
      Tests  3 failed (3)
   Start at  12:58:03
   Duration  28.80s (transform 45ms, setup 0ms, collect 41ms, tests 28.57s, environment 0ms, prepare 50ms)

npm error Lifecycle script `test:integration` failed with error:
npm error code 1
npm error path /Users/acoliver/projects/llxprt-code/packages/cli
npm error workspace @vybestack/llxprt-code@0.5.0
npm error location /Users/acoliver/projects/llxprt-code/packages/cli
npm error command failed
npm error command sh -c vitest run -c vitest.integration.config.ts --run src/integration-tests/profile-bootstrap.integration.test.ts --reporter verbose
```
