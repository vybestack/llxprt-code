/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand, CommandContext } from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { fetchAllQuotaInfo } from './statsQuota.js';
import {
  CodexRateLimitResetCreditsResponseSchema,
  consumeCodexRateLimitResetCredit,
  formatCodexResetCredits,
} from '@vybestack/llxprt-code-providers';
import type { CodexRateLimitResetCreditsResponse } from '@vybestack/llxprt-code-providers';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { CodexOAuthTokenSchema } from '@vybestack/llxprt-code-auth';
import type { CommandArgumentSchema } from './schema/types.js';
import { randomUUID } from 'node:crypto';

// Non-interactive mode (`llxprt-code --command "/quota reset"`) does not load
// BuiltinCommandLoader (only FileCommandLoader) and createNonInteractiveUI is
// a no-op sink, so NO built-in slash command works non-interactively today.
// Making /quota reset work there requires a cross-cutting change to load
// built-ins + provide a real non-interactive UI sink, which affects every
// built-in and is out of scope for this issue.

const NO_RESET_CREDITS_MSG =
  'No Codex reset credits available. Reset credits are earned via referrals or purchased.';
const NOT_AUTHED_CODEX_MSG =
  'Not authenticated with Codex. Run /auth codex to login.';
const NO_REDEEMABLE_CREDITS_MSG =
  'No reset credits available to redeem. Reset credits are earned via referrals or purchased.';

interface BucketCredits {
  readonly bucket: string;
  readonly availableCount: number;
  readonly firstCreditId: string | null;
}

/**
 * A bucket + credit guaranteed to be redeemable (non-null credit id).
 * Returned by findRedeemableCredit so callers need no null-narrowing guard.
 */
interface RedeemableCredit {
  readonly bucket: string;
  readonly firstCreditId: string;
}

interface BucketTokenInfo {
  readonly accessToken: string | null;
  readonly accountId: string | null;
}

/**
 * Parse a raw reset-credits payload via the Zod schema once.
 * Returns the validated response or null when the shape does not validate.
 */
function safeParseResetCredits(
  raw: Record<string, unknown>,
): CodexRateLimitResetCreditsResponse | null {
  const parsed = CodexRateLimitResetCreditsResponseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Resolve the OAuthManager via the runtime API, returning null when the
 * runtime infrastructure is not registered (mirrors authCommand.getOAuthManager
 * but degrades to null instead of throwing).
 */
function resolveOAuthManager(): OAuthManager | null {
  try {
    return getRuntimeApi().getCliOAuthManager();
  } catch {
    return null;
  }
}

/**
 * Resolve the trimmed base-url ephemeral setting, or undefined when blank.
 */
function resolveBaseUrl(): string | undefined {
  const value = getRuntimeApi().getEphemeralSetting('base-url');
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function addInfo(context: CommandContext, text: string): void {
  context.ui.addItem({ type: MessageType.INFO, text }, Date.now());
}

function addError(context: CommandContext, text: string): void {
  context.ui.addItem({ type: MessageType.ERROR, text }, Date.now());
}

/**
 * Status (and default) action: show quota/rate-limit info for all providers.
 */
async function statusAction(context: CommandContext): Promise<void> {
  try {
    const runtimeApi = getRuntimeApi();
    const quotaLines = await fetchAllQuotaInfo(runtimeApi);

    if (quotaLines.length === 0) {
      addInfo(
        context,
        'No quota information available. Supported providers: Anthropic (OAuth), Codex (OAuth), Z.ai, Synthetic, Chutes, Kimi.',
      );
      return;
    }

    addInfo(context, quotaLines.join('\n'));
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    addError(context, `Failed to retrieve quota information: ${msg}`);
  }
}

/**
 * Parse a single bucket's reset-credits payload via the Zod schema.
 * Returns null when the shape does not validate.
 */
function parseBucketCredits(
  bucket: string,
  raw: Record<string, unknown>,
): BucketCredits | null {
  const parsed = safeParseResetCredits(raw);
  if (parsed === null) {
    return null;
  }
  const credits = parsed.rate_limit_reset_credits;
  const availableCount = credits?.available_count ?? 0;
  const creditList = credits?.credits ?? [];
  const firstCreditId =
    creditList.length > 0 && creditList[0]?.id ? creditList[0].id : null;
  return { bucket, availableCount, firstCreditId };
}

/**
 * Format a single bucket's reset credits into display lines (with optional
 * bucket header), or null when there is nothing to show.
 */
function formatOneBucket(
  bucket: string,
  parsed: CodexRateLimitResetCreditsResponse,
  multiBucket: boolean,
): string[] | null {
  const lines = formatCodexResetCredits(parsed);
  if (lines.length === 0) {
    return null;
  }
  const result: string[] = [];
  if (multiBucket) {
    result.push(`### Bucket: ${bucket}\n`);
  }
  result.push(...lines);
  result.push('');
  return result;
}

/**
 * Format all bucket reset-credits into display lines with bucket headers.
 * Each bucket is parsed once via the schema; buckets that fail to validate
 * are skipped.
 */
function formatAllResetCreditsLines(
  creditsMap: Map<string, Record<string, unknown>>,
): string[] {
  const output: string[] = [];
  const multiBucket = creditsMap.size > 1;

  for (const [bucket, raw] of creditsMap.entries()) {
    const parsed = safeParseResetCredits(raw);
    if (parsed === null) {
      continue;
    }
    const bucketLines = formatOneBucket(bucket, parsed, multiBucket);
    if (bucketLines !== null) {
      output.push(...bucketLines);
    }
  }

  if (output[output.length - 1] === '') {
    output.pop();
  }
  return output;
}

/**
 * Credits subcommand action: show available Codex reset credits.
 */
async function creditsAction(context: CommandContext): Promise<void> {
  const oauthManager = resolveOAuthManager();
  if (!oauthManager) {
    addInfo(context, NO_RESET_CREDITS_MSG);
    return;
  }

  try {
    const creditsMap = await oauthManager.getAllCodexRateLimitResetCredits();

    if (creditsMap.size === 0) {
      addInfo(context, NO_RESET_CREDITS_MSG);
      return;
    }

    const lines = formatAllResetCreditsLines(creditsMap);
    if (lines.length === 0) {
      addInfo(context, NO_RESET_CREDITS_MSG);
      return;
    }

    addInfo(context, lines.join('\n'));
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    addError(context, `Failed to retrieve reset credits: ${msg}`);
  }
}

/**
 * Determine whether the user is authenticated with Codex.
 */
async function isCodexAuthed(oauthManager: OAuthManager): Promise<boolean> {
  const token = await oauthManager.getToken('codex');
  if (token !== null) {
    return true;
  }
  const buckets = await oauthManager.listBuckets('codex');
  return buckets.length > 0;
}

/**
 * Find the first bucket+credit that can be redeemed.
 */
async function findRedeemableCredit(
  oauthManager: OAuthManager,
): Promise<RedeemableCredit | null> {
  const creditsMap = await oauthManager.getAllCodexRateLimitResetCredits();

  for (const [bucket, raw] of creditsMap.entries()) {
    const parsed = parseBucketCredits(bucket, raw);
    if (
      parsed !== null &&
      parsed.availableCount > 0 &&
      parsed.firstCreditId !== null
    ) {
      return { bucket: parsed.bucket, firstCreditId: parsed.firstCreditId };
    }
  }
  return null;
}

/**
 * Resolve the access token + account_id for a Codex bucket.
 */
async function resolveBucketToken(
  oauthManager: OAuthManager,
  bucket: string,
): Promise<BucketTokenInfo> {
  const tokenStore = oauthManager.getTokenStore();
  const token = await tokenStore.getToken('codex', bucket);
  if (token === null) {
    return { accessToken: null, accountId: null };
  }
  const parsed = CodexOAuthTokenSchema.safeParse(token);
  if (!parsed.success) {
    return { accessToken: null, accountId: null };
  }
  // Guard against a token that expired between the credit-listing call and
  // this resolve — sending an expired token to consume would yield a 401 and
  // a misleading generic error.
  if (parsed.data.expiry <= Math.floor(Date.now() / 1000)) {
    return { accessToken: null, accountId: null };
  }
  return {
    accessToken: parsed.data.access_token,
    accountId: parsed.data.account_id,
  };
}

/**
 * Reset subcommand action: redeem a Codex rate-limit-reset credit.
 */
async function resetAction(
  context: CommandContext,
  args: string,
): Promise<void> {
  const provider = args.trim();

  if (provider.length > 0 && provider !== 'codex') {
    addError(context, "Only 'codex' supports reset.");
    return;
  }

  const oauthManager = resolveOAuthManager();
  if (!oauthManager) {
    addInfo(context, NOT_AUTHED_CODEX_MSG);
    return;
  }

  try {
    const authed = await isCodexAuthed(oauthManager);
    if (!authed) {
      addInfo(context, NOT_AUTHED_CODEX_MSG);
      return;
    }

    const redeemable = await findRedeemableCredit(oauthManager);
    if (redeemable === null) {
      addInfo(context, NO_REDEEMABLE_CREDITS_MSG);
      return;
    }
    const creditId = redeemable.firstCreditId;
    const bucket = redeemable.bucket;

    const tokenInfo = await resolveBucketToken(oauthManager, bucket);
    if (tokenInfo.accessToken === null || tokenInfo.accountId === null) {
      addError(
        context,
        'Codex credentials for the selected bucket are unavailable or expired. Run /auth codex to re-authenticate.',
      );
      return;
    }

    // Both the credit listing (getAllCodexRateLimitResetCredits) and this
    // consume call resolve base-url from the same runtime settings source, so
    // list and consume always target the same backend host.
    const baseUrl = resolveBaseUrl();
    const redeemRequestId = randomUUID();
    const consumeResult = await consumeCodexRateLimitResetCredit(
      tokenInfo.accessToken,
      tokenInfo.accountId,
      creditId,
      redeemRequestId,
      baseUrl,
    );

    if (consumeResult === null) {
      addError(
        context,
        'Failed to reset rate-limit window. Please try again later.',
      );
      return;
    }

    if (consumeResult.code === 'reset') {
      addInfo(context, 'Rate-limit window reset successfully.');
    } else {
      addInfo(context, 'Credit already redeemed.');
    }

    // fetchAllQuotaInfo has its own internal error handling and returns [] on
    // failure, so it never throws — no extra guard is needed here.
    const runtimeApi = getRuntimeApi();
    const quotaLines = await fetchAllQuotaInfo(runtimeApi);
    if (quotaLines.length > 0) {
      addInfo(context, quotaLines.join('\n'));
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    addError(context, `Failed to reset rate-limit window: ${msg}`);
  }
}

/**
 * Schema for /quota reset autocomplete: offers 'codex' as the provider.
 */
const resetSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'provider',
    description: 'Provider to reset',
    options: [{ value: 'codex', description: 'Codex (ChatGPT)' }],
  },
];

export const quotaCommand: SlashCommand = {
  name: 'quota',
  description:
    'Manage quota and rate-limit reset. Usage: /quota [status|credits|reset]',
  kind: CommandKind.BUILT_IN,
  action: statusAction,
  subCommands: [
    {
      name: 'status',
      description: 'Show quota/rate-limit status for all providers.',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: statusAction,
    },
    {
      name: 'credits',
      description: 'Show available Codex rate-limit-reset credits.',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: creditsAction,
    },
    {
      name: 'reset',
      description:
        'Redeem a Codex rate-limit-reset credit to reset the rate-limit window.',
      kind: CommandKind.BUILT_IN,
      schema: resetSchema,
      action: resetAction,
    },
  ],
};
