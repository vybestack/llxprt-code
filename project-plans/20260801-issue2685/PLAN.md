# Issue #2685 — Docs audit phase 2: user-perspective rewrites and deduplication

Status: in progress
Branch: `issue2685`
Predecessor: #2654 phase 1 (merged as 35369bb11) — link/placement guards, six relocations,
factual corrections, `dev-docs/documentation-style-guide.md`.

## Goal

Complete the subjective half of the #2654 audit: rewrite large user-facing pages from the
reader's perspective, split mixed user/internal material, deduplicate repeated sections, and
remove rollout-era and sensational framing. Placement and link correctness are already
mechanically enforced; this issue supplies the prose judgement those guards cannot make.

## Authority

`dev-docs/documentation-style-guide.md` is the governing standard:

- `docs/` targets product consumers; `dev-docs/` targets repository contributors.
- Pages lead with the reader's outcome and a minimal path, not implementation history.
- Source paths, internal type definitions, test names, and issue/plan IDs do not belong in
  `docs/`.
- One canonical page per subject; link rather than copy.
- Security claims state boundaries and evidence, not absolutes.

## Scope reconciliation

Two items named in the issue do not exist on `main` and are therefore out of scope. Both were
listed from the original audit snapshot and no longer resolve:

| Issue item                              | State on `main` | Disposition |
| --------------------------------------- | --------------- | ----------- |
| `docs/release-notes/2025Q4.md`          | Absent (no `docs/release-notes/` directory) | Out of scope — nothing to rewrite |
| `docs/migration/stateless-provider-v2.md` | Absent          | Out of scope — nothing to rewrite |

`docs/agent-api.md` was relocated wholesale to `dev-docs/agent-api.md` by phase 1. The phase 2
work for that item is the split the issue asks for: extract the supported consumer-facing API
surface back into `docs/`, leaving implementation history and future work in `dev-docs/`.

## Acceptance criteria

Each criterion is verified by inspection against the style guide checklist plus the mechanical
guards. "No internal material" means: no repository source paths, no internal-only type or
function signatures, no test names, no issue/plan IDs used as structure, no implementation
history or future-work sections.

### AC1 — Agent API split

- `docs/agent-api.md` exists and covers, in reader-task order: audience and stability, the
  supported entry package and imports, quick start, configuration (`createAgent` /
  `AgentConfig`), lifecycle and control-plane operations, events, errors, disposal, and
  examples.
- `dev-docs/agent-api.md` retains implementation history, recorded decisions, import-boundary
  material, runtime-vs-app-service internals, sequence model, and future work, and cross-links
  to the user page.
- Neither page duplicates the other's material.

### AC2 — Deployment split

- `docs/deployment.md` keeps install, run, and deployment guidance for users.
- Running-from-source, package/build architecture, test-runner, and release-workflow internals
  are removed from `docs/` and are present in `dev-docs/` (existing `dev-docs/npm.md`,
  `dev-docs/bun.md`, `dev-docs/test-runner-inventory.md` where already covered; no duplicate
  copies created).

### AC3 — Message bus

- `docs/message-bus.md` leads with controlling tool execution through policies.
- The legacy-flow diagram, current-flow pseudocode, and performance-internals sections are
  gone from `docs/`, and the equivalent material is confirmed present in
  `dev-docs/architecture/message-bus.md`, which the user page links to.

### AC4 — Todo system

- `docs/todo-system.md` leads with user-visible behavior (what the user sees, how to control
  the panel, how continuation affects a session).
- Model-facing tool schemas and continuation complexity heuristics are removed from `docs/`
  and recorded in `dev-docs/`.

### AC5 — Memory import

- `docs/core/memport.md` keeps syntax, path rules, safety, examples, errors, and
  troubleshooting.
- The function/type API reference and the cross-product comparison section are removed from
  `docs/` and recorded in `dev-docs/`.

### AC6 — MCP server page rebuild

- `docs/tools/mcp-server.md` is ordered by user task: add, authenticate, verify, use, restrict
  trust, troubleshoot, remove.
- Exactly one MCP-prompts section and exactly one server-management section remain (the page
  currently carries two of each).
- Discovery and tool-execution internals are removed from `docs/` and recorded in `dev-docs/`.

### AC7 — Hook tutorial consolidation

- One canonical hook tutorial page remains under `docs/hooks/`.
- The superseded page is removed and every inbound link in the repository resolves to the
  canonical page.
- No tutorial content is lost without justification; overlapping examples are merged, not
  duplicated.

### AC8 — Approval-mode migration

- `docs/migration/approval-mode-to-policies.md` follows the style guide's migration structure:
  status/affected versions/audience, compatibility impact, before and after, migration steps,
  verification, rollback, deprecation timeline.
- Rollout-era phase framing (feature-flag phases, coexistence phases) is gone.

### AC9 — Sandbox tone

- `docs/sandbox.md` states a neutral threat model, explicit boundaries (what is and is not
  isolated), per-platform limitations, and verification steps a reader can run.
- No absolute or sensational security claims remain.

### AC10 — Provider reference freshness

- `docs/providers/quick-reference.md` is a scannable setup reference.
- Mutable model/pricing/capability guidance lives on its own page carrying an explicit "as of"
  date and a named owner, per the style guide's freshness rule.

### AC11 — CLI section index

- `docs/cli/index.md` opens with task-oriented navigation and no package-layout framing.

### AC12 — Implementation pointers removed

- `docs/cli/retry-settings.md`, `docs/debug-logging.md`, and `docs/multiline-input.md` contain
  no source-file or implementation-detail pointers; that material is in `dev-docs/` where it
  is worth keeping.

### AC13 — Verification gates

- `npm run lint:doc-links` and `npm run lint:doc-placement` pass.
- `npm run format`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test` pass.
- Every factual claim written or retained is verified against source; the verification log
  below records the checks performed.

## Boundary cases

- **Link fan-in.** `packages/cli/src/ui/commands/mcpCommand.ts` and its test hard-code the
  GitHub URL for `docs/tools/mcp-server.md`. That path must not move.
- **Anchor stability.** The link guard validates `#anchor` fragments. Any heading rename must
  be matched by inbound-link updates in the same change.
- **Placement guard.** `docs/` must not gain `architecture/`, `plans/`, or `merge-notes/`
  directories, and must not carry `@plan:`, `@requirement:`, `PLAN-`, or `REQ-` markers
  outside fenced code blocks.
- **Deletion safety.** Content is only deleted from `docs/` after confirming the equivalent
  exists in `dev-docs/`; otherwise it is moved.

## Non-goals

- No changes to code, tests, tooling, CI, or dependencies.
- No new guards or lint rules; phase 1 already supplies them.
- No edits to `docs/` pages outside the issue's list except link updates forced by relocation
  or consolidation.

## Verification log

Populated during implementation; each row records a claim written or retained in `docs/` and
the source consulted to confirm it.

| Claim | Source consulted | Result |
| ----- | ---------------- | ------ |
