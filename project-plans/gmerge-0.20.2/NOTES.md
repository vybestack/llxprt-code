# NOTES.md — gmerge-0.20.2

Running notes during execution. Append after each batch.

---

## Pre-execution Notes

- 24 decision changes made during Phase 2 review (v1 -> v2).
- Key architectural discoveries: prompts.ts completely rewritten, hooks partially implemented, MCP instruction plumbing absent, executor already stateless.
- 2 REIMPLEMENT pairs grouped into single batches: hooks (558c8ece + 5bed9706), MCP instructions (bc365f1e + 844d3a4d).
