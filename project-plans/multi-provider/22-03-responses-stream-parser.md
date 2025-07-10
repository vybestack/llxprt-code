# Phase 22-03 – Stream parser & conversation cache

## Goal

Stream SSE chunks from `openai.responses.stream`, convert to `IMessageDelta`, capture IDs, usage, and push into cache.

## Deliverables

- `parseResponsesStream.ts` generator
- `ConversationCache.ts` (LRU 100 / 2h TTL)
- Integration in `OpenAIProvider.callResponsesEndpoint`
- Unit tests: parser, cache, two-call integration fixture

## Checklist

- [ ] Implement SSE parser (C1 & C2 spec)
- [ ] Implement LRU cache util
- [ ] Wire provider save + reuse
- [ ] Map errors 409/410/5xx per policy
- [ ] Tests green, lint, types

## Self-verify

```bash
npm run typecheck && npm run lint && npm test --run ResponsesStream
```

STOP. Wait for Phase 22-03a verification.
