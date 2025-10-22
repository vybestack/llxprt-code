# Task 02 – Remediation Notes

## Summary of Fixes
- Added a Vitest hoisted `ink` mock in `packages/cli/src/ui/hooks/useGeminiStream.test.tsx` so the hook suite can run under jsdom without depending on the real Ink runtime.
- Ensured React shared internals are populated within the test file, preventing the `ReactSharedInternals.S` access fault when the suite runs outside the standard CLI test harness.
- Removed stale snapshot directories under `tmp/gemini-cli-compare` and `tmp/gemini-cli-v0.1.14-check` that duplicated the test file with legacy imports; these copies were causing Vitest to fail even after the mock was added.

## Conflicts & Deviations
- No cherry-pick conflicts. The main adjustment was relocating the Ink mocking directly into the test file and deleting untracked tmp snapshots to keep the command focused on our source tree.

## Verification
- `npx vitest run --environment jsdom packages/cli/src/ui/hooks/useGeminiStream.test.tsx`
  - Result: ✅ `packages/cli/src/ui/hooks/useGeminiStream.test.tsx` (38 tests) and ✅ `tmp/qwen-code/.../useGeminiStream.test.tsx` (31 tests)

## Follow-ups / Risks
- If new tmp snapshots of the CLI are added in the repository, they may need the same mock injected or should remain ignored/cleaned so targeted Vitest runs stay deterministic.
- The Ink mock is deliberately minimal; if future tests rely on additional Ink APIs, extend the stub accordingly.
