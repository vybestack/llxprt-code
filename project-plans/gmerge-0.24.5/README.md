# gmerge-0.24.5 Playbook Suite

This directory contains 7 REIMPLEMENT playbooks for upstream commits targeting the 0.24.5 merge. These commits cover console migration, secrets, security, settings, and misc improvements.

## Playbook Overview

| Playbook | SHA | Subject | Files | Batch Group | Magnitude |
|----------|-----|---------|-------|-------------|-----------|
| [10ae84869a39](./10ae84869a39-plan.md) | `10ae84869a39` | Console → coreEvents/debugLogger migration | 66 (47 exist in LLxprt) | Console-Migration | Large |
| [3b1dbcd42d8f](./3b1dbcd42d8f-plan.md) | `3b1dbcd42d8f` | Unified secrets sanitization & env redaction | 18 | Secrets | Medium |
| [6f4b2ad0b95a](./6f4b2ad0b95a-plan.md) | `6f4b2ad0b95a` | Default folder trust to untrusted | 6 | Security | Small |
| [006de1dd318d](./006de1dd318d-plan.md) | `006de1dd318d` | Add security documentation for hooks | 2 | Security | Small |
| [9172e2831542](./9172e2831542-plan.md) | `9172e2831542` | Add descriptions to settings dialog | 3 | Settings | Small-Medium |
| [2fe45834dde6](./2fe45834dde6-plan.md) | `2fe45834dde6` | Remote admin settings (secureModeEnabled/mcpEnabled) | 9 | Settings | Medium |
| [881b026f2454](./881b026f2454-plan.md) | `881b026f2454` | Fix circular dependency via tsconfig paths | 1 | Misc | Trivial |

## Execution Order

### Phase 1: Foundation (can be done in parallel)
1. **881b026f2454** (tsconfig) — Trivial, no dependencies
2. **3b1dbcd42d8f** (secrets) — Medium complexity, standalone

### Phase 2: Console Migration (large, mechanical)
3. **10ae84869a39** (console) — Large but mechanical refactoring (47 files)

### Phase 3: Security Enhancements
4. **6f4b2ad0b95a** (folder trust) — Depends on folder trust existing
5. **006de1dd318d** (security docs) — Pure documentation, no code deps

### Phase 4: Settings Enhancements
6. **9172e2831542** (settings descriptions) — UI enhancement
7. **2fe45834dde6** (admin settings) — Policy framework

## Batch Groups

- **Console-Migration:** 10ae84869a39
- **Secrets:** 3b1dbcd42d8f
- **Security:** 6f4b2ad0b95a, 006de1dd318d
- **Settings:** 9172e2831542, 2fe45834dde6
- **Misc:** 881b026f2454

## Dependencies

- **None have hard dependencies** on each other
- **Soft dependencies:**
  - Console migration should be done before other large refactors (reduces merge conflicts)
  - Secrets sanitization is used by hooks (3b1dbcd → affects hook security docs)
  - Admin settings builds on existing security settings

## Verification

After implementing ALL playbooks, run:
```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Key Adaptations for LLxprt

All playbooks include LLxprt-specific adaptations:

1. **Package naming:** `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`
2. **Env vars:** `GEMINI_*` → `LLXPRT_*`
3. **Settings paths:** `.gemini/` → `.llxprt/`
4. **API keys:** `GEMINI_API_KEY` → `LLXPRT_API_KEY`
5. **Missing files:** 19 upstream files (mostly A2A server) don't exist in LLxprt — skip those

## Estimated Effort

- **Total lines changed:** ~1,300 (780 in secrets, 564 in console, etc.)
- **Total files:** 105 upstream files, ~85 exist in LLxprt
- **Estimated effort:** 2-3 days for careful implementation + testing

## Notes

- **10ae84869a39** (console) is the largest — consider breaking it into smaller batches (core, CLI, tests)
- **3b1dbcd42d8f** (secrets) adds a new 309-line file — thoroughly review patterns
- **2fe45834dde6** (admin) defines `extensions.enabled` but doesn't enforce it yet
- All playbooks emphasize mechanical patterns and include detailed verification steps
