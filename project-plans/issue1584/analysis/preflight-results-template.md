# Preflight Results Template

Plan ID: PLAN-20260603-ISSUE1584

P00a must copy this file to `analysis/preflight-results.md` and populate command outputs before P03 begins.

## Dependency Outputs

```bash
npm ls typescript
npm ls vitest
npm ls openai
npm ls @anthropic-ai/sdk
npm ls @google/genai
```

## Workspace Metadata

```bash
node -e "const p=require('./package.json'); console.log(p.workspaces)"
cat packages/core/package.json
cat packages/cli/package.json
cat tsconfig.json
cat packages/core/tsconfig.json
cat packages/cli/tsconfig.json
```

## Type/Interface Reads

```bash
sed -n '1,220p' packages/core/src/providers/IProvider.ts
sed -n '1,220p' packages/core/src/providers/IProviderManager.ts
sed -n '1,160p' packages/core/src/providers/tokenizers/ITokenizer.ts
sed -n '1,180p' packages/core/src/runtime/providerRuntimeContext.ts
```

## Import Scans

```bash
rg -n "from ['"].*providers|@vybestack/llxprt-code-core/providers" packages --glob '*.ts' --glob '!dist/**'
rg -n "@vybestack/llxprt-code-providers" packages --glob '*.ts'
```

## Provider Inventory

```bash
find packages/core/src/providers -type f | sort
find packages/core/src/providers -type f | wc -l
find packages/core/src/providers -type f \( -name '*.test.ts' -o -name '*.spec.ts' \) | wc -l
```

## Gate

Do not implement P03 or later until `analysis/preflight-results.md` exists and the plan has been updated if outputs contradict assumptions.


## Preflight Execution Requirement

`analysis/preflight-results.md` is intentionally not pre-populated during plan creation. P00a must generate it from `analysis/preflight-results-template.md`, paste actual command outputs, and P00a/P01a verification must approve it before P03 or any production-code implementation begins.
