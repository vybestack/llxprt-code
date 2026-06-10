# Phase 15a: Consumer Migration Scaffolding Verification

Plan ID: PLAN-20260608-ISSUE1586.P15a

> **Phase framing:** This verification covers the P15 consumer migration scaffolding phase. P15 creates the auth-factories.ts type-import stub and updates all consumer imports. P17 implements the actual factory function bodies. P18 removes the `core/src/auth/` directory.

## Verification Tasks
- [ ] Core index.ts re-exports auth from @vybestack/llxprt-code-auth
- [ ] Core auth-factories.ts type-import stub exists (actual factory implementations deferred to P17; P15 stub has only `import type` declarations and throwing/empty function signatures)
- [ ] Core auth subpath exports removed from package.json (`./auth/precedence.js`, `./auth/types.js`) — verified by Node.js check that exits only when exports remain
- [ ] CLI types.ts re-exports auth types from auth package (not core); OAuthProvider stays in CLI
- [ ] CLI oauth-manager imports token types from auth package
- [ ] CLI oauth-provider-base imports OAuthError from auth package
- [ ] CLI proxy files import ProxyTokenStore/ProxySocketClient from auth package
- [ ] Providers BaseProvider imports AuthPrecedenceResolver from auth package
- [ ] All providers auth imports migrated from core/auth to auth package
- [ ] typecheck passes for core, CLI, and providers