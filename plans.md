# 🗂️ multi-llm-ts Plan-Creation Guide

This document explains **how to craft multi-phase implementation plans** ("P-plans") that can be executed by independent LLM workers while guaranteeing incremental quality gates.  Refer to this whenever you ask an LLM to generate a new plan.

---

## 1. Folder & File Structure

```
plans/<feature-slug>/
  01-<title>.md          ← Phase *N* task description
  01a-<title>-verification.md  ← Phase *N*a verification task
  02-…
  02a-…
  …
```

* Use **two-digit numeric prefixes** for chronological ordering.
* Every implementation phase *N* **must** be immediately followed by a verification phase *N*a.
* The final plan should include as many phases as needed (stubs, TDD, impl, UI, integration, release).

---

## 2. Content of an **Implementation Phase** file (`NN-*.md`)

1. **Heading** – `# Phase <index> – <short title> (<feature-slug>)`.
2. **STOP banner** – instructs the worker to cease after tasks are done.
3. **Goal** – concise objective.
4. **Deliverables** – bullet list with explicit paths & API contracts.
5. **Checklist (implementer)** – GitHub-style checkboxes `[ ]`; must be ticked (`[x]`) by the worker before finishing.
6. **Self-verify** – terminal commands the worker must run locally to prove success (e.g., `npm run typecheck`).
7. **End note** – *"STOP. Wait for Phase X verification."*

### Mandatory Rules for Implementation Phases

* **NO reverse tests**: workers cannot write tests that expect `NotYetImplemented` or any stub error.  Tests must assert real behaviour.
* **Stub phases** must throw `NotYetImplemented` from all new methods.
* Workers **must not** remove type checking or disable ESLint.
* Each phase may only run the tests it expects to pass; earlier failing tests are acceptable until their scheduled phase.
* The worker must check off every box in the checklist before stopping.

---

## 3. Content of a **Verification Phase** file (`NNa-*-verification.md`)

1. **Heading** – `# Phase <index>a – Verification of <title> (<feature-slug>)`.
2. **Verification Steps** – numbered list describing exact commands and grep checks to prove deliverables.
3. **Outcome section** – instruction to emit `✅` or a list of `❌` failures.

### Mandatory Rules for Verification Phases

* Must aggressively look for *cheating* (e.g., hidden logic in stubs, unchecked boxes, tests that catch the stub error).
* Should run linter, type-checker, and the relevant test scope.
* Must fail if any checklist item remains unchecked.

---

## 4. Phase Sequence Template

The recommended minimal sequence:

1. **Stub Scaffolding** – create compile-able skeleton throwing `NotYetImplemented`.
2. **TDD Specification** – add failing tests that define behaviour (no reverse tests!).
3. **Core Implementation** – implement logic until Phase-2 tests pass.
4. **UI / Integration** – build components, wire events, enable feature flags.
5. **Final Regression & Release** – run full test suite & update docs.

Each step is paired with its own `a` verification step.

---

## 5. Checklist for Plan Authors

- [ ] Use two-digit numeric prefixes and matching `a` files.
- [ ] Every deliverable lists **exact** file paths.
- [ ] Include linter & type-check commands in self-verify sections.
- [ ] Document rules: no reverse tests, throw `NotYetImplemented`, tick checkboxes.
- [ ] Provide grep examples to detect cheating in verification files.


---

Happy planning! 