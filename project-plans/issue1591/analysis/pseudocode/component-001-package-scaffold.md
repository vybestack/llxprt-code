# Pseudocode: Package Scaffold

## Component: packages/policy package creation

### Interface Contracts

```typescript
// INPUTS: None (new package, no callers yet)
// OUTPUTS: A compilable, registered workspace package
// DEPENDENCIES:
//   @iarna/toml — TOML parsing (already in workspace)
//   zod — validation (already in workspace)
//   NO @google/genai — FORBIDDEN (PolicyFunctionCall replaces)
//   NO @vybestack/llxprt-code-core — FORBIDDEN (injected interfaces replace)
//   NO @vybestack/llxprt-code-telemetry — FORBIDDEN (PolicyLogger injection replaces)
```

### Pseudocode

```
10: CREATE directory packages/policy/
11: CREATE packages/policy/package.json
12:   SET name to "@vybestack/llxprt-code-policy"
13:   SET version to "0.10.0"
14:   SET type to "module"
15:   SET main to "dist/index.js"
16:   SET types to "dist/index.d.ts"
17:   SET exports to { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } }
18:   ADD dependencies: @iarna/toml, zod ONLY
19:   ADD devDependencies: @types/node, typescript, vitest, fast-check
20:   ADD scripts: build, lint, format, test, test:ci, typecheck
21:   SET engines to { node: ">=20" }

22: CREATE packages/policy/tsconfig.json
23:   EXTEND ../../tsconfig.json
24:   SET outDir to "dist"
25:   SET composite to false
26:   SET types to ["node", "vitest/globals"]
27:   SET baseUrl to "."
28:   SET paths to self-alias
29:   SET include to ["index.ts", "src/**/*.ts", "src/**/*.json"]
30:   SET exclude to ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]

31: CREATE packages/policy/vitest.config.ts
32:   DEFINE workspaceDependencyAliasPlugin (empty — no workspace deps needed)
33:   EXPORT defineConfig with test options
34:   SET test.passWithNoTests to true
35:   SET test.setupFiles to ["./test-setup.ts"]

38: CREATE packages/policy/test-setup.ts
39:   EXPORT empty or minimal setup (no provider runtime needed)

40: CREATE packages/policy/index.ts
41:   EXPORT {} (empty for now, filled in Phase 05)

42: MODIFY root package.json
43:   ADD "packages/policy" to workspaces array (after packages/lsp)

44: CREATE packages/policy/src/ directory
45: CREATE packages/policy/src/utils/ directory
46: CREATE packages/policy/src/policies/ directory
47: CREATE packages/policy/src/confirmation-bus/ directory
```

### Integration Points

- Line 43: Root package.json workspaces array must include "packages/policy"
- Line 33: Vitest alias plugin pattern copied from core's vitest.config.ts
- Line 17: Exports map follows telemetry package pattern

### Anti-Pattern Warnings

```
[ERROR] DO NOT: Add dependency on @vybestack/llxprt-code-core
[ERROR] DO NOT: Add dependency on @vybestack/llxprt-code-telemetry
[ERROR] DO NOT: Add dependency on @google/genai
[OK] DO: Only depend on @iarna/toml and zod — all cross-boundary concerns injected

[ERROR] DO NOT: Set composite: true (only needed for project references in build chain)
[OK] DO: Set composite: false (following telemetry pattern)

[ERROR] DO NOT: Add telemetry workspace dependency alias in vitest.config.ts
[OK] DO: No workspace aliases needed — policy has no workspace dependencies
```
