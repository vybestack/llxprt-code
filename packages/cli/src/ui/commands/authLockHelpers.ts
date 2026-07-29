/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type {
  AuthLockStatus,
  AuthLockRecoveryResult,
} from '@vybestack/llxprt-code-auth';
import type { CommandArgumentSchema, CompleterFn } from './schema/types.js';
import type { MessageActionReturn } from './types.js';

export function buildLockUnlockSchemaEntries(
  bucketCompleter: CompleterFn,
): CommandArgumentSchema {
  return [
    {
      kind: 'literal',
      value: 'lock',
      description: 'Inspect or recover auth locks',
      next: [
        {
          kind: 'literal',
          value: 'status',
          description: 'Show auth lock status',
          next: [
            {
              kind: 'value',
              name: 'bucket',
              description: 'Bucket name (defaults to default)',
              completer: bucketCompleter,
            },
          ],
        },
      ],
    },
    {
      kind: 'literal',
      value: 'unlock',
      description: 'Recover a stuck auth lock (safe or forced)',
      next: [
        {
          kind: 'value',
          name: 'bucket',
          description: 'Bucket name (defaults to default)',
          completer: bucketCompleter,
          next: [
            {
              kind: 'literal',
              value: '--force',
              description:
                'Force-remove unverifiable/legacy locks (requires ack)',
              next: [
                {
                  kind: 'literal',
                  value: '--i-have-stopped-all-processes',
                  description:
                    'Acknowledge all LLxprt processes sharing the path are stopped',
                },
              ],
            },
            {
              kind: 'literal',
              value: '--i-have-stopped-all-processes',
              description:
                'Acknowledge all LLxprt processes sharing the path are stopped',
            },
          ],
        },
      ],
    },
  ];
}

function bucketSuffix(bucket: string): string {
  return bucket === 'default' ? '' : bucket;
}

export function formatLockStatus(status: AuthLockStatus): string {
  if (!status.exists) {
    return `No auth lock for ${status.provider}/${status.bucket}`;
  }

  const lines: string[] = [
    `Auth lock for ${status.provider}/${status.bucket}:`,
    `  Path: ${status.canonicalPath}`,
    `  Schema: ${status.classification}`,
  ];

  if (status.ownerPid !== null) {
    lines.push(`  Owner PID: ${status.ownerPid}`);
  }
  if (status.ownerHostname !== null) {
    lines.push(`  Owner host: ${status.ownerHostname}`);
  }
  if (status.ownerStartTimeMs !== null) {
    lines.push(
      `  Owner start: ${new Date(status.ownerStartTimeMs).toISOString()} (${status.ownerStartTimeSource})`,
    );
  } else {
    lines.push(`  Owner start: unknown (${status.ownerStartTimeSource})`);
  }

  lines.push(`  Liveness: ${status.liveness.status}`);
  if (status.ageMs !== null) {
    lines.push(`  Age: ${Math.floor(status.ageMs / 1000)}s`);
  }
  function describeVisibility(): string {
    const tv = status.tokenVisibility;
    if (tv.status === 'valid') return 'valid';
    if (tv.status === 'invalid') return 'invalid';
    return `unknown (${tv.diagnostic})`;
  }
  lines.push(`  Token on disk: ${describeVisibility()}`);

  const bucketLabel = bucketSuffix(status.bucket);

  if (status.liveness.status === 'dead') {
    lines.push(
      `\n  → Recover with: /auth ${status.provider} unlock ${bucketLabel}`.trimEnd(),
    );
  } else if (
    status.classification === 'legacy' ||
    status.classification === 'malformed' ||
    status.liveness.status === 'unverifiable'
  ) {
    lines.push(
      `\n  → Force-remove with: /auth ${status.provider} unlock ${bucketLabel} --force --i-have-stopped-all-processes`.trimEnd(),
    );
  }

  return lines.join('\n');
}

export function formatRecoveryResult(
  result: AuthLockRecoveryResult,
  isForce: boolean,
): string {
  const action = isForce ? 'Force unlock' : 'Unlock';
  const bucketLabel = result.bucket === 'default' ? '' : `/${result.bucket}`;
  const cleanupWarning =
    result.cleanupDiagnostic === undefined
      ? ''
      : `\n  Warning: ${result.cleanupDiagnostic}`;

  if (result.recovered) {
    return (
      `${action} succeeded for ${result.provider}${bucketLabel}: ${result.reason}` +
      cleanupWarning
    );
  }

  if (isForce && result.reason.includes('acknowledge')) {
    return (
      `${action} not performed for ${result.provider}${bucketLabel}.\n` +
      `  ${result.reason}` +
      cleanupWarning
    );
  }

  return (
    `${action} not recovered for ${result.provider}${bucketLabel}.\n` +
    `  ${result.reason}` +
    cleanupWarning
  );
}

export async function handleLockCommand(
  oauthManager: OAuthManager,
  provider: string,
  lockParts: string[],
): Promise<MessageActionReturn> {
  const positionalArgs = lockParts.filter((part) => !part.startsWith('--'));
  const subAction =
    positionalArgs.length > 0 ? positionalArgs[0].toLowerCase() : undefined;
  const bucket = positionalArgs[1];

  if (subAction !== 'status') {
    return {
      type: 'message',
      messageType: 'error',
      content: `Unknown lock subcommand: ${subAction ?? '(none)'}. Use: /auth ${provider} lock status [bucket]`,
    };
  }

  try {
    if (typeof oauthManager.inspectAuthLock !== 'function') {
      return {
        type: 'message',
        messageType: 'info',
        content: `Lock inspection is not supported for ${provider}'s token store`,
      };
    }
    const status = await oauthManager.inspectAuthLock(provider, bucket);
    if (status === null) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Lock inspection is not supported for ${provider}'s token store`,
      };
    }
    return {
      type: 'message',
      messageType: 'info',
      content: formatLockStatus(status),
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to inspect lock for ${provider}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function handleUnlockCommand(
  oauthManager: OAuthManager,
  provider: string,
  unlockParts: string[],
): Promise<MessageActionReturn> {
  const hasForce = unlockParts.includes('--force');
  const hasAck = unlockParts.includes('--i-have-stopped-all-processes');
  const positionalArgs = unlockParts.filter((p) => !p.startsWith('--'));
  const bucket = positionalArgs[0];

  try {
    if (hasForce) {
      if (typeof oauthManager.forceRecoverAuthLock !== 'function') {
        return {
          type: 'message',
          messageType: 'error',
          content: `Force recovery is not supported for ${provider}'s token store`,
        };
      }
      const result = await oauthManager.forceRecoverAuthLock(provider, bucket, {
        acknowledgeAllStopped: hasAck,
      });
      if (result === null) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Force recovery is not supported for ${provider}'s token store`,
        };
      }
      return {
        type: 'message',
        messageType: 'info',
        content: formatRecoveryResult(result, true),
      };
    }

    if (typeof oauthManager.recoverAuthLock !== 'function') {
      return {
        type: 'message',
        messageType: 'error',
        content: `Lock recovery is not supported for ${provider}'s token store`,
      };
    }
    const result = await oauthManager.recoverAuthLock(provider, bucket);
    if (result === null) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Lock recovery is not supported for ${provider}'s token store`,
      };
    }
    return {
      type: 'message',
      messageType: 'info',
      content: formatRecoveryResult(result, false),
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to unlock ${provider}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
