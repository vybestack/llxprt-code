# Phase 02: Contract-First Pseudocode

Plan ID: PLAN-20260608-ISSUE1586.P02

## Prerequisites
- Required: Phase 01 completed and verified
- Verification: `test -f project-plans/issue1586/analysis/dependency-audit.md`

## Phase Tasks

1. Create numbered pseudocode for each DI interface:
   - ISecureStore (C-CB-01)
   - ISettingsService (C-CB-02)
   - IProviderKeyStorage (C-CB-03)
   - IDebugLogger (C-CB-04)
   - IProviderRuntimeContext (C-CB-05)

2. Create numbered pseudocode for each refactored component:
   - AuthPrecedenceResolver DI refactoring (C-CB-06)
   - KeyringTokenStore DI refactoring (C-CB-07)
   - CodexDeviceFlow DI refactoring (C-CB-08)
   - Core DI factory functions (C-CB-09)
   - Provider adapter registration (C-CB-10)
   - Proxy auth infrastructure split (C-CB-11)

3. Create consumer migration pseudocode (C-CM-01 through C-CM-10, sequentially numbered):
   - Core index.ts re-export updates (C-CM-01)
   - CLI types.ts migration (C-CM-02)
   - CLI oauth-manager import update (C-CM-03)
   - CLI provider adapter updates (C-CM-04)
   - CLI proxy import updates (C-CM-05)
   - Core auth subpath exports update (C-CM-06)
   - Package dependency additions (C-CM-07)
   - Providers auth import migration (C-CM-08)
   - Core non-auth file auth import migration (C-CM-09)
   - Core package subpath export cleanup (C-CM-10)

4. Create OAuth domain split pseudocode (auth-domain-split.md), including:
   - OAuthProvider ownership decision (stays in CLI)
   - Justification of CLI auth scope vs issue #1586

## Output Artifacts
- `analysis/pseudocode/component-boundaries.md` (verify and update)
- `analysis/pseudocode/consumer-migration.md` (verify and update)
- `analysis/pseudocode/auth-domain-split.md` (verify and update)

## Success Criteria
- Every pseudocode line is numbered
- Every DI interface method is specified
- Every consumer migration path is documented
- OAuthProvider ownership consistently stated (stays in CLI)
- CLI auth scope justified against issue #1586
- packages/storage absence and interim DI design documented
- Providers import migration included (C-CM-08)
- No actual TypeScript implementation code