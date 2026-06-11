# Phase 02c: Integration Contract Verification

Plan ID: PLAN-20260608-ISSUE1586.P02c

## Verification Tasks

1. Verify each IC specifies dependency direction matching final-architecture.md.
2. Verify no IC allows auth→core dependency.
3. Verify each IC verification command is a concrete, fail-safe shell command (with `set -euo pipefail` where appropriate, not runtime type tests for type-only interfaces).
4. Verify BVE items cover: auth precedence, token store, OAuth flow, proxy, smoke test.
5. Verify IC-05 (OAuth split) is consistent with auth-domain-split.md pseudocode.
6. Verify IC-06 (proxy split) matches move map classification.
7. Verify IC-09 (providers import migration) exists and covers providers files.
8. Verify OAuthProvider ownership decision is consistent across all ICs (stays in CLI).
9. Verify packages/storage absence is documented.
10. Verify verification commands use compile-time type tests, not runtime instanceof for type-only interfaces.

## Cross-Reference Checks
- [ ] REQ-AUTH-001 covered by IC-01 through IC-06
- [ ] REQ-DEP-001 covered by IC-01, IC-02, IC-07
- [ ] REQ-INTF-001 covered by IC-01
- [ ] REQ-OAUTH-001 covered by IC-05
- [ ] REQ-PROXY-001 covered by IC-06
- [ ] REQ-CLEAN-001 covered by IC-08
- [ ] REQ-DEP-001.6 (providers→auth) covered by IC-09
- [ ] REQ-API-001.2 covered by IC-02, IC-09