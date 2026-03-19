# MessageBus Dependency Injection Refactoring — Design Specification

## 1. Overview

Refactor MessageBus from a hybrid service-locator/constructor-injection pattern to pure constructor dependency injection (DI). This makes the dependency explicit, improves testability, and aligns with upstream gemini-cli's 3-phase MessageBus migration.

### Upstream Commits Being Reimplemented

| SHA | Phase | Subject | Files Changed |
|-----|-------|---------|---------------|
| `eec5d5ebf839` | Phase 1 | Restore MessageBus optionality — make it optional constructor param | 16 files changed, 105 insertions(+), 82 deletions(-) |
| `90be9c35876d` | Phase 2 | Standardize tool and agent invocation constructors | 23 files changed, 140 insertions(+), 44 deletions(-) |
| `12c7c9cc426b` | Phase 3 | Enforce mandatory MessageBus injection everywhere | 57 files changed, 440 insertions(+), 276 deletions(-) |

**Verified upstream stats** (via `git show --stat <SHA>`):
- Total upstream changes: 96 files, 685 insertions, 402 deletions
- Upstream includes `smart-edit.ts` which LLxprt removed
- LLxprt has `ripGrep.ts` as primary grep tool (upstream uses `grep.ts`)
- LLxprt has additional tools (ast-grep, structural-analysis, etc.) not in upstream

**LLxprt-Specific Considerations**:
- Skip `smart-edit.ts` (removed from LLxprt)
- Apply pattern to `ripGrep.ts` (LLxprt's grep implementation)
- Include LLxprt-only tools: ast-grep, structural-analysis, delete-line-range, insert-at-line, read-line-range, apply-patch, code-search, direct-web-fetch, todo-write/read/pause, check-async-tasks, activate-skill
- Subagent and agent invocation patterns match upstream

### Current State (LLxprt)

MessageBus usage in LLxprt is inconsistent:

1. **Service locator**: `config.getMessageBus()` — used in 7 call sites (coreToolScheduler, tool-registry, subagent)
2. **Constructor injection (optional)**: Many tools accept `messageBus?: MessageBus` in `createInvocation()`
3. **setMessageBus() shim**: ToolRegistry has a dead `setMessageBus()` no-op stub, and iterates tools calling `setMessageBus()` on any tool that has the method
4. **Config storage**: `Config` class stores MessageBus and provides `getMessageBus()` / `setMessageBus()`

**Scope**: 33 production files, 24 test files, 717 total references (verified via grep).

**Verification** (as of plan creation):
```bash
# Production files referencing MessageBus (33 files)
grep -rln "messageBus\|MessageBus\|getMessageBus\|setMessageBus" packages/core/src/ --include="*.ts" | grep -v test | grep -v ".d.ts" | wc -l
# Result: 33

# Test files referencing MessageBus (24 files)
grep -rln "messageBus\|MessageBus\|getMessageBus\|setMessageBus" packages/core/src/ --include="*.ts" | grep test | wc -l
# Result: 24

# Total line references (717 lines)
grep -rn "messageBus\|MessageBus\|getMessageBus\|setMessageBus" packages/core/src/ --include="*.ts" | wc -l
# Result: 717
```

**Current service locator usage**:
- `config.getMessageBus()`: 5 production call sites (coreToolScheduler, subagent, tool-registry)
- `setMessageBus()` shim: 1 location (ToolRegistry) — dead code calling it on tools
- `Config` storage: 1 `getMessageBus()` method implementation

### Target State

1. **Pure constructor injection**: All tools, invocations, and agents receive `MessageBus` as a required constructor parameter
2. **No service locator**: Remove `config.getMessageBus()` and `config.setMessageBus()` — MessageBus is not a Config concern
3. **No setMessageBus() shim**: Remove from ToolRegistry and DeclarativeTool
4. **MessageBus flows down**: Created at CLI/session level, passed to ToolRegistry → tools → invocations

## 2. Architecture

### Injection Flow

```
CLI Session
  └── creates MessageBus
  └── passes to CoreToolScheduler(config, messageBus)
       └── passes to ToolRegistry(config, messageBus)
            └── passes to tool.createInvocation(params, messageBus)
                 └── ToolInvocation stores this.messageBus
  └── passes to AgentExecutor(config, messageBus)
       └── passes to SubagentInvocation(definition, config, messageBus)
```

### Key Changes

#### Config class (`packages/core/src/config/config.ts`)
- Remove `getMessageBus()` method
- Remove `setMessageBus()` method
- Remove MessageBus storage field
- MessageBus is NOT a configuration concern — it's a runtime dependency

#### ToolRegistry (`packages/core/src/tools/tool-registry.ts`)
- Add `messageBus: MessageBus` as required constructor parameter
- Remove `setMessageBus()` method and the iteration loop that calls it on tools
- Pass messageBus to `createInvocation()` calls

#### DeclarativeTool base class (`packages/core/src/tools/tools.ts`)
- Make `messageBus` a required parameter in `createInvocation()`
- Remove any `setMessageBus()` method
- Store on the invocation instance, not the tool definition

#### CoreToolScheduler (`packages/core/src/core/coreToolScheduler.ts`)
- Add `messageBus: MessageBus` as constructor parameter (alongside config)
- Replace all `this.config.getMessageBus()` calls with `this.messageBus`

#### Agent Invocations
- SubagentInvocation: add `messageBus: MessageBus` constructor parameter
- AgentExecutor: pass messageBus through
- DelegateToAgentTool: pass messageBus to agent invocations

## 3. Migration Strategy

This is a **3-phase mechanical refactoring** matching upstream's approach:

### Phase 1: Make MessageBus an explicit optional parameter
- Add `messageBus?: MessageBus` to constructors that currently use `config.getMessageBus()`
- Fall back to `config.getMessageBus()` if not provided (backward compatible)
- Tests updated to pass MessageBus explicitly

### Phase 2: Standardize constructor signatures
- All `createInvocation()` methods accept MessageBus
- All agent constructors accept MessageBus
- Wire MessageBus through ToolRegistry → tools → invocations

### Phase 3: Make MessageBus mandatory, remove fallbacks
- Change `messageBus?: MessageBus` to `messageBus: MessageBus` everywhere
- Remove `config.getMessageBus()` and `config.setMessageBus()`
- Remove `setMessageBus()` shim from ToolRegistry
- Remove MessageBus from Config class entirely

### What Does NOT Change

- MessageBus interface itself (no API changes)
- MessageBus creation point (still created by CLI/session)
- Message types and payloads
- Confirmation flow behavior
- Subscription/publish semantics

## 4. Affected Files

### Production Code (33 files)

**Config removal** (1 file):
- `packages/core/src/config/config.ts` — remove getMessageBus/setMessageBus

**Core** (3 files):
- `packages/core/src/core/coreToolScheduler.ts` — constructor param, replace config.getMessageBus()
- `packages/core/src/core/coreToolHookTriggers.ts` — if uses MessageBus
- `packages/core/src/core/subagent.ts` — replace config.getMessageBus()

**Tools** (~20 files):
- `tool-registry.ts`, `tools.ts` (base class)
- Every tool with `createInvocation()`: edit, glob, grep, ls, read-file, read-many-files, write-file, shell, web-fetch, web-search, mcp-tool, apply-patch, ripGrep, memory-tool, write-todos, get-internal-docs, activate-skill, google-web-search-invocation

**Agents** (~5 files):
- `delegate-to-agent-tool.ts`, `subagent-tool-wrapper.ts`
- `local-invocation.ts`, `local-executor.ts`
- `introspection-agent.ts`

**Other** (~4 files):
- `hooks/hookEventHandler.ts`
- `cli/src/ui/hooks/atCommandProcessor.ts`
- `cli/src/zed-integration/zedIntegration.ts`
- `packages/core/src/index.ts` (export cleanup)

### Test Code (24 files)
All corresponding test files need MessageBus in test setup/mocks.

## 5. Risk Assessment

**Risk: MODERATE implementation risk, LOW behavioral-change risk**

**Why Moderate Implementation Risk**:
- High blast radius: 57 files changed in total (Phase 1: 16, Phase 2: 23, Phase 3: 57)
- 717 total line references to MessageBus across codebase
- Mechanical changes but requires careful tracking across many files
- TypeScript signature changes can cascade to tests and mocks

**Why Low Behavioral-Change Risk**:
- Pure structural refactoring — no MessageBus API changes
- No new features or logic added
- Upstream completed identical migration successfully (commits eec5d5ebf839, 90be9c35876d, 12c7c9cc426b)
- Each phase is backward-compatible until Phase 3
- All existing tests verify behavior is preserved

**Mitigation Strategy**:
1. Follow upstream diffs exactly (adapt for LLxprt structure)
2. Maintain backward compatibility through Phase 1-2 (optional params with fallback)
3. Run full test suite after each phase
4. Use git to review changes file-by-file
5. Verify zero `config.getMessageBus()` references before completing Phase 3

## 6. Success Criteria

1. All `config.getMessageBus()` calls removed
2. All `setMessageBus()` methods removed
3. MessageBus is a required constructor parameter everywhere it's used
4. All existing tests pass without behavior changes
5. No MessageBus-related imports from Config in tool files
6. TypeScript compiles with strict mode
