# Phase 4: Legacy System Migration Strategy (P4)

## Problem Analysis

**Current State**: The OAuth system uses multiple legacy storage mechanisms:
- `~/.llxprt/oauth_creds.json` - Google OAuth credentials
- `~/.llxprt/google_accounts.json` - Google account information  
- In-memory token caching in `oauthClientPromises` Map
- Mixed authentication precedence between OAuth and API keys

**Issues**:
1. **Fragmented Storage**: Tokens stored in multiple locations with different formats
2. **Migration Complexity**: Users have tokens in legacy formats that need migration
3. **Inconsistent Behavior**: Some flows use legacy storage, others use new storage
4. **Security Concerns**: Legacy files may have incorrect permissions
5. **Maintenance Burden**: Multiple code paths for same functionality

## Migration Strategy Overview

### Three-Phase Migration Approach

#### Phase 1: Discovery and Compatibility (Immediate)
- Inventory all legacy token storage locations
- Implement detection of legacy tokens
- Ensure new system can read and use legacy tokens
- No user-facing changes

#### Phase 2: Transparent Migration (2-3 weeks)
- Automatically migrate legacy tokens to new storage on access
- Maintain both storage formats during transition
- Add migration success/failure logging
- Users experience no disruption

#### Phase 3: Legacy Deprecation (1-2 months)
- Stop writing to legacy storage formats
- Add deprecation warnings for legacy token usage
- Provide migration tools for edge cases
- Eventually remove legacy code

## Legacy Token Inventory

### File 1: Google OAuth Credentials
**Location**: `~/.llxprt/oauth_creds.json`
**Format**:
```json
{
  "access_token": "ya29.a0AfH6SMD...",
  "refresh_token": "1//04i7zZYt2L...", 
  "scope": "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
  "token_type": "Bearer",
  "expiry_date": 1735689600000
}
```

**Differences from new format**:
- `expiry_date` in milliseconds vs `expiry` in seconds
- Different field structure
- No provider association (assumed to be Gemini)

### File 2: Google Account Information  
**Location**: `~/.llxprt/google_accounts.json`
**Format**:
```json
{
  "email": "user@example.com",
  "id": "1234567890",
  "verified_email": true,
  "name": "User Name",
  "picture": "https://...",
  "cached_at": 1735689600000
}
```

**Purpose**: User profile information for display and account management

### File 3: In-Memory OAuth Clients
**Location**: Memory (`oauthClientPromises` Map in `oauth2.ts`)
**Content**: `OAuth2Client` instances indexed by `AuthType`
**Issue**: Not cleared on logout, potential security issue

## Migration Implementation

### Step 1: Legacy Token Detection

**File**: `/packages/core/src/auth/legacy-token-detector.ts` (new)

```typescript
/**
 * Detects and validates legacy OAuth tokens for migration
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { OAuthToken } from './types.js';

export interface LegacyTokenInfo {
  provider: string;
  hasToken: boolean;
  hasAccount: boolean;
  tokenValid: boolean;
  tokenExpiry?: Date;
  accountEmail?: string;
  migrationRequired: boolean;
}

export class LegacyTokenDetector {
  private readonly legacyDir: string;

  constructor() {
    this.legacyDir = join(homedir(), '.llxprt');
  }

  /**
   * Detect all legacy tokens that need migration
   */
  async detectLegacyTokens(): Promise<LegacyTokenInfo[]> {
    const results: LegacyTokenInfo[] = [];

    // Check Google OAuth (Gemini) tokens
    const geminiInfo = await this.detectGoogleOAuth();
    if (geminiInfo.hasToken) {
      results.push(geminiInfo);
    }

    return results;
  }

  /**
   * Detect Google OAuth tokens and account info
   */
  private async detectGoogleOAuth(): Promise<LegacyTokenInfo> {
    const info: LegacyTokenInfo = {
      provider: 'gemini',
      hasToken: false,
      hasAccount: false,
      tokenValid: false,
      migrationRequired: false,
    };

    try {
      // Check for OAuth credentials
      const credsPath = join(this.legacyDir, 'oauth_creds.json');
      const credsData = await fs.readFile(credsPath, 'utf8');
      const credentials = JSON.parse(credsData);

      if (credentials.access_token && credentials.expiry_date) {
        info.hasToken = true;
        info.tokenExpiry = new Date(credentials.expiry_date);
        info.tokenValid = credentials.expiry_date > Date.now();
        info.migrationRequired = true;
      }
    } catch {
      // No legacy OAuth credentials
    }

    try {
      // Check for account information
      const accountPath = join(this.legacyDir, 'google_accounts.json');
      const accountData = await fs.readFile(accountPath, 'utf8');
      const account = JSON.parse(accountData);

      if (account.email) {
        info.hasAccount = true;
        info.accountEmail = account.email;
        info.migrationRequired = true;
      }
    } catch {
      // No legacy account information
    }

    return info;
  }

  /**
   * Convert legacy Google OAuth credentials to new format
   */
  async migrateLegacyGoogleOAuth(): Promise<OAuthToken | null> {
    try {
      const credsPath = join(this.legacyDir, 'oauth_creds.json');
      const credsData = await fs.readFile(credsPath, 'utf8');
      const credentials = JSON.parse(credsData);

      if (credentials.access_token && credentials.expiry_date) {
        const oauthToken: OAuthToken = {
          access_token: credentials.access_token,
          refresh_token: credentials.refresh_token,
          expiry: Math.floor(credentials.expiry_date / 1000), // Convert ms to seconds
          token_type: credentials.token_type || 'Bearer',
          scope: credentials.scope || null,
        };

        // Validate token is not expired
        const now = Math.floor(Date.now() / 1000);
        if (oauthToken.expiry > (now + 30)) { // 30-second buffer
          return oauthToken;
        }
      }

      return null;
    } catch (error) {
      console.debug('Failed to migrate legacy Google OAuth token:', error);
      return null;
    }
  }

  /**
   * Get legacy Google account information
   */
  async getLegacyGoogleAccount(): Promise<{ email: string; name?: string } | null> {
    try {
      const accountPath = join(this.legacyDir, 'google_accounts.json');
      const accountData = await fs.readFile(accountPath, 'utf8');
      const account = JSON.parse(accountData);

      if (account.email) {
        return {
          email: account.email,
          name: account.name,
        };
      }

      return null;
    } catch {
      return null;
    }
  }
}
```

### Step 2: Automatic Migration Service

**File**: `/packages/core/src/auth/legacy-migration-service.ts` (new)

```typescript
/**
 * Service to automatically migrate legacy OAuth tokens
 */

import { TokenStore } from './token-store.js';
import { LegacyTokenDetector, LegacyTokenInfo } from './legacy-token-detector.js';

export interface MigrationResult {
  provider: string;
  success: boolean;
  error?: string;
  tokenMigrated: boolean;
  accountMigrated: boolean;
}

export class LegacyMigrationService {
  private detector: LegacyTokenDetector;
  private migrationAttempted = new Set<string>();

  constructor(private tokenStore: TokenStore) {
    this.detector = new LegacyTokenDetector();
  }

  /**
   * Perform automatic migration for all legacy tokens
   */
  async migrateAllLegacyTokens(): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];
    
    try {
      const legacyTokens = await this.detector.detectLegacyTokens();
      console.debug(`Found ${legacyTokens.length} legacy token sources requiring migration`);

      for (const tokenInfo of legacyTokens) {
        const result = await this.migrateLegacyToken(tokenInfo);
        results.push(result);
      }
    } catch (error) {
      console.error('Failed to detect legacy tokens:', error);
    }

    return results;
  }

  /**
   * Migrate a specific legacy token
   */
  async migrateLegacyToken(tokenInfo: LegacyTokenInfo): Promise<MigrationResult> {
    const result: MigrationResult = {
      provider: tokenInfo.provider,
      success: false,
      tokenMigrated: false,
      accountMigrated: false,
    };

    // Prevent duplicate migration attempts
    if (this.migrationAttempted.has(tokenInfo.provider)) {
      result.error = 'Migration already attempted';
      return result;
    }
    
    this.migrationAttempted.add(tokenInfo.provider);

    try {
      console.debug(`Migrating legacy tokens for provider: ${tokenInfo.provider}`);

      // Check if new token storage already exists
      const existingToken = await this.tokenStore.getToken(tokenInfo.provider);
      if (existingToken) {
        console.debug(`Provider ${tokenInfo.provider} already has new token storage, skipping migration`);
        result.success = true;
        result.tokenMigrated = false; // Already exists
        return result;
      }

      if (tokenInfo.provider === 'gemini') {
        // Migrate Google OAuth token
        const migratedToken = await this.detector.migrateLegacyGoogleOAuth();
        if (migratedToken) {
          await this.tokenStore.saveToken('gemini', migratedToken);
          result.tokenMigrated = true;
          console.debug('Successfully migrated Gemini OAuth token');
        }

        // Account information is informational only - not migrated to token storage
        const accountInfo = await this.detector.getLegacyGoogleAccount();
        if (accountInfo) {
          result.accountMigrated = true;
          console.debug(`Found legacy account info for: ${accountInfo.email}`);
        }
      }

      result.success = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      console.error(`Failed to migrate legacy tokens for ${tokenInfo.provider}:`, error);
    }

    return result;
  }

  /**
   * Migrate legacy tokens for a specific provider on-demand
   */
  async migrateProviderIfNeeded(provider: string): Promise<boolean> {
    try {
      const legacyTokens = await this.detector.detectLegacyTokens();
      const providerInfo = legacyTokens.find(info => info.provider === provider);
      
      if (providerInfo && providerInfo.migrationRequired) {
        const result = await this.migrateLegacyToken(providerInfo);
        return result.success && result.tokenMigrated;
      }
      
      return false; // No migration needed
    } catch (error) {
      console.error(`Failed to migrate legacy tokens for ${provider}:`, error);
      return false;
    }
  }

  /**
   * Get migration status report
   */
  async getMigrationStatus(): Promise<{
    totalLegacyTokens: number;
    migrationRequired: number;
    validTokens: number;
  }> {
    const legacyTokens = await this.detector.detectLegacyTokens();
    
    return {
      totalLegacyTokens: legacyTokens.length,
      migrationRequired: legacyTokens.filter(t => t.migrationRequired).length,
      validTokens: legacyTokens.filter(t => t.tokenValid).length,
    };
  }
}
```

### Step 3: Integration with OAuth Manager

**File**: `/packages/cli/src/auth/oauth-manager.ts`

Add migration service integration:

```typescript
import { LegacyMigrationService } from '@vybestack/llxprt-code-core';

export class OAuthManager {
  private providers: Map<string, OAuthProvider>;
  private tokenStore: TokenStore;
  private settings?: LoadedSettings;
  private inMemoryOAuthState: Map<string, boolean>;
  private migrationService: LegacyMigrationService;
  private migrationPerformed = false;

  constructor(tokenStore: TokenStore, settings?: LoadedSettings) {
    this.providers = new Map();
    this.tokenStore = tokenStore;
    this.settings = settings;
    this.inMemoryOAuthState = new Map();
    this.migrationService = new LegacyMigrationService(tokenStore);
  }

  /**
   * Perform one-time legacy token migration on first use
   */
  private async performMigrationIfNeeded(): Promise<void> {
    if (this.migrationPerformed) {
      return;
    }

    this.migrationPerformed = true;

    try {
      console.debug('Checking for legacy tokens to migrate...');
      const results = await this.migrationService.migrateAllLegacyTokens();
      
      const successful = results.filter(r => r.success);
      const migrated = results.filter(r => r.tokenMigrated);
      
      if (migrated.length > 0) {
        console.log(`✅ Migrated OAuth tokens for ${migrated.length} provider(s): ${migrated.map(r => r.provider).join(', ')}`);
      } else if (successful.length > 0) {
        console.debug('Legacy token check completed, no migration needed');
      }
    } catch (error) {
      console.error('Legacy token migration failed:', error);
      // Don't throw - continue with normal operation
    }
  }

  /**
   * Get OAuth token - now with automatic migration
   */
  async getOAuthToken(providerName: string): Promise<OAuthToken | null> {
    // Perform migration check on first access
    await this.performMigrationIfNeeded();

    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    try {
      // 1. Try to get token from provider (new storage)
      const token = await this.tokenStore.getToken(providerName);
      if (!token) {
        // 2. Try on-demand migration for this provider
        const migrated = await this.migrationService.migrateProviderIfNeeded(providerName);
        if (migrated) {
          console.debug(`Migrated legacy token for ${providerName} on demand`);
          const migratedToken = await this.tokenStore.getToken(providerName);
          if (migratedToken && !this.isTokenExpired(migratedToken)) {
            return migratedToken;
          }
        }
        
        return null;
      }

      // 3. Check if token expires within 30 seconds (30000ms)
      const now = Date.now();
      const thirtySecondsFromNow = now + 30000;

      if (token.expiry <= thirtySecondsFromNow) {
        // 4. Token is expired or about to expire, try refresh
        try {
          const refreshedToken = await provider.refreshIfNeeded();
          if (refreshedToken) {
            // 5. Update stored token if refreshed
            await this.tokenStore.saveToken(providerName, refreshedToken);
            return refreshedToken;
          } else {
            // Refresh failed, return null
            return null;
          }
        } catch (_error) {
          // Token refresh failure: Return null, no logging
          return null;
        }
      }

      // 6. Return valid token
      return token;
    } catch (error) {
      // For unknown provider or other critical errors, throw
      if (
        error instanceof Error &&
        error.message.includes('Unknown provider')
      ) {
        throw error;
      }
      // For other errors, return null
      return null;
    }
  }

  private isTokenExpired(token: OAuthToken): boolean {
    const now = Math.floor(Date.now() / 1000);
    return token.expiry <= (now + 30);
  }
}
```

### Step 4: Migration CLI Command

**File**: `/packages/cli/src/ui/commands/migrationCommand.ts` (new)

```typescript
/**
 * CLI command for manual token migration
 */

import { Command } from 'commander';
import { OAuthManager } from '../../auth/oauth-manager.js';
import { MultiProviderTokenStore } from '@vybestack/llxprt-code-core';
import { LegacyMigrationService } from '@vybestack/llxprt-code-core';

export function createMigrationCommand(): Command {
  const command = new Command('migrate');
  
  command
    .description('Migrate legacy OAuth tokens to new storage format')
    .option('--dry-run', 'Show what would be migrated without making changes')
    .option('--force', 'Force migration even if new tokens already exist')
    .action(async (options) => {
      await handleMigrationCommand(options);
    });

  return command;
}

async function handleMigrationCommand(options: {
  dryRun?: boolean;
  force?: boolean;
}): Promise<void> {
  console.log('🔄 OAuth Token Migration Tool');
  console.log('─'.repeat(40));

  try {
    const tokenStore = new MultiProviderTokenStore();
    const migrationService = new LegacyMigrationService(tokenStore);

    if (options.dryRun) {
      console.log('Running in dry-run mode (no changes will be made)...\n');
      
      const status = await migrationService.getMigrationStatus();
      console.log(`Found ${status.totalLegacyTokens} legacy token sources`);
      console.log(`Migration required for: ${status.migrationRequired} sources`);
      console.log(`Valid tokens found: ${status.validTokens} sources\n`);

      if (status.migrationRequired === 0) {
        console.log('✅ No migration needed');
        return;
      }

      console.log('Would migrate the following:');
      // Show what would be migrated
      const detector = (migrationService as any).detector;
      const legacyTokens = await detector.detectLegacyTokens();
      
      for (const tokenInfo of legacyTokens) {
        if (tokenInfo.migrationRequired) {
          console.log(`  📦 ${tokenInfo.provider}:`);
          console.log(`     - Token: ${tokenInfo.hasToken ? '✓' : '✗'} ${tokenInfo.tokenValid ? '(valid)' : '(expired)'}`);
          console.log(`     - Account: ${tokenInfo.hasAccount ? '✓' : '✗'} ${tokenInfo.accountEmail || ''}`);
        }
      }
      
      console.log('\nRun without --dry-run to perform migration');
    } else {
      console.log('Performing token migration...\n');
      
      const results = await migrationService.migrateAllLegacyTokens();
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const result of results) {
        if (result.success) {
          successCount++;
          console.log(`✅ ${result.provider}:`);
          if (result.tokenMigrated) {
            console.log(`   - Migrated OAuth token`);
          }
          if (result.accountMigrated) {
            console.log(`   - Found account information`);
          }
          if (!result.tokenMigrated && !result.accountMigrated) {
            console.log(`   - No migration needed (already current)`);
          }
        } else {
          errorCount++;
          console.log(`❌ ${result.provider}: ${result.error}`);
        }
      }
      
      console.log(`\nMigration complete: ${successCount} successful, ${errorCount} failed`);
      
      if (successCount > 0) {
        console.log('\n💡 Tip: You can now safely delete legacy token files if migration was successful:');
        console.log('   rm ~/.llxprt/oauth_creds.json');
        console.log('   rm ~/.llxprt/google_accounts.json');
        console.log('\n   (The CLI will continue to work with the new token storage)');
      }
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}
```

## Testing Strategy

### Unit Tests

**File**: `/packages/core/test/auth/legacy-migration.test.ts`

```typescript
import { LegacyTokenDetector, LegacyMigrationService } from '../../src/auth/index.js';
import { MultiProviderTokenStore } from '../../src/auth/token-store.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';

describe('Legacy Token Migration', () => {
  let tempDir: string;
  let tokenStore: MultiProviderTokenStore;
  let migrationService: LegacyMigrationService;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `legacy-migration-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Mock the detector to use temp directory
    const detector = new LegacyTokenDetector();
    (detector as any).legacyDir = tempDir;
    
    tokenStore = new MultiProviderTokenStore();
    (tokenStore as any).basePath = join(tempDir, 'oauth');
    
    migrationService = new LegacyMigrationService(tokenStore);
    (migrationService as any).detector = detector;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should detect legacy Google OAuth tokens', async () => {
    // Setup legacy token file
    const legacyToken = {
      access_token: 'ya29.legacy-token',
      refresh_token: '1//04-refresh-token',
      expiry_date: Date.now() + 3600000, // 1 hour from now
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/cloud-platform'
    };
    
    await fs.writeFile(
      join(tempDir, 'oauth_creds.json'),
      JSON.stringify(legacyToken, null, 2)
    );
    
    const detector = (migrationService as any).detector;
    const legacyTokens = await detector.detectLegacyTokens();
    
    expect(legacyTokens).toHaveLength(1);
    expect(legacyTokens[0].provider).toBe('gemini');
    expect(legacyTokens[0].hasToken).toBe(true);
    expect(legacyTokens[0].tokenValid).toBe(true);
    expect(legacyTokens[0].migrationRequired).toBe(true);
  });

  it('should migrate legacy token to new format', async () => {
    // Setup legacy token
    const legacyToken = {
      access_token: 'ya29.legacy-token',
      refresh_token: '1//04-refresh-token',
      expiry_date: Date.now() + 3600000,
      token_type: 'Bearer'
    };
    
    await fs.writeFile(
      join(tempDir, 'oauth_creds.json'),
      JSON.stringify(legacyToken, null, 2)
    );
    
    // Perform migration
    const results = await migrationService.migrateAllLegacyTokens();
    
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].tokenMigrated).toBe(true);
    
    // Verify token in new storage
    const migratedToken = await tokenStore.getToken('gemini');
    expect(migratedToken).toBeTruthy();
    expect(migratedToken!.access_token).toBe('ya29.legacy-token');
    expect(migratedToken!.expiry).toBe(Math.floor(legacyToken.expiry_date / 1000));
  });

  it('should skip migration if new token already exists', async () => {
    // Setup both legacy and new tokens
    await fs.writeFile(
      join(tempDir, 'oauth_creds.json'),
      JSON.stringify({ access_token: 'legacy', expiry_date: Date.now() + 3600000 }, null, 2)
    );
    
    await tokenStore.saveToken('gemini', {
      access_token: 'new-token',
      expiry: Math.floor((Date.now() + 3600000) / 1000),
      token_type: 'Bearer'
    });
    
    // Attempt migration
    const results = await migrationService.migrateAllLegacyTokens();
    
    expect(results[0].success).toBe(true);
    expect(results[0].tokenMigrated).toBe(false); // Already exists
    
    // Verify new token unchanged
    const token = await tokenStore.getToken('gemini');
    expect(token!.access_token).toBe('new-token');
  });
});
```

## Deployment Plan

### Week 1: Detection and Compatibility
- Deploy legacy token detection
- Add migration service (non-invasive)
- Test on staging environment
- No user-facing changes

### Week 2: Automatic Migration
- Enable automatic migration on OAuth Manager initialization
- Add migration status logging
- Monitor error rates
- Gradual rollout with feature flag

### Week 3: Manual Migration Tools
- Deploy migration CLI command
- Add migration status to `/auth` commands
- User documentation updates
- Support for edge cases

### Week 4-8: Monitoring and Refinement
- Monitor migration success rates
- Handle edge cases and error scenarios
- Collect user feedback
- Prepare for legacy deprecation

## Success Criteria

1. **Token Preservation**: All valid legacy tokens successfully migrated
2. **Zero Downtime**: Users experience no authentication failures during migration
3. **Data Integrity**: Migrated tokens work identically to legacy tokens
4. **Error Handling**: Graceful handling of corrupted or invalid legacy tokens
5. **User Transparency**: Clear communication about migration status
6. **Rollback Safety**: Ability to revert if migration causes issues

## Risk Mitigation

### Risk: Data Loss During Migration
**Mitigation**: 
- Never delete legacy files during automatic migration
- Atomic file operations for new token storage
- Extensive backup and rollback procedures

### Risk: Token Format Incompatibilities
**Mitigation**:
- Comprehensive testing with real OAuth tokens
- Validation of all field mappings
- Fallback to legacy system if migration fails

### Risk: Performance Impact
**Mitigation**:
- Migration runs only once per user
- Asynchronous migration processes
- Caching of migration status

### Risk: Security Vulnerabilities
**Mitigation**:
- Maintain same file permissions as existing system
- Secure temporary file handling
- Audit of all token access patterns