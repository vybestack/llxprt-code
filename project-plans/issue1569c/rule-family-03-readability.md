# Rule Family 03: Low-Risk Readability Simplifications

## Target Rules

- `no-else-return`
- `no-lonely-if`
- `no-unneeded-ternary`
- `@typescript-eslint/prefer-optional-chain`
- optionally `sonarjs/no-collapsible-if` after the ESLint-core rules are clean

## Why This Family Is Third

These rules are often local and readable, but they can still change semantics or obscure intent if mass-applied carelessly. They are a good bridge between the mechanical phases and the higher-risk TS logic phases.

## Severity Workflow

Promote one rule at a time from `warn` to `error`.

Recommended order:
1. `no-else-return`
2. `no-lonely-if`
3. `no-unneeded-ternary`
4. `@typescript-eslint/prefer-optional-chain`
5. `sonarjs/no-collapsible-if`

## Fixed execution batches

Use only the batches defined in `BATCH_INVENTORY.md` for this family. Do not let the implementation subagent choose files dynamically.

Initial fixed batches:
- `R3A`
- `R3B`

Each readability rule still runs as a separate batch. Do not combine multiple readability rules into one execution pass.

## deepthinker Assignment Pattern

For each unit, deepthinker should:
- identify the transformations that are behavior-preserving
- flag nested conditionals where the current form may be intentionally clearer
- flag optional-chain rewrites that could hide repeated evaluation or control-flow intent

## Implementation Guidance

### Good candidates
- return-driven if/else simplifications
- truly redundant ternaries
- straightforward optional property access chains

### Do not do blindly
- collapsing control flow where the original shape communicates domain intent
- optional-chain rewrites that affect method-call short-circuit behavior or debug logging paths

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

- [ ] The promoted readability rule is zero in the targeted unit
- [ ] The rewrite improved readability rather than merely changing shape
- [ ] Full verification loop passes
- [ ] deepthinker review approves semantic safety
