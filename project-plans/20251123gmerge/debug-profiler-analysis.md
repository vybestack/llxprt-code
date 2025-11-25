# Debug Profiler Implementation Analysis

**Commit:** 34ba8be8 - "Enhance debug profiler to track tree framerate and dispatch errors"
**Date:** 2025-10-07
**Status:** Skipped in original cherry-pick plan
**Analysis Date:** 2025-11-24

## Executive Summary

The debug profiler commit enhances the development-time performance monitoring tool from a simple render counter to a sophisticated idle frame detector that can automatically identify React infinite loops and performance issues. Full implementation would require **11-18 hours** of effort with several architectural adaptations for llxprt.

### Critical Issue: Command Naming Collision

⚠️ **BLOCKER:** Upstream introduces `/profile` command for profiler toggle, but llxprt already uses `/profile` for configuration profile management (600+ lines, 5 subcommands).

**Resolution:** Rename upstream's profiler toggle to `/debug` command.

---

## What It Does

### Core Functionality

The enhanced debug profiler monitors UI rendering performance in real-time:

1. **Tracks Metrics:**
   - Total frames rendered since startup
   - Idle frames (rendered without user input)
   - Frame timestamps for framerate calculation

2. **Detects Performance Issues:**
   - Monitors for idle frame patterns (frames rendered when app should be idle)
   - If 5+ idle frames detected in 1 second → **CRITICAL ISSUE**
   - Automatically opens debug console and logs error
   - Indicates severe React infinite loop or state management bug

3. **UI Display:**
   - Shows: `Renders: {total} (total), {idle} (idle)`
   - Only visible when `debugMode=true` OR `NODE_ENV=development`
   - Toggle via slash command (development only)

### Technical Implementation

- Uses `mnemonist` library's `FixedDeque` for memory-efficient circular buffers
- Patches `process.stdout.write()` to detect frame renders
- Tracks user interactions (stdin, stdout resize) as "actions"
- Analyzes patterns every 1 second to identify idle frames
- Frame is "idle" if no action occurred within 500ms before/after it

---

## Files Modified (20 total)

### High-Risk Changes

| File | Risk | Lines | Issue |
|------|------|-------|-------|
| **DebugProfiler.tsx** | **HIGH** | ~40 → ~190 | Complete rewrite, not just enhancement |
| **profileCommand.ts** | **COLLISION** | NEW | Name conflict with existing llxprt command |
| **AppContainer.tsx** | MEDIUM | +10 | Adapt to llxprt reducer patterns |

### Medium-Risk Changes

| File | Risk | Lines | Issue |
|------|------|-------|-------|
| CliSpinner.tsx | MEDIUM | +24 | May not exist in llxprt |
| GeminiRespondingSpinner.tsx | MEDIUM | 2 | Depends on current structure |
| CompressionMessage.tsx | MEDIUM | 2 | Depends on current structure |
| BuiltinCommandLoader.test.ts | MEDIUM | +42 | Test pattern adaptation |

### Low-Risk Changes

| File | Risk | Lines | Change |
|------|------|-------|--------|
| UIStateContext.tsx | LOW | +1 | Add `showDebugProfiler` field |
| keyBindings.ts | LOW | 1 | Add `shift: false` to HISTORY_UP |
| BuiltinCommandLoader.ts | LOW | +3 | Conditional command loading |
| commands/types.ts | LOW | +1 | Add method signature |
| installationInfo.ts | LOW | +3 | Export `isDevelopment` |
| Footer.tsx | LOW | +2 | Show profiler in development |
| slashCommandProcessor.ts | LOW | +2 | Pass through method |
| nonInteractiveUi.ts | LOW | +1 | Mock function |
| DebugProfiler.test.tsx | LOW | +183 | New test file (no conflicts) |
| packages/cli/package.json | LOW | +1 | Add mnemonist dependency |

---

## Dependencies

### New Dependency Required

**mnemonist** `^0.40.3`
- JavaScript data structure library
- Provides `FixedDeque` for circular ring buffers
- Used to store timestamps with fixed capacity (prevents memory leaks)
- Well-maintained, 15KB minified, no other dependencies

```bash
npm install mnemonist@^0.40.3
```

---

## Critical Conflicts

### 1. Command Naming Collision ⚠️

**Upstream `/profile` command:**
- Purpose: Toggle debug profiler on/off
- Size: ~25 lines
- Development-only feature

**llxprt's existing `/profile` command:**
- Purpose: Manage configuration profiles (save/load/delete/set-default/list)
- Size: 600+ lines, 5 subcommands
- Production feature

**Resolution Options:**

| Option | Action | Pros | Cons | Recommended |
|--------|--------|------|------|-------------|
| **A** | Rename upstream → `/debug` | Clear separation, no breaking changes | Deviation from upstream | ✅ **YES** |
| B | Add as subcommand → `/profile debug` | Keeps functionality together | Complex, not upstream pattern | ❌ No |
| C | Overwrite llxprt's command | Follows upstream exactly | Breaking change to users | ❌ No |

**Recommendation:** Rename upstream's profiler toggle to `/debug` command.

### 2. Architecture Differences

**Color System:**
- Upstream: `theme.status.warning` / `theme.status.error`
- llxprt: `Colors` and `SemanticColors` from `colors.js`
- **Adaptation:** Map upstream colors to llxprt equivalents

**Import Paths:**
- Upstream: `@google/gemini-cli-core`
- llxprt: `@vybestack/llxprt-code-core`
- **Adaptation:** Update all import statements

**State Management:**
- Upstream: Simple `useState` in AppContainer
- llxprt: Reducer pattern in AppContainer
- **Adaptation:** Integrate with existing state architecture

---

## Implementation Plan

### Phase 1: Preparation (1-2 hours)

1. Add mnemonist dependency
2. Review llxprt's AppContainer reducer patterns
3. Back up current DebugProfiler.tsx
4. Create isolated test environment

### Phase 2: Core Profiler (3-4 hours)

1. Rewrite DebugProfiler.tsx:
   - Import FixedDeque from mnemonist
   - Implement frame timestamp tracking
   - Implement action timestamp tracking
   - Add idle detection algorithm
   - Adapt color system to llxprt's
   - Add error dispatch events
2. Port upstream tests (DebugProfiler.test.tsx)
3. Test profiler in isolation

### Phase 3: Infrastructure (2-3 hours)

1. Update `installationInfo.ts` → add `isDevelopment` export
2. Create/enhance `CliSpinner.tsx` → add `debugNumSpinners` tracking
3. Update `GeminiRespondingSpinner.tsx` → use CliSpinner
4. Update `CompressionMessage.tsx` → use CliSpinner
5. Update `Footer.tsx` → show profiler if `debugMode || isDevelopment`

### Phase 4: Command Integration (2-3 hours)

1. Create `debugCommand.ts` (renamed from profileCommand.ts):
   ```typescript
   export const debugCommand: SlashCommand = {
     name: 'debug',
     kind: CommandKind.BUILT_IN,
     description: 'Toggle the debug profiler display',
     action: async (context) => {
       context.ui.toggleDebugProfiler();
       return {
         type: 'message',
         messageType: 'info',
         content: 'Toggled debug profiler.',
       };
     },
   };
   ```
2. Update `BuiltinCommandLoader.ts` → conditionally load command
3. Update `CommandContext` types → add `toggleDebugProfiler` method
4. Update `UIStateContext` → add `showDebugProfiler: boolean`
5. Update `AppContainer.tsx`:
   - Add state/reducer action for `showDebugProfiler`
   - Add `toggleDebugProfiler` callback
   - Pass to slash command processor
6. Update `slashCommandProcessor.ts` → pass through method
7. Update `nonInteractiveUi.ts` → add mock

### Phase 5: Testing (2-3 hours)

1. Run full test suite
2. Test in development mode:
   - Verify `/debug` command toggles profiler
   - Verify profiler shows correct metrics
   - Verify idle frame detection works
   - Verify error dispatch triggers
3. Test in production mode:
   - Verify `/debug` command not available
   - Verify profiler hidden unless debugMode enabled
4. Test no interference with existing `/profile` command

### Phase 6: Documentation (1-2 hours)

1. Add inline comments explaining idle detection algorithm
2. Document `/debug` command in help system
3. Update CLAUDE.md or developer docs
4. Code review and formatting

**Total Estimated Effort: 11-18 hours**

---

## Testing Strategy

### Unit Tests (from upstream)

```typescript
// Test FixedDeque capacity
- Should maintain max capacity for frame timestamps
- Should maintain max capacity for action timestamps

// Test idle detection
- Should detect idle frames (no actions within 500ms)
- Should not mark frames as idle when actions are nearby
- Should handle mixed idle/non-idle patterns
- Should handle edge cases (exactly at 500ms boundary)
```

### Integration Tests

```typescript
// Command availability
- /debug command available in development mode
- /debug command NOT available in production mode
- /debug command doesn't conflict with /profile command

// Profiler display
- Profiler appears in footer when toggled on
- Profiler hidden when toggled off
- Profiler shows correct total/idle counts
- Profiler updates in real-time

// Error dispatch
- Idle frame detection triggers debug console
- Error event logged with correct message
- No false positives during normal operation
```

### Manual Testing Checklist

- [ ] Run `NODE_ENV=development npm start`
- [ ] Type `/debug` command
- [ ] Verify profiler appears in footer
- [ ] Observe frame count increasing
- [ ] Leave app idle for 10 seconds
- [ ] Verify idle frames detected (if any)
- [ ] Simulate input, verify non-idle frames
- [ ] Toggle off with `/debug` again
- [ ] Run `NODE_ENV=production npm start`
- [ ] Verify `/debug` command not available
- [ ] Verify `/profile` command still works

---

## Risks and Mitigations

| Risk | Level | Impact | Mitigation |
|------|-------|--------|-----------|
| Complete DebugProfiler rewrite | HIGH | Could break existing debug features | Keep backup, extensive testing |
| Command naming collision | CRITICAL | User confusion, breaking change | Rename to `/debug` |
| Missing mnemonist dependency | MEDIUM | Build/runtime failures | Add early in Phase 1 |
| Architecture mismatches | MEDIUM | Integration issues | Adapt carefully, test each change |
| Idle detection false positives | MEDIUM | Spurious error messages | Test with real workflows |
| Performance overhead | LOW | Slight slowdown in dev mode | Only active in development |

---

## llxprt-Specific Adaptations

### Required Changes

1. **Branding:** None needed (technical feature, not user-facing)

2. **Import Paths:**
   ```typescript
   // Change from:
   import { ... } from '@google/gemini-cli-core'
   // To:
   import { ... } from '@vybestack/llxprt-code-core'
   ```

3. **Color System:**
   ```typescript
   // Change from:
   import { theme } from '../theme'
   color: theme.status.warning
   // To:
   import { SemanticColors } from '../colors'
   color: SemanticColors.warning
   ```

4. **Command Name:**
   ```typescript
   // Change from:
   name: 'profile'
   // To:
   name: 'debug'
   ```

5. **State Management:**
   - Integrate with llxprt's reducer pattern in AppContainer
   - May need to add reducer actions instead of simple setState

---

## Decision Required

**Should we implement the debug profiler enhancement?**

### Arguments For ✅

- Valuable development tool for identifying performance issues
- Automatically detects React infinite loops
- Low risk to production (development-only)
- Well-tested upstream implementation
- Clear separation from user-facing features

### Arguments Against ❌

- 11-18 hours of implementation effort
- Command naming collision requires resolution
- Adds dependency (mnemonist)
- Complete rewrite of DebugProfiler component
- Not a user-facing feature (only for developers)

### Recommendation

**DEFER to future work** unless:
1. Developers report need for better performance debugging tools
2. Experiencing React performance issues that need diagnosis
3. Want to stay closer to upstream for easier future merges

The keybinding change (adding `shift: false`) could be applied independently as a low-effort alignment with upstream.

---

## Next Steps if Approved

1. Create GitHub issue tracking this work
2. Set up development branch: `feature/debug-profiler-enhancement`
3. Begin Phase 1 (preparation)
4. Implement phases incrementally with testing after each
5. Create PR when complete with full test results

---

## References

- Upstream commit: `34ba8be8` (Oct 7, 2025)
- Original PR: #10502 (gemini-cli)
- Related commit analysis: `project-plans/20251123gmerge/analysis.md`
- Remediation plan: `project-plans/20251123gmerge/remediation-plan.md`
