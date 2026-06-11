# Phase P03: Package Scaffold

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Stub
Prerequisites: P02 (pseudocode reviewed)

## Purpose

Create the `packages/policy` directory structure with all configuration files. The package must compile and be registered in the workspace, but contains no implementation yet (empty barrel exports).

## Expanded Requirements

- Create complete directory structure for `packages/policy`
- Package.json declares ONLY `@iarna/toml` and `zod` as production dependencies
- Package.json declares `@types/node`, `fast-check`, `typescript`, `vitest` as dev dependencies
- Package.json FORBIDDEN: `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code-tools`, `@vybestack/llxprt-code-cli`, `@google/genai`, `@vybestack/llxprt-code-telemetry`
- TypeScript config follows telemetry package pattern (composite: false)
- Vitest config sets `passWithNoTests: true` (policy has no tests until P04)
- Root package.json updated with new workspace entry
- Package compiles successfully with `npm run build --workspace @vybestack/llxprt-code-policy`

## Exact File Tasks

| File | Action | Description |
|------|--------|-------------|
| `packages/policy/package.json` | CREATE | Package manifest with exact deps from overview |
| `packages/policy/tsconfig.json` | CREATE | TypeScript config, composite: false |
| `packages/policy/vitest.config.ts` | CREATE | Test config with `passWithNoTests: true`, no workspace aliases |
| `packages/policy/test-setup.ts` | CREATE | Empty or minimal test setup |
| `packages/policy/index.ts` | CREATE | Root barrel (empty export for now) |
| `packages/policy/src/index.ts` | CREATE | Public API barrel (empty export for now) |
| `packages/policy/src/utils/` | CREATE | Directory for shell-utils copy |
| `packages/policy/src/policies/` | CREATE | Directory for TOML policy files |
| `packages/policy/src/confirmation-bus/` | CREATE | Directory for confirmation bus types |
| `package.json` (root) | MODIFY | Add `"packages/policy"` to workspaces array |

### package.json (exact content — matches repository conventions)

Follows the same conventions as `packages/telemetry/package.json`: `build` uses `node ../../scripts/build_package.js`, `files` is `["dist"]`, and standard metadata fields are present.

```json
{
  "name": "@vybestack/llxprt-code-policy",
  "version": "0.10.0",
  "description": "LLxprt Code Policy — policy engine, TOML rule loading, and confirmation bus",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/vybestack/llxprt-code.git"
  },
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "node ../../scripts/build_package.js",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --check .",
    "test": "vitest run",
    "test:ci": "vitest run --reporter=verbose",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@iarna/toml": "^2.2.5",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^24.2.1",
    "fast-check": "^4.2.0",
    "typescript": "^5.3.3",
    "vitest": "^3.1.1"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### vitest.config.ts (exact content)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
  },
});
```

Without `passWithNoTests: true`, `vitest run` exits with code 1 when no test files exist. Setting it ensures `npm run test --workspace @vybestack/llxprt-code-policy` passes during the scaffold phase (before P04 adds tests).

## Verification Commands

```bash
# Verify package registered
npm ls @vybestack/llxprt-code-policy

# Verify no forbidden deps
grep -E "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code-tools|@vybestack/llxprt-code-cli|@google/genai|@vybestack/llxprt-code-telemetry" packages/policy/package.json
# Expected: zero matches

# Verify TypeScript compiles
npm run build --workspace @vybestack/llxprt-code-policy

# Verify tests run (pass with no tests)
npm run test --workspace @vybestack/llxprt-code-policy

# Verify full suite still passes
npm run build
npm run test
```

## Success Criteria

- [ ] `packages/policy/` directory created with all required files
- [ ] Root `package.json` workspaces includes `packages/policy`
- [ ] `npm ls @vybestack/llxprt-code-policy` succeeds
- [ ] Zero forbidden dependencies in `packages/policy/package.json`
- [ ] `npm run build --workspace @vybestack/llxprt-code-policy` succeeds
- [ ] `npm run test --workspace @vybestack/llxprt-code-policy` succeeds (passWithNoTests: true)
- [ ] Full workspace build still passes

## What Comes Next

After P03a verification, **P03b (Skeleton Stubs)** creates minimal resolvable skeleton exports so that P04/P06 RED tests fail on behavioral assertions (wrong return values, missing enum values) rather than import-resolution failures. This ensures TDD discipline: RED means "tests fail because behavior is wrong," not "tests fail because module not found."

## Failure Recovery

1. If `npm install` fails — check for typos in package.json, verify workspace path
2. If TypeScript build fails — check tsconfig.json extends path, verify base config exists
3. If full workspace build breaks — revert only `package.json` (root) and `packages/policy/` directory
4. Targeted revert: `git checkout -- package.json` followed by targeted removal of specific `packages/policy/` files with `git checkout -- packages/policy/<file>`
