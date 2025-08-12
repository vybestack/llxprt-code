# Phase 18: Migration and Cleanup

## Goal
Complete the migration to centralized settings and remove old code.

## Context
After all integration is complete and tested, remove the old scattered settings code.

## Migration Steps

### 1. Feature Flag Rollout
```typescript
// Initial deployment behind flag
if (process.env.USE_SETTINGS_SERVICE === 'true') {
  this.settingsService = new SettingsService();
  // New path
} else {
  // Old path
}
```

### 2. Gradual Migration
- Week 1: Enable for internal testing
- Week 2: Enable for 10% of users
- Week 3: Enable for 50% of users
- Week 4: Enable for all users
- Week 5: Remove old code

### 3. Deprecation Warnings
```typescript
// Add to old methods
console.warn('DEPRECATED: Direct ephemeralSettings access. Use SettingsService instead.');
```

### 4. Code Removal Checklist

**Remove from Config class:**
- [ ] Private ephemeralSettings field
- [ ] Direct ephemeral manipulation methods
- [ ] Old provider setting methods
- [ ] Redundant model parameter handling

**Remove from Providers:**
- [ ] Local settings storage
- [ ] Direct model parameter fields
- [ ] Individual API key management

**Remove from Commands:**
- [ ] Direct config manipulation
- [ ] Scattered settings access
- [ ] Old validation logic

**Clean up ProfileManager:**
- [ ] Direct file access
- [ ] Old serialization code
- [ ] Legacy format support (after migration period)

### 5. Documentation Updates

**Update:**
- [ ] README.md - New settings architecture
- [ ] API documentation
- [ ] Command documentation
- [ ] Migration guide

**Create:**
- [ ] Settings architecture diagram
- [ ] Event flow documentation
- [ ] Troubleshooting guide

## Migration Utilities

```typescript
class SettingsMigrator {
  // Migrate old settings to new format
  async migrateUserSettings(): Promise<void> {
    const oldSettings = this.loadOldSettings();
    const newSettings = this.convertToNew(oldSettings);
    await this.settingsService.import(newSettings);
  }
  
  // Backup before migration
  async backup(): Promise<string> {
    const backup = await this.createBackup();
    return backup.path;
  }
  
  // Rollback if needed
  async rollback(backupPath: string): Promise<void> {
    await this.restoreFromBackup(backupPath);
  }
}
```

## Monitoring

Track during migration:
- Settings operation success rate
- Performance metrics
- Error rates
- User complaints

## Rollback Plan

If issues arise:
1. Disable feature flag
2. Restore from backups
3. Revert code changes
4. Investigate issues
5. Fix and retry

## Final Cleanup

After successful migration:
1. Remove all deprecated code
2. Remove migration utilities
3. Remove feature flags
4. Optimize performance
5. Final documentation update

## Success Criteria

- All old code removed
- No functionality lost
- Performance improved
- Documentation complete
- Zero user complaints