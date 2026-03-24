# Phase 0: Baseline & Test Infrastructure - Hard Gate Checkpoint

## Completed Tasks

### 0.1 Baseline Snapshots [OK]

All baseline files captured in `project-plans/issue1577/`:

- `baseline-coverage.json` - Coverage data for text-buffer tests
- `baseline-test-results.json` - Test results for text-buffer and vim-buffer-actions tests
- `baseline-file-sizes.txt` - File size counts:
  - text-buffer.ts: 2,734 lines
  - text-buffer.test.ts: 2,341 lines
  - vim-buffer-actions.ts: 814 lines
  - vim-buffer-actions.test.ts: 1,120 lines
  - Total: 7,009 lines

### 0.2 ESLint Flat Config Enforcement [OK]

Added to `eslint.config.js`:

1. **Domain module purity rules** - Files matching:
   - `buffer-types.ts`
   - `word-navigation.ts`
   - `buffer-operations.ts`
   - `transformations.ts`
   - `visual-layout.ts`

   Rules enforced:
   - No React imports
   - No debugLogger from core
   - No Node.js I/O modules (fs, child_process, os)
   - Complexity <= 15
   - max-lines: 800
   - max-lines-per-function: 80

2. **vim-buffer-actions.ts restrictions**:
   - Cannot import from text-buffer.js
   - Cannot import from buffer-reducer.js
   - Cannot import React
   - Complexity <= 15
   - max-lines-per-function: 80

3. **buffer-reducer.ts restrictions**:
   - Cannot import React
   - Complexity <= 15
   - max-lines-per-function: 80

4. **text-buffer.ts size limits**:
   - max-lines: 800
   - max-lines-per-function: 80

5. **Migration warnings** for utility imports from text-buffer.js

## Verification

ESLint config validated by running:
```bash
NODE_OPTIONS="--max-old-space-size=8192" npx eslint packages/cli/src/ui/components/shared/text-buffer.ts packages/cli/src/ui/components/shared/vim-buffer-actions.ts
```

The config correctly applies the new rules and shows the expected errors/warnings for the current text-buffer.ts file (which will be addressed during Phase 3 refactoring).

## Ready for Phase 1

The hard gate is complete. Proceeding to create behavioral parity tests:

- [ ] 1.1 position-roundtrip.test.ts
- [ ] 1.2 reducer-invariants.test.ts
- [ ] 1.3 vim-consistency.test.ts
- [ ] 1.4 action-corpus.json
- [ ] 1.5 golden-snapshot.test.ts
