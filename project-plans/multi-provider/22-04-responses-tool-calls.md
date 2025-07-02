# Phase 22-04 – Tool-call handling & multi-choice

## Goal

Support `tool_calls` array, assemble arguments, surface as single delta; handle multi-choice responses gracefully.

## Deliverables

- `ToolFormatter.toResponsesTool()` helper
- Updates to stream parser to accumulate tool_calls
- Tests: edge-case schemas, multi-choice stream fixture

## Checklist

- [ ] Extend ToolFormatter
- [ ] Parser emits assembled toolCall array
- [ ] Multi-choice index 0 logic + meta warning
- [ ] Tests green

## Self-verify

```bash
npm run typecheck && npm run lint && npm test --run ToolCalls
```

STOP. Wait for Phase 22-04a verification.
