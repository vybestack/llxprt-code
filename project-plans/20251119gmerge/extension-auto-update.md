# Extension Auto-Update Implementation Plan

## Executive Summary

This plan outlines the implementation of automatic extension updates in llxprt-code. The system will check for updates on startup and periodically during runtime, notify users of available updates, and automatically install them based on user preferences. The implementation will leverage existing GitHub release infrastructure and follow patterns from the CLI auto-update mechanism. It is inspired by upstream commit [`22b7d865`](https://github.com/google-gemini/gemini-cli/commit/22b7d86574d9a8db1daeb34741f0350e871566ee) ("Add support for auto-updating git extensions").

## Implementation Status (2025-11-21)

- ✅ `packages/cli/src/extensions/extensionAutoUpdater.ts` provides the background checker/installer with persisted state (`~/.llxprt/extension-update-state.json`) plus configurable scheduling/notification.
- ✅ `packages/cli/src/extensions/extensionAutoUpdater.test.ts` exercises immediate, on-restart, and manual flows.
- ✅ UI wiring via `useExtensionAutoUpdate()` (AppContainer) surfaces console notifications for queued/finished updates.
- ✅ `settingsSchema.ts` exposes `extensions.autoUpdate` (enabled by default, interval, install mode, notification level, per-extension overrides).
- ✅ Pending installs created in “on-restart” mode are completed automatically the next time llxprt-code launches.

## Upstream Reference Summary

- Watches installed git extensions and compares installed SHA against origin.
- Adds a background job that checks for updates on startup and on an interval.
- Persists the "last checked" timestamp so repeated restarts do not hammer GitHub.
- Updates run serially and emit status events to the UI so a toast can surface progress/failures.

## 1. Current State Analysis

### Existing Manual Update Infrastructure

**Update Commands** (`packages/cli/src/commands/extensions/update.ts`):
- `updateExtensionByName()` - Updates single extension
- `updateAllUpdatableExtensions()` - Updates all extensions
- Returns `ExtensionUpdateInfo` with version change details

**GitHub Release Support** (`packages/cli/src/config/extensions/github.ts`):
- `ExtensionUpdateState` enum with states:
  - `CHECKING_FOR_UPDATES`
  - `UPDATE_AVAILABLE`
  - `UPDATING`
  - `UPDATED_NEEDS_RESTART`
  - `UP_TO_DATE`
  - `ERROR`
  - `NOT_UPDATABLE`
- `checkForExtensionUpdate()` - Checks git/github-release for updates
- `downloadFromGitHubRelease()` - Downloads and extracts releases
- `checkGitHubReleasesExist()` - Verifies release availability

**Extension Installation** (`packages/cli/src/config/extension.ts`):
- `ExtensionInstallMetadata` tracks:
  - `source`: URL or path
  - `type`: 'git' | 'github-release' | 'local' | 'link'
  - `ref`: Optional git ref/release tag
- Install metadata stored in `.llxprt-extension-install.json`
- Extension config in `llxprt-extension.json`

**Settings Structure** (`packages/cli/src/config/settingsSchema.ts`):
```typescript
extensions: {
  disabled: string[],
  workspacesWithMigrationNudge: string[]
}
```

### Missing for Auto-Updates

1. **Background update checking mechanism**
2. **Update scheduling/timing logic**
3. **Per-extension update preferences**
4. **Update notification system**
5. **Automatic download and installation**
6. **Version tracking and history**
7. **Rollback mechanism**
8. **Update retry logic**

### CLI Auto-Update Reference

**Update Check** (`packages/cli/src/ui/utils/updateCheck.ts`):
- Uses `update-notifier` npm package
- Checks for updates with timeout (2 seconds)
- Handles nightly vs stable versions
- Returns `UpdateObject` with message and version info
- Respects `DEV=true` environment variable

**Settings Integration**:
- `disableUpdateNag` setting to suppress notifications
- Update checks run on startup

## 2. Design Decisions

### Update Check Timing

**On Startup**:
- Check all extensions after CLI loads
- Non-blocking with 2-second timeout per extension
- Cache results for session

**Periodic Checks**:
- Every 24 hours for installed extensions
- Store last check timestamp per extension
- Stagger checks to avoid burst traffic

**On Demand**:
- Manual check via `llxprt extensions update --check`
- Before running extension commands

### User Notification Strategy

**Notification Types**:
1. **Silent** - Log only, no UI interruption
2. **Badge** - Visual indicator in UI/status
3. **Toast** - Non-blocking notification
4. **Dialog** - Blocking confirmation for major updates

**Notification Rules**:
- Patch versions (x.x.1 → x.x.2): Silent
- Minor versions (x.1.0 → x.2.0): Toast
- Major versions (1.0.0 → 2.0.0): Dialog
- Security updates: Always Dialog

### Settings Schema

```typescript
// In settingsSchema.ts - extend existing extensions object
extensions: {
  disabled: string[],
  workspacesWithMigrationNudge: string[],
  autoUpdate: {
    enabled: boolean,              // Global auto-update toggle
    checkInterval: number,          // Hours between checks (default: 24)
    installMode: 'immediate' | 'on-restart' | 'manual',
    notificationLevel: 'silent' | 'toast' | 'dialog',
    perExtension: {
      [extensionName: string]: {
        enabled: boolean,
        installMode?: 'immediate' | 'on-restart' | 'manual',
        pinnedVersion?: string,     // Lock to specific version
        channel?: 'stable' | 'beta' | 'nightly'
      }
    }
  },
  updateHistory: {
    [extensionName: string]: {
      lastCheck: number,            // Unix timestamp
      lastUpdate: number,           // Unix timestamp
      currentVersion: string,
      availableVersion?: string,
      updateState: ExtensionUpdateState,
      failureCount: number,         // For retry logic
      rollbackVersion?: string      // Previous version for rollback
    }
  }
}
```

### Update Retry Logic

```typescript
interface RetryConfig {
  maxAttempts: 3,
  backoffMultiplier: 2,
  initialDelay: 60000,  // 1 minute
  maxDelay: 3600000     // 1 hour
}

// Retry on:
// - Network failures
// - GitHub API rate limiting
// - Temporary file system errors

// Don't retry on:
// - Version conflicts
// - Incompatible platform
// - Authentication failures
```

### Rollback Mechanism

**Automatic Rollback Triggers**:
- Extension fails to load after update
- Runtime errors within 5 minutes of update
- User-initiated via command

**Rollback Process**:
1. Keep previous version in `.llxprt/extensions/.backup/[name]-[version]`
2. On failure, swap directories
3. Update metadata to reflect rollback
4. Log rollback for debugging

## 3. Implementation Phases

### Phase 1: Background Update Checking

> **Status:** Implemented via `ExtensionAutoUpdater` (packages/cli/src/extensions/extensionAutoUpdater.ts) with persisted state + Vitest coverage.

**New Files**:
```typescript
// packages/cli/src/extensions/update-checker.ts
export class ExtensionUpdateChecker {
  private updateCheckInterval: NodeJS.Timer | null = null;
  private updateQueue: Map<string, ExtensionUpdateTask>;

  constructor(
    private settings: Settings,
    private extensions: Extension[]
  ) {}

  async startBackgroundChecking(): Promise<void> {
    // Initial check on startup
    await this.checkAllExtensions();

    // Schedule periodic checks
    const interval = this.settings.extensions?.autoUpdate?.checkInterval || 24;
    this.updateCheckInterval = setInterval(
      () => this.checkAllExtensions(),
      interval * 60 * 60 * 1000
    );
  }

  async checkAllExtensions(): Promise<ExtensionUpdateStatus[]> {
    const results = await Promise.allSettled(
      this.extensions.map(ext => this.checkExtension(ext))
    );

    // Update settings with check timestamps and results
    await this.updateCheckHistory(results);

    // Notify UI of available updates
    this.emitUpdateNotifications(results);

    return results;
  }

  private async checkExtension(extension: Extension): Promise<ExtensionUpdateStatus> {
    // Skip if disabled or pinned
    if (!this.shouldCheckExtension(extension)) {
      return { name: extension.config.name, state: 'SKIPPED' };
    }

    // Add timeout wrapper
    const timeout = new Promise<ExtensionUpdateStatus>((_, reject) =>
      setTimeout(() => reject(new Error('Check timeout')), 2000)
    );

    const check = checkForExtensionUpdate(extension.installMetadata);

    try {
      const state = await Promise.race([check, timeout]);
      return {
        name: extension.config.name,
        state,
        currentVersion: extension.config.version,
        availableVersion: await this.getLatestVersion(extension)
      };
    } catch (error) {
      return {
        name: extension.config.name,
        state: ExtensionUpdateState.ERROR,
        error: error.message
      };
    }
  }

  stopBackgroundChecking(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }
}

// packages/cli/src/extensions/types.ts
export interface ExtensionUpdateStatus {
  name: string;
  state: ExtensionUpdateState | 'SKIPPED';
  currentVersion?: string;
  availableVersion?: string;
  error?: string;
}

export interface ExtensionUpdateTask {
  extension: Extension;
  status: ExtensionUpdateStatus;
  retryCount: number;
  nextRetryTime?: number;
}
```

**Integration Points**:
```typescript
// packages/cli/src/gemini.tsx - Add to startup
const updateChecker = new ExtensionUpdateChecker(settings, extensions);
if (settings.extensions?.autoUpdate?.enabled !== false) {
  await updateChecker.startBackgroundChecking();
}

// Clean up on shutdown
process.on('SIGTERM', () => updateChecker.stopBackgroundChecking());
```

### Phase 2: Notification System

> **Status:** Completed — notifications flow through `useExtensionAutoUpdate()` and `handleNewMessage`, emitting toast-style output without blocking the UI.

**New Components**:
```typescript
// packages/cli/src/extensions/update-notifier.ts
export class ExtensionUpdateNotifier {
  constructor(
    private ui: UIComponentRef,
    private settings: Settings
  ) {}

  notify(updates: ExtensionUpdateStatus[]): void {
    const availableUpdates = updates.filter(u =>
      u.state === ExtensionUpdateState.UPDATE_AVAILABLE
    );

    if (availableUpdates.length === 0) return;

    const level = this.determineNotificationLevel(availableUpdates);

    switch (level) {
      case 'silent':
        this.logUpdates(availableUpdates);
        break;
      case 'toast':
        this.showToastNotification(availableUpdates);
        break;
      case 'dialog':
        this.showUpdateDialog(availableUpdates);
        break;
    }
  }

  private determineNotificationLevel(updates: ExtensionUpdateStatus[]): NotificationLevel {
    // Check for security updates (requires metadata enhancement)
    if (updates.some(u => u.securityUpdate)) {
      return 'dialog';
    }

    // Check for major version changes
    if (updates.some(u => this.isMajorUpdate(u))) {
      return 'dialog';
    }

    // Use configured default
    return this.settings.extensions?.autoUpdate?.notificationLevel || 'toast';
  }

  private isMajorUpdate(update: ExtensionUpdateStatus): boolean {
    if (!update.currentVersion || !update.availableVersion) return false;

    const current = semver.parse(update.currentVersion);
    const available = semver.parse(update.availableVersion);

    return available.major > current.major;
  }

  private showToastNotification(updates: ExtensionUpdateStatus[]): void {
    const message = updates.length === 1
      ? `Extension "${updates[0].name}" has an update available`
      : `${updates.length} extensions have updates available`;

    this.ui.showToast({
      message,
      action: 'Update Now',
      onAction: () => this.initiateUpdate(updates)
    });
  }

  private showUpdateDialog(updates: ExtensionUpdateStatus[]): void {
    this.ui.showModal({
      title: 'Extension Updates Available',
      content: this.renderUpdateList(updates),
      buttons: [
        { label: 'Update All', action: () => this.updateAll(updates) },
        { label: 'Select...', action: () => this.selectiveUpdate(updates) },
        { label: 'Later', action: 'dismiss' }
      ]
    });
  }
}
```

**UI Integration**:
```typescript
// packages/cli/src/ui/components/ExtensionUpdateBadge.tsx
export function ExtensionUpdateBadge({ updateCount }: { updateCount: number }) {
  if (updateCount === 0) return null;

  return (
    <Box>
      <Text color="yellow">⬆ {updateCount} update{updateCount !== 1 ? 's' : ''}</Text>
    </Box>
  );
}

// Add to footer or status bar
```

### Phase 3: Automatic Installation

> **Status:** Completed — `ExtensionAutoUpdater` supports `immediate`, `on-restart`, and `manual` install modes, queuing pending installs when necessary.

**Installation Manager**:
```typescript
// packages/cli/src/extensions/update-installer.ts
export class ExtensionUpdateInstaller {
  private installQueue: ExtensionUpdateTask[] = [];
  private installing = false;

  constructor(
    private settings: Settings,
    private eventBus: EventEmitter
  ) {}

  async installUpdate(
    extension: Extension,
    mode: 'immediate' | 'on-restart' | 'manual' = 'immediate'
  ): Promise<ExtensionUpdateInfo> {
    // Backup current version
    await this.backupExtension(extension);

    try {
      // Perform update based on type
      const updateInfo = await this.performUpdate(extension);

      // Update metadata
      await this.updateMetadata(extension, updateInfo);

      // Emit success event
      this.eventBus.emit('extension:updated', updateInfo);

      // Handle restart if needed
      if (mode === 'immediate' && this.requiresRestart(extension)) {
        this.scheduleRestart();
      }

      return updateInfo;
    } catch (error) {
      // Attempt rollback
      await this.rollbackExtension(extension);

      // Update failure count for retry logic
      await this.recordFailure(extension, error);

      throw error;
    }
  }

  private async performUpdate(extension: Extension): Promise<ExtensionUpdateInfo> {
    const { installMetadata } = extension;

    if (!installMetadata) {
      throw new Error(`No install metadata for ${extension.config.name}`);
    }

    switch (installMetadata.type) {
      case 'github-release':
        return await this.updateGitHubRelease(extension);
      case 'git':
        return await this.updateGitRepo(extension);
      default:
        throw new Error(`Cannot auto-update ${installMetadata.type} extensions`);
    }
  }

  private async updateGitHubRelease(extension: Extension): Promise<ExtensionUpdateInfo> {
    const tempDir = await ExtensionStorage.createTmpDir();

    try {
      // Download latest release
      const result = await downloadFromGitHubRelease(
        { ...extension.installMetadata, ref: undefined }, // Get latest
        tempDir
      );

      // Read new version
      const configPath = path.join(tempDir, EXTENSIONS_CONFIG_FILENAME);
      const newConfig = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));

      // Swap directories
      const extensionDir = extension.path;
      const backupDir = this.getBackupPath(extension);

      await fs.promises.rename(extensionDir, backupDir);
      await fs.promises.rename(tempDir, extensionDir);

      // Update install metadata
      const newMetadata = {
        ...extension.installMetadata,
        ref: result.tagName
      };

      await fs.promises.writeFile(
        path.join(extensionDir, INSTALL_METADATA_FILENAME),
        JSON.stringify(newMetadata, null, 2)
      );

      return {
        name: extension.config.name,
        originalVersion: extension.config.version,
        updatedVersion: newConfig.version
      };
    } catch (error) {
      // Clean up temp dir on failure
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  private async updateGitRepo(extension: Extension): Promise<ExtensionUpdateInfo> {
    const git = simpleGit(extension.path);

    // Store current version
    const originalHash = await git.revparse(['HEAD']);
    const originalVersion = extension.config.version;

    // Fetch and update
    await git.fetch();
    await git.pull();

    // Read new version
    const configPath = path.join(extension.path, EXTENSIONS_CONFIG_FILENAME);
    const newConfig = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));

    return {
      name: extension.config.name,
      originalVersion,
      updatedVersion: newConfig.version
    };
  }

  private async backupExtension(extension: Extension): Promise<void> {
    const backupDir = this.getBackupPath(extension);
    await fs.promises.cp(extension.path, backupDir, { recursive: true });
  }

  private async rollbackExtension(extension: Extension): Promise<void> {
    const backupDir = this.getBackupPath(extension);

    if (!fs.existsSync(backupDir)) {
      throw new Error(`No backup found for ${extension.config.name}`);
    }

    // Swap back
    const tempName = `${extension.path}.failed`;
    await fs.promises.rename(extension.path, tempName);
    await fs.promises.rename(backupDir, extension.path);
    await fs.promises.rm(tempName, { recursive: true, force: true });

    // Log rollback
    console.error(`Rolled back ${extension.config.name} to previous version`);
  }

  private getBackupPath(extension: Extension): string {
    const storage = new ExtensionStorage(extension.config.name);
    return path.join(
      path.dirname(storage.getExtensionDir()),
      '.backup',
      `${extension.config.name}-${extension.config.version}`
    );
  }
}
```

### Phase 4: Settings Integration

> **Status:** Completed — `extensions.autoUpdate` (settingsSchema.ts) exposes enable/interval/installMode/notification/per-extension overrides with defaults.

**Settings UI Commands**:
```typescript
// packages/cli/src/ui/commands/extensionSettingsCommand.ts
export async function extensionSettingsCommand(args: string[]): Promise<void> {
  const [action, ...params] = args;

  switch (action) {
    case 'auto-update':
      await toggleAutoUpdate(params[0]);
      break;
    case 'pin':
      await pinExtensionVersion(params[0], params[1]);
      break;
    case 'channel':
      await setUpdateChannel(params[0], params[1]);
      break;
    case 'check-now':
      await checkForUpdatesNow();
      break;
    default:
      showExtensionSettings();
  }
}

async function showExtensionSettings(): Promise<void> {
  const settings = await loadSettings();
  const extensions = loadExtensions();

  console.log('Extension Auto-Update Settings:');
  console.log(`  Enabled: ${settings.extensions?.autoUpdate?.enabled ?? true}`);
  console.log(`  Check Interval: ${settings.extensions?.autoUpdate?.checkInterval ?? 24} hours`);
  console.log(`  Install Mode: ${settings.extensions?.autoUpdate?.installMode ?? 'on-restart'}`);
  console.log('');
  console.log('Per-Extension Settings:');

  for (const ext of extensions) {
    const extSettings = settings.extensions?.autoUpdate?.perExtension?.[ext.config.name];
    console.log(`  ${ext.config.name}:`);
    console.log(`    Version: ${ext.config.version}`);
    console.log(`    Auto-Update: ${extSettings?.enabled ?? true}`);
    if (extSettings?.pinnedVersion) {
      console.log(`    Pinned: ${extSettings.pinnedVersion}`);
    }

    // Show update status
    const history = settings.extensions?.updateHistory?.[ext.config.name];
    if (history?.availableVersion && history.availableVersion !== ext.config.version) {
      console.log(`    Update Available: ${history.availableVersion}`);
    }
  }
}
```

**CLI Arguments Enhancement**:
```typescript
// packages/cli/src/commands/extensions/install.ts - implement --auto-update flag
builder: (yargs) =>
  yargs
    .option('auto-update', {
      describe: 'Enable automatic updates for this extension',
      type: 'boolean',
      default: true
    })

// In handleInstall()
if (args.autoUpdate !== undefined) {
  await updateSettings({
    extensions: {
      autoUpdate: {
        perExtension: {
          [extensionName]: {
            enabled: args.autoUpdate
          }
        }
      }
    }
  });
}
```

### Phase 5: Extension Metadata Improvements

> **Status:** Completed — state is tracked in `~/.llxprt/extension-update-state.json` (last check/update/error/failure counts + pending flags).

**Enhanced Metadata Schema**:
```typescript
// packages/cli/src/config/extension.ts
export interface ExtensionConfig {
  name: string;
  version: string;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFileName?: string | string[];
  excludeTools?: string[];

  // New fields for update support
  updateChannel?: 'stable' | 'beta' | 'nightly';
  minimumCliVersion?: string;    // Minimum llxprt-code version required
  maximumCliVersion?: string;    // Maximum compatible version
  changelog?: string;            // URL to changelog
  securityAdvisory?: {          // For security updates
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    cve?: string;
  };
}

export interface ExtensionInstallMetadata {
  source: string;
  type: 'git' | 'local' | 'link' | 'github-release';
  ref?: string;

  // New fields
  installedAt: number;          // Unix timestamp
  installedBy: 'manual' | 'auto-update' | 'migration';
  updateChannel?: string;
  lastModified?: number;        // For detecting manual changes
}
```

**Version Compatibility Checking**:
```typescript
// packages/cli/src/extensions/compatibility.ts
export async function checkExtensionCompatibility(
  extension: ExtensionConfig,
  cliVersion: string
): Promise<CompatibilityResult> {
  const issues: string[] = [];

  if (extension.minimumCliVersion) {
    if (semver.lt(cliVersion, extension.minimumCliVersion)) {
      issues.push(`Requires llxprt-code >= ${extension.minimumCliVersion}`);
    }
  }

  if (extension.maximumCliVersion) {
    if (semver.gt(cliVersion, extension.maximumCliVersion)) {
      issues.push(`Not compatible with llxprt-code > ${extension.maximumCliVersion}`);
    }
  }

  return {
    compatible: issues.length === 0,
    issues
  };
}
```

## 4. Multi-Provider Considerations

### Provider-Specific Extension Behavior

Since llxprt-code supports multiple AI providers, extensions may need provider-specific features:

```typescript
// Extension manifest can specify provider requirements
export interface ExtensionConfig {
  // ... existing fields ...

  providers?: {
    supported?: string[];        // List of supported providers
    required?: string[];         // Required providers
    features?: {
      [provider: string]: {
        tools?: string[];        // Provider-specific tools
        config?: any;           // Provider-specific config
      }
    }
  };
}
```

### Update Strategy per Provider

Different providers may have different update cadences or compatibility requirements:

```typescript
// In update checker
private shouldCheckExtension(extension: Extension): boolean {
  // Check if extension supports current provider
  const currentProvider = this.settings.currentProvider;
  const supportedProviders = extension.config.providers?.supported;

  if (supportedProviders && !supportedProviders.includes(currentProvider)) {
    return false; // Skip updates for unsupported provider
  }

  return true;
}
```

## 5. Testing Strategy

### Unit Tests

**Update Checker Tests** (`packages/cli/src/extensions/update-checker.test.ts`):
```typescript
describe('ExtensionUpdateChecker', () => {
  describe('checkExtension', () => {
    it('should detect available updates for github-release extensions');
    it('should detect available updates for git extensions');
    it('should respect timeout limits');
    it('should skip disabled extensions');
    it('should skip pinned versions');
    it('should handle network failures gracefully');
    it('should update check history in settings');
  });

  describe('background checking', () => {
    it('should check on startup');
    it('should respect check interval');
    it('should clean up timers on stop');
  });
});
```

**Update Installer Tests** (`packages/cli/src/extensions/update-installer.test.ts`):
```typescript
describe('ExtensionUpdateInstaller', () => {
  describe('installUpdate', () => {
    it('should backup before update');
    it('should update github-release extension');
    it('should update git extension');
    it('should rollback on failure');
    it('should update metadata after success');
    it('should handle restart requirements');
  });

  describe('rollback', () => {
    it('should restore from backup');
    it('should clean up failed update');
    it('should log rollback event');
  });
});
```

### Integration Tests

**End-to-End Update Flow** (`integration-tests/extension-updates.test.ts`):
```typescript
describe('Extension Auto-Updates E2E', () => {
  it('should check, notify, and install updates automatically', async () => {
    // 1. Install extension with known update available
    await runCli(['extensions', 'install', 'test/fixture-extension']);

    // 2. Enable auto-update
    await updateSettings({
      extensions: { autoUpdate: { enabled: true, installMode: 'immediate' } }
    });

    // 3. Trigger update check
    await runCli(['extensions', 'update', '--check']);

    // 4. Verify notification shown
    const output = await getCliOutput();
    expect(output).toContain('Update available');

    // 5. Verify automatic installation
    await waitFor(() => extensionUpdated('fixture-extension'));

    // 6. Verify new version running
    const extension = await loadExtension('fixture-extension');
    expect(extension.config.version).toBe('2.0.0');
  });

  it('should rollback on update failure', async () => {
    // Set up extension that will fail to update
    await installFailingExtension();

    // Attempt update
    await runCli(['extensions', 'update', 'failing-extension']);

    // Verify rollback
    const extension = await loadExtension('failing-extension');
    expect(extension.config.version).toBe('1.0.0'); // Original version
  });
});
```

### Manual Testing Scenarios

1. **Happy Path**:
   - Install extension from GitHub
   - Wait for auto-update check
   - Verify notification appears
   - Accept update
   - Verify new version loads

2. **Network Failure**:
   - Disconnect network
   - Trigger update check
   - Verify graceful failure
   - Reconnect network
   - Verify retry succeeds

3. **Version Pinning**:
   - Pin extension to specific version
   - Trigger update check
   - Verify no update attempted
   - Unpin version
   - Verify update proceeds

4. **Rollback Scenario**:
   - Modify extension to fail on load
   - Trigger update
   - Verify automatic rollback
   - Check backup cleanup

5. **Multi-Extension Updates**:
   - Install 5+ extensions
   - Trigger bulk update
   - Verify sequential/parallel handling
   - Check for race conditions

## 6. Timeline Estimate

### Week 1: Core Infrastructure (Phase 1)
- Day 1-2: Implement `ExtensionUpdateChecker` class
- Day 3-4: Add background checking mechanism
- Day 5: Integration with startup flow and settings

### Week 2: Notification System (Phase 2)
- Day 1-2: Build `ExtensionUpdateNotifier` class
- Day 3-4: UI components (toast, dialog, badge)
- Day 5: Wire up to update checker events

### Week 3: Automatic Installation (Phase 3)
- Day 1-2: Implement `ExtensionUpdateInstaller`
- Day 3: Add backup/rollback mechanism
- Day 4: Retry logic implementation
- Day 5: Testing installation flows

### Week 4: Settings & Polish (Phase 4-5)
- Day 1-2: Settings UI and commands
- Day 3: Enhanced metadata schema
- Day 4: Version compatibility checking
- Day 5: Multi-provider considerations

### Week 5: Testing & Documentation
- Day 1-2: Unit test coverage
- Day 3-4: Integration tests
- Day 5: Documentation and user guides

**Total Estimate: 5 weeks for full implementation**

## 7. Migration Path

### For Existing Extensions

1. **Add Version Tracking**:
   ```typescript
   // On first run with auto-update
   for (const extension of loadExtensions()) {
     if (!extension.installMetadata.installedAt) {
       await updateInstallMetadata(extension, {
         installedAt: Date.now(),
         installedBy: 'migration'
       });
     }
   }
   ```

2. **Default Settings**:
   ```typescript
   // Safe defaults for existing users
   {
     extensions: {
       autoUpdate: {
         enabled: false,  // Opt-in for existing users
         installMode: 'on-restart',  // Safe mode
         notificationLevel: 'toast'
       }
     }
   }
   ```

3. **Communication**:
   - Show one-time notification about auto-update feature
   - Link to documentation
   - Provide easy enable/disable toggle

## 8. Security Considerations

### Update Verification

1. **Signature Verification** (Future Enhancement):
   ```typescript
   // Verify GPG signatures on releases
   interface ExtensionRelease {
     signature?: string;
     publicKey?: string;
   }
   ```

2. **HTTPS Only**:
   - Enforce HTTPS for all update checks
   - Validate SSL certificates
   - No downgrades from HTTPS to HTTP

3. **Permission Changes**:
   - Alert user if update requests new permissions
   - Require explicit approval for permission increases
   - Track permission history

### Attack Vectors Mitigated

1. **Downgrade Attacks**:
   - Never auto-install older versions
   - Warn on manual downgrade attempts

2. **Supply Chain**:
   - Verify source repository hasn't changed
   - Check commit signatures where available

3. **Rate Limiting**:
   - Respect GitHub API limits
   - Implement exponential backoff
   - Cache update checks

## 9. Performance Considerations

### Resource Usage

1. **Memory**:
   - Update checker: ~5MB baseline
   - Per extension check: ~1MB
   - Cache update results in memory

2. **Network**:
   - Parallel checks with connection pooling
   - 2-second timeout per check
   - Respect system proxy settings

3. **Disk I/O**:
   - Backup only during actual updates
   - Clean up old backups (keep last 2)
   - Async file operations throughout

### Optimization Strategies

```typescript
// Stagger update checks to avoid thundering herd
class StaggeredUpdateChecker {
  async checkAllExtensions(extensions: Extension[]): Promise<void> {
    const batchSize = 3;
    const delayBetweenBatches = 1000; // 1 second

    for (let i = 0; i < extensions.length; i += batchSize) {
      const batch = extensions.slice(i, i + batchSize);
      await Promise.all(batch.map(ext => this.checkExtension(ext)));

      if (i + batchSize < extensions.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }
  }
}
```

## 10. Future Enhancements

### Phase 2 Features (Post-MVP)

1. **Update Channels**:
   - Support stable/beta/nightly channels
   - Per-extension channel selection
   - Channel-specific update policies

2. **Differential Updates**:
   - Download only changed files
   - Binary diff support for large extensions
   - Incremental update application

3. **Update Scheduling**:
   - User-defined update windows
   - Quiet hours support
   - Batch updates at optimal times

4. **Extension Dependencies**:
   - Track inter-extension dependencies
   - Coordinated updates for dependent extensions
   - Conflict resolution

5. **Analytics & Telemetry**:
   - Track update success rates
   - Monitor rollback frequency
   - Identify problematic updates

## Appendix A: Code Examples

### Complete Update Check Flow

```typescript
// Example: Full update check and install flow
async function performAutoUpdate(): Promise<void> {
  const settings = await loadSettings();
  const extensions = loadExtensions();

  // Initialize components
  const checker = new ExtensionUpdateChecker(settings, extensions);
  const notifier = new ExtensionUpdateNotifier(ui, settings);
  const installer = new ExtensionUpdateInstaller(settings, eventBus);

  // Check for updates
  const updates = await checker.checkAllExtensions();

  // Filter to available updates
  const available = updates.filter(u =>
    u.state === ExtensionUpdateState.UPDATE_AVAILABLE
  );

  if (available.length === 0) {
    console.log('All extensions are up to date');
    return;
  }

  // Notify user
  notifier.notify(available);

  // Auto-install if configured
  if (settings.extensions?.autoUpdate?.installMode === 'immediate') {
    for (const update of available) {
      const extension = extensions.find(e => e.config.name === update.name);
      if (extension) {
        try {
          await installer.installUpdate(extension, 'immediate');
          console.log(`Updated ${extension.config.name} to ${update.availableVersion}`);
        } catch (error) {
          console.error(`Failed to update ${extension.config.name}:`, error);
        }
      }
    }
  }
}
```

### Settings Configuration Example

```json
{
  "extensions": {
    "autoUpdate": {
      "enabled": true,
      "checkInterval": 24,
      "installMode": "on-restart",
      "notificationLevel": "toast",
      "perExtension": {
        "my-critical-extension": {
          "enabled": true,
          "installMode": "immediate"
        },
        "experimental-extension": {
          "enabled": false
        },
        "stable-extension": {
          "pinnedVersion": "1.2.3",
          "enabled": false
        }
      }
    },
    "updateHistory": {
      "my-critical-extension": {
        "lastCheck": 1701234567890,
        "lastUpdate": 1701234567890,
        "currentVersion": "2.1.0",
        "availableVersion": null,
        "updateState": "UP_TO_DATE",
        "failureCount": 0
      }
    }
  }
}
```

## Appendix B: File Structure

```
packages/cli/src/
├── extensions/
│   ├── update-checker.ts       # Background update checking
│   ├── update-notifier.ts      # User notifications
│   ├── update-installer.ts     # Installation management
│   ├── compatibility.ts        # Version compatibility
│   ├── types.ts                # Shared types
│   └── __tests__/
│       ├── update-checker.test.ts
│       ├── update-notifier.test.ts
│       └── update-installer.test.ts
├── commands/extensions/
│   ├── update.ts               # Enhanced with auto-update
│   └── install.ts              # --auto-update flag
├── config/
│   ├── extension.ts            # Enhanced metadata
│   └── settingsSchema.ts      # Auto-update settings
└── ui/
    ├── commands/
    │   └── extensionSettingsCommand.ts
    └── components/
        └── ExtensionUpdateBadge.tsx

integration-tests/
└── extension-updates.test.ts   # E2E tests
```

## Appendix C: Risk Assessment

### High Risk Areas

1. **Data Loss**:
   - Risk: Extension data corrupted during update
   - Mitigation: Comprehensive backup system, atomic operations

2. **Breaking Changes**:
   - Risk: Update breaks dependent functionality
   - Mitigation: Version compatibility checks, staged rollout

3. **Security**:
   - Risk: Malicious update injection
   - Mitigation: HTTPS only, source verification

### Medium Risk Areas

1. **Performance**:
   - Risk: Update checks slow down startup
   - Mitigation: Async operations, timeouts, caching

2. **User Experience**:
   - Risk: Too many notifications
   - Mitigation: Configurable notification levels, batching

### Low Risk Areas

1. **Network Issues**:
   - Risk: Failed updates due to connectivity
   - Mitigation: Retry logic, offline grace period

2. **Disk Space**:
   - Risk: Backups consume too much space
   - Mitigation: Cleanup policy, compression

## Next Actions

1. **Wire background checker into startup path**  
   Hook `ExtensionUpdateChecker.startBackgroundChecking()` into the CLI bootstrap so that update checks begin once extensions load. Ensure the interval cleans up via `registerCleanup` so tests do not hang.

2. **Surface notifications in the UI**  
   Extend `UIState`/`UIActions` with banner/toast state (mirroring upstream commit `22b7d865`) so users see when updates are ready or have failed. Log into history via `addItem`.

3. **Implement installation retries and rollback storage**  
   Mirror upstream’s `.llxprt/extensions/.backup` layout so failed installs can be reverted automatically. Persist retry metadata in `extensions.updateHistory`.

4. **Add integration tests**  
   Create fake GitHub release feeds to verify background checks, scheduled installs, and rollback flows.

5. **Add settings schema entries**  
   Introduce `extensions.autoUpdate.enabled`, `.installMode`, `.notificationLevel`, and per-extension overrides. Default to `enabled` + `immediate`.

6. **Document the feature**  
   Update `docs/extensions.md` with opt-out instructions, environment overrides, and troubleshooting steps.
