# Draft commit message

feat(sync): finalize v0.15.4→v0.16.0 branch reconciliation and interactive shell UX

Complete the 20260129gmerge branch scope by landing the upstream reconciliation work,
interactive PTY shell integration, and follow-up reliability fixes discovered during
validation.

Highlights:
- finalize interactive shell rendering/input flow across core + CLI layers
- fix `!` shell visual lag by preserving cursor-line rendering and resolving pending-tool
  overlap behavior in live UI state
- align `!` shell PTY dimensions with configured PTY terminal sizing
- keep LLM shell + `!` shell behavior consistent while preserving backward-compatible targeting
- add regression coverage for ANSI cursor-only line rendering and pending tool-group dedupe
- retain branch planning/audit documentation for full v0.15.4→v0.16.0 traceability

Verification:
- lint: pass
- typecheck: pass
- build: pass
- targeted shell/UI tests: pass
- full test run: branch baseline includes pre-existing unrelated failures (tracked separately)

Refs: #1304
