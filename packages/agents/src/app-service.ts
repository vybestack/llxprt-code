/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * PUBLIC app-service subpath (`@vybestack/llxprt-code-agents/app-service.js`).
 *
 * REQ-021 (runtime-vs-app-service boundary): durable/config/app concerns —
 * profile persistence, MCP server config, memory-file edits, skill/extension
 * config, settings mutation, diagnostics/about — are exposed here as a STABLE
 * PUBLIC subpath of concrete, behavior-real functions. They are standalone and
 * do NOT require a live `Agent` instance. The live `Agent` runtime facade stays
 * runtime-only; these durable ops are never crammed onto it.
 *
 * This singular barrel re-exports the implementation submodules under
 * `./app-services/` (kept small) plus the canonical `COMMAND_API_MAP`. The
 * SINGULAR public name (`app-service.js`) matches the pinned specifier asserted
 * by the P09 boundary harness.
 */

export * from './app-services/index.js';
