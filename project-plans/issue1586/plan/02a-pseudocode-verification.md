# Phase 02a: Pseudocode Verification

Plan ID: PLAN-20260608-ISSUE1586.P02a

## Verification Tasks

1. Check all pseudocode files have numbered lines.
2. Verify each DI interface covers all methods used by auth code (compare with dependency-audit.md).
3. Verify each component refactoring pseudocode references DI interface injection points.
4. Verify consumer migration pseudocode covers all CLI auth files that import from core.
5. Verify OAuth split pseudocode is consistent with integration-contract.md IC-05.
6. Verify no pseudocode contains actual TypeScript implementation.
7. Verify OAuthProvider ownership decision is stated and consistent (stays in CLI).
8. Verify CLI auth scope is justified against issue #1586.
9. Verify packages/storage absence is documented.
10. Verify providers import migration pseudocode exists (C-CM-08).
11. Verify consumer migration sections are sequentially numbered (C-CM-01 through C-CM-10) with no duplicate package dependency blocks.

## Anti-Pattern Checks
- [ ] No hard-coded provider names in AuthPrecedenceResolver pseudocode
- [ ] No core imports in auth package pseudocode
- [ ] Every DI-injected dependency is explicitly listed in constructor pseudocode
- [ ] OAuthProvider NOT in auth package pseudocode (stays in CLI)
- [ ] ISecureStore and IProviderKeyStorage marked as interim (packages/storage absent)
- [ ] ISecureStore includes all 5 methods (get, set, delete, list, has) in pseudocode
- [ ] ISecureStoreError includes code (SecureStoreErrorCode), message, remediation in pseudocode
- [ ] SecureStoreErrorCode union type defined in pseudocode
- [ ] precedence.ts pseudocode shows core import refactoring: SettingsService→ISettingsService, ProviderRuntimeContext→IProviderRuntimeContext, debugLogger→injected IDebugLogger boundary