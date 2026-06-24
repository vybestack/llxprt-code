/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P09
 * @requirement:REQ-021
 *
 * Slash-command to API surface map (REQ-021 / §4.7 runtime-vs-app-service
 * boundary). Every CLI touchpoint is assigned exactly one kind:
 *   - runtime    -> a live Agent method path (affects the active conversation/turn)
 *   - subpath    -> a durable app-service concern exposed as a public subpath
 *   - cli-local  -> pure UI/UX with no core dependency
 *
 * P27 update: the canonical map now lives in PRODUCTION
 * (`packages/agents/src/app-services/command-api-map.ts`) and is exposed via the
 * SINGULAR public subpath `@vybestack/llxprt-code-agents/app-service.js`. This
 * harness module re-exports `COMMAND_API_MAP` / `CommandApiMapping` /
 * `CommandApiKind` / `APP_SERVICE_SUBPATH` from that public subpath instead of
 * duplicating them, so there is no drift and the T23/T24 boundary assertions in
 * `app-service-boundary.spec.ts` exercise the real public map and resolve the
 * pinned specifier to the concrete behavior-real functions.
 */

export {
  COMMAND_API_MAP,
  APP_SERVICE_SUBPATH,
} from '@vybestack/llxprt-code-agents/app-service.js';
export type {
  CommandApiKind,
  CommandApiMapping,
} from '@vybestack/llxprt-code-agents/app-service.js';
