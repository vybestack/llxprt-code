# Phase 01a: Analysis Verification

Plan ID: PLAN-20260608-ISSUE1586.P01a

## Verification Tasks

1. Re-run `find packages/core/src/auth -type f -name '*.ts' | sort` and verify against `auth-file-inventory.md`.
   - Verify 15 production files
   - Verify 20 test files (10 root-level + 6 __tests__ + 4 proxy/__tests__)
   - Verify total = 35
2. Verify CLI auth non-test `.ts` count is 37 (34 pure production + 3 test-helpers).
3. Verify providers auth import count matches preflight `rg` scan (current: 9 files = 6 production + 3 test).
4. Verify every core auth production file in dependency-audit.md has correct external import list.
5. Verify move map covers 100% of core auth production + ALL 20 test files (including proxy/__tests__). Total expected: 15 production + 20 test = 35 move entries.
6. Verify DI interface table in external-dependencies.md matches actual code.
7. Verify no file is classified as both "moves" and "stays".
8. Verify packages/storage absence is documented.
9. Cross-reference with integration-contract.md IC-01 through IC-09.

## Structural Verification Checklist
- [ ] Inventory file count matches `find` output (15 production + 20 test = 35)
- [ ] Inventory includes 4 proxy/__tests__ test files
- [ ] Classification rules cover every file
- [ ] Move map has source→dest for every production + test file (35 entries: 15 production + 20 test)
- [ ] Move map includes proxy/__tests__ destinations
- [ ] Dependency audit lists all 5 subsystems (storage, debug, settings, runtime, utils)
- [ ] External dependencies correctly identify zod as only npm dep
- [ ] Providers auth imports audited (plan-time expected count: 6 prod + 3 test = 9; preflight must confirm actual count)
- [ ] packages/storage absence documented