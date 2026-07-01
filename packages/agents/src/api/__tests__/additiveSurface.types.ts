/**
 * @plan:PLAN-20260622-COREAPIGAP.P18
 * @requirement:REQ-009
 *
 * Compile-only type anchors for the additive-surface regression fence.
 *
 * WHY THIS FILE EXISTS (and is NOT a ".test.ts"):
 * The workspace tsconfig (packages/agents/tsconfig.json) `exclude` drops every
 * "**\/*.test.ts" and "**\/*.spec.ts" file, so `tsc --noEmit` (npm run
 * typecheck) NEVER compiles them. Compile anchors placed in a ".test.ts" file
 * are therefore VACUOUS — a removed/renamed projected type or a changed
 * sub-controller signature would slip through typecheck silently (and vitest
 * strips types at runtime). To make the compile-time half of the fence
 * LOAD-BEARING, the anchors live here with a ".types.ts" suffix (no ".test"/
 * ".spec" infix) so the workspace tsconfig DOES compile them. This file is:
 *   - typecheck-VISIBLE  (tsconfig.json excludes only *.test.ts / *.spec.ts),
 *   - build-EXCLUDED     (tsconfig.build.json excludes src/**\/__tests__/**),
 *   - vitest-IGNORED     (the default matcher targets *.test. / *.spec. files).
 * The sibling publicSurface.nonbreaking.test.ts holds all RUNTIME assertions.
 * This mirrors the established contractPromotion.types.ts precedent.
 *
 * Each anchor below binds a function that reads a REAL required field of a
 * projected public type, or pins the EXISTING signature of an extended-AROUND
 * sub-controller method. Removing/renaming the type, dropping the field, or
 * changing a prior member's signature breaks `npm run typecheck` — that is the
 * regression the additive-only contract (REQ-009) forbids.
 *
 * Anchors are `void`-consumed so noUnusedLocals (root tsconfig) does not raise
 * TS6196; they never execute (compile-only). Types are imported via a top-level
 * `import type` (not inline `import()` annotations) to satisfy the
 * @typescript-eslint/consistent-type-imports lint rule.
 */

import type {
  Agent,
  AgentTaskInfo,
  AuthProviderDetail,
  CompressionResult,
  HookInfo,
  McpDetailStatus,
  PolicyRuleView,
  ToolKeyStatus,
} from '@vybestack/llxprt-code-agents';

// --- Compile anchors for new projected types (load-bearing under typecheck) ---

// AgentTaskInfo anchor — keep the EXACT textual form
//   `(x: _TaskInfoShape) => string = (x) => x.id`
// so the P18a perl mutation probe
//   s/(_TaskInfoShape\) => string = \(x\) => x\.)id/.../
// matches and can prove this anchor is load-bearing. DO NOT reformat this line.
type _TaskInfoShape = AgentTaskInfo;
const _taskInfoAnchor: (x: _TaskInfoShape) => string = (x) => x.id;
void _taskInfoAnchor;

type _PolicyRuleViewShape = PolicyRuleView;
const _policyRuleViewAnchor: (x: _PolicyRuleViewShape) => string = (x) =>
  x.decision;
void _policyRuleViewAnchor;

type _ToolKeyStatusShape = ToolKeyStatus;
const _toolKeyStatusAnchor: (x: _ToolKeyStatusShape) => string = (x) =>
  x.toolName;
void _toolKeyStatusAnchor;

type _HookInfoShape = HookInfo;
const _hookInfoAnchor: (x: _HookInfoShape) => string = (x) => x.name;
void _hookInfoAnchor;

type _AuthProviderDetailShape = AuthProviderDetail;
const _authProviderDetailAnchor: (x: _AuthProviderDetailShape) => string = (
  x,
) => x.provider;
void _authProviderDetailAnchor;

type _McpDetailStatusShape = McpDetailStatus;
const _mcpDetailStatusAnchor: (
  x: _McpDetailStatusShape,
) => readonly unknown[] = (x) => x.servers;
void _mcpDetailStatusAnchor;

// --- Extended-controller signature anchors (compile-only) ---
// Pin the EXISTING signatures of methods that were extended-AROUND (not
// changed). Any accidental change to a prior member's signature fails
// typecheck.
type _AgentShape = Agent;
const _mcpRefreshShape: _AgentShape['mcp']['refresh'] = async (
  _server?: string,
) => {};
void _mcpRefreshShape;
const _hooksClearShape: _AgentShape['hooks']['clear'] = () => {};
void _hooksClearShape;

// --- MCP OAuth quad-state anchors (PLAN-20260622-MCPOAUTHTRUTH.P07 / REQ-004) ---
// These fence the additive OAuth projection landed in P06. Removing a projected
// field, or dropping a union member, breaks `npm run typecheck`.
// @plan:PLAN-20260622-MCPOAUTHTRUTH.P07 @requirement:REQ-004
import type {
  McpOAuthStatus,
  McpServerAuthStatus,
  McpServerDetail,
} from '@vybestack/llxprt-code-agents';

// McpOAuthStatus must remain a 4-member union (additive quad-state).
// This array anchor catches member REMOVAL: a dropped member is no longer
// assignable to the narrowed union, breaking `npm run typecheck`.
const _mcpOAuthStatusAnchor: McpOAuthStatus[] = [
  'authenticated',
  'expired',
  'none',
  'not-required',
];
void _mcpOAuthStatusAnchor;

// Exhaustiveness helper: only `never` satisfies the `extends never` constraint.
type _AssertNever<T extends never> = T;

// Complementary anchor that catches union GROWTH (the array anchor above only
// catches removal): while McpOAuthStatus is EXACTLY the 4-member quad-state,
// `Exclude<...>` resolves to `never` and satisfies `_AssertNever`. Adding a 5th
// member makes `Exclude<...>` resolve to that member, which fails
// `extends never` => `npm run typecheck` error. `export type` keeps it
// noUnusedLocals-safe (root tsconfig) without a runtime binding.
export type _McpOAuthStatusExhaustive = _AssertNever<
  Exclude<McpOAuthStatus, 'authenticated' | 'expired' | 'none' | 'not-required'>
>;

// New fields must exist on both projected shapes (removal => compile error).
const _mcpAuthShapeAnchor: Pick<
  McpServerAuthStatus,
  'oauthStatus' | 'sessionAuthenticated' | 'authenticated' | 'requiresAuth'
> = {
  oauthStatus: 'authenticated',
  sessionAuthenticated: false,
  authenticated: true,
  requiresAuth: true,
};
void _mcpAuthShapeAnchor;

const _mcpDetailShapeAnchor: Pick<
  McpServerDetail,
  'oauthStatus' | 'sessionAuthenticated' | 'requiresAuth'
> = {
  oauthStatus: 'not-required',
  sessionAuthenticated: false,
  requiresAuth: false,
};
void _mcpDetailShapeAnchor;

// --- CompressionResult root type identity anchor (P05 backwards compat) ---
// The root barrel (@vybestack/llxprt-code-agents) MUST export the CORE
// CompressionResult (from @vybestack/llxprt-code-core/core/compression/types.js)
// for backwards compatibility with main — NOT the API agent.ts shape. This
// compile-only anchor proves the root CompressionResult has the CORE fields
// `newHistory` and `metadata`. If the explicit re-export in index.ts is
// removed (causing root CompressionResult to fall back to the agent.ts shape
// which has `status`/`originalTokenCount`/etc.), this anchor fails typecheck
// because those fields do not exist on the core type.
type _RootCompressionResultShape = CompressionResult;
const _compressionResultNewHistoryAnchor: (
  x: _RootCompressionResultShape,
) => readonly unknown[] = (x) => x.newHistory;
void _compressionResultNewHistoryAnchor;
const _compressionResultMetadataAnchor: (
  x: _RootCompressionResultShape,
) => unknown = (x) => x.metadata;
void _compressionResultMetadataAnchor;
