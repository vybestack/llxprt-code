/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI-owned command-API boundary extensions (issue #3167 / P13).
 *
 * The canonical {@link COMMAND_API_MAP} in `@vybestack/llxprt-code-agents`
 * classifies every touchpoint that has an agents/core runtime or durable
 * app-service surface. Some commands live ENTIRELY in the CLI package and have
 * no agents or core runtime dependency — they are pure CLI-local telemetry/UI
 * operations. Those are classified here rather than in the agents map so the
 * agents package stays agent-neutral.
 *
 * The completeness test combines this array with the agents COMMAND_API_MAP to
 * validate a single unified boundary map with uniqueness and orphan checks.
 */

/**
 * CLI-local command-API entries for commands that have no agents/core surface.
 * These are `cli-local`: pure UI/telemetry operations with no live Agent method
 * and no durable app-service function.
 *
 * `/perf` and its subcommands read/write telemetry data files and display live
 * process snapshots. They never invoke an Agent method or mutate durable
 * app-service state, so they are CLI-local — not runtime, not subpath.
 */
export const CLI_COMMAND_API_EXTENSIONS = [
  {
    command: '/perf',
    kind: 'cli-local',
    target: 'perf snapshot (UI)',
    note: 'Live process perf snapshot; CLI-local telemetry display',
  },
  {
    command: '/perf inspect',
    kind: 'cli-local',
    target: 'perf inspect (UI)',
    note: 'Perf data location and sample counts; CLI-local telemetry file read',
  },
  {
    command: '/perf report',
    kind: 'cli-local',
    target: 'perf report (UI)',
    note: 'Longitudinal perf trends; CLI-local telemetry file read',
  },
  {
    command: '/perf delete',
    kind: 'cli-local',
    target: 'perf delete (UI)',
    note: 'Delete perf data files; CLI-local telemetry file operation',
  },
] as const;
