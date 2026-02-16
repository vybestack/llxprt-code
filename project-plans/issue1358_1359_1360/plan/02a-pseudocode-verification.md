# Phase 02a: Pseudocode Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P02a`

## Prerequisites
- Required: Phase 02 completed
- Verification: `test -f project-plans/issue1358_1359_1360/.completed/P02.md`

## Verification Checklist

### Structural Verification
- [ ] All 9 pseudocode files exist in `analysis/pseudocode/`
- [ ] Every file has numbered lines (grep for `^\s*[0-9]+:`)
- [ ] No actual TypeScript implementation in pseudocode files
- [ ] Each file has Contract section (Inputs, Outputs, Dependencies)
- [ ] Each file has Integration Points section
- [ ] Each file has Anti-Pattern Warnings section

### Requirement Coverage
- [ ] 001-framing-protocol covers R5 (framing), R6 (handshake), R24.1 (request timeout), R24.2 (idle timeout), R24.4 (partial frame timeout)
- [ ] 002-token-sanitization-merge covers R10 (sanitization), R12 (merge contract)
- [ ] 003-proxy-token-store covers R8 (token operations), R23.3 (error translation), R29 (connection management)
- [ ] 004-proxy-provider-key-storage covers R9 (API key operations)
- [ ] 005-credential-proxy-server covers R3 (socket creation), R4 (peer verification), R7 (request validation), R21 (profile scoping), R22 (rate limiting), R25 (lifecycle)
- [ ] 006-refresh-coordinator covers R11 (host-side refresh), R13 (retry/backoff), R14 (refresh rate limit), R15 (refresh+logout race)
- [ ] 007-proactive-scheduler covers R16 (proactive renewal)
- [ ] 008-oauth-session-manager covers R17-R19 (OAuth flows), R20 (session management)
- [ ] 009-proxy-oauth-adapter covers R17.4-R17.5 (inner-side adapter, refresh trigger)

### Semantic Verification
- [ ] Pseudocode algorithms match specification exactly
- [ ] Error handling paths complete (every error from R23.1 covered)
- [ ] Lock ordering documented (refresh, save_token, remove_token)
- [ ] Gemini exception path documented in pseudocode
- [ ] Codex dual-flow (browser_redirect + device_code) documented

### Quality Checks
- [ ] No "TODO" or "TBD" in pseudocode
- [ ] No implementation shortcuts
- [ ] All function signatures match TypeScript interfaces from preflight

## Verification Commands

```bash
# Comprehensive check
echo "=== File existence ==="
ls -la analysis/pseudocode/*.md | wc -l
# Expected: 9

echo "=== Line numbering ==="
for f in analysis/pseudocode/*.md; do
  LINES=$(grep -cE "^\s*[0-9]+:" "$f")
  echo "$(basename $f): $LINES numbered lines"
done

echo "=== No TypeScript implementation ==="
for f in analysis/pseudocode/*.md; do
  TS_LINES=$(grep -cE "^(export|import|const|let|var|function|class|interface|type|enum|async)" "$f" 2>/dev/null || echo 0)
  [ "$TS_LINES" -gt 5 ] && echo "WARNING: $(basename $f) may contain TypeScript ($TS_LINES lines)"
done

echo "=== Contract sections ==="
for f in analysis/pseudocode/*.md; do
  grep -q "## Contract\|### Inputs\|### Outputs" "$f" && echo "$(basename $f): OK" || echo "$(basename $f): MISSING contract"
done
```

## Success Criteria
- 9 pseudocode files with numbered lines
- All requirements covered across pseudocode files
- No implementation code in pseudocode
- Complete error handling paths


## Anti-Fake / Anti-Fraud Verification (MANDATORY)
- [ ] No test-environment branching in production code (for example: NODE_ENV checks, JEST_WORKER_ID, VITEST, process.env.TEST, isTest guards) unless explicitly required by specification.
- [ ] No fixture-hardcoded behavior in production code for known test values, providers, buckets, or session IDs.
- [ ] No mock theater: tests verify semantic outputs, state transitions, or externally visible side effects; not only call counts.
- [ ] No structure-only assertions as sole proof (toHaveProperty/toBeDefined without value-level behavior assertions).
- [ ] No deferred implementation artifacts in non-stub phases (TODO/FIXME/HACK/placeholder/NotYetImplemented/empty return shortcuts).
- [ ] Security invariants are actively checked where relevant: refresh_token and auth artifacts are never returned across proxy boundaries or logged in full.
- [ ] Failure-path assertions exist (invalid request, unauthorized, timeout, rate limit, session errors) to prevent happy-path-only implementations from passing.

### Anti-Fraud Command Checks
- Run: grep -rn -E "(NODE_ENV|JEST_WORKER_ID|VITEST|process\.env\.TEST|isTest\()" packages --include="*.ts" | grep -v ".test.ts"
- Run: grep -rn -E "(toHaveBeenCalled|toHaveBeenCalledWith)" [phase-test-files]
- Run: grep -rn -E "(toHaveProperty|toBeDefined|toBeUndefined)" [phase-test-files]
- Run: grep -rn -E "(TODO|FIXME|HACK|placeholder|NotYetImplemented|return \[\]|return \{\}|return null|return undefined)" [phase-impl-files] | grep -v ".test.ts"
- Run: grep -rn "refresh_token" packages/cli/src/auth/proxy packages/core/src/auth --include="*.ts" | grep -v ".test.ts"

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P02a.md`
