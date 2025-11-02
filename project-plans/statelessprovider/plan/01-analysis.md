# Phase 01: Runtime & Integration Analysis

## Phase ID

`PLAN-20250218-STATELESSPROVIDER.P01`

## Prerequisites

- Required: Specification approved (`project-plans/statelessprovider/specification.md`)
- Recommended: Review `plan/00-overview.md` to understand downstream phases.
- Reference materials gathered before starting (open tabs or local notes are fine).

## Phase Purpose

Capture an authoritative snapshot of how state currently flows through the provider runtime, CLI entrypoints, prompt helpers, and profile lifecycle so later refactor phases have clear guardrails. The output is an updated analysis document—no production code changes occur during this phase.

## Investigation Objectives

- Identify every construct that currently owns or mutates provider state (including latent singletons).
- Document how CLI commands, bootstrap code, and profile utilities interact with provider/runtime configuration.
- Trace prompt generation dependencies so we understand where settings are implicitly fetched.
- Record integration touchpoints and edge cases that must be preserved when providers become stateless.

## Implementation Tasks

### 1. Trace the Existing Runtime Wiring (Blocking)

- Inspect how `SettingsService`, `Config`, `ProviderManager`, and `geminiChat` share state:
  ```bash
  rg "getSettingsService" packages/core/src -n
  rg "ProviderManager" packages/cli/src packages/core/src -n
  sed -n '1,200p' packages/core/src/core/geminiChat.ts
  sed -n '1,160p' packages/core/src/config/config.ts
  ```
- Capture findings about singleton usage, constructor patterns, and any implicit coupling that will need to be broken in later phases.

### 2. Map CLI Command & Bootstrap Interactions

- Review CLI entrypoints and commands that mutate provider/model state:
  ```bash
  sed -n '1,200p' packages/cli/src/gemini.tsx
  rg "profile" packages/cli/src/ui/commands -g '*Command.ts'
  rg "setModel" packages/cli/src/ui/commands -n
  ```
- Document how `/provider`, `/model`, `/profile save`, `/profile load`, and `--profile-load` currently manipulate settings or provider instances.
- Note any helper utilities (`providerManagerInstance.ts`, `profileManager.ts`) that rely on global caches.

### 3. Audit Prompt Helper Dependencies

- Examine where prompts fetch settings implicitly:
  ```bash
  sed -n '1,200p' packages/core/src/core/prompts.ts
  rg "getCoreSystemPrompt" -n packages
  ```
- Record every parameter currently derived from global state and what the desired injected source should be.

### 4. Capture Edge Cases & Integration Touchpoints

- Enumerate error/edge scenarios (missing profiles, unset models, auth workflow quirks) encountered during the review.
- List downstream modules that depend on existing behavior (e.g., tests under `packages/core/src/providers/__tests__`, CLI hooks).
- Flag any risky migrations that must be coordinated with later phases.

### 5. Synthesize the Analysis Document (Output)

- Update `project-plans/statelessprovider/analysis/domain-model.md` with the findings above.
  - Provide sections for runtime entities, provider behaviors, CLI interactions, profile lifecycle, prompt service dependencies, edge cases, and integration touchpoints.
  - Ensure the document remains descriptive (no implementation directives).
  - MUST include the markers:
    ```markdown
    <!-- @plan:PLAN-20250218-STATELESSPROVIDER.P01 @requirement:REQ-SP-001 -->
    ```
  - Explicitly map how each CLI command and profile operation interacts with settings/config and where prompt helpers rely on global state.

### Files to Create

- _None_

### Files to Modify

- `project-plans/statelessprovider/analysis/domain-model.md` (analysis narrative only)

## Verification Commands

### Automated Checks

```bash
grep -r "@plan:PLAN-20250218-STATELESSPROVIDER.P01" project-plans/statelessprovider/analysis/domain-model.md
grep -r "@requirement:REQ-SP-001" project-plans/statelessprovider/analysis/domain-model.md
```

### Manual Verification Checklist

- [ ] Document covers runtime wiring, CLI commands, profile lifecycle, prompt helpers, and integration touchpoints.
- [ ] Edge cases and risks are captured for downstream phases.
- [ ] No implementation instructions or code edits outlined—analysis only.

## Success Criteria

- Domain analysis gives a complete, traceable picture of current-state behavior aligned with REQ-SP-001.
- Later phases can rely on the document to understand existing dependencies and edge scenarios.

## Failure Recovery

1. Revert modifications: `git checkout -- project-plans/statelessprovider/analysis/domain-model.md`
2. Repeat the investigation with deeper review of uncovered areas.

## Phase Completion Marker

Create: `project-plans/statelessprovider/.completed/P01.md`

```markdown
Phase: P01
Completed: YYYY-MM-DD HH:MM
Files Modified:
- analysis/domain-model.md (updated)
Verification:
- <paste command outputs>
```
