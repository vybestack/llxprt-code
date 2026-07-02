# A2A Exception Records — Retained Internals Subpath Usage

@plan:PLAN-20260629-ISSUE2285.P04
@requirement:REQ-004

## Status: NO EXCEPTIONS

All A2A production consumers have been migrated to public factories or
core-root contract types. No A2A production file retains an internals
subpath import.

## Migration Summary

| File | Symbol | Migration Target | Exception? |
|------|--------|-----------------|------------|
| `packages/a2a-server/src/config/config.ts` | `AgentClient` (value) | `createAgentClient` (public factory from agents root) | NO |
| `packages/a2a-server/src/config/config.ts` | `CoreToolScheduler` (value) | `createToolScheduler` (public factory from agents root) | NO |
| `packages/a2a-server/src/config/config.ts` | `createTaskToolRegistration` | KEPT from agents root (curated compatibility export — decision per preflight P01 Gate 1) | NO (curated) |
| `packages/a2a-server/src/agent/task.ts` | `AgentClient` (value, constructed) | `createAgentClient` (public factory from agents root) | NO |
| `packages/a2a-server/src/agent/task.ts` | `AgentClient` (field type) | `AgentClientContract` (from core root `@vybestack/llxprt-code-core`) | NO |
| `packages/a2a-server/src/agent/task-runtime-helpers.ts` | `AgentClient` (type) | `AgentClientContract` (from core root `@vybestack/llxprt-code-core`) | NO |
| `packages/a2a-server/src/utils/testing_utils.ts` | `CoreToolScheduler` (type) | `ToolSchedulerContract` (from core root `@vybestack/llxprt-code-core`) | NO |

## Conclusion

No per-use exception records are required. Every A2A production symbol that
previously imported an internals-only name from the agents root now resolves
via a public factory (`createAgentClient`, `createToolScheduler`) or a
core-root contract type (`AgentClientContract`, `ToolSchedulerContract`).
The curated `createTaskToolRegistration` remains a sanctioned root export
(per P01 Gate 1 decision).
