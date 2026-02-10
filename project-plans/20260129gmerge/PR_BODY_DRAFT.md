## Summary
This PR lands the full `20260129gmerge` branch outcome for LLxprt’s upstream sync from `v0.15.4..v0.16.0`, including reimplementations and follow-up shell fixes discovered during branch validation.

It is intentionally scoped to the **whole branch**, not only the most recent interactive-shell bugfix.

## What’s included

### Upstream reconciliation and reimplementation work
- Applied selected upstream changes compatible with LLxprt architecture.
- Reimplemented selected UX/runtime behavior where direct cherry-pick was not suitable.
- Skipped out-of-scope upstream items (Google-specific infra, preview/version bumps, safety-checker framework, etc.) based on documented rationale.

Reference docs:
- `project-plans/20260129gmerge/PLAN.md`
- `project-plans/20260129gmerge/CHERRIES.md`
- `project-plans/20260129gmerge/AUDIT.md`
- `project-plans/20260129gmerge/NOTES.md`
- `project-plans/20260129gmerge/PROGRESS.md`

### Interactive shell feature delivery
- PTY terminal serialization and ANSI token rendering path.
- Interactive shell input focus/routing path.
- Type-safe propagation of live shell output through scheduler/UI layers.

### Follow-up fixes from validation
- Fixed `!` shell visual lag / one-character-behind behavior.
- Preserved cursor-only line visibility in ANSI render windowing.
- Aligned effective PTY dimensions for `!` shell execution.
- Deduplicated overlapping pending tool-group rendering while preserving shell tool visibility.

## Verification
- `npm run lint` [OK]
- `npm run typecheck` [OK]
- `npm run build` [OK]
- `npm run test` WARNING: full suite not fully green due to pre-existing branch-baseline unrelated failures
- targeted touched-area tests [OK]
  - `src/ui/hooks/shellCommandProcessor.test.ts`
  - `src/ui/hooks/useGeminiStream.dedup.test.tsx`
  - `src/ui/components/AnsiOutput.test.tsx`

## Related issue
Closes #1304
