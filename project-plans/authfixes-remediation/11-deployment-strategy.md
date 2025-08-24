# Phase 6: Deployment Strategy (Safe Rollout Plan)

## Deployment Overview

This deployment strategy ensures safe, gradual rollout of OAuth authentication fixes with minimal risk to users and the ability to quickly rollback if issues arise.

## Risk Assessment

### High Risk Areas
1. **Token Storage Migration** - Risk of data loss during legacy migration
2. **Provider Initialization** - Changes to async patterns could cause timing issues
3. **Cache Clearing** - OAuth client cache changes affect active sessions
4. **Error Handling** - New error classification might change user experience

### Medium Risk Areas
1. **Legacy System Integration** - Dual-path authentication complexity
2. **Multi-Provider Support** - Concurrent provider registration
3. **Performance Impact** - Lazy initialization and error handling overhead

### Low Risk Areas
1. **UI Error Display** - Improved user messaging
2. **Debug Logging** - Enhanced troubleshooting capabilities
3. **Migration CLI Commands** - Optional user tools

## Deployment Phases

### Phase 1: Foundation (Week 1)
**Goal**: Deploy core infrastructure without changing behavior

**Components**:
- Token storage enhancements with debug logging
- Error classification system (unused)
- OAuth client cache clearing function
- Legacy token detection utilities

**Risk Level**: Low
**Rollback Strategy**: Simple revert
**Success Criteria**: No authentication regressions

### Phase 2: Cache Security Fix (Week 1)
**Goal**: Fix critical OAuth cache clearing security issue

**Components**:
- Update GeminiOAuthProvider logout to clear cache
- Update OAuth Manager logout to clear cache
- Add unit tests for cache clearing

**Risk Level**: Medium
**Rollback Strategy**: Disable cache clearing calls
**Success Criteria**: No session leakage, logout works correctly

### Phase 3: Token Persistence (Week 2)
**Goal**: Fix broken token persistence across restarts

**Components**:
- Fix async initialization in OAuth providers
- Update OAuth Manager to pass TokenStore properly
- Enable automatic token loading

**Risk Level**: High
**Rollback Strategy**: Revert to fire-and-forget async patterns
**Success Criteria**: Tokens persist across CLI restarts

### Phase 4: Gemini OAuth Implementation (Week 3)
**Goal**: Replace placeholder with real Gemini OAuth

**Components**:
- Deploy real GeminiOAuthProvider implementation
- Remove magic string handling
- Enable Gemini OAuth integration

**Risk Level**: Medium
**Rollback Strategy**: Revert to placeholder implementation
**Success Criteria**: Gemini OAuth works end-to-end

### Phase 5: Legacy Migration (Week 4)
**Goal**: Enable automatic legacy token migration

**Components**:
- Automatic migration on first access
- Migration CLI commands
- Legacy cleanup utilities

**Risk Level**: Medium
**Rollback Strategy**: Disable automatic migration
**Success Criteria**: Legacy tokens migrated successfully

### Phase 6: Error Handling (Week 5)
**Goal**: Improve error handling and user experience

**Components**:
- Enable comprehensive error handling
- User-friendly error displays
- Error recovery mechanisms

**Risk Level**: Low
**Rollback Strategy**: Revert to simple error logging
**Success Criteria**: Better user error experience

## Feature Flags

### Implementation

**File**: `/packages/core/src/auth/feature-flags.ts` (new)

```typescript
/**
 * Feature flags for OAuth authentication system
 */

export interface OAuthFeatureFlags {
  // Phase 1: Infrastructure
  enableDebugLogging: boolean;
  enableLegacyDetection: boolean;
  
  // Phase 2: Security fixes
  enableCacheClearing: boolean;
  
  // Phase 3: Token persistence
  enableAsyncInitialization: boolean;
  enableTokenStorePassing: boolean;
  
  // Phase 4: Gemini OAuth
  enableRealGeminiOAuth: boolean;
  disableMagicStrings: boolean;
  
  // Phase 5: Legacy migration
  enableAutomaticMigration: boolean;
  enableMigrationCommands: boolean;
  
  // Phase 6: Error handling
  enableAdvancedErrorHandling: boolean;
  enableErrorRecovery: boolean;
}

class OAuthFeatureFlagService {
  private static flags: OAuthFeatureFlags = {
    // Phase 1: Safe to enable immediately
    enableDebugLogging: true,
    enableLegacyDetection: true,
    
    // Phase 2: Enable after testing
    enableCacheClearing: false,
    
    // Phase 3: High risk - gradual rollout
    enableAsyncInitialization: false,
    enableTokenStorePassing: false,
    
    // Phase 4: Enable after Phase 3
    enableRealGeminiOAuth: false,
    disableMagicStrings: false,
    
    // Phase 5: Enable after user base migration
    enableAutomaticMigration: false,
    enableMigrationCommands: false,
    
    // Phase 6: Safe to enable anytime
    enableAdvancedErrorHandling: false,
    enableErrorRecovery: false,
  };

  static getFlags(): OAuthFeatureFlags {
    // Check environment variables for overrides
    const envFlags: Partial<OAuthFeatureFlags> = {};
    
    for (const [key, defaultValue] of Object.entries(this.flags)) {
      const envKey = `LLXPRT_OAUTH_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
      const envValue = process.env[envKey];
      
      if (envValue !== undefined) {
        envFlags[key as keyof OAuthFeatureFlags] = envValue === 'true';
      }
    }
    
    return { ...this.flags, ...envFlags };
  }

  static isEnabled(flag: keyof OAuthFeatureFlags): boolean {
    return this.getFlags()[flag];
  }

  static enable(flag: keyof OAuthFeatureFlags): void {
    this.flags[flag] = true;
  }

  static disable(flag: keyof OAuthFeatureFlags): void {
    this.flags[flag] = false;
  }

  // Phase management
  static enablePhase1(): void {
    this.flags.enableDebugLogging = true;
    this.flags.enableLegacyDetection = true;
  }

  static enablePhase2(): void {
    this.enablePhase1();
    this.flags.enableCacheClearing = true;
  }

  static enablePhase3(): void {
    this.enablePhase2();
    this.flags.enableAsyncInitialization = true;
    this.flags.enableTokenStorePassing = true;
  }

  static enablePhase4(): void {
    this.enablePhase3();
    this.flags.enableRealGeminiOAuth = true;
    this.flags.disableMagicStrings = true;
  }

  static enablePhase5(): void {
    this.enablePhase4();
    this.flags.enableAutomaticMigration = true;
    this.flags.enableMigrationCommands = true;
  }

  static enablePhase6(): void {
    this.enablePhase5();
    this.flags.enableAdvancedErrorHandling = true;
    this.flags.enableErrorRecovery = true;
  }
}

export { OAuthFeatureFlagService };
```

### Usage in Code

**Example**: OAuth Provider with feature flags

```typescript
export class QwenOAuthProvider implements OAuthProvider {
  constructor(private tokenStore?: TokenStore) {
    if (OAuthFeatureFlagService.isEnabled('enableTokenStorePassing')) {
      this.tokenStore = tokenStore;
    } else {
      // Legacy behavior - ignore TokenStore
      this.tokenStore = undefined;
    }

    if (OAuthFeatureFlagService.isEnabled('enableAsyncInitialization')) {
      this.initializationPromise = this.initializeToken();
    } else {
      // Legacy fire-and-forget pattern
      this.initializeToken();
    }
  }

  async logout(): Promise<void> {
    // ... existing logout logic ...

    if (OAuthFeatureFlagService.isEnabled('enableCacheClearing')) {
      try {
        const { clearOauthClientCache } = await import('@vybestack/llxprt-code-core');
        clearOauthClientCache();
      } catch (error) {
        console.warn('Failed to clear OAuth cache:', error);
      }
    }
  }
}
```

## Gradual Rollout Strategy

### Rollout Percentages

#### Week 1: Phase 1 & 2 (Foundation + Security)
- **Development**: 100%
- **Staging**: 100%
- **Production**: 10% (staff and beta users)

#### Week 2: Phase 3 (Token Persistence) 
- **Development**: 100%
- **Staging**: 100%
- **Production**: 25% (gradual increase)

#### Week 3: Phase 3 Continued
- **Production**: 50% (if no issues)

#### Week 4: Phase 4 (Gemini OAuth)
- **Production**: 75% (Phase 3 + Phase 4)

#### Week 5: Phase 5 (Legacy Migration)
- **Production**: 90%

#### Week 6: Phase 6 (Error Handling) + Full Rollout
- **Production**: 100%

### Rollout Implementation

**File**: `/packages/core/src/auth/rollout-service.ts` (new)

```typescript
/**
 * Gradual rollout service for OAuth features
 */

import crypto from 'crypto';

export class OAuthRolloutService {
  private static readonly ROLLOUT_CONFIG = {
    // Current rollout percentages by feature
    cacheClearing: 100, // Security fix - deploy immediately
    tokenPersistence: 25, // High risk - gradual rollout
    geminiOAuth: 10, // New feature - limited testing
    legacyMigration: 50, // Medium risk - moderate rollout
    errorHandling: 75, // Low risk - wide rollout
  };

  /**
   * Check if user should receive feature based on stable hash
   */
  static shouldReceiveFeature(
    feature: keyof typeof OAuthRolloutService.ROLLOUT_CONFIG,
    userId?: string
  ): boolean {
    const percentage = this.ROLLOUT_CONFIG[feature];
    
    if (percentage >= 100) {
      return true;
    }
    
    if (percentage <= 0) {
      return false;
    }

    // Use stable hash of user ID or system identifier
    const identifier = userId || this.getSystemIdentifier();
    const hash = crypto.createHash('sha256').update(`${feature}-${identifier}`).digest('hex');
    const hashNumber = parseInt(hash.substring(0, 8), 16);
    const userPercentile = (hashNumber % 100) + 1;
    
    return userPercentile <= percentage;
  }

  /**
   * Get system identifier for consistent rollout
   */
  private static getSystemIdentifier(): string {
    // Use hostname + user home directory for consistent identifier
    const os = require('os');
    return `${os.hostname()}-${os.homedir()}`;
  }

  /**
   * Update rollout percentage for a feature
   */
  static updateRolloutPercentage(
    feature: keyof typeof OAuthRolloutService.ROLLOUT_CONFIG,
    percentage: number
  ): void {
    if (percentage < 0 || percentage > 100) {
      throw new Error('Rollout percentage must be between 0 and 100');
    }
    
    this.ROLLOUT_CONFIG[feature] = percentage;
    console.log(`Updated ${feature} rollout to ${percentage}%`);
  }

  /**
   * Get current rollout status
   */
  static getRolloutStatus(): Record<string, number> {
    return { ...this.ROLLOUT_CONFIG };
  }
}
```

### Integration with Feature Flags

```typescript
export class OAuthFeatureFlagService {
  static isEnabled(flag: keyof OAuthFeatureFlags): boolean {
    const baseEnabled = this.getFlags()[flag];
    if (!baseEnabled) {
      return false;
    }

    // Check rollout percentage for gradual features
    switch (flag) {
      case 'enableCacheClearing':
        return OAuthRolloutService.shouldReceiveFeature('cacheClearing');
      case 'enableAsyncInitialization':
      case 'enableTokenStorePassing':
        return OAuthRolloutService.shouldReceiveFeature('tokenPersistence');
      case 'enableRealGeminiOAuth':
        return OAuthRolloutService.shouldReceiveFeature('geminiOAuth');
      case 'enableAutomaticMigration':
        return OAuthRolloutService.shouldReceiveFeature('legacyMigration');
      case 'enableAdvancedErrorHandling':
        return OAuthRolloutService.shouldReceiveFeature('errorHandling');
      default:
        return true; // No rollout restrictions
    }
  }
}
```

## Monitoring and Alerts

### Metrics to Track

**File**: `/packages/core/src/auth/oauth-metrics.ts` (new)

```typescript
/**
 * OAuth metrics collection for deployment monitoring
 */

export interface OAuthMetrics {
  // Authentication metrics
  authenticationAttempts: number;
  authenticationSuccesses: number;
  authenticationFailures: number;
  
  // Token persistence metrics
  tokensLoaded: number;
  tokensSaved: number;
  tokenLoadFailures: number;
  tokenSaveFailures: number;
  
  // Migration metrics
  legacyTokensDetected: number;
  migrationAttempts: number;
  migrationSuccesses: number;
  migrationFailures: number;
  
  // Error metrics
  errorsByType: Record<string, number>;
  errorsByProvider: Record<string, number>;
  
  // Performance metrics
  initializationTimes: number[];
  tokenAccessTimes: number[];
  
  // Feature usage
  featureUsage: Record<string, number>;
}

class OAuthMetricsCollector {
  private metrics: OAuthMetrics = {
    authenticationAttempts: 0,
    authenticationSuccesses: 0,
    authenticationFailures: 0,
    tokensLoaded: 0,
    tokensSaved: 0,
    tokenLoadFailures: 0,
    tokenSaveFailures: 0,
    legacyTokensDetected: 0,
    migrationAttempts: 0,
    migrationSuccesses: 0,
    migrationFailures: 0,
    errorsByType: {},
    errorsByProvider: {},
    initializationTimes: [],
    tokenAccessTimes: [],
    featureUsage: {},
  };

  // Metric collection methods
  recordAuthenticationAttempt(): void {
    this.metrics.authenticationAttempts++;
  }

  recordAuthenticationSuccess(): void {
    this.metrics.authenticationSuccesses++;
  }

  recordAuthenticationFailure(): void {
    this.metrics.authenticationFailures++;
  }

  recordTokenLoaded(): void {
    this.metrics.tokensLoaded++;
  }

  recordTokenSaved(): void {
    this.metrics.tokensSaved++;
  }

  recordTokenLoadFailure(): void {
    this.metrics.tokenLoadFailures++;
  }

  recordTokenSaveFailure(): void {
    this.metrics.tokenSaveFailures++;
  }

  recordLegacyTokenDetected(): void {
    this.metrics.legacyTokensDetected++;
  }

  recordMigrationAttempt(): void {
    this.metrics.migrationAttempts++;
  }

  recordMigrationSuccess(): void {
    this.metrics.migrationSuccesses++;
  }

  recordMigrationFailure(): void {
    this.metrics.migrationFailures++;
  }

  recordError(type: string, provider: string): void {
    this.metrics.errorsByType[type] = (this.metrics.errorsByType[type] || 0) + 1;
    this.metrics.errorsByProvider[provider] = (this.metrics.errorsByProvider[provider] || 0) + 1;
  }

  recordInitializationTime(timeMs: number): void {
    this.metrics.initializationTimes.push(timeMs);
    // Keep only last 100 measurements
    if (this.metrics.initializationTimes.length > 100) {
      this.metrics.initializationTimes.shift();
    }
  }

  recordTokenAccessTime(timeMs: number): void {
    this.metrics.tokenAccessTimes.push(timeMs);
    // Keep only last 100 measurements
    if (this.metrics.tokenAccessTimes.length > 100) {
      this.metrics.tokenAccessTimes.shift();
    }
  }

  recordFeatureUsage(feature: string): void {
    this.metrics.featureUsage[feature] = (this.metrics.featureUsage[feature] || 0) + 1;
  }

  // Metric analysis
  getAuthenticationSuccessRate(): number {
    if (this.metrics.authenticationAttempts === 0) return 0;
    return this.metrics.authenticationSuccesses / this.metrics.authenticationAttempts;
  }

  getTokenPersistenceSuccessRate(): number {
    const total = this.metrics.tokensSaved + this.metrics.tokenSaveFailures;
    if (total === 0) return 0;
    return this.metrics.tokensSaved / total;
  }

  getMigrationSuccessRate(): number {
    if (this.metrics.migrationAttempts === 0) return 0;
    return this.metrics.migrationSuccesses / this.metrics.migrationAttempts;
  }

  getAverageInitializationTime(): number {
    if (this.metrics.initializationTimes.length === 0) return 0;
    return this.metrics.initializationTimes.reduce((a, b) => a + b, 0) / this.metrics.initializationTimes.length;
  }

  getMetrics(): OAuthMetrics {
    return { ...this.metrics };
  }

  // Export for telemetry
  exportMetrics(): string {
    return JSON.stringify({
      ...this.metrics,
      timestamp: new Date().toISOString(),
      authSuccessRate: this.getAuthenticationSuccessRate(),
      persistenceSuccessRate: this.getTokenPersistenceSuccessRate(),
      migrationSuccessRate: this.getMigrationSuccessRate(),
      avgInitTime: this.getAverageInitializationTime(),
    }, null, 2);
  }
}

export const oauthMetrics = new OAuthMetricsCollector();
```

### Alert Conditions

**File**: `/scripts/oauth-monitoring.js` (new)

```javascript
/**
 * OAuth monitoring and alerting script
 */

const ALERT_THRESHOLDS = {
  // Critical alerts
  authenticationSuccessRate: 0.95, // Below 95% success rate
  tokenPersistenceSuccessRate: 0.98, // Below 98% persistence rate
  
  // Warning alerts  
  migrationSuccessRate: 0.90, // Below 90% migration rate
  averageInitializationTime: 2000, // Above 2 seconds
  
  // Error rate alerts
  maxErrorsPerHour: 100, // More than 100 errors per hour
  maxFailuresPerProvider: 50, // More than 50 failures per provider
};

class OAuthMonitor {
  constructor() {
    this.metrics = require('../packages/core/src/auth/oauth-metrics.js').oauthMetrics;
    this.lastAlertTime = new Map();
  }

  checkAlerts() {
    const metrics = this.metrics.getMetrics();
    const alerts = [];

    // Check authentication success rate
    const authSuccessRate = this.metrics.getAuthenticationSuccessRate();
    if (authSuccessRate < ALERT_THRESHOLDS.authenticationSuccessRate) {
      alerts.push({
        level: 'critical',
        message: `Authentication success rate below threshold: ${(authSuccessRate * 100).toFixed(2)}%`,
        metric: 'auth_success_rate',
        value: authSuccessRate,
        threshold: ALERT_THRESHOLDS.authenticationSuccessRate,
      });
    }

    // Check token persistence success rate
    const persistenceSuccessRate = this.metrics.getTokenPersistenceSuccessRate();
    if (persistenceSuccessRate < ALERT_THRESHOLDS.tokenPersistenceSuccessRate) {
      alerts.push({
        level: 'critical',
        message: `Token persistence success rate below threshold: ${(persistenceSuccessRate * 100).toFixed(2)}%`,
        metric: 'persistence_success_rate',
        value: persistenceSuccessRate,
        threshold: ALERT_THRESHOLDS.tokenPersistenceSuccessRate,
      });
    }

    // Check migration success rate
    const migrationSuccessRate = this.metrics.getMigrationSuccessRate();
    if (migrationSuccessRate < ALERT_THRESHOLDS.migrationSuccessRate && metrics.migrationAttempts > 10) {
      alerts.push({
        level: 'warning',
        message: `Migration success rate below threshold: ${(migrationSuccessRate * 100).toFixed(2)}%`,
        metric: 'migration_success_rate',
        value: migrationSuccessRate,
        threshold: ALERT_THRESHOLDS.migrationSuccessRate,
      });
    }

    // Check initialization time
    const avgInitTime = this.metrics.getAverageInitializationTime();
    if (avgInitTime > ALERT_THRESHOLDS.averageInitializationTime) {
      alerts.push({
        level: 'warning',
        message: `Average initialization time above threshold: ${avgInitTime.toFixed(0)}ms`,
        metric: 'avg_init_time',
        value: avgInitTime,
        threshold: ALERT_THRESHOLDS.averageInitializationTime,
      });
    }

    // Check error rates by provider
    for (const [provider, errorCount] of Object.entries(metrics.errorsByProvider)) {
      if (errorCount > ALERT_THRESHOLDS.maxFailuresPerProvider) {
        alerts.push({
          level: 'warning',
          message: `High error rate for provider ${provider}: ${errorCount} errors`,
          metric: 'provider_errors',
          provider,
          value: errorCount,
          threshold: ALERT_THRESHOLDS.maxFailuresPerProvider,
        });
      }
    }

    return alerts;
  }

  shouldSendAlert(alert) {
    const key = `${alert.metric}_${alert.provider || 'global'}`;
    const lastAlert = this.lastAlertTime.get(key);
    const now = Date.now();
    
    // Rate limit alerts - don't send same alert more than once per hour
    if (lastAlert && (now - lastAlert) < 3600000) {
      return false;
    }
    
    this.lastAlertTime.set(key, now);
    return true;
  }

  sendAlert(alert) {
    // In production, this would send to monitoring system
    console.error(`🚨 OAuth ${alert.level.toUpperCase()} ALERT: ${alert.message}`);
    
    // Could integrate with:
    // - Slack webhooks
    // - PagerDuty
    // - Email notifications
    // - Monitoring dashboards
  }

  run() {
    const alerts = this.checkAlerts();
    
    for (const alert of alerts) {
      if (this.shouldSendAlert(alert)) {
        this.sendAlert(alert);
      }
    }
    
    return alerts;
  }
}

// Run monitoring check
if (require.main === module) {
  const monitor = new OAuthMonitor();
  const alerts = monitor.run();
  
  if (alerts.length === 0) {
    console.log('✅ OAuth system health check: All metrics within normal ranges');
  } else {
    console.log(`⚠️  OAuth system health check: ${alerts.length} alerts generated`);
    process.exit(1);
  }
}

module.exports = { OAuthMonitor, ALERT_THRESHOLDS };
```

## Rollback Procedures

### Automated Rollback Triggers

```typescript
/**
 * Automated rollback system for OAuth features
 */

export class OAuthRollbackService {
  private static readonly ROLLBACK_TRIGGERS = {
    // Critical rollback conditions
    authSuccessRateBelow: 0.90, // Roll back if auth success < 90%
    persistenceFailureRateAbove: 0.10, // Roll back if persistence failure > 10%
    criticalErrorsAbove: 10, // Roll back if > 10 critical errors in 5 minutes
    
    // Warning conditions (reduce rollout percentage)
    authSuccessRateWarning: 0.95,
    persistenceFailureRateWarning: 0.05,
    errorRateWarning: 5, // errors per 5 minutes
  };

  static async checkRollbackConditions(): Promise<{ shouldRollback: boolean; reason?: string }> {
    const metrics = oauthMetrics.getMetrics();
    
    // Check authentication success rate
    const authSuccessRate = oauthMetrics.getAuthenticationSuccessRate();
    if (authSuccessRate < this.ROLLBACK_TRIGGERS.authSuccessRateBelow && metrics.authenticationAttempts > 50) {
      return {
        shouldRollback: true,
        reason: `Authentication success rate critically low: ${(authSuccessRate * 100).toFixed(2)}%`
      };
    }
    
    // Check persistence failure rate
    const persistenceSuccessRate = oauthMetrics.getTokenPersistenceSuccessRate();
    const persistenceFailureRate = 1 - persistenceSuccessRate;
    if (persistenceFailureRate > this.ROLLBACK_TRIGGERS.persistenceFailureRateAbove && 
        metrics.tokensSaved + metrics.tokenSaveFailures > 20) {
      return {
        shouldRollback: true,
        reason: `Token persistence failure rate critically high: ${(persistenceFailureRate * 100).toFixed(2)}%`
      };
    }
    
    // Check critical error count
    const criticalErrors = metrics.errorsByType['critical'] || 0;
    if (criticalErrors > this.ROLLBACK_TRIGGERS.criticalErrorsAbove) {
      return {
        shouldRollback: true,
        reason: `Critical error count too high: ${criticalErrors} errors`
      };
    }
    
    return { shouldRollback: false };
  }

  static async performRollback(reason: string): Promise<void> {
    console.error(`🚨 PERFORMING OAUTH ROLLBACK: ${reason}`);
    
    // Disable high-risk features immediately
    OAuthFeatureFlagService.disable('enableAsyncInitialization');
    OAuthFeatureFlagService.disable('enableTokenStorePassing');
    OAuthFeatureFlagService.disable('enableRealGeminiOAuth');
    OAuthFeatureFlagService.disable('enableAutomaticMigration');
    
    // Reduce rollout percentages to 0%
    OAuthRolloutService.updateRolloutPercentage('tokenPersistence', 0);
    OAuthRolloutService.updateRolloutPercentage('geminiOAuth', 0);
    OAuthRolloutService.updateRolloutPercentage('legacyMigration', 0);
    
    // Keep safe features enabled
    // - Debug logging (helps with troubleshooting)
    // - Legacy detection (no behavior change)
    // - Error handling improvements (generally beneficial)
    
    console.log('✅ Rollback completed - OAuth system reverted to safe configuration');
    
    // Send rollback notification
    this.sendRollbackNotification(reason);
  }

  private static sendRollbackNotification(reason: string): void {
    // In production, this would alert the development team
    console.error(`
🚨 OAUTH ROLLBACK NOTIFICATION
Reason: ${reason}
Time: ${new Date().toISOString()}
Action: OAuth features have been automatically disabled
Next Steps: 
1. Investigate the root cause
2. Fix the issue in development
3. Re-enable features gradually
4. Monitor metrics closely
    `);
  }
}
```

### Manual Rollback Commands

**File**: `/packages/cli/src/ui/commands/rollbackCommand.ts` (new)

```typescript
/**
 * Manual rollback command for OAuth features
 */

import { Command } from 'commander';
import { OAuthFeatureFlagService, OAuthRolloutService } from '@vybestack/llxprt-code-core';

export function createRollbackCommand(): Command {
  const command = new Command('oauth-rollback');
  
  command
    .description('Rollback OAuth features to safe configuration')
    .option('--feature <feature>', 'Rollback specific feature only')
    .option('--percentage <percentage>', 'Set rollout percentage (0-100)')
    .option('--full', 'Full rollback to legacy system')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (options) => {
      await handleRollbackCommand(options);
    });

  return command;
}

async function handleRollbackCommand(options: {
  feature?: string;
  percentage?: string;
  full?: boolean;
  confirm?: boolean;
}): Promise<void> {
  console.log('🔄 OAuth Rollback Tool');
  console.log('─'.repeat(40));

  if (!options.confirm) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    const answer = await new Promise<string>((resolve) => {
      rl.question('Are you sure you want to rollback OAuth features? (y/N): ', resolve);
    });
    
    rl.close();
    
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('Rollback cancelled');
      return;
    }
  }

  try {
    if (options.full) {
      await performFullRollback();
    } else if (options.feature && options.percentage) {
      await performPartialRollback(options.feature, parseInt(options.percentage));
    } else if (options.feature) {
      await disableFeature(options.feature);
    } else {
      await performSafeRollback();
    }
    
    console.log('✅ Rollback completed successfully');
  } catch (error) {
    console.error('❌ Rollback failed:', error);
    process.exit(1);
  }
}

async function performFullRollback(): Promise<void> {
  console.log('Performing full rollback to legacy OAuth system...');
  
  // Disable all new features
  const flags: Array<keyof OAuthFeatureFlags> = [
    'enableAsyncInitialization',
    'enableTokenStorePassing',
    'enableRealGeminiOAuth',
    'disableMagicStrings',
    'enableAutomaticMigration',
    'enableMigrationCommands',
    'enableAdvancedErrorHandling',
    'enableErrorRecovery',
  ];
  
  for (const flag of flags) {
    OAuthFeatureFlagService.disable(flag);
    console.log(`  Disabled: ${flag}`);
  }
  
  // Set all rollout percentages to 0
  const rolloutFeatures = ['tokenPersistence', 'geminiOAuth', 'legacyMigration', 'errorHandling'];
  for (const feature of rolloutFeatures) {
    OAuthRolloutService.updateRolloutPercentage(feature as any, 0);
    console.log(`  Rollout disabled: ${feature}`);
  }
  
  console.log('Full rollback completed - system reverted to legacy OAuth behavior');
}

async function performSafeRollback(): Promise<void> {
  console.log('Performing safe rollback - disabling high-risk features...');
  
  // Disable only high-risk features
  const highRiskFlags: Array<keyof OAuthFeatureFlags> = [
    'enableAsyncInitialization',
    'enableTokenStorePassing',
    'enableRealGeminiOAuth',
    'enableAutomaticMigration',
  ];
  
  for (const flag of highRiskFlags) {
    OAuthFeatureFlagService.disable(flag);
    console.log(`  Disabled high-risk feature: ${flag}`);
  }
  
  // Reduce rollout percentages for risky features
  OAuthRolloutService.updateRolloutPercentage('tokenPersistence', 10);
  OAuthRolloutService.updateRolloutPercentage('geminiOAuth', 5);
  OAuthRolloutService.updateRolloutPercentage('legacyMigration', 25);
  
  console.log('Safe rollback completed - high-risk features disabled');
}

async function performPartialRollback(feature: string, percentage: number): Promise<void> {
  console.log(`Setting rollout percentage for ${feature} to ${percentage}%...`);
  
  try {
    OAuthRolloutService.updateRolloutPercentage(feature as any, percentage);
    console.log(`Successfully updated ${feature} rollout to ${percentage}%`);
  } catch (error) {
    throw new Error(`Failed to update rollout for ${feature}: ${error}`);
  }
}

async function disableFeature(feature: string): Promise<void> {
  console.log(`Disabling feature: ${feature}...`);
  
  try {
    OAuthFeatureFlagService.disable(feature as any);
    console.log(`Successfully disabled ${feature}`);
  } catch (error) {
    throw new Error(`Failed to disable feature ${feature}: ${error}`);
  }
}
```

## Deployment Checklist

### Pre-Deployment Checklist

#### Phase 1: Foundation
- [ ] Unit tests pass for all new infrastructure
- [ ] Debug logging works correctly
- [ ] Legacy detection utilities tested
- [ ] No performance regressions in existing flows
- [ ] Documentation updated

#### Phase 2: Security Fix
- [ ] Cache clearing functionality tested
- [ ] No memory leaks in OAuth client handling
- [ ] Security audit of cache clearing mechanism
- [ ] Rollback procedure tested

#### Phase 3: Token Persistence
- [ ] Async initialization thoroughly tested
- [ ] Token storage passing works correctly
- [ ] Migration from fire-and-forget pattern verified
- [ ] Performance impact measured and acceptable
- [ ] Edge cases and error scenarios tested

#### Phase 4: Gemini OAuth
- [ ] Real Gemini OAuth implementation tested end-to-end
- [ ] Magic string removal doesn't break existing flows
- [ ] Legacy compatibility maintained
- [ ] Integration with existing LOGIN_WITH_GOOGLE verified

#### Phase 5: Legacy Migration
- [ ] Automatic migration tested with real legacy tokens
- [ ] Migration CLI commands functional
- [ ] No data loss during migration
- [ ] Rollback from migration possible

#### Phase 6: Error Handling
- [ ] Error classification covers all scenarios
- [ ] User-friendly error messages tested
- [ ] Error recovery mechanisms functional
- [ ] No regression in error handling experience

### Post-Deployment Verification

#### Immediate (0-24 hours)
- [ ] Monitor authentication success rates
- [ ] Check error logs for unexpected issues
- [ ] Verify feature flags working correctly
- [ ] Confirm rollout percentages applied correctly

#### Short-term (1-7 days)
- [ ] Token persistence working across restarts
- [ ] Legacy migration completing successfully
- [ ] Performance metrics within acceptable ranges
- [ ] User support tickets not increased

#### Long-term (1-4 weeks)
- [ ] Gradual rollout proceeding safely
- [ ] Metrics trending positively
- [ ] User feedback positive
- [ ] Full deployment readiness confirmed

## Success Metrics

### Technical Metrics
- **Authentication Success Rate**: > 98%
- **Token Persistence Rate**: > 99%  
- **Migration Success Rate**: > 95%
- **Average Initialization Time**: < 500ms
- **Error Rate**: < 2% of operations

### User Experience Metrics
- **Support Ticket Volume**: No increase > 10%
- **User Satisfaction**: No decline in authentication experience
- **Feature Adoption**: Gradual increase in OAuth usage
- **Error Recovery**: Users able to self-resolve common issues

### Business Metrics
- **Deployment Velocity**: Features deployed on schedule
- **Rollback Frequency**: < 1 rollback per phase
- **Development Team Confidence**: High confidence in OAuth system
- **Maintenance Overhead**: Reduced complexity after full deployment

This comprehensive deployment strategy ensures safe, gradual rollout of OAuth authentication fixes with proper monitoring, rollback capabilities, and success validation.