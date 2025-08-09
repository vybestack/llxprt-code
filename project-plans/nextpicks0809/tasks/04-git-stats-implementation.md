# Task 3B: Git Statistics Tracking - Implementation

## Objective
Implement git statistics tracking with privacy-first approach AFTER tests are written.

## For: typescript-coder subagent

## Prerequisites
- Task 03-git-stats-behavioral-tests.md must be completed first
- All tests must be written and failing

## Implementation Requirements

### 1. Create GitStatsTracker Class
**File**: `packages/cli/src/providers/logging/git-stats.ts`

```typescript
export class GitStatsTracker {
  private enabled: boolean;
  private sessionStats: SessionStats;

  constructor(private config: Config) {
    this.enabled = config.getConversationLoggingEnabled();
    this.sessionStats = {
      filesChanged: new Set<string>(),
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    };
  }

  async trackFileEdit(
    filePath: string,
    oldContent: string,
    newContent: string
  ): Promise<GitStats | null> {
    if (!this.enabled) {
      return null;
    }

    // Calculate diff statistics
    const stats = this.calculateStats(oldContent, newContent);
    
    // Update session stats
    this.sessionStats.filesChanged.add(filePath);
    this.sessionStats.totalLinesAdded += stats.linesAdded;
    this.sessionStats.totalLinesRemoved += stats.linesRemoved;

    // Return stats for logging
    return {
      ...stats,
      filesChanged: this.sessionStats.filesChanged.size,
    };
  }

  private calculateStats(oldContent: string, newContent: string): DiffStats {
    // Simple line-based diff
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    // This is simplified - real implementation would use diff algorithm
    const added = Math.max(0, newLines.length - oldLines.length);
    const removed = Math.max(0, oldLines.length - newLines.length);

    return {
      linesAdded: added,
      linesRemoved: removed,
    };
  }
}
```

### 2. Integrate with Edit/Write Tools
**Files to modify**:
- `packages/core/src/tools/edit.ts`
- `packages/core/src/tools/write-file.ts`

Add tracking calls:
```typescript
// In edit tool
if (config.getConversationLoggingEnabled()) {
  const tracker = getGitStatsTracker();
  const stats = await tracker.trackFileEdit(
    filePath,
    oldContent,
    newContent
  );
  
  if (stats) {
    // Include in tool response metadata
    metadata.gitStats = stats;
  }
}
```

### 3. Include Stats in Conversation Logs
**File**: `packages/core/src/providers/LoggingProviderWrapper.ts`

Add stats to logged tool calls:
```typescript
private logToolCall(tool: ITool, result: any) {
  const entry = {
    type: 'tool_call',
    tool: tool.name,
    timestamp: new Date().toISOString(),
    // Include git stats if present
    gitStats: result.metadata?.gitStats,
  };
  
  this.writeToLog(entry);
}
```

### 4. Display Stats in /logging show
**File**: `packages/cli/src/ui/commands/loggingCommand.ts`

Format stats in output:
```typescript
if (entry.gitStats) {
  const { linesAdded, linesRemoved, filesChanged } = entry.gitStats;
  content += ` [+${linesAdded} -${linesRemoved} in ${filesChanged} files]`;
}
```

## Implementation Principles

### Privacy First
- NO external transmission
- NO telemetry to Google/GCP
- Local storage only
- Respects user's logging preference

### Simple Control
- On when logging is enabled
- Off when logging is disabled
- No separate configuration
- No fine-grained settings

### Integration
- Works with existing logging system
- Uses same storage location
- Visible in /logging show
- Part of conversation logs

## Files to Create/Modify

1. **New Files**:
   - `packages/cli/src/providers/logging/git-stats.ts`
   - `packages/cli/src/providers/logging/git-stats.test.ts`

2. **Modified Files**:
   - `packages/core/src/tools/edit.ts`
   - `packages/core/src/tools/write-file.ts`
   - `packages/core/src/providers/LoggingProviderWrapper.ts`
   - `packages/cli/src/ui/commands/loggingCommand.ts`

## Testing Checklist
- [ ] All behavioral tests pass
- [ ] Integration tests pass
- [ ] No external data transmission
- [ ] Stats appear in logs when enabled
- [ ] No tracking when disabled
- [ ] Runtime toggle works

## Success Criteria
- Feature works exactly as specified in tests
- No privacy violations
- Clean integration with existing system
- Simple, maintainable code