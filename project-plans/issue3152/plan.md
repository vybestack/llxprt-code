# Issue #3152 — Remove the vestigial gemini-cli Declarative Agent Framework

Branch: `issue3152`. Base: `main` @ `f80a695f3`.

This is a pure deletion. No new behavior is added. The proof obligation is that
every symbol removed had no production consumer, and that every gate that
records the removed files is updated so nothing dangles.

## Preflight evidence (gathered before any edit)

### 1. Production constructors

```
$ grep -rn "AgentExecutor.create\|new SubagentInvocation" --include=*.ts packages/ \
    | grep -v "\.test\.ts" | grep -v "\.spec\.ts"
packages/agents/src/agents/invocation.ts:112:      const executor = await AgentExecutor.create(
```

`SubagentInvocation` has no constructor anywhere. The pair is closed.

### 2. `AgentExecutor` hits outside `packages/agents/src/agents/`

All five are `@a2a-js/sdk/server`'s own unrelated `AgentExecutor` interface:

```
packages/a2a-server/src/agent/executor.ts:10
packages/a2a-server/src/http/app.ts:11,98
packages/a2a-server/src/commands/types.ts:8,19
```

### 3. `SubagentInvocation` hits outside the framework

```
packages/core/src/policy/policies/read-only.toml:59:toolName = "SubagentInvocation"
packages/policy/src/policies/read-only.toml:59:toolName = "SubagentInvocation"
```

The two files are byte-identical (`diff` reports no differences). No tool is
ever registered under the name `SubagentInvocation` — the policy engine matches
on the tool name sent by the model, and a `BaseToolInvocation` subclass is not a
tool name. No test asserts on this rule. It is a dangling allowlist entry named
directly after the deleted class.

### 4. Imports of the framework's own modules from outside the framework

```
packages/agents/src/core/__tests__/toolSchema.characterization.test.ts:25
    import { buildCompleteTaskDeclaration } from '../../agents/executor-tool-dispatch.js';
packages/agents/src/internals.ts:67  export * from './agents/invocation.js';
packages/agents/src/internals.ts:68  export * from './agents/executor.js';
```

Nothing else. `recovery.ts`, `executor-prompt-builder.ts`,
`executor-stream-processor.ts`, `executor-termination.ts`,
`executor-validation.ts` and `executor-test-helpers.ts` have zero consumers
outside `packages/agents/src/agents/`.

### 5. `agents/types.ts` — RETAINED

```
packages/agents/src/core/subagent.runNonInteractive-execution.test.ts:37
    import type { FunctionDeclaration } from '../agents/types.js';
packages/agents/src/core/turn.undefined_issue.test.ts:4
    import type { FunctionCall } from '../agents/types.js';
packages/agents/src/internals.ts:66  export * from './agents/types.js';
```

Live consumers exist and it is on the published `./internals.js` surface. It
stays, unmodified, and `internals.ts` keeps re-exporting it.

Note: the `PromptConfig` / `ModelConfig` / `RunConfig` / `OutputObject` /
`templateString` uses found across `packages/agents/src/core/` resolve to
`@vybestack/llxprt-code-core/core/subagentTypes.js`, not to `agents/types.ts` or
`agents/utils.ts`. They are unaffected.

### 6. `agents/utils.ts` — DELETED

`templateString` there has exactly three importers, all being deleted:

```
packages/agents/src/agents/executor.ts:49
packages/agents/src/agents/executor-prompt-builder.ts:14
packages/agents/src/agents/__tests__/executorRun.characterization.test.ts:10
```

`agents/utils.ts` is NOT re-exported from `internals.ts`, so deleting it is not a
public-surface change. The live `templateString` used by
`subagentRuntimeSetup.ts` is the separate `packages/core/src/core/subagentTypes.ts`
implementation and is untouched.

### 7. `getCoreSystemPromptAsync` production call sites in `packages/agents` (5 → 4)

| # | file | production caller | fate |
| - | ---- | ----------------- | ---- |
| 1 | `src/core/ChatSessionFactory.ts:137` | main agent chat session | stays |
| 2 | `src/core/subagentRuntimeSetup.ts:839` | `task` tool → `SubAgentScope` | stays |
| 3 | `src/core/clientLlmUtilities.ts:73` | utility/JSON LLM path | stays |
| 4 | `src/compression/compressionSystemPrompt.ts:149` | compression strategies | stays |
| 5 | `src/agents/executor.ts:929` | **none** | **deleted** |

### 8. Public-surface impact

`packages/agents/src/index.ts` does NOT re-export `./internals.js` (the header
comment in `internals.ts` claiming otherwise is stale; #1595 already landed the
split). Confirmed by `grep -n internals packages/agents/src/index.ts` → no hits,
and by `expected-root-surface.json` containing none of the framework's symbols.

Therefore `scripts/check-agents-api-surface.ts` and
`packages/agents/src/api/__tests__/expected-root-surface.json` require **no**
change. The guard should stay green as-is; if it drifts, that is a signal, not a
snapshot to rubber-stamp.

The only surface change is the published `./internals.js` subpath, which loses
three names: `AgentExecutor`, `SubagentInvocation`, `ActivityCallback`.
Consumers of that subpath were audited:

```
packages/agents/src/api/__tests__/{boundary.spec.ts,boundary.adequacy.test.ts,
  nonBreaking.exports.test.ts,publicSurface.nonbreaking.test.ts,
  helpers/buildCliStyleConfig.ts}
packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.providerIgnoreCancel.bun.tsx
packages/cli/src/integration-tests/{todo-continuation.integration.test.ts,test-utils.ts}
scripts/tests/cli-import-boundary.test.ts
```

None reference the three removed names; the two surface tests assert only on
`AgentClient` and `PostTurnAction`.

### 9. Gates that record the deleted test files

- `packages/agents/tsconfig.json` `exclude[]` — 7 entries.
- `scripts/eslint-guard/test-exclusion-baseline.json` under
  `packages/agents/tsconfig.json` — the same 7 entries.
  `scanRepositoryTestExclusions` requires baseline config keys to match scanned
  configs exactly, and reports entries whose file no longer exists as stale
  (informational, nonblocking). Both files must drop the 7 entries together so
  the ratchet stays accurate.
- `dev-docs/agents-neutral-gate-baseline.md` — the per-site listing is labelled
  "frozen at P02" and is a historical snapshot, not a live allowlist. No script
  reads it. **Not modified.**
- `project-plans/issue3162-*.md` — another issue's plan doc. **Not modified.**

## Acceptance criteria

1. `AgentExecutor`, `SubagentInvocation` and their exclusive helpers no longer
   exist in the tree, together with their tests.
2. `internals.ts` no longer re-exports `./agents/invocation.js` or
   `./agents/executor.js`, and still re-exports `./agents/types.js`.
3. `agents/types.ts` is retained byte-for-byte and its two live test consumers
   still compile and pass.
4. `getCoreSystemPromptAsync` production call sites in `packages/agents` number
   4, each with the production caller named in table 7.
5. `scripts/check-agents-api-surface.ts` passes with the snapshot unchanged.
6. `packages/agents/tsconfig.json` and
   `scripts/eslint-guard/test-exclusion-baseline.json` no longer list the
   deleted test files.
7. Full verification is green: `npm run lint:ci`, `npm run lint:eslint-guard`,
   `npm run typecheck`, `npm run test`, `npm run format`, `npm run build`, plus
   the startup smoke test.

## Change list

### Delete — implementation

```
packages/agents/src/agents/executor.ts
packages/agents/src/agents/invocation.ts
packages/agents/src/agents/executor-prompt-builder.ts
packages/agents/src/agents/executor-stream-processor.ts
packages/agents/src/agents/executor-termination.ts
packages/agents/src/agents/executor-tool-dispatch.ts
packages/agents/src/agents/executor-validation.ts
packages/agents/src/agents/recovery.ts
packages/agents/src/agents/executor-test-helpers.ts
packages/agents/src/agents/utils.ts
```

### Delete — tests

```
packages/agents/src/agents/executor.test.ts
packages/agents/src/agents/executor.execution.test.ts
packages/agents/src/agents/executor.recovery.test.ts
packages/agents/src/agents/executor.termination-conditions.test.ts
packages/agents/src/agents/executor-termination.test.ts
packages/agents/src/agents/executor-stream-processor.test.ts
packages/agents/src/agents/executor.stream-idle-timeout.test.ts
packages/agents/src/agents/invocation.test.ts
packages/agents/src/agents/__tests__/executorRun.characterization.test.ts
```

`packages/agents/src/agents/__tests__/` becomes empty and is removed.

### Retain

```
packages/agents/src/agents/types.ts   (unmodified)
```

### Edit

- `packages/agents/src/internals.ts` — drop the two re-export lines. Keep
  `export * from './agents/types.js';`. Also correct the stale claim in the
  header block only if it names the removed modules; do not rewrite unrelated
  prose.
- `packages/agents/src/core/__tests__/toolSchema.characterization.test.ts` —
  remove the `buildCompleteTaskDeclaration` import and the
  `toolSchema characterization — executor` describe block (3 tests), and the
  matching bullet in the file's header comment. The remaining subagent and
  property-based blocks are untouched and still cover the lowercase-JSON-Schema
  characterization for the live path.
- `packages/agents/tsconfig.json` — remove the 7 `exclude` entries.
- `scripts/eslint-guard/test-exclusion-baseline.json` — remove the same 7
  entries under `packages/agents/tsconfig.json`.
- `packages/core/src/policy/policies/read-only.toml` and
  `packages/policy/src/policies/read-only.toml` — remove the
  `toolName = "SubagentInvocation"` rule block. The two files must remain
  byte-identical afterwards.

## Test strategy

No new tests. This is a deletion, and the behavior it proves is absence: the
package must still build, typecheck, lint and pass its entire suite with the
framework gone. The existing suites carry the evidence:

- `packages/agents/src/core/**` and `src/tools/**` — the live `SubAgentScope` /
  `TaskTool` path, unchanged and still green.
- `packages/agents/src/core/subagent.runNonInteractive-execution.test.ts` and
  `src/core/turn.undefined_issue.test.ts` — prove `agents/types.ts` survived and
  is still importable.
- `packages/agents/src/api/__tests__/nonBreaking.exports.test.ts` and
  `publicSurface.nonbreaking.test.ts` — prove the `./internals.js` subpath still
  resolves and still exports what it is contracted to export.
- `packages/agents` `pretest` → `scripts/check-agents-api-surface.ts` — proves
  the root barrel surface did not move.
- `npm run lint:eslint-guard` — proves the test-exclusion ratchet is consistent
  after the tsconfig and baseline edits.

## Deliberately out of scope

- Deleting `agents/types.ts` (has live consumers; issue says it stays).
- Touching `dev-docs/agents-neutral-gate-baseline.md` (frozen historical
  snapshot).
- Touching other issues' plan docs under `project-plans/`.
- Any change to the four surviving prompt assemblers.
