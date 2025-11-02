# Phase P08: Unit Implementation – SubAgentScope

## Phase ID
`PLAN-20251028-STATELESS6.P08`

## Prerequisites
- P07/P07a completed

## Objectives
- Satisfy unit tests by refactoring SubAgentScope to consume `AgentRuntimeContext` and eliminate Config mutation.

## Tasks
1. Update SubAgentScope constructor/factory per pseudocode steps 007.1–007.8.
2. Remove `this.runtimeContext.setModel(...)` and related Config mutations.
3. Instantiate runtime view via scaffolded builder from P06.
4. Ensure existing public API remains stable (factory signature adjustments documented).
5. Update exports and type definitions as needed.

## Completion Criteria
- Unit tests from P07 pass.
- Code annotated with `@plan PLAN-20251028-STATELESS6.P08` and requirement IDs.
- Ready for verification in P08a.
