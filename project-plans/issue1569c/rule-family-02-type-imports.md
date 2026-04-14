# Rule Family 02: Type-Only Imports and Import Hygiene

## Target Rules

- `@typescript-eslint/consistent-type-imports`

Optional follow-on if needed after the main rule is stable:
- closely related import hygiene warnings in the same touched units, but only if they are genuinely mechanical and do not expand scope

## Why This Family Is Early

This rule is TypeScript-idiomatic, improves clarity, and often yields a large warning reduction. It also reduces noise for later refactors.

## Severity Workflow

Promote `@typescript-eslint/consistent-type-imports` from `warn` to `error`.

Important policy:
- We want idiomatic top-level TypeScript imports.
- We do not want to regress to ugly or fragile inline `import()` style.
- Respect the project’s Node ESM compilation model and existing `.js` extension conventions where required.

## Fixed execution batches

Use only the batches defined in `BATCH_INVENTORY.md` for this family. Do not let the implementation subagent choose files dynamically.

Initial fixed batches:
- `TI2A`
- `TI2B`

For `TI2B`, the exact provider-file list must be frozen in a copied `BATCH_TEMPLATE.md` before implementation begins. Once frozen, it is no longer allowed to expand during execution.

## deepthinker Assignment Pattern

For each unit, deepthinker should:
- distinguish safe top-level `import type` conversions from tricky inline `import()` cases
- flag any case where module graph or ESM semantics make the rewrite suspicious
- review whether the rewrite preserves the project’s `.js` import-extension conventions

## Implementation Guidance

### Safe edits
- convert value imports used only as types into top-level `import type` declarations
- split mixed imports if necessary while preserving path strings and `.js` extensions

### Be careful with
- inline `import()` type annotations that may require manual redesign
- files with circular-ish dependency pressure
- generated or schema-derived exports
- code where tooling or runtime interop depends on exact import shape

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

- [ ] The targeted unit has zero `consistent-type-imports` violations
- [ ] No `.js` import-path convention was broken
- [ ] No inline `import()` rewrite introduced awkward or non-idiomatic TS where a better manual import was required
- [ ] Full verification loop passes
- [ ] deepthinker signs off on TS/ESM correctness
