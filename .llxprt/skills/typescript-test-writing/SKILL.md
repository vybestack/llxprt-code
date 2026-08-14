---
name: typescript-test-writing
description: Use this skill when writing or modifying tests in the llxprt-code repository. Covers mandatory TDD, behavioral testing, bun:test conventions and file naming, mock hygiene (no mock theater), and what never to test. Distilled from dev-docs/RULES.md, which remains the source of truth.
---

# Writing TypeScript Tests in llxprt-code

Distilled from dev-docs/RULES.md. When in doubt, read RULES.md in full — it is
the source of truth for development guidelines.

## Core principle: TDD is mandatory

Every line of production code must be written in response to a failing test.
No exceptions.

Red-Green-Refactor, followed strictly:

1. **RED**: Write a failing test for the next small behavior.
2. **GREEN**: Write ONLY enough code to make the test pass.
3. **REFACTOR**: Only if it improves clarity.
4. **COMMIT**: Feature + tests together; refactoring separately.

## Stack rules (non-negotiable)

- Bun + `bun:test` ONLY. Never create Vitest or Node test suites, and never add
  new `.js` files — everything is TypeScript run with bun.
- TypeScript strict mode: no `any` (use `unknown` with type guards), no type
  assertions (use type predicates), explicit return types.
- Import pattern (bun:test re-exports `vi`, `mock`, and `Mock`):

  ```typescript
  import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    vi,
    type Mock,
  } from 'bun:test';
  ```

- Prefer immutable data in tests and fixtures (`{ ...cart, items: [...cart.items, item] }`);
  never mutate shared fixtures between tests.

## Test behavior, not implementation

✅ Test:

- Public API behavior
- Input → Output transformations
- Edge cases and error conditions
- Integration between units
- Schema validation

❌ Never test:

- Implementation details
- Private methods
- Third-party libraries
- Mock interactions

❌ Never enshrine bugs as specification: do not write a passing test that asserts
incorrect behavior, even if that is what the code currently does. If you
discover a bug while writing tests: (1) file an issue or ask the user, (2) write
a failing test that asserts the CORRECT behavior, (3) fix the production code so
the test passes. A suite that encodes bugs as passing tests is worse than no
tests — it actively prevents future fixes.

## Test structure

- **describe**: feature/component name.
- **it**: specific behavior in plain English.
- **Arrange-Act-Assert**: clear sections; one behavior per test.
- **DRY setup**: never copy-paste identical beforeEach/afterEach boilerplate
  (e.g. temp-dir creation, cleanup) across describe blocks. Extract a shared
  helper that wires the lifecycle hooks (e.g. a `useTempDir()` helper that
  registers beforeEach/afterEach internally and returns a lazy accessor).
  Repeating 5+ lines of identical setup in N describe blocks is a maintenance
  hazard; one line of shared setup per describe block is the target.

## File conventions

- Tests are TypeScript, co-located with the code under test.
- `*.test.ts` is the dominant pattern in this repo; `*.spec.ts` and
  `__tests__/` directories are also in use — match the existing pattern of the
  neighboring tests before creating a new file.
- File names: kebab-case.
- Run a single file with `bun test path/to/file.test.ts`; the full suite is
  `npm run test`.

## Mock hygiene: no mock theater

**The fundamental rule: you cannot test a component by mocking that component.**

### Mock decision tree

```
Is it the component you're testing?
├─ Yes → [ERROR] NEVER MOCK IT
└─ No → Is it doing the core work being tested?
    ├─ Yes → [ERROR] DON'T MOCK IT
    └─ No → Is it infrastructure (FS, network, DB)?
        ├─ Yes → [OK] OK to mock
        └─ No → Is it completely unrelated to the test?
            ├─ Yes → [OK] OK to mock
            └─ No → WARNING: Probably shouldn't mock
```

### Prohibited mock patterns

1. **Self-mocking** — mocking the component under test. If you mock EmojiFilter
   to test EmojiFilter, you are testing the mock, not the component.
2. **Direct-value mock** — a mock that returns exactly the output the test
   expects. The test is worthless: it can never fail for the right reason.
3. **Mock verification** — asserting a mock was called
   (`expect(mockFn).toHaveBeenCalledWith(...)`) proves nothing about real code.

Also watch for: the mock chain (A calls MockB calls MockC — no real code tested)
and mocks with complex implementations (if the mock has the logic, test the real
code instead).

### Allowed mock patterns

1. **Infrastructure mocking** — mock filesystem, network, databases (not
   business logic); instantiate the REAL component; assert real transformations
   through the real code paths.
2. **Irrelevant service mocking** — mock services unrelated to the behavior
   under test (auth, logging), while the component under test is real.
3. **Test data builders** — build input data; never mock behavior.

### The litmus test

After writing a test, all four answers must be the "good" one:

1. If I delete the real implementation, will this test fail? (If NO: worthless)
2. If I break the real implementation, will this test catch it? (If NO: worthless)
3. Am I testing my mock or my code? (If MOCK: worthless)
4. Could I replace the component with `return 'expected'` and pass? (If YES: worthless)

## Before submitting

- All tests pass (`npm run test`).
- No TypeScript errors (`npm run typecheck`).
- No linting warnings (`npm run lint`).
- No console.logs or debug code left behind.
- Every production line you touched is covered by behavior tests.
