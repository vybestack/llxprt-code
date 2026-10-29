/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NetworkFetch } from '@vybestack/llxprt-code-core';
import {
  CommandKind,
  type SlashCommand,
  type CommandContext,
  type SlashCommandActionReturn,
  type ConfirmActionReturn,
} from './types.js';
import { MessageType } from '../types.js';
import {
  CodexRateLimitResetCreditsResponseSchema,
  consumeCodexRateLimitResetCredit,
  formatCodexResetCredits,
} from '@vybestack/llxprt-code-providers';
import type { CodexRateLimitResetCreditsResponse } from '@vybestack/llxprt-code-providers';
import type { OAuthControl } from '../contexts/OAuthControlContext.js';
type QuotaOAuthControl = Pick<
  OAuthControl,
  | 'isAvailable'
  | 'getAllCodexRateLimitResetCredits'
  | 'hasCodexToken'
  | 'listBuckets'
  | 'readCodexBucketToken'
>;

/**
 * The operations /quota needs from its owning session. The host binds them
 * once at registration; the command never reads them from an invocation.
 */
export interface QuotaCommandOperations {
  /** The session's OAuth control; absent infrastructure reports unavailable. */
  readonly oauthControl: QuotaOAuthControl;
  /** The session's network fetch, used for credit listing and redemption. */
  readonly fetch: NetworkFetch;
  /** The raw `base-url` ephemeral setting of the active session. */
  readonly baseUrlSetting: () => unknown;
  /** Formatted quota lines for every provider the session can query. */
  readonly fetchQuotaLines: () => Promise<string[]>;
}

/**
 * What one invocation contributes: where to report and what the user typed.
 * Everything else comes from the registered operations.
 */
interface QuotaRun {
  readonly operations: QuotaCommandOperations;
  readonly report: {
    readonly info: (text: string) => void;
    readonly error: (text: string) => void;
  };
  readonly confirmed: boolean;
  readonly rawInvocation: string | undefined;
}

function startRun(
  operations: QuotaCommandOperations,
  context: CommandContext,
): QuotaRun {
  return {
    operations,
    report: {
      info: (text) =>
        context.ui.addItem({ type: MessageType.INFO, text }, Date.now()),
      error: (text) =>
        context.ui.addItem({ type: MessageType.ERROR, text }, Date.now()),
    },
    confirmed: context.overwriteConfirmed === true,
    rawInvocation: context.invocation?.raw,
  };
}
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

interface RedeemableCreditWithToken extends RedeemableCredit {
  readonly accessToken: string;
  readonly accountId: string;
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
 * Quota is optional when the owning runtime has no OAuth infrastructure.
 */
function resolveOAuthManager(run: QuotaRun): QuotaOAuthControl | null {
  const { oauthControl } = run.operations;
  try {
    return oauthControl.isAvailable() ? oauthControl : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the trimmed base-url ephemeral setting, or undefined when blank.
 */
function resolveBaseUrl(run: QuotaRun): string | undefined {
  const value = run.operations.baseUrlSetting();
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Status (and default) action: show quota/rate-limit info for all providers.
 */
async function statusAction(run: QuotaRun): Promise<void> {
  try {
    const quotaLines = await run.operations.fetchQuotaLines();

    if (quotaLines.length === 0) {
      run.report.info(
        'No quota information available. Supported providers: Claude Code (OAuth), Codex (OAuth), Z.ai, Synthetic, Chutes, Kimi.',
      );
      return;
    }

    run.report.info(quotaLines.join('\n'));
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    run.report.error(`Failed to retrieve quota information: ${msg}`);
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
async function creditsAction(run: QuotaRun): Promise<void> {
  const oauthManager = resolveOAuthManager(run);
  if (!oauthManager) {
    run.report.info(NO_RESET_CREDITS_MSG);
    return;
  }

  try {
    const creditsMap = await oauthManager.getAllCodexRateLimitResetCredits(
      run.operations.fetch,
    );

    if (creditsMap.size === 0) {
      run.report.info(NO_RESET_CREDITS_MSG);
      return;
    }

    const lines = formatAllResetCreditsLines(creditsMap);
    if (lines.length === 0) {
      run.report.info(NO_RESET_CREDITS_MSG);
      return;
    }

    run.report.info(lines.join('\n'));
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    run.report.error(`Failed to retrieve reset credits: ${msg}`);
  }
}

/**
 * Determine whether the user is authenticated with Codex.
 */
async function isCodexAuthed(
  oauthManager: QuotaOAuthControl,
): Promise<boolean> {
  if (await oauthManager.hasCodexToken()) {
    return true;
  }
  const buckets = await oauthManager.listBuckets('codex');
  return buckets.length > 0;
}

/**
 * Find all buckets with a credit that can be redeemed.
 */
async function findRedeemableCredits(
  requestFetch: NetworkFetch,
  oauthManager: QuotaOAuthControl,
): Promise<readonly RedeemableCredit[]> {
  const creditsMap =
    await oauthManager.getAllCodexRateLimitResetCredits(requestFetch);
  const redeemableCredits: RedeemableCredit[] = [];

  for (const [bucket, raw] of creditsMap.entries()) {
    const parsed = parseBucketCredits(bucket, raw);
    if (
      parsed !== null &&
      parsed.availableCount > 0 &&
      parsed.firstCreditId !== null
    ) {
      redeemableCredits.push({
        bucket: parsed.bucket,
        firstCreditId: parsed.firstCreditId,
      });
    }
  }
  return redeemableCredits;
}

/**
 * Resolve the access token + account_id for a Codex bucket.
 */
async function resolveBucketToken(
  oauthManager: QuotaOAuthControl,
  bucket: string,
): Promise<BucketTokenInfo> {
  const token = await oauthManager.readCodexBucketToken(bucket);
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

async function findRedeemableCreditWithToken(
  oauthManager: QuotaOAuthControl,
  redeemableCredits: readonly RedeemableCredit[],
): Promise<RedeemableCreditWithToken | null> {
  for (const redeemable of redeemableCredits) {
    const tokenInfo = await resolveBucketToken(oauthManager, redeemable.bucket);
    if (tokenInfo.accessToken !== null && tokenInfo.accountId !== null) {
      return {
        ...redeemable,
        accessToken: tokenInfo.accessToken,
        accountId: tokenInfo.accountId,
      };
    }
  }
  return null;
}

const RESET_CONFIRMATION_PROMPT =
  'Redeem a Codex rate-limit-reset credit to reset your rate-limit window? This consumes one earned/purchased reset credit.';

/**
 * Build the confirm_action return value for /quota reset, deriving the
 * original raw invocation (falling back to a canonical form when the
 * invocation context is absent or blank).
 */
function buildResetConfirmation(run: QuotaRun): ConfirmActionReturn {
  const rawInvocation =
    run.rawInvocation && run.rawInvocation.trim() !== ''
      ? run.rawInvocation
      : '/quota reset codex';
  return {
    type: 'confirm_action',
    prompt: RESET_CONFIRMATION_PROMPT,
    originalInvocation: { raw: rawInvocation },
  };
}

/**
 * Consume the redeemable credit and render the result (success / already
 * redeemed / failure) plus a refreshed quota snapshot. Returns void — all
 * user feedback flows through the run reporter.
 */
async function redeemResetCredit(
  run: QuotaRun,
  accessToken: string,
  accountId: string,
  creditId: string,
): Promise<void> {
  // Both the credit listing (getAllCodexRateLimitResetCredits) and this
  // consume call resolve base-url from the same runtime settings source, so
  // list and consume always target the same backend host.
  const baseUrl = resolveBaseUrl(run);
  const redeemRequestId = randomUUID();
  const consumeResult = await consumeCodexRateLimitResetCredit(
    run.operations.fetch,
    accessToken,
    accountId,
    creditId,
    redeemRequestId,
    baseUrl,
  );

  if (consumeResult === null) {
    run.report.error(
      'Failed to reset rate-limit window. Please try again later.',
    );
    return;
  }

  if (consumeResult.code === 'reset') {
    run.report.info('Rate-limit window reset successfully.');
  } else {
    run.report.info('Credit already redeemed.');
  }

  // fetchAllQuotaInfo has its own internal error handling and returns [] on
  // failure, so it never throws — no extra guard is needed here.
  const quotaLines = await run.operations.fetchQuotaLines();
  if (quotaLines.length > 0) {
    run.report.info(quotaLines.join('\n'));
  }
}

/**
 * Reset subcommand action: redeem a Codex rate-limit-reset credit.
 */
async function resetAction(
  run: QuotaRun,
  args: string,
): Promise<SlashCommandActionReturn | void> {
  const tokens = args
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '');
  const provider = tokens[0] ?? '';

  if (provider !== '' && provider !== 'codex') {
    run.report.error("Only 'codex' supports reset.");
    return undefined;
  }
  if (tokens.length > 1) {
    run.report.error('Too many arguments. Usage: /quota reset [codex]');
    return undefined;
  }

  const oauthManager = resolveOAuthManager(run);
  if (!oauthManager) {
    run.report.info(NOT_AUTHED_CODEX_MSG);
    return undefined;
  }

  try {
    const authed = await isCodexAuthed(oauthManager);
    if (!authed) {
      run.report.info(NOT_AUTHED_CODEX_MSG);
      return undefined;
    }

    const redeemableCredits = await findRedeemableCredits(
      run.operations.fetch,
      oauthManager,
    );
    if (redeemableCredits.length === 0) {
      run.report.info(NO_REDEEMABLE_CREDITS_MSG);
      return undefined;
    }

    const redeemable = await findRedeemableCreditWithToken(
      oauthManager,
      redeemableCredits,
    );
    if (redeemable === null) {
      run.report.error(
        'Codex credentials for all credit-bearing buckets are unavailable or expired. Run /auth codex to re-authenticate.',
      );
      return undefined;
    }

    // Confirmation gate: redeeming consumes a paid/referral-earned resource,
    // so — like other mutating commands — prompt before performing the
    // mutation. The confirmed re-invocation arrives with
    // overwriteConfirmed === true and skips this gate to actually consume.
    if (!run.confirmed) {
      return buildResetConfirmation(run);
    }

    await redeemResetCredit(
      run,
      redeemable.accessToken,
      redeemable.accountId,
      redeemable.firstCreditId,
    );
    return undefined;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    run.report.error(`Failed to reset rate-limit window: ${msg}`);
    return undefined;
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

export function createQuotaCommand(
  operations: QuotaCommandOperations,
): SlashCommand {
  const status = (context: CommandContext): Promise<void> =>
    statusAction(startRun(operations, context));
  return {
    name: 'quota',
    description:
      'Manage quota and rate-limit reset. Usage: /quota [status|credits|reset]',
    kind: CommandKind.BUILT_IN,
    action: status,
    subCommands: [
      {
        name: 'status',
        description: 'Show quota/rate-limit status for all providers.',
        kind: CommandKind.BUILT_IN,
        autoExecute: true,
        action: status,
      },
      {
        name: 'credits',
        description: 'Show available Codex rate-limit-reset credits.',
        kind: CommandKind.BUILT_IN,
        autoExecute: true,
        action: (context) => creditsAction(startRun(operations, context)),
      },
      {
        name: 'reset',
        description:
          'Redeem a Codex rate-limit-reset credit to reset the rate-limit window.',
        kind: CommandKind.BUILT_IN,
        schema: resetSchema,
        action: (context, args) =>
          resetAction(startRun(operations, context), args),
      },
    ],
  };
}
