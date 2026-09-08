# Plan: tool-dispatcher tests — remove shared mock mutation in getTool

Plan ID: PLAN-20260825-TOOLDISPATCHERMUTATION
Source issue: #2913

## Problem

`makeMockRegistry` in
`packages/agents/src/scheduler/tool-dispatcher.test.ts` mutates the shared
mock tool's `context` property as a side effect of `getTool`:

```ts
getTool: vi.fn((_name, context) => {
  if (tool instanceof ContextAwareMockTool && context) {
    tool.context = context;
  }
  return tool ?? null;
})
```

Because the same registry/tool instance shape is reused across `it` blocks,
an earlier call overwrites `context` for later ones, so the context tests
become order-dependent and the context-propagation coverage is weaker than it
looks: the mock (not the production dispatcher) is what populates
`tool.context`.

## Root cause

The production `ToolDispatcher.resolveAndValidate` already sets context on a
resolved tool through `setToolContext` (packages/agents/src/scheduler/utils.ts),
independent of the registry's `getTool`. The mock mutation in
`makeMockRegistry` is therefore redundant test infrastructure: the context
test would pass even if the production `setToolContext` call were
removed, because the mock sets `tool.context` first.

## Acceptance criteria

1. `getTool` in `makeMockRegistry` no longer mutates `tool.context`: the
   branch that assigns `tool.context = context` is removed, and the mock
   still accepts a `context` argument (so the two call-argument assertions
   using `toHaveBeenCalledWith(...)` stay valid) and returns `tool ?? null`.
   `getAllToolNames` is unchanged.
2. The `sets context on ContextAwareTool during resolveAndValidate` test
   proves the production dispatcher populates `tool.context`: it pre-sets a
   stale `context` on the tool, dispatches, and asserts the dispatcher
   overwrote it with the expected `sessionId` / `agentId` /
   `interactiveMode`. This makes the coverage order-independent and
   self-contained.
3. Behavioral evidence that the test is not mock theater: temporarily
   removing the production `setToolContext` call from
   `tool-dispatcher.ts` makes the context test fail; restoring it makes the
   test pass again. (The mutation is deleted from the mock BEFORE this red
   check so the failure source is the production path.)
4. The test file passes, is formatted, lints clean, and typechecks.
   Full verification cycle and CI green on the candidate head.
5. Scope: test-only. No production source changes beyond a temporary red
   check that is reverted. No adjacent cleanup.

## Context-propagation design (order-independent)

Before dispatch, set a stale context on the tool:

```ts
tool.context = {
  sessionId: 'stale-session',
  agentId: 'stale-agent',
  interactiveMode: false,
};
```

After `dispatcher.resolveAndValidate([...], makeGovernance(), true)`, assert
`tool.context` equals the dispatch context:

```ts
expect(tool.context?.sessionId).toBe('test-session-id');
expect(tool.context?.agentId).toBe('primary');
expect(tool.context?.interactiveMode).toBe(true);
```

If the dispatcher's `setToolContext` were missing, the stale values would
survive and the assertions would fail — proving the production path owns the
behavior. This is why the pre-set stale value strengthens coverage versus the
current test.

## Change

One file, test-only:

`packages/agents/src/scheduler/tool-dispatcher.test.ts`:

- `makeMockRegistry`: remove the `ContextAwareMockTool` context-mutation
  branch from `getTool`, leaving `getTool: vi.fn((_name) => tool ?? null)`.
  The `context` parameter is dropped from the implementation since it is no
  longer read; the mock still records whatever arguments the dispatcher
  passes, so the `toHaveBeenCalledWith(name, {...context})` assertions are
  unaffected.
- `sets context on ContextAwareTool during resolveAndValidate`: pre-set a
  stale `tool.context` before dispatch to prove the dispatcher overwrites it.

Kept as-is, by evidence:

- `resolveAndValidate` production flow (ungoverned tool resolution +
  `setToolContext`), which is the behavior under test.
- The two `toHaveBeenCalledWith(name, { sessionId, agentId,
  interactiveMode })` call-argument assertions.
- All other tests in the file.

## Why this is in scope

The issue names exactly this file, the `makeMockRegistry` mutation, and this
remediation ("each test setting context explicitly for what it needs"). PR
#2897 (issue #2779) only touched the file incidentally and left this out.

## Verification

- `bun test` on `packages/agents/src/scheduler/tool-dispatcher.test.ts`
  (red check with production `setToolContext` temporarily removed, green with
  it restored).
- Full cycle per the issue workflow: agents test/lint/typecheck/format/build,
  then the profile-load smoke (`bun scripts/start.ts --profile-load
  stepfun-37 "write me a haiku and nothing else"`).
- Open code review (up to 2 rounds) and CI on the PR.

## Risks and mitigations

- The red check is a temporary edit to production source that is reverted
  before commit, so the PR remains test-only.
- `ContextAwareMockTool` remains defined but is still referenced by the
  type guard? After the mutation removal the class is still used as the tool
  instance in the context test. If `ContextAwareMockTool` becomes unused
  after the change, `noUnusedLocals` would flag it; the context test
  continues to instantiate it, so it stays in use.

## Results (2026-08-26)

Implementation matches this plan. Evidence:

- RED check: with the mock mutation removed, deleting the production
  `setToolContext` call in `tool-dispatcher.ts` makes the context test fail
  (`Expected: "test-session-id" / Received: "stale-session"`); restoring it
  passes. Production file restored (worktree hash == HEAD hash).
- `bun test src/scheduler/tool-dispatcher.test.ts`: 17 pass / 0 fail.
- Full agents corpus (`bun run-bun-tests.ts` in packages/agents): 376 files,
  0 failed. A separate baseline run on clean main also passed (6/6 isolated).
- eslint on the changed file: clean. Repo-wide `npm run lint`: 0 errors.
- typecheck (agents workspace): clean. An additional explicit scratch tsconfig
  run that INCLUDES the excluded test file under strictNullChecks shows zero
  errors on the changed lines (3 pre-existing errors at lines 89/122/135
  exist on main and are out of scope).
- prettier --check: clean. agents build: succeeded.
- Test-audit scanner: no new findings vs the main baseline (one pre-existing
  MOCK_MIRROR finding in the same file, unchanged line offset only).
- Smoke (`bun scripts/start.ts --profile-load stepfun-37`): startup
  initialized and reached the API call, which the stepfun provider rejected
  with `400 you have no active step plan subscription` — external account
  state, not caused by a test-only change; CI is the authoritative gate.

Reviews:

- deepthinker subagent review: PASS, no findings (Blocker/In-scope/Reject/Defer
  all none), with independent test/lint/diff verification.
- Local OCR (workspace scope, run dir
  `~/Library/Logs/llxprt-code/opencodereview/runs/20260826T031031Z-36b2abb7`,
  zai-anthropic/glm-5.2, 1 file reviewed): 1 LOW finding claiming the
  non-optional `tool.context.X` accesses are unsound under strictNullChecks
  and would error if the file left the tsconfig exclude list.
  Disposition: **Reject** — verified invalid: the explicit scratch-tsconfig
  tsc run above INCLUDES the file under strictNullChecks and reports 0 errors
  on those lines (TS narrows `tool.context` after the test's own assignment,
  and property narrowing persists across the `resolveAndValidate` call);
  runtime soundness holds by construction because the test pre-sets the stale
  object (a regression leaves `'stale-session'` and fails cleanly); and the
  suggested `?.` form is actively rejected by this repo's enforced type-aware
  rule `@typescript-eslint/no-unnecessary-condition` (verified: it fired on
  the `?.` variant; `!` is likewise rejected by
  `no-unnecessary-type-assertion`). The 3 pre-existing errors elsewhere in the
  file pre-date this change and are out of scope.
