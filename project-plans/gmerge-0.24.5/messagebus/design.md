# MessageBus Dependency Injection Refactoring — Design Specification

## 1. Overview

Refactor MessageBus from a hybrid service-locator/constructor-injection pattern to pure constructor dependency injection (DI). This makes the dependency explicit, improves testability, and aligns with upstream gemini-cli's 3-phase MessageBus migration.

### Upstream Commits Being Reimplemented

| SHA | Phase | Subject |
|-----|-------|---------|
| `eec5d5ebf839` | Phase 1 | Restore MessageBus optionality — make it optional constructor param |
| `90be9c35876d` | Phase 2 | Standardize tool and agent invocation constructors |
| `12c7c9cc426b` | Phase 3 | Enforce mandatory MessageBus injection everywhere |

### Current State (LLxprt)

MessageBus usage in LLxprt is inconsistent:

1. **Service locator**: `config.getMessageBus()` — used in 7 call sites (coreToolScheduler, tool-registry, subagent)
2. **Constructor injection (optional)**: Many tools accept `messageBus?: MessageBus` in `createInvocation()`
3. **setMessageBus() shim**: ToolRegistry has a dead `setMessageBus()` no-op stub, and iterates tools calling `setMessageBus()` on any tool that has the method
4. **Config storage**: `Config` class stores MessageBus and provides `getMessageBus()` / `setMessageBus()`

**Scope**: 33 production files, 28 test files, ~206 references.

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

### Test Code (28 files)
All corresponding test files need MessageBus in test setup/mocks.

## 5. Risk Assessment

**Risk: LOW** — This is a mechanical signature refactoring. No behavior changes. No new logic.

- Pattern is well-understood (constructor DI is standard)
- Each phase is independently deployable (fallback in Phase 1-2)
- Upstream already did this exact migration — we can reference their diffs
- All existing tests verify behavior is preserved

## 6. Success Criteria

1. All `config.getMessageBus()` calls removed
2. All `setMessageBus()` methods removed
3. MessageBus is a required constructor parameter everywhere it's used
4. All existing tests pass without behavior changes
5. No MessageBus-related imports from Config in tool files
6. TypeScript compiles with strict mode
