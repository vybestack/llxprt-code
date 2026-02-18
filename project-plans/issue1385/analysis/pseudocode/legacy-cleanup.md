# Pseudocode: Legacy Cleanup (--resume Flag Removal)

## Interface Contracts

```typescript
// This pseudocode covers removal of the --resume / -r CLI flag
// and related exports from sessionUtils.ts.

// REMOVED types:
// - SessionSelector (type)
// - SessionSelectionResult (interface)
// - RESUME_LATEST (constant)

// PRESERVED types (used by sessionCleanup.ts):
// - SessionInfo (interface)
// - SessionFileEntry (interface)
// - getSessionFiles() (function)
// - getAllSessionFiles() (function)

// UNCHANGED functionality:
// - --continue / -C flag (entire flow)
// - --list-sessions flag
// - --delete-session flag
```

## Integration Points

```
Line 10: MODIFY packages/cli/src/config/config.ts
         - Remove .option('resume', ...) from yargs chain
         - Remove 'resume' field from parsed args type
         - Remove RESUME_LATEST import

Line 20: MODIFY packages/cli/src/utils/sessionUtils.ts
         - Remove RESUME_LATEST export
         - Remove SessionSelector type export
         - Remove SessionSelectionResult interface export
         - Keep SessionInfo, SessionFileEntry, getSessionFiles, getAllSessionFiles

Line 30: SEARCH all files for references to 'args.resume' and remove
         - Any conditional logic based on args.resume
         - Any code paths that use RESUME_LATEST
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Remove SessionInfo, SessionFileEntry, getSessionFiles, getAllSessionFiles
[OK] DO: These are used by sessionCleanup.ts and must be preserved

[ERROR] DO NOT: Modify the --continue / -C flag behavior
[OK] DO: Leave the entire --continue flow untouched

[ERROR] DO NOT: Leave dead imports of RESUME_LATEST
[OK] DO: Remove all imports of removed exports
```

## Config Changes

```
10: // In packages/cli/src/config/config.ts
11:
12: // REMOVE these lines (~349-357):
13: // .option('resume', {
14: //   alias: 'r',
15: //   type: 'string',
16: //   skipValidation: true,
17: //   description: 'Resume a previous session',
18: //   coerce: (value) => {
19: //     if (value === '' || value === true) return RESUME_LATEST;
20: //     return String(value);
21: //   }
22: // })
23:
24: // REMOVE from import section:
25: // import { RESUME_LATEST } from '../utils/sessionUtils.js'
26:
27: // REMOVE from parsed args interface (RESUME_LATEST is string 'latest', not Symbol):
28: // resume: string | typeof RESUME_LATEST | undefined  // line 167
29:
30: // SEARCH for any code using args.resume and remove:
31: // e.g., if (args.resume) { ... }
```

## sessionUtils Changes

```
40: // In packages/cli/src/utils/sessionUtils.ts
41:
42: // REMOVE:
43: // export const RESUME_LATEST = 'latest'  // string constant, NOT Symbol
44: // export class SessionSelector { ... }
45: // - SessionSelector.listSessions()
46: // - SessionSelector.findSession()
47: // - SessionSelector.resolveSession()
48: // export interface SessionSelectionResult { sessionPath, sessionData }
49:
50: // KEEP:
51: // export interface SessionInfo { id, file, fileName, startTime, lastUpdated, firstUserMessage, isCurrentSession }
52: // export interface SessionFileEntry { fileName, sessionInfo: SessionInfo | null }
53: // export function getSessionFiles(chatsDir, currentSessionId?) { ... }
54: // export function getAllSessionFiles(chatsDir, currentSessionId?) { ... }
```

## Test File Changes

```
60: // In packages/cli/src/config/config.test.ts (or similar)
61: // REMOVE test cases for --resume flag parsing
62: // REMOVE test cases for RESUME_LATEST coercion
63:
64: // DO NOT MODIFY tests for --continue / -C
```

## Verification After Removal

```
70: // After removing --resume:
71: // 1. grep -r "RESUME_LATEST" packages/cli/src/ → should have 0 matches
72: // 2. grep -r "SessionSelector" packages/cli/src/ → should have 0 matches
73: // 3. grep -r "args\.resume" packages/cli/src/ → should have 0 matches
74: // 4. grep -r "option.*resume" packages/cli/src/config/ → should have 0 matches (except comments)
75: // 5. npm run typecheck → should pass (no missing references)
76: // 6. npm run test → should pass (no broken tests)
```
