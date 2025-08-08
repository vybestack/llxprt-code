# Phase 09: Integration & Configuration - Stub

## Objective

Create integration points in useGeminiStream and ephemeral settings.

## Implementation Task

```bash
Task(
  description="Create integration stubs",
  prompt="Create stub modifications for integrating todo continuation.

Files to modify:
1. packages/cli/src/ui/hooks/useGeminiStream.ts - Add continuation hook integration
2. packages/core/src/types/settings.ts - Add todo-continuation ephemeral setting
3. packages/core/src/types/tools.ts - Export todo_pause tool

Requirements:
1. Minimal changes to existing files
2. Add integration points that throw NotYetImplemented
3. Maintain existing functionality
4. Type-safe modifications

For useGeminiStream:
- Add useTodoContinuation hook import
- Add continuation check after stream complete
- Stub the integration point

For settings:
- Add 'todo-continuation' to ephemeral settings type
- Default value: true

For tools:
- Register todo_pause in tool registry

All integration points should compile but throw NotYetImplemented.",
  subagent_type="typescript-coder"
)
```

## Verification Checklist

- [ ] Existing tests still pass
- [ ] New integration points compile
- [ ] Types are correct
- [ ] Minimal invasive changes