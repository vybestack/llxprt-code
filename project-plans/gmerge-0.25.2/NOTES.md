# Execution Notes: gmerge-0.25.2

Running notes captured during batch execution. Append after each batch.

---

## Pre-Execution Notes

- `CHERRIES.md` is frozen and remains the source of truth for all PICK / SKIP / REIMPLEMENT / NO_OP decisions.
- `PLAN.md` is the authoritative 55-batch execution schedule; do not resequence batches.
- All **28** REIMPLEMENT playbooks are present and linked from `PLAN.md`.
- The project-plan artifact set now includes `CHERRIES.md`, `SUMMARY.md`, `PLAN.md`, `PROGRESS.md`, `NOTES.md`, `AUDIT.md`, `AUDIT-DETAILS.md`, and every `SHA-plan.md` file required by REIMPLEMENT batches.
- The smoke-test command for this sync is standardized as:
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Tracking issue number is still missing from the planning package. Confirm it before PR creation and before finalizing PR title/body text.
- A2A-related follow-up work remains deferred to issue `#1675` unless an individual playbook explicitly directs otherwise.
- Preserve LLxprt architecture throughout execution:
  - multi-provider support
  - provider-neutral auth
  - LLxprt tool batching behavior
  - `/subagent` + `SubagentManager` + `task()` semantics
  - LLxprt branding / package names / tool names
- Do **not** adopt upstream `/agents`, `AgentRegistry`, `DelegateToAgentTool`, markdown-frontmatter agent files, Clearcut, Google-only auth, or automatic model routing.
- Several REIMPLEMENT items intentionally target LLxprt-native files rather than upstream locations. Examples already captured in playbooks include:
  - history perf work targets `packages/cli/src/ui/layouts/DefaultAppLayout.tsx`
  - loading-indicator refinements must fit LLxprt’s current `usePhraseCycler` / UI state model
  - extension / subagent work must extend LLxprt’s existing config and manager layers rather than import upstream agent architecture
  - evals work starts from the fact that top-level `evals/` tooling is currently absent

---

<!-- Append batch notes below this line during execution -->
