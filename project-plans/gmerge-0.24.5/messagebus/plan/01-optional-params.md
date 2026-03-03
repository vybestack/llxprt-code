# Phase 01: Optional MessageBus Parameters (Upstream Phase 1)

## Phase ID
`PLAN-20260303-MESSAGEBUS.P01`

## Prerequisites
- Phase 00a preflight verified
- All tests passing

## Requirements Implemented

### REQ MB-DI-001: Optional MessageBus Constructor Parameter
**EARS**: WHERE a class currently retrieves MessageBus via `config.getMessageBus()`, the class SHALL accept an optional `messageBus?: MessageBus` constructor parameter, falling back to `config.getMessageBus()` when not provided.

**Behavior**:
- GIVEN: CoreToolScheduler receives `messageBus` in constructor
- WHEN: MessageBus is provided
- THEN: Uses the provided instance directly
- AND: Does NOT call `config.getMessageBus()`

- GIVEN: CoreToolScheduler does NOT receive `messageBus` in constructor
- WHEN: MessageBus is needed
- THEN: Falls back to `config.getMessageBus()` (backward compatible)

## Implementation Tasks

### Reference Diff
`git show eec5d5ebf839` — Upstream Phase 1. Adapt for LLxprt (different file structure, tool names).

### Files to Modify (~16 files)

**1. `packages/core/src/tools/tool-registry.ts`**
- Add `messageBus?: MessageBus` to constructor
- Store as `private readonly messageBus?: MessageBus`
- In `createInvocation()`, use `this.messageBus ?? this.config.getMessageBus()`
- Keep `setMessageBus()` stub (removed in Phase 3)

**2. `packages/core/src/tools/tools.ts`** (DeclarativeTool base)
- Ensure `createInvocation()` accepts `messageBus?: MessageBus` param (many already do)
- For tools that don't yet accept it, add the parameter

**3. `packages/core/src/test-utils/mock-tool.ts`**
- Update mock tool factory to accept and pass MessageBus
- Create helper: `createMockMessageBus()` returning a mock with `publish` and `subscribe` spies

**4. Test files (~12 files)**
Reference upstream diff for exact test changes. Key pattern:
```typescript
// Before
const invocation = tool.createInvocation(params);
// After
const messageBus = createMockMessageBus();
const invocation = tool.createInvocation(params, messageBus);
```

Files:
- `tools/edit.test.ts`
- `tools/glob.test.ts`
- `tools/grep.test.ts`
- `tools/ls.test.ts`
- `tools/read-file.test.ts`
- `tools/read-many-files.test.ts`
- `tools/write-file.test.ts`
- `tools/message-bus-integration.test.ts`
- `utils/editCorrector.test.ts`
- `utils/tool-utils.test.ts`
- `cli/src/ui/hooks/useToolScheduler.test.ts`
- `a2a-server/src/http/app.test.ts`

**5. `packages/core/src/index.ts`**
- Remove any re-exports of `setMessageBus` from public API (if present)

### Approach
- Use upstream diff as a guide but adapt to LLxprt's tool names and structure
- LLxprt doesn't have `smart-edit.ts` — skip that file
- LLxprt tool names differ (e.g., `ripGrep.ts` for grep)
- Keep changes backward-compatible: `messageBus?:` (optional), with fallback

## Verification Commands
```bash
npm run typecheck
npm run test
npm run lint
```

## Success Criteria
- TypeScript compiles
- All tests pass
- MessageBus can be explicitly passed OR omitted (backward compatible)
- No behavior changes

## Failure Recovery
If tests fail, compare failing tests against upstream changes. The most common issue is test mocks not providing MessageBus where now expected. Fix by adding `createMockMessageBus()` to test setup.

## Phase Completion Marker
```bash
echo "PLAN-20260303-MESSAGEBUS.P01 COMPLETE: Optional params added, backward-compatible"
npm run typecheck && npm run test && echo "VERIFIED"
```
