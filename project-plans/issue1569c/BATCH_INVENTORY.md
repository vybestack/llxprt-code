# Issue #1569c Batch Inventory

This inventory exists to prevent unbounded execution. Subagents must not choose files dynamically. Every implementation pass must use one of the fixed batches below or a newly reviewed batch added explicitly to this file.

## Global batch safety rules

1. Only one primary lint rule may be promoted from `warn` to `error` in a batch.
2. A batch may touch at most:
   - 8 production files, or
   - 12 test-only files.
3. A batch must stay within one package or one tightly-coupled subsystem.
4. If a batch needs more files, split it into multiple batches before implementation begins.
5. No opportunistic cleanup of unrelated rules.
6. If full verification fails and the fix is not obviously local, revert the batch and redesign it smaller.

---

## Phase 1: Test discipline and highly mechanical test fixes

### Batch T1A
- **Primary rule**: `vitest/prefer-strict-equal`
- **Scope**: `packages/a2a-server` tests
- **Risk**: low
- **Files**:
  1. `packages/a2a-server/src/agent/task.test.ts`
  2. `packages/a2a-server/src/commands/extensions.test.ts`
  3. `packages/a2a-server/src/commands/restore.test.ts`
  4. `packages/a2a-server/src/config/config.test.ts`
- **Why together**: same package, same rule shape, strongly mechanical assertion upgrades.

### Batch T1B
- **Primary rule**: `vitest/prefer-strict-equal`
- **Scope**: `packages/core` tests
- **Risk**: low
- **Files**:
  1. `packages/core/src/tools/todo-read.test.ts`
  2. `packages/core/src/tools/todo-write.test.ts`
  3. `packages/core/src/config/config.test.ts`
  4. `packages/core/src/policy/config.test.ts`
- **Why together**: verified existing files, compact scope, safe revert boundary.

### Batch T1C
- **Primary rule**: `vitest/require-to-throw-message`
- **Scope**: `packages/a2a-server` tests
- **Risk**: low
- **Files**:
  1. `packages/a2a-server/src/agent/task.test.ts`
  2. `packages/a2a-server/src/commands/restore.test.ts`
- **Why together**: same package, same matcher pattern class.

### Batch T1D
- **Primary rule**: `vitest/expect-expect`
- **Scope**: `packages/core` tests
- **Risk**: low-medium
- **Files**:
  1. `packages/core/src/tools/todo-read.test.ts`
  2. `packages/core/src/tools/todo-write.test.ts`
- **Why together**: tiny scope for structurally weak tests if any need explicit assertions.

Hold `vitest/no-conditional-expect` and `vitest/no-conditional-in-test` until stronger localized tests exist in the touched subsystem.

---

## Phase 2: Type-only imports and import hygiene

### Batch TI2A
- **Primary rule**: `@typescript-eslint/consistent-type-imports`
- **Scope**: `packages/core` config and adjacent config tests
- **Risk**: low-medium
- **Files**:
  1. `packages/core/src/config/types.ts`
  2. `packages/core/src/config/config.test.ts`
  3. `packages/core/src/policy/config.test.ts`
- **Why together**: verified existing files in one config-related scope with likely type-only imports.

### Batch TI2B
- **Primary rule**: `@typescript-eslint/consistent-type-imports`
- **Scope**: `packages/core` Anthropic provider support modules
- **Risk**: medium
- **Files**:
  1. `packages/core/src/providers/anthropic/AnthropicRequestBuilder.ts`
  2. `packages/core/src/providers/anthropic/AnthropicMessageNormalizer.ts`
  3. `packages/core/src/providers/anthropic/AnthropicMessageValidator.ts`
  4. `packages/core/src/providers/anthropic/AnthropicResponseParser.ts`
  5. `packages/core/src/providers/anthropic/AnthropicRequestPreparation.ts`
- **Why together**: type-heavy provider-support files in one subsystem; good candidate for top-level `import type` cleanup without crossing provider boundaries broadly.

### Batch TI2C
- **Primary rule**: `@typescript-eslint/consistent-type-imports`
- **Scope**: `packages/core` Anthropic/provider support continuation
- **Risk**: medium
- **Files**:
  1. `packages/core/src/providers/anthropic/AnthropicApiExecution.ts`
  2. `packages/core/src/providers/anthropic/AnthropicRateLimitHandler.ts`
  3. `packages/core/src/providers/anthropic/usageInfo.ts`
  4. `packages/core/src/providers/apiKeyQuotaResolver.ts`
- **Why together**: same provider-adjacent scope, verified existing files, manageable revert boundary.

Important policy:
- top-level `import` -> `import type` conversions are acceptable
- do not allow ugly or fragile inline `import()` style rewrites
- preserve `.js` import-path conventions required by the ESM build model

---

## Phase 3: Low-risk readability simplifications

### Batch R3A
- **Primary rule**: `no-else-return`
- **Scope**: `packages/a2a-server` command/config layer
- **Risk**: low
- **Files**:
  1. `packages/a2a-server/src/config/config.ts`
  2. `packages/a2a-server/src/commands/extensions.ts`
  3. `packages/a2a-server/src/commands/restore.ts`
- **Why together**: small verified set in one package where flow simplifications are easy to review.

### Batch R3B
- **Primary rule**: `@typescript-eslint/prefer-optional-chain`
- **Scope**: `packages/a2a-server` lower-risk files
- **Risk**: medium
- **Files**:
  1. `packages/a2a-server/src/config/config.ts`
  2. `packages/a2a-server/src/commands/restore.ts`
- **Why together**: verified files with localized logic; avoid heavy orchestration hotspots.

Do not mix `prefer-optional-chain` with `no-else-return` in the same execution pass.

---

## Phase 4: Boolean and nullish correctness

These batches are high risk and intentionally tiny.

### Batch BN4A
- **Primary rule**: `@typescript-eslint/switch-exhaustiveness-check`
- **Scope**: `packages/a2a-server` agent flow
- **Risk**: medium
- **Files**:
  1. `packages/a2a-server/src/agent/task.ts`
- **Why together**: one-file localized exhaustiveness cleanup is safer than a sweep.

### Batch BN4B
- **Primary rule**: `@typescript-eslint/prefer-nullish-coalescing`
- **Scope**: `packages/a2a-server` config/env resolution
- **Risk**: high
- **Files**:
  1. `packages/a2a-server/src/config/config.ts`
- **Why together**: tiny one-file batch in a semantically coherent area.

### Batch BN4C
- **Primary rule**: `@typescript-eslint/no-unnecessary-condition`
- **Scope**: `packages/a2a-server` agent/executor pair
- **Risk**: high
- **Files**:
  1. `packages/a2a-server/src/agent/executor.ts`
  2. `packages/a2a-server/src/agent/task.ts`
- **Why together**: both are in the same agent execution subsystem, but still small enough to review and revert.

### Batch BN4D
- **Primary rule**: `@typescript-eslint/strict-boolean-expressions`
- **Scope**: `packages/a2a-server` command/config edge cases
- **Risk**: highest
- **Files**:
  1. `packages/a2a-server/src/config/config.ts`
  2. `packages/a2a-server/src/commands/extensions.ts`
- **Why together**: same package and lower blast radius than large provider/runtime files.

Do not begin BN4C or BN4D until nearby tests are clearly adequate.

---

## Phase 5: Complexity, size, and decomposition hotspots

These are hotspot-driven, not sweep-driven.

### Batch C5A
- **Primary rule**: `max-lines-per-function`
- **Scope**: `packages/a2a-server` executor hotspot
- **Risk**: high
- **Files**:
  1. `packages/a2a-server/src/agent/executor.ts`
- **Why together**: one hotspot file only; safe rollback boundary.

### Batch C5B
- **Primary rule**: `complexity`
- **Scope**: `packages/a2a-server` task hotspot
- **Risk**: high
- **Files**:
  1. `packages/a2a-server/src/agent/task.ts`
- **Why together**: one hotspot file only; behavior can be preserved while decomposing deliberately.

### Batch C5C
- **Primary rule**: `sonarjs/cognitive-complexity`
- **Scope**: `packages/a2a-server` task hotspot continuation
- **Risk**: high
- **Files**:
  1. `packages/a2a-server/src/agent/task.ts`
- **Why together**: same hotspot, but still a separate execution pass from `complexity` if needed.

### Batch C5D
- **Primary rule**: `max-lines`
- **Scope**: `packages/a2a-server` oversized module
- **Risk**: high
- **Files**:
  1. `packages/a2a-server/src/agent/task.ts`
- **Why together**: one oversized module and any extracted helper files created by that single refactor pass.

Use a responsibility map before editing any hotspot file.

---

## Phase 6: Sonar maintainability and anti-slop rules

### Batch S6A
- **Primary rule**: `sonarjs/todo-tag`
- **Scope**: `packages/a2a-server` TODO hotspots
- **Risk**: medium
- **Files**:
  1. `packages/a2a-server/src/config/config.ts`
  2. `packages/a2a-server/src/agent/task.ts`
- **Why together**: verified high-warning files where TODO cleanup is likely to matter.
- **Policy**: do not hide TODOs merely to satisfy lint.

### Batch S6B
- **Primary rule**: `sonarjs/no-ignored-exceptions`
- **Scope**: `packages/a2a-server` agent flow
- **Risk**: medium-high
- **Files**:
  1. `packages/a2a-server/src/agent/executor.ts`
  2. `packages/a2a-server/src/agent/task.ts`
- **Why together**: same execution subsystem with likely catch/ignore patterns.

### Batch S6C
- **Primary rule**: `sonarjs/regular-expr`
- **Scope**: provider/parser support
- **Risk**: medium
- **Files**:
  1. `packages/core/src/providers/anthropic/AnthropicResponseParser.ts`
  2. `packages/core/src/providers/anthropic/AnthropicMessageNormalizer.ts`
- **Why together**: parser/normalizer files are the most plausible regex-heavy existing verified paths in one subsystem.

### Batch S6D
- **Primary rule**: `sonarjs/os-command` or `sonarjs/no-os-command-from-path`
- **Scope**: shell/process-execution subsystem
- **Risk**: medium-high
- **Files**:
  1. `packages/a2a-server/src/agent/executor.ts`
- **Why together**: one-file shell/process boundary is the safest place to handle execution-related Sonar rules.

---

## Verification loop for every batch

### After each touched file

```bash
npm run lint -- <touched-file>
npm run typecheck
npm run test -- <related-area-if-supported>
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
node scripts/tmux-harness.js
```

### After the full batch

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
node scripts/tmux-harness.js
```

Do not proceed to the next batch until the current batch passes the full verification loop.
