# REIMPLEMENT Plan: Autogenerate Settings Documentation

**Upstream SHA:** `5062fadf8767de5531a0a1577946d0e8227117a6`  
**Subject:** chore: autogenerate settings documentation (#12451)

## Overview

This commit adds automated generation of settings documentation and JSON schema from settingsSchema.ts.

## Files Changed (Upstream)

- `.github/workflows/ci.yml` (+6 lines)
- `docs/get-started/configuration.md` (+293 lines modified)
- `package.json` (+3 scripts)
- `packages/cli/src/config/settingsSchema.test.ts` (+48 lines)
- `packages/cli/src/config/settingsSchema.ts` (+412 lines)
- `schemas/settings.schema.json` (+1229 lines - new)
- `scripts/generate-settings-doc.ts` (+201 lines - new)
- `scripts/generate-settings-schema.ts` (+354 lines - new)
- `scripts/tests/generate-settings-doc.test.ts` (+16 lines)
- `scripts/tests/generate-settings-schema.test.ts` (+16 lines)
- `scripts/tests/vitest.config.ts` (+2 lines)
- `scripts/utils/autogen.ts` (+83 lines - new)

## LLxprt Considerations

1. **Schema Location** - LLxprt may have different schema location preferences
2. **Doc Generation** - Docs path may differ from upstream
3. **CI Integration** - LLxprt's CI workflow is different
4. **Settings Names** - Some settings may be LLxprt-specific vs Gemini-specific

## Implementation Steps

1. Review settingsSchema.ts changes for LLxprt compatibility
2. Adapt script paths for LLxprt structure
3. Skip CI workflow changes (LLxprt has own CI)
4. Update generated docs path if needed
5. Ensure scripts don't reference Gemini-specific settings

## Verification

```bash
npm run lint && npm run typecheck
npm run generate:settings-schema  # If added
npm run generate:settings-doc     # If added
```

## Decision

- [ ] Cherry-pick with conflicts
- [ ] Manual adaptation needed
- [ ] Skip CI changes, take scripts

---

*Plan to be executed during Batch 15*
