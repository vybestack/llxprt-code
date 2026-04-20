# Rule Family 05: Complexity, File Size, and Function Decomposition

## Target Rules

- `complexity`
- `max-lines`
- `max-lines-per-function`
- `sonarjs/cognitive-complexity`
- `sonarjs/nested-control-flow`
- `sonarjs/expression-complexity`
- `sonarjs/no-nested-conditional`
- `sonarjs/no-identical-functions`
- `sonarjs/no-duplicated-branches`
- `sonarjs/no-all-duplicated-branches`
- `sonarjs/no-inconsistent-returns`
- `sonarjs/too-many-break-or-continue-in-loop`

## Why This Family Is the Highest-Value Cleanup

This is the core architectural debt payoff. These rules are the strongest defense against god objects, orchestration sludge, and AI-generated copy/paste code.

They are also the least automatable and the most likely to require true refactoring.

## Severity Workflow

Promote one rule at a time, or promote a tightly-related pair only when the fix strategy is the same.

Recommended order:
1. `max-lines-per-function`
2. `complexity`
3. `sonarjs/cognitive-complexity`
4. `sonarjs/nested-control-flow`
5. `max-lines`
6. duplication-oriented rules (`no-identical-functions`, duplicated branches)
7. remaining maintainability rules (`expression-complexity`, `no-inconsistent-returns`, etc.)

Rationale:
- function-size cleanup often creates the seams that make later complexity fixes easier
- file-size cleanup is usually a consequence of successful function/module decomposition

## Fixed execution batches

Use only the batches defined in `BATCH_INVENTORY.md` for this family. Do not let the implementation subagent choose files dynamically.

Initial fixed batches:
- `C5A`
- `C5B`
- `C5C`
- `C5D`

Complexity work is hotspot-driven, not sweep-driven.

For each hotspot batch:
- use one hotspot file only unless the batch explicitly includes extracted helper files
- create a responsibility map before editing if the hotspot file is large
- do not convert one hotspot cleanup into a broad subsystem rewrite

## deepthinker Assignment Pattern

For each logical unit, deepthinker should:
- partition the file into coherent responsibilities before implementation begins
- identify extraction seams that preserve behavior and avoid speculative abstraction
- call out whether a file wants helper extraction, module decomposition, or simplification of control flow
- review the resulting structure for real architectural improvement, not just line-count shuffling

## Implementation Guidance

### Good outcomes
- smaller pure helpers
- thinner orchestration functions
- narrower modules with clear responsibility boundaries
- duplicated logic extracted into shared primitives only when the abstraction is real and stable

### Bad outcomes to avoid
- facade crutches that move code without improving design
- giant parameter bags created only to satisfy a lint rule
- comment-heavy patches that explain moved complexity instead of reducing it
- speculative abstractions with no behavioral anchor

## Per-File Verification

```bash
npm run lint -- <touched-file>
npm run typecheck
npm run test -- <related-area-if-supported>
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
node scripts/tmux-harness.js
```

## Full Verification After Each Logical Unit

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
node scripts/tmux-harness.js
```

## Completion Checklist

- [ ] The promoted complexity/size rule is zero in the targeted unit
- [ ] The code is actually simpler, not merely redistributed
- [ ] The touched modules remain within the active size/complexity budgets
- [ ] Full verification loop passes
- [ ] deepthinker confirms the refactor improved structure rather than hiding complexity
