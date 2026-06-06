# Core Deep Import Policy For Providers

Plan ID: PLAN-20260603-ISSUE1584

## Policy

`packages/providers` may temporarily import selected deep modules from `@vybestack/llxprt-code-core/...` because auth/settings/tools/history/debug packages are not yet extracted. Existing package.json files do not define `exports`, so runtime deep imports resolve against built `dist` files by package path after build. TypeScript must also resolve these imports through package metadata and workspace symlinks.

## Allowed Prefixes

Only these core deep import prefixes are allowed from provider production code unless P01 documents a new prefix with rationale:

- `@vybestack/llxprt-code-core/auth/`
- `@vybestack/llxprt-code-core/config/`
- `@vybestack/llxprt-code-core/core/`
- `@vybestack/llxprt-code-core/debug/`
- `@vybestack/llxprt-code-core/models/`
- `@vybestack/llxprt-code-core/parsers/`
- `@vybestack/llxprt-code-core/prompt-config/`
- `@vybestack/llxprt-code-core/runtime/`
- `@vybestack/llxprt-code-core/services/`
- `@vybestack/llxprt-code-core/settings/`
- `@vybestack/llxprt-code-core/telemetry/`
- `@vybestack/llxprt-code-core/tools/`
- `@vybestack/llxprt-code-core/types/`
- `@vybestack/llxprt-code-core/utils/`

## Verification

```bash
rg -n "@vybestack/llxprt-code-core/" packages/providers/src --glob '*.ts'
npm run build --workspace @vybestack/llxprt-code-core
npm run build --workspace @vybestack/llxprt-code-providers
node -e "import('@vybestack/llxprt-code-providers').then(()=>console.log('providers import ok'))"
```

The runtime import check must run after both core and providers are built.
