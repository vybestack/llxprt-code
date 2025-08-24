# Phase 4B: Legacy System Deprecation and Cleanup (P4)

## Deprecation Strategy

After successful token migration, the legacy OAuth system needs to be gradually deprecated to:
1. Reduce code complexity and maintenance burden
2. Eliminate security risks from multiple auth code paths
3. Ensure consistent behavior across all OAuth flows
4. Prepare for future authentication enhancements

## Deprecation Timeline

### Phase 1: Warning Period (Month 1-2)
- Add deprecation warnings for legacy token usage
- Continue supporting both systems in parallel
- Encourage users to migrate manually
- Monitor usage metrics

### Phase 2: Read-Only Legacy (Month 3-4)
- Stop writing to legacy token files
- Legacy tokens readable for compatibility
- All new tokens saved only to new system
- Stronger deprecation warnings

### Phase 3: Legacy Removal (Month 5-6)
- Remove legacy token reading code
- Clean up obsolete OAuth code paths
- Update documentation
- Single unified OAuth system

## Implementation Plan

### Step 1: Add Deprecation Warnings

**File**: `/packages/core/src/auth/legacy-migration-service.ts`

Add warning system:

```typescript
export class LegacyMigrationService {
  // ... existing code ...

  /**
   * Show deprecation warning for legacy token usage
   */
  private showLegacyTokenWarning(provider: string, action: string): void {
    const warningMessage = [
      `⚠️  DEPRECATION WARNING: Using legacy OAuth storage for ${provider}`,
      `   Action: ${action}`,
      `   Legacy tokens will be deprecated in a future release.`,
      `   Run 'llxprt migrate' to upgrade to the new token storage format.`,
      `   See: https://docs.llxprt.com/oauth-migration for details`,
    ].join('\n');
    
    console.warn(warningMessage);
    
    // Track deprecation usage for metrics
    this.trackLegacyUsage(provider, action);
  }

  /**
   * Track legacy token usage for deprecation metrics
   */
  private trackLegacyUsage(provider: string, action: string): void {
    try {
      // In production, this might send telemetry
      // For now, just log locally
      const usageData = {
        timestamp: new Date().toISOString(),
        provider,
        action,
        version: process.env.LLXPRT_VERSION || 'unknown',
      };
      
      console.debug('Legacy OAuth usage:', JSON.stringify(usageData));
    } catch (error) {
      // Don't let tracking failures affect authentication
      console.debug('Failed to track legacy usage:', error);
    }
  }

  /**
   * Check if legacy token usage should show warnings
   */
  private shouldShowWarnings(): boolean {
    // Environment variable to suppress warnings (for CI/automated systems)
    if (process.env.LLXPRT_SUPPRESS_LEGACY_WARNINGS === 'true') {
      return false;
    }
    
    // Show warnings by default
    return true;
  }

  /**
   * Enhanced migration with deprecation warnings
   */
  async migrateProviderIfNeeded(provider: string): Promise<boolean> {
    try {
      const legacyTokens = await this.detector.detectLegacyTokens();
      const providerInfo = legacyTokens.find(info => info.provider === provider);
      
      if (providerInfo && providerInfo.migrationRequired) {
        // Show deprecation warning
        if (this.shouldShowWarnings()) {
          this.showLegacyTokenWarning(provider, 'token-migration');
        }
        
        const result = await this.migrateLegacyToken(providerInfo);
        
        if (result.success && result.tokenMigrated) {
          console.log(`✅ Successfully migrated ${provider} OAuth token to new storage format`);
          return true;
        }
      }
      
      return false; // No migration needed
    } catch (error) {
      console.error(`Failed to migrate legacy tokens for ${provider}:`, error);
      return false;
    }
  }
}
```

### Step 2: Legacy Token Read-Only Mode

**File**: `/packages/core/src/auth/legacy-token-detector.ts`

Add read-only enforcement:

```typescript
export class LegacyTokenDetector {
  // ... existing code ...

  /**
   * Configuration for legacy system behavior
   */
  private static readonly LEGACY_CONFIG = {
    // Phase 1: Full support with warnings
    // Phase 2: Read-only mode (change to true)
    // Phase 3: Disabled (change to false)
    enableLegacyReads: true,
    enableLegacyWrites: true, // Set to false in Phase 2
    showWarnings: true,
  };

  /**
   * Check if legacy writes are still allowed
   */
  static isLegacyWriteEnabled(): boolean {
    return this.LEGACY_CONFIG.enableLegacyWrites;
  }

  /**
   * Check if legacy reads are still allowed  
   */
  static isLegacyReadEnabled(): boolean {
    return this.LEGACY_CONFIG.enableLegacyReads;
  }

  /**
   * Migrate legacy Google OAuth token (enhanced with phase controls)
   */
  async migrateLegacyGoogleOAuth(): Promise<OAuthToken | null> {
    if (!LegacyTokenDetector.isLegacyReadEnabled()) {
      console.debug('Legacy token reads disabled, skipping migration');
      return null;
    }

    try {
      const credsPath = join(this.legacyDir, 'oauth_creds.json');
      
      // Phase 2/3: Add warning about legacy file access
      if (LegacyTokenDetector.LEGACY_CONFIG.showWarnings) {
        console.warn(`⚠️  Accessing legacy OAuth file: ${credsPath}`);
        console.warn('   This file format is deprecated and will be removed in a future release.');
        console.warn('   Run "llxprt migrate" to upgrade to the new storage format.');
      }
      
      const credsData = await fs.readFile(credsPath, 'utf8');
      const credentials = JSON.parse(credsData);

      if (credentials.access_token && credentials.expiry_date) {
        const oauthToken: OAuthToken = {
          access_token: credentials.access_token,
          refresh_token: credentials.refresh_token,
          expiry: Math.floor(credentials.expiry_date / 1000),
          token_type: credentials.token_type || 'Bearer',
          scope: credentials.scope || null,
        };

        // Validate token is not expired
        const now = Math.floor(Date.now() / 1000);
        if (oauthToken.expiry > (now + 30)) {
          return oauthToken;
        }
      }

      return null;
    } catch (error) {
      console.debug('Failed to migrate legacy Google OAuth token:', error);
      return null;
    }
  }
}
```

### Step 3: Remove Legacy Token Writing

**File**: `/packages/core/src/code_assist/oauth2.ts`

Update token caching to respect deprecation:

```typescript
async function cacheCredentials(credentials: Credentials) {
  const filePath = getCachedCredentialPath();
  const dir = path.dirname(filePath);

  // Check if legacy writes are disabled
  const { LegacyTokenDetector } = await import('../auth/legacy-token-detector.js');
  if (!LegacyTokenDetector.isLegacyWriteEnabled()) {
    console.debug('Legacy token writes disabled, skipping oauth_creds.json update');
    // Note: In Phase 2, we'd still cache in memory but not write to disk
    return;
  }

  // Show deprecation warning for legacy writes
  console.warn('⚠️  Writing to legacy OAuth format (oauth_creds.json)');
  console.warn('   This file format is deprecated. New installations should use the unified OAuth system.');
  
  try {
    // Check if directory exists first to avoid unnecessary mkdir calls
    await fs.access(dir);
  } catch {
    // Directory doesn't exist, create it
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // Handle race condition where directory was created between access and mkdir
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        console.error('Failed to create OAuth cache directory:', error);
        return;
      }
    }
  }

  try {
    // Write with restricted permissions (owner read/write only)
    await fs.writeFile(filePath, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    });
  } catch (error) {
    console.error('Failed to cache OAuth credentials:', error);
    // Don't throw - allow OAuth to continue without caching
  }
}
```

### Step 4: OAuth Manager Legacy Support Removal

**File**: `/packages/cli/src/auth/oauth-manager.ts`

Phase out legacy fallback logic:

```typescript
export class OAuthManager {
  // ... existing code ...

  /**
   * Get legacy Gemini token (deprecated path)
   */
  private async getLegacyGeminiToken(): Promise<OAuthToken | null> {
    const { LegacyTokenDetector } = await import('@vybestack/llxprt-code-core');
    
    // Phase 3: Disable legacy token fallback
    if (!LegacyTokenDetector.isLegacyReadEnabled()) {
      return null;
    }

    try {
      const path = await import('path');
      const os = await import('os');
      const fs = await import('fs/promises');
      
      const legacyPath = path.join(os.homedir(), '.llxprt', 'oauth_creds.json');
      
      // Phase 2/3: Strong deprecation warning
      console.warn('⚠️  DEPRECATION: Falling back to legacy OAuth storage');
      console.warn(`   File: ${legacyPath}`);
      console.warn('   This fallback will be removed in the next major release.');
      console.warn('   Run "llxprt migrate" to upgrade immediately.');
      
      const credentialsData = await fs.readFile(legacyPath, 'utf8');
      const credentials = JSON.parse(credentialsData);
      
      if (credentials.access_token && credentials.expiry_date) {
        return {
          access_token: credentials.access_token,
          refresh_token: credentials.refresh_token,
          expiry: Math.floor(credentials.expiry_date / 1000),
          token_type: 'Bearer',
          scope: credentials.scope || null,
        };
      }
      
      return null;
    } catch (error) {
      return null; // Legacy token not available
    }
  }

  /**
   * Get token with phased legacy support
   */
  async getToken(providerName: string): Promise<string | null> {
    // Check if OAuth is enabled for this provider
    if (!this.isOAuthEnabled(providerName)) {
      return null;
    }

    // Try new OAuth provider system first
    const token = await this.getOAuthToken(providerName);
    if (token) {
      return token.access_token;
    }

    // Phase-controlled legacy fallback for Gemini
    if (providerName === 'gemini') {
      try {
        const legacyToken = await this.getLegacyGeminiToken();
        if (legacyToken) {
          // Attempt migration for future use
          try {
            await this.migrateLegacyGeminiToken(legacyToken);
            console.log('✅ Successfully migrated legacy token during access');
          } catch (migrationError) {
            console.warn('Failed to migrate legacy token:', migrationError);
          }
          
          return legacyToken.access_token;
        }
      } catch (error) {
        console.debug('Legacy Gemini token not available:', error);
      }
    }

    // For providers without valid tokens, trigger OAuth flow
    try {
      await this.authenticate(providerName);
      const newToken = await this.getOAuthToken(providerName);
      return newToken ? newToken.access_token : null;
    } catch (error) {
      console.error(`OAuth authentication failed for ${providerName}:`, error);
      throw error;
    }
  }
}
```

### Step 5: Legacy Cleanup Utilities

**File**: `/packages/cli/src/ui/commands/cleanupCommand.ts` (new)

```typescript
/**
 * Command to clean up legacy OAuth files after successful migration
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { LegacyMigrationService, MultiProviderTokenStore } from '@vybestack/llxprt-code-core';

export function createCleanupCommand(): Command {
  const command = new Command('cleanup-legacy');
  
  command
    .description('Clean up legacy OAuth files after migration')
    .option('--dry-run', 'Show what would be deleted without making changes')
    .option('--force', 'Skip safety checks and delete legacy files')
    .action(async (options) => {
      await handleCleanupCommand(options);
    });

  return command;
}

async function handleCleanupCommand(options: {
  dryRun?: boolean;
  force?: boolean;
}): Promise<void> {
  console.log('🧹 Legacy OAuth Cleanup Tool');
  console.log('─'.repeat(40));

  try {
    const llxprtDir = join(homedir(), '.llxprt');
    const legacyFiles = [
      join(llxprtDir, 'oauth_creds.json'),
      join(llxprtDir, 'google_accounts.json'),
    ];

    // Safety check: Ensure migration was successful
    if (!options.force) {
      const tokenStore = new MultiProviderTokenStore();
      const migrationService = new LegacyMigrationService(tokenStore);
      
      console.log('Checking migration status...\n');
      const status = await migrationService.getMigrationStatus();
      
      if (status.migrationRequired > 0) {
        console.log('❌ Cannot cleanup: Migration not complete');
        console.log(`   ${status.migrationRequired} providers still require migration`);
        console.log('   Run "llxprt migrate" first, or use --force to override\n');
        return;
      }

      // Verify new tokens exist for providers that had legacy tokens
      const geminiToken = await tokenStore.getToken('gemini');
      const hasLegacyGemini = await fileExists(join(llxprtDir, 'oauth_creds.json'));
      
      if (hasLegacyGemini && !geminiToken) {
        console.log('❌ Cannot cleanup: Gemini has legacy tokens but no migrated token');
        console.log('   Run "llxprt migrate" first, or use --force to override\n');
        return;
      }
    }

    // Show what will be deleted
    const filesToDelete = [];
    for (const filePath of legacyFiles) {
      if (await fileExists(filePath)) {
        filesToDelete.push(filePath);
      }
    }

    if (filesToDelete.length === 0) {
      console.log('✅ No legacy files found to clean up');
      return;
    }

    console.log('Files to be deleted:');
    for (const filePath of filesToDelete) {
      const stat = await fs.stat(filePath);
      console.log(`  📁 ${filePath} (${stat.size} bytes, modified ${stat.mtime.toLocaleDateString()})`);
    }
    
    if (options.dryRun) {
      console.log('\nDry run mode - no files were deleted');
      console.log('Run without --dry-run to delete these files');
      return;
    }

    // Confirm deletion
    if (!options.force) {
      console.log('\n⚠️  This will permanently delete the above legacy OAuth files.');
      console.log('   Make sure your OAuth tokens are working with the new system first.');
      console.log('   You can test with: llxprt auth <provider>');
      
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question('\nContinue with deletion? (y/N): ', resolve);
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log('Cleanup cancelled');
        return;
      }
    }

    // Delete files
    let deletedCount = 0;
    for (const filePath of filesToDelete) {
      try {
        await fs.unlink(filePath);
        console.log(`✅ Deleted: ${filePath}`);
        deletedCount++;
      } catch (error) {
        console.log(`❌ Failed to delete ${filePath}: ${error}`);
      }
    }

    console.log(`\n🎉 Cleanup complete: ${deletedCount}/${filesToDelete.length} files deleted`);
    
    if (deletedCount > 0) {
      console.log('\n💡 Your OAuth tokens are now managed exclusively by the new system.');
      console.log('   All authentication should continue to work normally.');
    }
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
```

### Step 6: Documentation Updates

**File**: `/docs/oauth-migration-guide.md` (new)

```markdown
# OAuth Token Migration Guide

## Overview

The LLXPRT CLI OAuth system has been updated to provide a more consistent and reliable authentication experience. This guide helps you migrate from the legacy OAuth storage format to the new unified system.

## What Changed

### Before (Legacy System)
- Tokens stored in `~/.llxprt/oauth_creds.json` (Gemini only)
- Account info in `~/.llxprt/google_accounts.json`
- Inconsistent token management across providers

### After (New System)  
- Unified storage in `~/.llxprt/oauth/` directory
- Consistent format across all providers (Gemini, Anthropic, Qwen)
- Better error handling and token refresh

## Migration Process

### Automatic Migration

The CLI automatically detects and migrates legacy tokens:

```bash
# Migration happens automatically on first use
llxprt auth gemini
```

### Manual Migration

For more control, use the migration command:

```bash
# See what would be migrated
llxprt migrate --dry-run

# Perform migration
llxprt migrate

# Clean up legacy files after successful migration
llxprt cleanup-legacy --dry-run
llxprt cleanup-legacy
```

### Verification

Check that migration was successful:

```bash
# Check auth status
llxprt auth

# Test authentication
llxprt auth gemini
```

## Troubleshooting

### Migration Failed

```bash
# Force migration even if new tokens exist
llxprt migrate --force

# Check migration status
llxprt migrate --dry-run
```

### Tokens Not Working After Migration

```bash
# Re-authenticate
llxprt auth gemini logout
llxprt auth gemini enable

# Check file permissions
ls -la ~/.llxprt/oauth/
# Should show: -rw------- (600) permissions
```

### Legacy Files Still Present

```bash
# After successful migration, clean up legacy files
llxprt cleanup-legacy

# Or manually:
rm ~/.llxprt/oauth_creds.json
rm ~/.llxprt/google_accounts.json
```

## Support

If you encounter issues:

1. Run migration with verbose logging: `LLXPRT_DEBUG=auth llxprt migrate`
2. Check for conflicting tokens: `llxprt auth --debug`
3. Report issues with log output to support
```

## Cleanup Timeline

### Phase 1 Implementation (Month 1)
- Deploy deprecation warnings
- Add legacy cleanup utilities
- Update documentation
- Monitor usage metrics

### Phase 2 Implementation (Month 3)
- Enable read-only mode for legacy tokens
- Remove legacy token writing
- Stronger deprecation warnings
- Automated migration prompts

### Phase 3 Implementation (Month 5)  
- Disable legacy token reading
- Remove legacy OAuth code paths
- Clean up obsolete imports and utilities
- Final documentation updates

## Testing Strategy

### Deprecation Warning Tests

```typescript
describe('Legacy OAuth Deprecation', () => {
  it('should show deprecation warnings for legacy token usage', async () => {
    const consoleSpy = jest.spyOn(console, 'warn');
    
    // Setup legacy token
    await setupLegacyToken();
    
    // Access through OAuth manager
    await oauthManager.getToken('gemini');
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('DEPRECATION WARNING')
    );
  });

  it('should respect warning suppression environment variable', async () => {
    process.env.LLXPRT_SUPPRESS_LEGACY_WARNINGS = 'true';
    
    const consoleSpy = jest.spyOn(console, 'warn');
    await setupLegacyToken();
    await oauthManager.getToken('gemini');
    
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('DEPRECATION WARNING')
    );
    
    delete process.env.LLXPRT_SUPPRESS_LEGACY_WARNINGS;
  });
});
```

### Phase Control Tests

```typescript
describe('Legacy System Phase Control', () => {
  it('should disable legacy writes in Phase 2', () => {
    // Mock Phase 2 configuration
    LegacyTokenDetector.LEGACY_CONFIG.enableLegacyWrites = false;
    
    expect(LegacyTokenDetector.isLegacyWriteEnabled()).toBe(false);
  });

  it('should disable legacy reads in Phase 3', () => {
    // Mock Phase 3 configuration
    LegacyTokenDetector.LEGACY_CONFIG.enableLegacyReads = false;
    
    expect(LegacyTokenDetector.isLegacyReadEnabled()).toBe(false);
  });
});
```

## Success Metrics

### Phase 1 Success Criteria
- [ ] Deprecation warnings appear for legacy token usage
- [ ] Migration command successfully migrates all token types
- [ ] Cleanup command safely removes legacy files
- [ ] Documentation updated and accessible
- [ ] No authentication regressions

### Phase 2 Success Criteria  
- [ ] Legacy token writes disabled
- [ ] New tokens saved only to new storage
- [ ] Migration rate > 80% of active users
- [ ] Support tickets < 5% increase

### Phase 3 Success Criteria
- [ ] Legacy code completely removed
- [ ] Single unified OAuth system
- [ ] Code complexity reduced by 30%
- [ ] All tests pass with new system only

## Risk Mitigation

### Risk: Users lose access to OAuth tokens
**Mitigation**: Always maintain legacy token reading until Phase 3

### Risk: Migration corruption
**Mitigation**: Never delete legacy files automatically, provide manual cleanup

### Risk: Breaking changes affect users
**Mitigation**: Extensive testing, gradual phase rollout, clear communication