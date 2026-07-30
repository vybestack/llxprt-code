/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthCommandExecutor } from './authCommand.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type {
  AuthLockStatus,
  AuthLockRecoveryResult,
} from '@vybestack/llxprt-code-auth';
import type { CommandContext, MessageActionReturn } from './types.js';

const mockContext: CommandContext = {} as CommandContext;

function createMockOAuthManager(): OAuthManager & {
  inspectAuthLock: ReturnType<typeof vi.fn>;
  recoverAuthLock: ReturnType<typeof vi.fn>;
  forceRecoverAuthLock: ReturnType<typeof vi.fn>;
} {
  return {
    getSupportedProviders: vi.fn().mockReturnValue(['codex']),
    isOAuthEnabled: vi.fn().mockReturnValue(true),
    isAuthenticated: vi.fn().mockResolvedValue(true),
    authenticate: vi.fn(),
    logout: vi.fn(),
    logoutAll: vi.fn(),
    logoutAllBuckets: vi.fn(),
    getAuthStatus: vi.fn(),
    getAuthStatusWithBuckets: vi.fn(),
    peekStoredToken: vi.fn(),
    getToken: vi.fn(),
    getOAuthToken: vi.fn(),
    forceRefreshToken: vi.fn(),
    toggleOAuthEnabled: vi.fn(),
    getHigherPriorityAuth: vi.fn(),
    setSessionBucket: vi.fn(),
    getSessionBucket: vi.fn(),
    clearSessionBucket: vi.fn(),
    clearAllSessionBuckets: vi.fn(),
    listBuckets: vi.fn(),
    activateNamedLoginBucket: vi.fn(),
    authenticateMultipleBuckets: vi.fn(),
    configureProactiveRenewalsForProfile: vi.fn(),
    runProactiveRenewal: vi.fn(),
    getTokenStore: vi.fn(),
    getProvider: vi.fn(),
    registerProvider: vi.fn(),
    attachAddItemToProviders: vi.fn(),
    inspectAuthLock: vi.fn(),
    recoverAuthLock: vi.fn(),
    forceRecoverAuthLock: vi.fn(),
    setBrowserProfileAssociation: vi.fn(),
    getBrowserProfileAssociation: vi.fn(),
    clearBrowserProfileAssociation: vi.fn(),
    listBrowserProfileAssociations: vi.fn(),
    getAnthropicUsageInfo: vi.fn(),
    getAllAnthropicUsageInfo: vi.fn(),
    getAllCodexUsageInfo: vi.fn(),
    getAllCodexRateLimitResetCredits: vi.fn(),
  } as unknown as OAuthManager & {
    inspectAuthLock: ReturnType<typeof vi.fn>;
    recoverAuthLock: ReturnType<typeof vi.fn>;
    forceRecoverAuthLock: ReturnType<typeof vi.fn>;
  };
}

function asMessage(
  result: Awaited<ReturnType<AuthCommandExecutor['execute']>>,
): MessageActionReturn {
  if (result.type !== 'message') {
    throw new Error(`Expected message result, got ${result.type}`);
  }
  return result;
}

describe('AuthCommandExecutor lock status/unlock commands (issue #2819)', () => {
  let manager: ReturnType<typeof createMockOAuthManager>;

  beforeEach(() => {
    manager = createMockOAuthManager();
  });

  it('lock status reports absent lock', async () => {
    manager.inspectAuthLock.mockResolvedValue({
      provider: 'codex',
      bucket: 'default',
      exists: false,
      canonicalPath: '/tmp/codex-auth.lock',
      classification: 'absent',
      ownerPid: null,
      ownerHostname: null,
      ownerStartTimeMs: null,
      ownerStartTimeSource: 'unavailable',
      liveness: { status: 'unverifiable' },
      ageMs: null,
      tokenVisibility: { status: 'invalid' },
    } satisfies AuthLockStatus);

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(mockContext, 'codex lock status'),
    );

    expect(result.messageType).toBe('info');
    expect(result.content).toContain('No auth lock');
    expect(result.content).not.toContain('--force');
  });

  it('lock status requires acknowledged force for unverifiable legacy residue', async () => {
    manager.inspectAuthLock.mockResolvedValue({
      provider: 'codex',
      bucket: 'default',
      exists: true,
      canonicalPath: '/tmp/codex-auth.lock',
      classification: 'legacy',
      ownerPid: 999999,
      ownerHostname: null,
      ownerStartTimeMs: null,
      ownerStartTimeSource: 'unavailable',
      liveness: { status: 'unverifiable' },
      ageMs: 60000,
      tokenVisibility: { status: 'invalid' },
    } satisfies AuthLockStatus);

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(mockContext, 'codex lock status'),
    );

    expect(result.messageType).toBe('info');
    expect(result.content).toContain('legacy');
    expect(result.content).toContain('unverifiable');
    expect(result.content).toContain('--force --i-have-stopped-all-processes');
  });

  it('lock status preserves an unknown token visibility diagnostic', async () => {
    manager.inspectAuthLock.mockResolvedValue({
      provider: 'codex',
      bucket: 'default',
      exists: true,
      canonicalPath: '/tmp/codex-auth.lock',
      classification: 'versioned',
      ownerPid: 12345,
      ownerHostname: 'myhost',
      ownerStartTimeMs: Date.now(),
      ownerStartTimeSource: 'canonical',
      liveness: { status: 'live' },
      ageMs: 5000,
      tokenVisibility: {
        status: 'unknown',
        diagnostic: 'keychain is locked',
      },
    } satisfies AuthLockStatus);

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(mockContext, 'codex lock status'),
    );

    expect(result.content).toContain('unknown (keychain is locked)');
  });

  it('lock status reports a verified-live owner without recovery guidance', async () => {
    manager.inspectAuthLock.mockResolvedValue({
      provider: 'codex',
      bucket: 'default',
      exists: true,
      canonicalPath: '/tmp/codex-auth.lock',
      classification: 'versioned',
      ownerPid: 12345,
      ownerHostname: 'myhost',
      ownerStartTimeMs: Date.now(),
      ownerStartTimeSource: 'canonical',
      liveness: { status: 'live' },
      ageMs: 5000,
      tokenVisibility: { status: 'valid' },
    } satisfies AuthLockStatus);

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(mockContext, 'codex lock status'),
    );

    expect(result.messageType).toBe('info');
    expect(result.content).toContain('live');
    expect(result.content).toContain('12345');
    expect(result.content).not.toContain('Recover with');
    expect(result.content).not.toContain('Force-remove with');
  });

  it('unlock recovers a proven-dead lock', async () => {
    manager.recoverAuthLock.mockResolvedValue({
      provider: 'codex',
      bucket: 'default',
      recovered: true,
      reason: 'Lock recovered via fenced takeover',
      canonicalPath: '/tmp/codex-auth.lock',
    } satisfies AuthLockRecoveryResult);

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(mockContext, 'codex unlock'),
    );

    expect(manager.recoverAuthLock).toHaveBeenCalledWith('codex', 'default');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('recovered');
  });

  it('unlock reports failure when owner is live', async () => {
    manager.recoverAuthLock.mockResolvedValue({
      provider: 'codex',
      bucket: 'default',
      recovered: false,
      reason: 'Owner is live, not provably dead',
      canonicalPath: '/tmp/codex-auth.lock',
    } satisfies AuthLockRecoveryResult);

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(mockContext, 'codex unlock'),
    );

    expect(result.messageType).toBe('info');
    expect(result.content).toContain('not recovered');
    expect(result.content).toContain('live');
  });

  it('unlock with bucket targets the correct bucket', async () => {
    manager.recoverAuthLock.mockResolvedValue({
      provider: 'codex',
      bucket: 'work',
      recovered: true,
      reason: 'Lock recovered',
      canonicalPath: '/tmp/codex-work-auth.lock',
    } satisfies AuthLockRecoveryResult);

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(mockContext, 'codex unlock work'),
    );

    expect(manager.recoverAuthLock).toHaveBeenCalledWith('codex', 'work');
    expect(result.content).toContain('work');
  });

  it('surfaces the backend acknowledgment requirement for legacy residue', async () => {
    manager.forceRecoverAuthLock.mockResolvedValue({
      provider: 'codex',
      bucket: 'default',
      recovered: false,
      reason:
        'Lock is legacy/unverifiable. Add --i-have-stopped-all-processes to acknowledge that all LLxprt processes sharing this path have been stopped.',
      canonicalPath: '/tmp/codex-auth.lock',
    } satisfies AuthLockRecoveryResult);

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(mockContext, 'codex unlock default --force'),
    );

    expect(manager.forceRecoverAuthLock).toHaveBeenCalledWith(
      'codex',
      'default',
      { acknowledgeAllStopped: false },
    );
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('--i-have-stopped-all-processes');
  });

  it('force unlock succeeds with --i-have-stopped-all-processes flag', async () => {
    manager.forceRecoverAuthLock.mockResolvedValue({
      provider: 'codex',
      bucket: 'default',
      recovered: true,
      reason: 'Lock force-removed (legacy/dead)',
      canonicalPath: '/tmp/codex-auth.lock',
    } satisfies AuthLockRecoveryResult);

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(
        mockContext,
        'codex unlock --force --i-have-stopped-all-processes',
      ),
    );

    expect(manager.forceRecoverAuthLock).toHaveBeenCalledWith(
      'codex',
      'default',
      { acknowledgeAllStopped: true },
    );
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('succeeded');
  });

  it('rejects the acknowledgment flag without --force', async () => {
    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(
        mockContext,
        'codex unlock --i-have-stopped-all-processes',
      ),
    );

    expect(result).toMatchObject({
      messageType: 'error',
      content: '--i-have-stopped-all-processes is valid only with --force',
    });
    expect(manager.recoverAuthLock).not.toHaveBeenCalled();
    expect(manager.forceRecoverAuthLock).not.toHaveBeenCalled();
  });

  it('lock status ignores flag-like arguments instead of treating them as a bucket', async () => {
    manager.inspectAuthLock.mockResolvedValue({
      provider: 'codex',
      bucket: 'default',
      exists: false,
      canonicalPath: '/tmp/codex-auth.lock',
      classification: 'absent',
      ownerPid: null,
      ownerHostname: null,
      ownerStartTimeMs: null,
      ownerStartTimeSource: 'unavailable',
      liveness: { status: 'unverifiable' },
      ageMs: null,
      tokenVisibility: { status: 'invalid' },
    } satisfies AuthLockStatus);

    const executor = new AuthCommandExecutor(manager);
    await executor.execute(mockContext, 'codex lock status --verbose');

    expect(manager.inspectAuthLock).toHaveBeenCalledWith('codex', 'default');
  });

  it('lock status surfaces inspection errors as command output', async () => {
    manager.inspectAuthLock.mockRejectedValue(new Error('disk I/O error'));

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(mockContext, 'codex lock status'),
    );

    expect(result).toMatchObject({
      messageType: 'error',
      content: 'Failed to inspect lock for codex: disk I/O error',
    });
  });

  it('unlock surfaces recovery errors as command output', async () => {
    manager.recoverAuthLock.mockRejectedValue(
      new Error('lock directory denied'),
    );

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(mockContext, 'codex unlock'),
    );

    expect(result).toMatchObject({
      messageType: 'error',
      content: 'Failed to unlock codex: lock directory denied',
    });
  });

  it('unlock surfaces fence cleanup diagnostics after successful recovery', async () => {
    manager.recoverAuthLock.mockResolvedValue({
      provider: 'codex',
      bucket: 'default',
      recovered: true,
      reason: 'Lock recovered via fenced takeover',
      canonicalPath: '/tmp/codex-auth.lock',
      cleanupDiagnostic: 'Recovery fence cleanup failed: permission denied',
    } satisfies AuthLockRecoveryResult);

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(mockContext, 'codex unlock'),
    );

    expect(result.content).toContain(
      'Warning: Recovery fence cleanup failed: permission denied',
    );
  });

  it('force unlock refuses a verified-live owner', async () => {
    manager.forceRecoverAuthLock.mockResolvedValue({
      provider: 'codex',
      bucket: 'default',
      recovered: false,
      reason: 'Owner PID 12345 is verified-live — refusing to remove',
      canonicalPath: '/tmp/codex-auth.lock',
    } satisfies AuthLockRecoveryResult);

    const executor = new AuthCommandExecutor(manager);
    const result = asMessage(
      await executor.execute(
        mockContext,
        'codex unlock default --force --i-have-stopped-all-processes',
      ),
    );

    expect(result.messageType).toBe('info');
    expect(result.content).toContain('verified-live');
  });
});
