# Phase 17a: Consumer Migration Implementation Verification

Plan ID: PLAN-20260608-ISSUE1586.P17a

> **Phase framing:** This verification covers P17 (factory function implementations + final consumer wiring). P15 created the type-import stub and rewrote imports; P17 implements the actual factory function bodies.

## Verification Tasks
- [ ] `packages/core/src/auth-factories.ts` exists with full implementations (not just type-import stub)
- [ ] `createKeyringTokenStore()` returns a KeyringTokenStore that can save/load tokens
- [ ] `createAuthPrecedenceResolver()` returns an AuthPrecedenceResolver with injected deps
- [ ] Factory functions exported from `packages/core/src/index.ts`
- [ ] No CLI auth imports from core for auth types
- [ ] No providers imports from core/auth
- [ ] No core auth path imports anywhere (repo-wide)
- [ ] All integration tests pass
- [ ] All consumer auth imports migrated from core to auth package
- [ ] No CLI auth file imports auth types from core
- [ ] No providers file imports auth types from core/auth
- [ ] Core re-exports auth from auth package
- [ ] All test suites pass for auth, core, CLI
- [ ] No TODO/FIXME in implementation

## TDD Pass/Fail Verification
- [ ] ALL integration tests pass

## Final Consumer Import Scan (using Node.js verifier for exact package-name checks)
```bash
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const forbidden = ['@vybestack/llxprt-code-core/auth', 'core/src/auth'];
const scanDirs = ['packages/cli/src', 'packages/providers/src', 'packages/core/src/core'];
let violations = [];
for (const dir of scanDirs) {
  try {
    const files = execSync('find ' + dir + ' -type f -name \"*.ts\" 2>/dev/null', {encoding:'utf8'}).trim().split('\\n').filter(f => f);
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      for (const pat of forbidden) {
        if (content.includes(pat)) { violations.push(f + ': ' + pat); }
      }
    }
  } catch(e) {}
}
if (violations.length > 0) { console.error('FAIL: old core/auth imports remain:'); violations.forEach(v => console.error('  ' + v)); process.exit(1); }
console.log('OK: no old core/auth imports');
"
```