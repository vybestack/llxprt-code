# Rule Family 06: Sonar Maintainability, TODO Pressure, and CLI-Safe Quality Rules

## Target Rules

Keep and address the SonarJS rules that are genuinely useful for this repo, instead of using SonarJS as a blanket preset dump.

Primary candidates:
- `sonarjs/todo-tag`
- `sonarjs/no-ignored-exceptions`
- `sonarjs/regular-expr`
- `sonarjs/slow-regex`
- `sonarjs/os-command`
- `sonarjs/no-os-command-from-path`
- `sonarjs/no-built-in-override`
- `sonarjs/no-element-overwrite`
- selected lower-volume maintainability rules that survive the earlier families

Secondary candidates to evaluate once warning volume is lower:
- `sonarjs/no-duplicate-string`
- `sonarjs/elseif-without-else`
- `sonarjs/prefer-regexp-exec`
- `sonarjs/no-redundant-jump`
- `sonarjs/file-permissions`

## Why This Family Is Last

Many of the valuable SonarJS maintainability warnings become easier to judge after the big TypeScript and complexity cleanup is done. This phase is where we preserve the useful anti-slop pressure without reintroducing wrong-fit JS/web/AWS noise.

## Severity Workflow

Promote one rule at a time from `warn` to `error`.

Recommended order:
1. `sonarjs/todo-tag`
2. `sonarjs/no-ignored-exceptions`
3. `sonarjs/regular-expr`
4. `sonarjs/slow-regex`
5. `sonarjs/os-command`
6. `sonarjs/no-os-command-from-path`
7. lower-priority style/maintainability survivors only if still desired

## Fixed execution batches

Use only the batches defined in `BATCH_INVENTORY.md` for this family. Do not let the implementation subagent choose files dynamically.

Initial fixed batches:
- `S6A`
- `S6B`
- `S6C`
- `S6D`

Additional Sonar batches may be added later, but only by explicitly extending `BATCH_INVENTORY.md` before execution starts.

## deepthinker Assignment Pattern

For each logical unit, deepthinker should:
- distinguish real unfinished-work markers from acceptable documentation context
- distinguish actually swallowed exceptions from intentional and correctly handled cases
- review shell/regex changes for operational correctness and safety
- flag any SonarJS rule that appears to still be a misfit for TypeScript/CLI/ESM so the coordinator can decide whether to disable it with written justification

## Implementation Guidance

### For `todo-tag`
- do not remove TODOs by hiding them
- either complete the work, rewrite the comment into non-TODO explanatory text when appropriate, or split the work into an actual issue/task and leave intentional documentation only if policy allows

### For `no-ignored-exceptions`
- prefer explicit handling over empty catch blocks
- if ignoring is intentional, encode that intention clearly in control flow rather than via a silent swallow

### For shell/regex rules
- preserve exact behavior while improving safety and explicitness
- avoid broad rewrites unless tests cover the behavior

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

- [ ] The promoted SonarJS rule is zero in the targeted unit
- [ ] No TODO was merely hidden to satisfy lint
- [ ] No exception path was silenced incorrectly
- [ ] Shell/regex safety fixes preserve behavior
- [ ] Full verification loop passes
- [ ] deepthinker confirms the rule remains useful for this repo or documents why it should be reconsidered
