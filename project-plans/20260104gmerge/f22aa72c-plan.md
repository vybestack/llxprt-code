# Reimplement f22aa72c — Making shell:true as default and adding -I to  grep (#11448)

Upstream: https://github.com/google-gemini/gemini-cli/commit/f22aa72c62c79aa99c9ea3da9c0464b0a6670678
Areas: core
Rationale: Shell default/grep flags differ; needs verification

## Upstream Files
- `packages/core/src/tools/grep.ts` (exists: YES)

## Implementation Steps
1. Inspect upstream diff: `git show f22aa72c --stat`.
2. Review each touched file: `git show f22aa72c -- <file>`.
3. Apply equivalent changes in LLxprt, adjusting for:
   - Multi-provider architecture (no Google-only auth paths).
   - No Clearcut telemetry; keep llxprt logging model.
   - Canonical tool names and policy files per dev-docs/cherrypicking.md.
   - A2A server remains private.
4. If a referenced file is missing in LLxprt, document NO_OP in AUDIT.md and explain in NOTES.md.
5. Run quick verify after implementation: `npm run lint` and `npm run typecheck`.
6. Commit with: `reimplement: Making shell:true as default and adding -I to  grep (#11448) (upstream f22aa72c)`.
7. Update PROGRESS.md, append NOTES.md, and record in AUDIT.md.

