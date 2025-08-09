# Task 3A: Git Statistics Tracking - Behavioral Tests

## Objective
Write behavioral tests FIRST for git statistics tracking feature following test-first development.

## For: typescript-code-reviewer subagent

## Test Requirements (Write These FIRST)

### File: `packages/cli/src/providers/logging/git-stats.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { GitStatsTracker } from './git-stats';
import { Config } from '@vybestack/llxprt-code-core';

describe('Git Statistics Tracking', () => {
  describe('Privacy-First Behavior', () => {
    it('should NOT track anything when logging is disabled', async () => {
      const config = new Config({ 
        telemetry: { logConversations: false } 
      });
      const tracker = new GitStatsTracker(config);
      
      const stats = await tracker.trackFileEdit('test.ts', 
        'old content', 
        'new content with more lines'
      );
      
      expect(stats).toBeNull();
    });

    it('should track stats locally when logging is enabled', async () => {
      const config = new Config({ 
        telemetry: { logConversations: true } 
      });
      const tracker = new GitStatsTracker(config);
      
      const stats = await tracker.trackFileEdit('test.ts',
        'line1\nline2',
        'line1\nline2\nline3\nline4'
      );
      
      expect(stats).toEqual({
        linesAdded: 2,
        linesRemoved: 0,
        filesChanged: 1
      });
    });

    it('should NEVER send data externally', async () => {
      // Mock any external calls to ensure they never happen
      const config = new Config({ 
        telemetry: { 
          logConversations: true,
          target: 'gcp' // Even with GCP target
        } 
      });
      const tracker = new GitStatsTracker(config);
      
      // Spy on any network calls
      const networkSpy = vi.spyOn(global, 'fetch');
      
      await tracker.trackFileEdit('test.ts', 'old', 'new');
      
      expect(networkSpy).not.toHaveBeenCalled();
    });
  });

  describe('Statistics Calculation', () => {
    it('should correctly count added lines', async () => {
      const config = new Config({ 
        telemetry: { logConversations: true } 
      });
      const tracker = new GitStatsTracker(config);
      
      const stats = await tracker.trackFileEdit('file.ts',
        'line1',
        'line1\nline2\nline3'
      );
      
      expect(stats?.linesAdded).toBe(2);
    });

    it('should correctly count removed lines', async () => {
      const config = new Config({ 
        telemetry: { logConversations: true } 
      });
      const tracker = new GitStatsTracker(config);
      
      const stats = await tracker.trackFileEdit('file.ts',
        'line1\nline2\nline3',
        'line1'
      );
      
      expect(stats?.linesRemoved).toBe(2);
    });

    it('should handle mixed additions and removals', async () => {
      const config = new Config({ 
        telemetry: { logConversations: true } 
      });
      const tracker = new GitStatsTracker(config);
      
      const stats = await tracker.trackFileEdit('file.ts',
        'line1\nline2\nline3',
        'line1\nmodified2\nline3\nline4'
      );
      
      expect(stats?.linesAdded).toBe(2); // modified2 and line4
      expect(stats?.linesRemoved).toBe(1); // line2
    });
  });

  describe('Integration with Logging System', () => {
    it('should include stats in conversation logs', async () => {
      const config = new Config({ 
        telemetry: { logConversations: true } 
      });
      const tracker = new GitStatsTracker(config);
      
      const stats = await tracker.trackFileEdit('file.ts',
        'old',
        'new\ncontent'
      );
      
      const logEntry = tracker.getLogEntry();
      expect(logEntry).toMatchObject({
        type: 'git_stats',
        stats: {
          linesAdded: expect.any(Number),
          linesRemoved: expect.any(Number),
          filesChanged: 1
        },
        timestamp: expect.any(String)
      });
    });

    it('should aggregate stats across multiple edits', async () => {
      const config = new Config({ 
        telemetry: { logConversations: true } 
      });
      const tracker = new GitStatsTracker(config);
      
      await tracker.trackFileEdit('file1.ts', 'old', 'new\nline');
      await tracker.trackFileEdit('file2.ts', 'content', 'modified');
      
      const summary = tracker.getSummary();
      expect(summary.filesChanged).toBe(2);
      expect(summary.totalLinesAdded).toBeGreaterThan(0);
    });
  });

  describe('Simple On/Off Control', () => {
    it('should have binary control - no fine-grained settings', async () => {
      const config = new Config({ 
        telemetry: { logConversations: true } 
      });
      const tracker = new GitStatsTracker(config);
      
      // Should track when on
      expect(tracker.isEnabled()).toBe(true);
      
      // Should not have complex configuration
      expect(tracker.hasComplexSettings()).toBe(false);
    });

    it('should respect runtime toggle', async () => {
      const config = new Config({ 
        telemetry: { logConversations: false } 
      });
      const tracker = new GitStatsTracker(config);
      
      expect(tracker.isEnabled()).toBe(false);
      
      // Toggle on
      config.updateTelemetrySettings({ logConversations: true });
      expect(tracker.isEnabled()).toBe(true);
      
      // Toggle off
      config.updateTelemetrySettings({ logConversations: false });
      expect(tracker.isEnabled()).toBe(false);
    });
  });
});
```

## Integration Test Requirements

### File: `packages/cli/src/providers/logging/git-stats.integration.test.ts`

```typescript
describe('Git Stats Integration', () => {
  it('should track stats during actual file edits', async () => {
    // Test with real file operations
  });

  it('should persist stats to conversation log file', async () => {
    // Verify stats appear in ~/.llxprt/conversations/
  });

  it('should display stats in /logging show command', async () => {
    // Verify stats are visible to users
  });
});
```

## Success Criteria
- All tests pass
- No external data transmission
- Simple on/off control
- Integrates with existing logging system
- Stats stored locally only