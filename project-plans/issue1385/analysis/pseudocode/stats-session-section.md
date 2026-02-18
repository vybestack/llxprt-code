# Pseudocode: /stats Session Info Section

## Interface Contracts

```typescript
// INPUTS
// SessionRecordingMetadata available from CommandContext or session state
interface SessionRecordingMetadata {
  sessionId: string;
  filePath: string | null;
  startTime: string;      // ISO-8601
  isResumed: boolean;
}

// OUTPUTS
// Additional section appended to stats output text

// DEPENDENCIES
// - formatRelativeTime() from utils
// - formatFileSize() from utils
// - fs.stat() for file size lookup
```

## Integration Points

```
Line 10: MODIFY packages/cli/src/ui/commands/statsCommand.ts
         - Add session section after existing sections
         - Access metadata from CommandContext

Line 20: IMPORT formatRelativeTime from ../utils/formatRelativeTime
         - Used for start time display

Line 25: IMPORT formatFileSize from ../utils/formatFileSize
         - Used for file size display
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Read session file directly for metadata
[OK] DO: Use SessionRecordingMetadata from the command context

[ERROR] DO NOT: Display full session ID
[OK] DO: Truncate to first 12 characters
```

## Stats Section Implementation

```
10: // In statsCommand.ts action function, add section:
11:
12: FUNCTION formatSessionSection(metadata: SessionRecordingMetadata | null): string[]
13:   LET lines: string[] = []
14:   lines.push('')
15:   lines.push('Session:')
16:
17:   IF metadata IS null THEN
18:     lines.push('  No active session recording.')
19:     RETURN lines
20:   END IF
21:
22:   // Session ID (first 12 chars)
23:   lines.push('  ID: ' + metadata.sessionId.substring(0, 12))
24:
25:   // Start time (relative)
26:   LET startDate = new Date(metadata.startTime)
27:   lines.push('  Started: ' + formatRelativeTime(startDate))
28:
29:   // File size (if file exists)
30:   IF metadata.filePath THEN
31:     TRY
32:       LET stat = AWAIT fs.stat(metadata.filePath)
33:       lines.push('  File size: ' + formatFileSize(stat.size))
34:     CATCH
35:       // File might not exist yet (deferred materialization)
36:       lines.push('  File size: (not yet created)')
37:     END TRY
38:   END IF
39:
40:   // Resumed status
41:   lines.push('  Resumed: ' + (metadata.isResumed ? 'yes' : 'no'))
42:
43:   RETURN lines
44: END FUNCTION
```

## Metadata Population

```
50: // SessionRecordingMetadata is populated:
51: // 1. During startup in gemini.tsx when recording starts:
52: //    metadata = { sessionId: recording.getSessionId(), filePath: recording.getFilePath(),
53: //                 startTime: new Date().toISOString(), isResumed: false }
54: //
55: // 2. During --continue resume at startup:
56: //    metadata = { sessionId: result.metadata.sessionId, filePath: ...,
57: //                 startTime: result.metadata.startTime, isResumed: true }
58: //
59: // 3. During /continue command (browser or direct):
60: //    metadata = { sessionId: result.metadata.sessionId, filePath: result.newRecording.getFilePath(),
61: //                 startTime: result.metadata.startTime, isResumed: true }
```
