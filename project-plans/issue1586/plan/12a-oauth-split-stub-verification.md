# Phase 12a: OAuth Split Stub Verification

Plan ID: PLAN-20260608-ISSUE1586.P12a

## Verification Tasks
- [ ] OAuthManager interface exported from packages/auth/src/precedence.ts
- [ ] OAuthTokenRequestMetadata exported from packages/auth
- [ ] OAuthProvider interface stays in packages/cli/src/auth/types.ts (consistent decision)
- [ ] CLI oauth-manager.ts type-checks against OAuthManager interface (compile-time)
- [ ] No auth package changes needed for CLI adapter registration
- [ ] No runtime instanceof checks for type-only OAuthManager interface