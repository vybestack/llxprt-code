@plan:PLAN-20251020-STATELESSPROVIDER3.P06a

Commands:
1. `npm run test --workspace @vybestack/llxprt-code -- --run src/config/__tests__/profileBootstrap.test.ts`

Output:
```
> @vybestack/llxprt-code@0.5.0 test
> vitest run --run src/config/__tests__/profileBootstrap.test.ts


 RUN  v3.2.4 /Users/acoliver/projects/llxprt-code/packages/cli
      Coverage enabled with v8

 ✓ src/config/__tests__/profileBootstrap.test.ts (4 tests) 5ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  03:41:39
   Duration  2.68s (transform 595ms, setup 26ms, collect 1.25s, tests 5ms, environment 300ms, prepare 50ms)

JUNIT report written to /Users/acoliver/projects/llxprt-code/packages/cli/junit.xml
 % Coverage report from v8
```

PASS: profileBootstrap vitest suite succeeded (4 tests)

Lint/Typecheck: not run
