# Preflight Results Template

Plan ID: PLAN-20260608-ISSUE1586

P00a must copy this file to `analysis/preflight-results.md` and populate command outputs before P03 begins.

## Dependency Outputs

```bash
npm ls typescript
npm ls vitest
npm ls zod
npm ls @napi-rs/keyring
```

## Workspace Metadata

```bash
# Informational — not gates
node -e "const p=require('./package.json'); console.log(JSON.stringify(p.workspaces, null, 2))"
cat packages/core/package.json || echo "MISSING"
cat packages/cli/package.json || echo "MISSING"
cat packages/providers/package.json || echo "MISSING"
# packages/auth/package.json — checked after P03 scaffold
cat tsconfig.json || echo "MISSING"
cat packages/core/tsconfig.json || echo "MISSING"
cat packages/cli/tsconfig.json || echo "MISSING"
```

## Core Auth External Import Inventory

```bash
# Production files only (15 files)
find packages/core/src/auth -type f -name '*.ts' ! -name '*.test.ts' ! -name '*.spec.ts' | sort
if rg -n "from ['\"].*\.\./" packages/core/src/auth --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' 2>/dev/null; then
  echo "Found external imports in core auth production code"; exit 0
fi
```

## Core Auth Test Inventory

```bash
# Test files only (20 files)
find packages/core/src/auth -name '*.test.ts' -o -name '*.spec.ts' | sort
```

## CLI Auth Core Import Inventory

```bash
if rg -n "from ['\"]@vybestack/llxprt-code-core" packages/cli/src/auth --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' 2>/dev/null; then
  echo "Found CLI auth imports from core"; exit 0
fi
```

## Providers Auth Core Import Inventory

```bash
# NOTE: Provider counts are preflight-derived. Rerun at preflight to confirm:
# rg -n "from ['"]@vybestack/llxprt-code-core/auth" packages/providers/src --glob '*.ts'
# Verified count at plan time: 6 production + 3 test = 9 provider auth import files
# Regenerate at preflight to confirm counts haven't changed
if rg -n "from ['\"]@vybestack/llxprt-code-core/auth" packages/providers/src --glob '*.ts' 2>/dev/null; then
  echo "Found provider auth imports from core"; exit 0
fi
```

## Core Non-Auth Files Using Auth Imports

```bash
# StreamProcessor.ts imports flushRuntimeAuthScope from ../auth/precedence.js
if rg -n "from ['\"].*\.\./auth/" packages/core/src/core/ --include='*.ts' 2>/dev/null; then
  echo "Found core non-auth files importing from auth"; exit 0
fi
```

## Core Exports That Include Auth

```bash
if rg -n "auth\|Auth\|OAuth\|Token\|Keyring\|precedence\|Precedence" packages/core/src/index.ts 2>/dev/null; then
  echo "Found auth-related exports in core index"; exit 0
fi
if ! node -e "const p=require('./packages/core/package.json'); if(!p.exports){console.error('No exports field');process.exit(1)}; console.log(JSON.stringify(p.exports,null,2))" 2>/dev/null; then
  echo "FAIL: could not read core package.json exports"; exit 1
fi
```

## packages/storage Verification

```bash
# Verify packages/storage does not exist
ls packages/storage 2>&1 || echo "CONFIRMED: packages/storage absent"
```

## Type/Interface Reads

```bash
# These are informational commands for preflight inspection (not gates)
head -30 packages/core/src/auth/types.ts || echo "FILE NOT FOUND"
head -30 packages/core/src/auth/token-store.ts || echo "FILE NOT FOUND"
head -40 packages/core/src/auth/precedence.ts || echo "FILE NOT FOUND"
head -40 packages/core/src/auth/auth-precedence-resolver.ts || echo "FILE NOT FOUND"
head -20 packages/core/src/storage/secure-store.ts || echo "FILE NOT FOUND"
head -20 packages/core/src/storage/provider-key-storage.ts || echo "FILE NOT FOUND"
head -20 packages/core/src/debug/index.ts || echo "FILE NOT FOUND"
head -20 packages/core/src/utils/debugLogger.ts || echo "FILE NOT FOUND"
```

## OAuthManager Interface Verification

```bash
# Verify actual interface matches plan assumptions
if ! grep -A5 "export interface OAuthManager" packages/core/src/auth/precedence.ts 2>/dev/null; then
  echo "FAIL: OAuthManager interface not found"; exit 1
fi
```

## OAuthProvider Interface Verification

```bash
# Verify OAuthProvider location and usage
if ! grep -n "export interface OAuthProvider" packages/cli/src/auth/types.ts 2>/dev/null; then
  echo "FAIL: OAuthProvider not found in CLI types.ts"; exit 1
fi
# Verify it's only used by CLI adapters
if rg -n "OAuthProvider" packages/ --glob '*.ts' 2>/dev/null | grep -v '.test.ts' | grep -v '.spec.ts' | grep -q .; then
  echo "OAuthProvider references found (expected CLI-only)"
fi
```

## Gate

Do not implement P03 or later until `analysis/preflight-results.md` exists and the plan has been updated if outputs contradict assumptions. Specifically:
- Regenerate provider counts via `rg -l "from ['"]@vybestack/llxprt-code-core/auth" packages/providers/src --glob '*.ts'` and confirm count (plan-time scan: 6 production + 3 test = 9 files).
- Verify `flushRuntimeAuthScope` is exported by `packages/core/src/auth/precedence.ts` and consumed by the files listed in anti-shim-policy.md's symbol migration table.
- Verify core package.json has `./auth/precedence.js` and `./auth/types.js` subpath exports (to be removed in migration).
- Verify `packages/core/src/core/StreamProcessor.ts` imports `flushRuntimeAuthScope` from `../auth/precedence.js`.