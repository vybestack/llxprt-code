# Execution Notes: gmerge-0.24.5

Running notes captured during batch execution. Append after each batch.

---

## Pre-Execution Notes

- A2A remote agents descoped to issue #1675 (4 commits moved to SKIP)
- Skills chain (11 commits) must be picked in order — heavy branding changes
- Race condition fixes (PICK-B8) are high-risk — `687ca40b` changes `void` → `await` on `scheduleToolCalls`
- Console migration (RE-B10) is the biggest single item at 47 files
- MessageBus P03 is the biggest DI phase at 31 files (11 prod + 20 test)
- `gemini.tsx`, `GeminiClient`, `GeminiCLIExtension` are REAL LLxprt names — not branding leakage

---

<!-- Append batch notes below this line -->
