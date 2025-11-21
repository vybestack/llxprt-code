# Implementation Plan: --profile CLI Flag (Issue #533)

**Plan ID**: PLAN-20251118-ISSUE533  
**Created**: 2025-11-18  
**Status**: Ready for Execution

## Overview

This plan implements a NEW `--profile` CLI flag that accepts JSON strings for GitHub Actions CI/CD use cases, enabling inline profile configuration without filesystem dependencies.

**Current State**:
- [OK] Existing: `--profile-load profileName` loads from `~/.llxprt/profiles/profileName.json`
- [ERROR] Does not exist: `--profile` flag

**Goal**: Enable syntax like:
```bash
llxprt --profile '{"provider":"openai","key":"sk-...","model":"gpt-4"}' --prompt "Hello"
```

## Plan Structure

```
project-plans/20251118-issue533/
├── README.md                           # This file
├── specification.md                    # Feature specification and requirements
├── PLAN.md                             # Master plan with all phases
├── PLAN-STATUS.md                      # Execution tracker (updated during implementation)
├── PLAN-EVALUATION.md                  # Plan quality evaluation (APPROVED)
├── analysis/
│   ├── domain-model.md                 # Domain analysis, business rules, edge cases
│   └── pseudocode/
│       ├── parse-bootstrap-args.md     # Pseudocode for argument parsing (lines 001-091)
│       └── profile-application.md      # Pseudocode for profile parsing (lines 001-221)
└── phases/
    ├── README.md                       # Phase overview
    ├── 03-type-extension-stub.md       # Phase 03: Add profileJson field
    ├── 03a-type-extension-verification.md
    ├── 04-argument-parsing-tdd.md      # Phase 04: Write 15 tests
    ├── 04a-argument-parsing-tdd-verification.md
    ├── 05-argument-parsing-implementation.md  # Phase 05: Implement parsing
    ├── 05a-argument-parsing-verification.md
    ├── 06-profile-parsing-stub.md      # Phase 06: Stub helper functions
    └── ... (18 phase files total)
```

## Key Features

### What Makes This Plan Special

1. **TDD-First**: Every line of code written in response to failing tests
2. **Pseudocode-Driven**: Implementation follows numbered pseudocode line-by-line
3. **Integration-Focused**: Not built in isolation, extends existing system
4. **Verification at Every Step**: Each phase has corresponding verification phase
5. **No Reverse Testing**: Tests expect REAL behavior, not stub behavior
6. **Behavioral Testing**: Tests verify input → output transformations with real data

### Requirements Covered

- **[REQ-PROF-001]** CLI Argument Parsing (3 sub-requirements)
- **[REQ-PROF-002]** Profile Application Integration (3 sub-requirements)
- **[REQ-PROF-003]** Security and Validation (3 sub-requirements)
- **[REQ-INT-001]** Integration Requirements (4 sub-requirements)

## Phase Overview

### Total: 18 Phases (9 implementation + 9 verification)

#### Argument Parsing (Phases 03-05)
- Add `profileJson` field to interface
- Write 15 behavioral tests
- Implement `--profile` flag parsing
- Enforce mutual exclusivity with `--profile-load`
- Add size limit validation (10KB)

#### Profile Parsing (Phases 06-08)
- Create stub helper functions
- Write 25 validation tests
- Implement JSON parsing with error handling
- Validate with Zod schemas
- Check nesting depth (max 10 levels)

#### Bootstrap Integration (Phases 09-11)
- Stub profile source selection
- Write 20 integration tests
- Implement profile application flow
- Ensure override precedence correct

#### End-to-End Integration (Phase 12)
- Write 12 E2E tests
- Test actual CLI invocation
- Verify provider initialization
- Test all error scenarios

## Execution

### Prerequisites
- Node.js 20.x+
- Project dependencies installed (`npm install`)
- TypeScript configured (strict mode)
- Vitest test runner

### How to Execute

1. **Read the specification**:
   ```bash
   cat specification.md
   ```

2. **Start with Phase 03**:
   ```bash
   cat phases/03-type-extension-stub.md
   # Implement changes
   cat phases/03a-type-extension-verification.md
   # Run verification
   ```

3. **Follow phases sequentially** (NO SKIPPING):
   ```
   P03 → P03a → P04 → P04a → P05 → P05a → P06 → ...
   ```

4. **Update PLAN-STATUS.md** after each phase:
   ```bash
   # Mark phase as completed, update timestamps
   ```

### Verification Commands

```bash
# Check plan markers
grep -r "@plan:PLAN-20251118-ISSUE533" packages/cli/src/config/

# Run tests
npm test packages/cli/src/config/profileBootstrap.test.ts

# Run integration tests
npm test packages/cli/src/integration-tests/cli-args.integration.test.ts

# Check mutation score
npx stryker run --mutate packages/cli/src/config/profileBootstrap.ts
```

## Success Metrics

- **Code**: ~985 lines (including tests)
- **Tests**: 76 total (15 parsing + 25 validation + 20 integration + 12 E2E + 4 verification)
- **Coverage**: 100% for new code paths
- **Mutation Score**: >80%
- **Property Tests**: >30%
- **Performance**: <20ms overhead

## Files Modified

### Production Code
- `packages/cli/src/config/profileBootstrap.ts` (only file modified)
  - Add `profileJson` field to interface
  - Add `--profile` case to switch
  - Add helper functions for JSON parsing
  - Modify bootstrap function for profile source selection

### Test Code
- `packages/cli/src/config/profileBootstrap.test.ts` (unit tests)
- `packages/cli/src/integration-tests/cli-args.integration.test.ts` (E2E tests)

### No New Files Created
This is a feature EXTENSION, not a new subsystem.

## Risk Assessment

**Overall Risk**: LOW

### Strengths
- Clear, well-defined scope
- Existing patterns followed
- Comprehensive tests
- No architectural changes
- Additive feature (no breaking changes)

### Mitigations
- Shell escaping: Platform-specific examples in documentation
- Mutual exclusivity: Explicit error messages
- JSON validation: Use existing Zod schemas
- Performance: Size/depth limits enforced

## Plan Evaluation Result

**Status**: [OK] APPROVED

This plan passed all critical checks:
- [OK] NOT an isolated feature (properly integrates)
- [OK] HAS integration plan (Phase 12 E2E tests)
- [OK] HAS user access (direct CLI flag)
- [OK] Pseudocode used (line-by-line implementation)
- [OK] NO reverse testing
- [OK] NO version duplication
- [OK] NO mock theater
- [OK] HAS comprehensive verification

See `PLAN-EVALUATION.md` for detailed evaluation.

## Quick Reference

### For Implementers
1. Read `specification.md` - Understand requirements
2. Read `analysis/domain-model.md` - Understand edge cases
3. Read `analysis/pseudocode/*.md` - Understand algorithm
4. Execute phases sequentially starting with P03
5. Update `PLAN-STATUS.md` after each phase

### For Reviewers
1. Check `PLAN-EVALUATION.md` - Verify plan quality
2. Check `PLAN-STATUS.md` - Track execution progress
3. Verify plan markers in code: `@plan:PLAN-20251118-ISSUE533.P##`
4. Verify requirement markers: `@requirement:REQ-XXX`
5. Run verification commands from phase files

## Next Steps

**Ready to Execute**: YES

1. Begin Phase 03 (Type Extension Stub)
2. Follow phases sequentially
3. Update PLAN-STATUS.md after each phase
4. Create completion markers in `.completed/` directory
5. Final verification after Phase 12

## Questions?

Refer to:
- `specification.md` - Feature requirements
- `PLAN.md` - Detailed phase descriptions
- `analysis/domain-model.md` - Edge cases and business rules
- `analysis/pseudocode/*.md` - Implementation algorithms
- `phases/*.md` - Step-by-step instructions

## Estimated Timeline

- **Experienced Developer**: 8-12 hours
- **Following Plan Exactly**: Minimal debugging needed
- **Test-First Approach**: High confidence in correctness

## License

This plan follows the project's Apache-2.0 license.

---

**Plan created**: 2025-11-18  
**Plan status**: Ready for execution  
**Last updated**: 2025-11-18
