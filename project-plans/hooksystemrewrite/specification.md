# Feature Specification: Hook System Rewrite

## Purpose
Deliver a complete hook rewrite plan that restores upstream-equivalent blocking/modification capabilities in tool and model pipelines while preserving compatibility and fail-open resilience behavior.

## Canonical Requirements Source
- project-plans/hooksystemrewrite/requirements.md
- Total HOOK headings parsed: 219
- Effective requirement count per appendix: 218 (merged/retired handled via canonical targets)

## Architectural Decisions
- Shared HookSystem lifecycle owned by Config.
- HookEventHandler orchestrates planner/runner/aggregator/translator components.
- Trigger functions return typed results and are awaited by callers.
- Caller boundaries apply policy decisions, request/response modifications, and stop semantics explicitly.
- Out-of-scope events continue to fire without caller-side output application.

## Scope Boundaries
- In-scope caller-applied events: BeforeTool, AfterTool, BeforeModel, AfterModel, BeforeToolSelection.
- Out-of-scope but still firing (non-regression): SessionStart, SessionEnd, Notification, PreCompress, BeforeAgent, AfterAgent.

## Key Correctness Invariants
- Use top-level enableHooks config key; do not rely on tools.enableHooks.
- AggregatedHookResult.success must not be used as policy-block signal.
- Unified shouldStop/stopReason semantics must be explicit where continue=false behavior applies.
- BeforeToolSelection restrictions operate via toolConfig; tools list definitions remain present.

## Required Artifacts
- specification.md (this file)
- analysis/domain-model.md
- analysis/pseudocode/*.md (numbered, contract-first)
- plan/00..18 phase files and paired verification files
- plan/requirements-coverage-matrix.md
- execution-tracker.md
- .completed/P*.md completion markers

## Section Coverage Summary
| Section | Title | Active HOOK Count | Active Range |
|---|---|---:|---|
| 1 | Initialization & Lifecycle | 9 | HOOK-001..HOOK-009 |
| 2 | Zero Overhead When Disabled | 4 | HOOK-010..HOOK-013 |
| 3 | BeforeTool Hook Event | 12 | HOOK-014..HOOK-024 |
| 4 | AfterTool Hook Event | 8 | HOOK-025..HOOK-032 |
| 5 | BeforeModel Hook Event | 10 | HOOK-033..HOOK-042 |
| 6 | AfterModel Hook Event | 10 | HOOK-043..HOOK-052 |
| 7 | BeforeToolSelection Hook Event | 8 | HOOK-053..HOOK-060 |
| 8 | Communication Protocol | 11 | HOOK-061..HOOK-070 |
| 9 | Stable Hook API Data Formats | 4 | HOOK-071..HOOK-074 |
| 10 | Data Translation | 5 | HOOK-075..HOOK-079 |
| 11 | Configuration | 7 | HOOK-080..HOOK-086 |
| 12 | Matcher & Deduplication | 5 | HOOK-087..HOOK-091 |
| 13 | Composition & Aggregation — OR-Decision Merge (Tool Events) | 6 | HOOK-092..HOOK-097 |
| 14 | Composition & Aggregation — Field-Replacement Merge (Model Events) | 1 | HOOK-098..HOOK-098 |
| 15 | Composition & Aggregation — Union Merge (Tool Selection) | 4 | HOOK-099..HOOK-102 |
| 16 | Sequential Chaining | 7 | HOOK-103..HOOK-109 |
| 17 | Error Handling & Resilience | 7 | HOOK-110..HOOK-116 |
| 18 | Timeout Enforcement | 4 | HOOK-117..HOOK-120 |
| 20 | Mode Independence | 1 | HOOK-125..HOOK-125 |
| 21 | Caller Integration — Tool Pipeline | 8 | HOOK-127..HOOK-134 |
| 22 | Caller Integration — Model Pipeline | 7 | HOOK-135..HOOK-141 |
| 23 | New Components | 8 | HOOK-142..HOOK-149 |
| 24 | Trigger Function Contracts | 5 | HOOK-150..HOOK-154 |
| 25 | Existing Hook Scripts — Backward Compatibility | 2 | HOOK-155..HOOK-156 |
| 26 | Output Field Contracts | 4 | HOOK-157..HOOK-160 |
| 27 | Transcript Path | 1 | HOOK-161..HOOK-161 |
| 28 | HookEventHandler Internal Flow | 5 | HOOK-162..HOOK-166 |
| 29 | Tool Selection — applyToolConfigModifications | 2 | HOOK-167..HOOK-168 |
| 30 | BeforeToolHookOutput Compatibility | 3 | HOOK-169..HOOK-171 |
| 31 | Streaming Constraints | 3 | HOOK-172..HOOK-174 |
| 32 | File Manifest & Module Exports | 2 | HOOK-175..HOOK-176 |
| 33 | Decision Summary Matrix | 5 | HOOK-177..HOOK-181 |
| 34 | New Requirements — Completeness Gaps (R1) | 14 | HOOK-182..HOOK-198 |
| 36 | Additional Completeness Requirements (R2) | 10 | HOOK-199..HOOK-208 |
| 38 | Additional Completeness Requirements (R3) | 6 | HOOK-209..HOOK-214 |
| 39 | Additional Completeness Requirements (R4) | 3 | HOOK-215..HOOK-217 |
