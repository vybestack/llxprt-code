# Phase 22-05 – Docs, regression suite & benchmarks

## Goal

Finalize provider docs, integrate full regression tests, and optional perf benchmark.

## Deliverables

- `docs/cli/providers-openai-responses.md`
- Vitest integration covering legacy, stateless, stateful, tool_call
- Optional `scripts/benchmark/responses_vs_chat.ts`

## Checklist

- [x] Write MD docs with examples
- [x] Add/green integration tests in packages/cli
- [x] (Optional) commit benchmark script

## Self-verify

```bash
npm run typecheck && npm run lint && npm run test && npm run md-link-check docs/cli/providers-openai-responses.md
```

STOP. Wait for Phase 22-05a verification.
