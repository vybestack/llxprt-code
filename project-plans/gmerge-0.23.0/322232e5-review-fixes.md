# Plan Review Fixes Summary

## Changes Made to 322232e5-plan.md

### 1. Added Mandatory TDD Requirements

**Status:** [OK] COMPLETE

**Changes:**
- Added prominent warning at start of TDD phase
- Explicitly states: "Write behavioral tests FIRST. Include edge cases: no response (timeout), malformed response, split chunks, alternate terminators (BEL vs ST). Run — confirm RED. Then implement. Run — confirm GREEN."
- Added comprehensive OSC 11 parsing tests with edge cases:
  - Non-TTY detection
  - Timeout (no response)
  - ST terminator (ESC \)
  - BEL terminator (\x07)
  - Split chunks (multiple data events)
  - Malformed responses
  - Cleanup verification

### 2. Made Wiring Plan Concrete

**Status:** [OK] COMPLETE

**Changes:**
- Specified EXACT integration point: gemini.tsx line 283 (BEFORE detectAndEnableKittyProtocol)
- Documented current theme initialization via useThemeCommand.ts
- Provided step-by-step threading through component hierarchy:
  * App.tsx: Add terminalBackgroundColor to AppProps interface (~line 30)
  * App.tsx: Props automatically spread to AppWithState and AppContainer
  * AppContainer.tsx: Add to UIState initialization (~line 2027)
  * UIStateContext.tsx: Add field to interface (~line 47)
  * gemini.tsx: Detect at line 282-283, pass to AppWrapper at ~line 310
- Each step has exact line numbers and context

### 3. Trimmed Scope Creep

**Status:** [OK] COMPLETE

**Removed from scope:**
- ThemeDialog sorting by compatibility
- "(Incompatible)" and "(Matches terminal)" labels
- Custom renderItem prop for RadioButtonSelect
- Any visual changes to theme list presentation

**Kept in scope:**
- Only initial theme selection logic using pickDefaultThemeName

**Updates:**
- Updated "Out of Scope" section to explicitly list all removed features
- Updated implementation checklist to reflect minimal scope
- Updated Step 3d to show MINIMAL CHANGE only

### 4. Added Robustness for Split Chunks and Alternate Terminators

**Status:** [OK] COMPLETE

**Changes:**
- Enhanced detectTerminalBackgroundColor JSDoc with 6 robustness features:
  1. Split chunks handling
  2. Alternate terminators (ST and BEL)
  3. Timeout protection
  4. Malformed response handling
  5. Non-TTY detection
  6. Proper cleanup
- Added inline comments explaining RGB conversion (16-bit to 8-bit)
- Documented terminator formats with standards references
- All robustness features have corresponding tests

## Summary

All four review findings have been addressed:

1. [OK] Mandatory TDD with comprehensive edge case tests
2. [OK] Concrete wiring plan with exact line numbers
3. [OK] Scope creep removed (no UI changes beyond initial selection)
4. [OK] Robustness documented and tested (split chunks, terminators)

**The plan is now ready for implementation.**

## Key Changes to Implementation

### Before Review:
- Vague wiring instructions ("search for where UIState is constructed")
- Included sorting and labeling features not in upstream
- Missing tests for timeout, split chunks, and alternate terminators
- Generic robustness comments

### After Review:
- Exact line numbers for every integration point
- Minimal scope: ONLY initial theme selection
- Comprehensive tests covering all edge cases
- Detailed robustness documentation with 6 explicit features

## Files Modified

- project-plans/gmerge-0.23.0/322232e5-plan.md (4 major sections updated)
