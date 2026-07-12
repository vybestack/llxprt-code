/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure, providers-owned model/transport policy for OpenAI.
 *
 * This module is the single authority for:
 * - Which model IDs **require** the Responses API (GPT-5.6+ bare and
 *   durable tier aliases on canonical OpenAI).
 * - Which model IDs **support** (but do not require) Responses.
 * - Mapping the project-canonical `reasoning.effort=minimal` to the
 *   OpenAI wire value `none` for GPT-5.6+.
 *
 * It is used by both the OpenAI Chat-Completions provider (for per-call
 * routing) and the UI info function (getOpenAIProviderInfo) so that UI
 * truth always matches execution truth (issue #2483).
 */

/**
 * Transport-selector (control-plane) keys that determine which API
 * endpoint a call uses. These are user-facing settings, NOT model
 * parameters — they must never leak into `invocation.modelParams` or
 * any API request body.
 *
 * Single source of truth shared by:
 * - settings registry (registration/classification)
 * - OpenAIProvider.getModelParams() (reserved-key filtering)
 * - openAIResponsesExecutor.translateRequestOverrides (defensive egress)
 */
export const OPENAI_TRANSPORT_SELECTOR_KEYS: ReadonlySet<string> = new Set([
  'apiMode',
  'responsesMode',
  'responses-mode',
  'openaiResponsesEnabled',
]);

/**
 * Pre-5.6 models that are known to work on the Responses API but do not
 * *require* it. They remain on Chat Completions unless the user explicitly
 * opts in via supported configuration.
 */
const RESPONSES_CAPABLE_PRE_56_MODELS: ReadonlySet<string> = new Set([
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4o-realtime',
  'gpt-4-turbo',
  'gpt-4-turbo-preview',
  'gpt-4.1',
  'o3-pro',
  'o3',
  'o3-mini',
  'o1',
  'o1-mini',
]);

/**
 * Durable tier suffixes that may follow a GPT generation alias (e.g.
 * `gpt-5.6-sol`). Only these exact strings qualify a tier ID.
 */
const DURABLE_TIERS = ['sol', 'terra', 'luna'] as const;

interface ParsedGptId {
  major: number;
  minor: number;
  tier: string | null;
  suffix: string;
}

/**
 * Parse a `gpt-MAJOR.MINOR[-tier]` model ID into its numeric components
 * and optional tier, returning `null` when the prefix or number format is
 * invalid.
 *
 * Numeric comparison is done on integers (not lexicographic) so that
 * `5.10` and `10.0` compare correctly.
 */
function parseGptModelId(model: string): ParsedGptId | null {
  const prefix = 'gpt-';
  if (!model.startsWith(prefix)) return null;
  const rest = model.slice(prefix.length);

  const dotIndex = rest.indexOf('.');
  if (dotIndex === -1) return null;

  const majorStr = rest.slice(0, dotIndex);
  const afterDot = rest.slice(dotIndex + 1);

  if (!/^\d+$/.test(majorStr)) return null;
  const major = Number(majorStr);
  if (!Number.isFinite(major) || major <= 0) return null;

  // Extract minor number and optional suffix
  // minor is digits, rest is suffix (e.g. "-sol", "-sol-latest")
  const minorMatch = /^(\d+)/.exec(afterDot);
  if (!minorMatch) return null;

  const minorStr = minorMatch[1];
  const minor = Number(minorStr);
  if (!Number.isFinite(minor)) return null;

  const suffix = afterDot.slice(minorStr.length);

  let tier: string | null = null;
  let qualifierRemainder = suffix;

  // Check if suffix starts with a tier: -sol, -terra, -luna
  if (suffix.startsWith('-')) {
    const afterDash = suffix.slice(1);
    for (const t of DURABLE_TIERS) {
      if (afterDash === t || afterDash.startsWith(t + '-')) {
        tier = t;
        qualifierRemainder = suffix.slice(1 + t.length);
        break;
      }
    }
  }

  return { major, minor, tier, suffix: qualifierRemainder };
}

/**
 * Compare two `{major, minor}` pairs numerically.
 */
function compareVersions(
  a: { major: number; minor: number },
  b: { major: number; minor: number },
): number {
  if (a.major !== b.major) return a.major - b.major;
  return a.minor - b.minor;
}

const GPT_56 = { major: 5, minor: 6 };

/**
 * Validate that the suffix qualifier (the part after a bare alias or
 * after a tier) is empty, `-latest`, a compact 8-digit date snapshot
 * (`-YYYYMMDD`), or a hyphenated 10-character date snapshot
 * (`-YYYY-MM-DD`).
 *
 * Both date shapes must represent a plausible calendar date so that
 * lookalikes (e.g. `-20261345` or `-2026-02-30`) are rejected.
 */
function isValidQualifier(suffix: string): boolean {
  if (suffix === '' || suffix === '-latest') return true;
  const compact = /^-(\d{4})(\d{2})(\d{2})$/.exec(suffix);
  if (compact) {
    return isValidDate(
      Number(compact[1]),
      Number(compact[2]),
      Number(compact[3]),
    );
  }
  const hyphenated = /^-(\d{4})-(\d{2})-(\d{2})$/.exec(suffix);
  if (hyphenated) {
    return isValidDate(
      Number(hyphenated[1]),
      Number(hyphenated[2]),
      Number(hyphenated[3]),
    );
  }
  return false;
}

/**
 * Validate a calendar date with correct month/day ranges (including leap
 * years) so that malformed snapshots like `-20261301` or `-2026-02-30`
 * are rejected rather than silently accepted as model IDs.
 */
function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export interface OpenAIModelTransport {
  /** The model can use the Responses API (required OR supported). */
  supportsResponses: boolean;
  /**
   * The model **must** use the Responses API — Chat Completions is not
   * available for it. GPT-5.6+ bare and tier IDs only.
   */
  requiresResponses: boolean;
}

/**
 * Parse a model ID to determine its transport policy.
 *
 * Rules:
 * - Bare `gpt-X.Y` where X.Y >= 5.6 → **requires** Responses.
 * - `gpt-X.Y-{sol|terra|luna}` where X.Y >= 5.6 → **requires** Responses.
 *   Qualifiers: bare, `-latest`, compact date (`-YYYYMMDD`), or
 *   hyphenated date (`-YYYY-MM-DD`).
 * - Pre-5.6 known Responses-capable models → **supports** only.
 * - Everything else → neither.
 */
export function parseOpenAIModelTransport(model: string): OpenAIModelTransport {
  const parsed = parseGptModelId(model);

  // Not a parseable gpt-X.Y model — check the known pre-5.6 set
  if (!parsed) {
    const supports = RESPONSES_CAPABLE_PRE_56_MODELS.has(model);
    return { supportsResponses: supports, requiresResponses: false };
  }

  const is56Plus = compareVersions(parsed, GPT_56) >= 0;

  if (parsed.tier !== null) {
    // Tier model: gpt-X.Y-{sol|terra|luna}[-qualifier]
    if (!is56Plus) {
      return { supportsResponses: false, requiresResponses: false };
    }
    if (!isValidQualifier(parsed.suffix)) {
      return { supportsResponses: false, requiresResponses: false };
    }
    return { supportsResponses: true, requiresResponses: true };
  }

  if (is56Plus) {
    // GPT-5.6+ bare aliases require Responses. Accept documented
    // qualifiers (bare, -latest, compact or hyphenated date snapshot)
    // consistently with tier IDs. Any other suffix is unknown — reject
    // so malformed lookalikes do not receive the minimal→none effort
    // mapping.
    if (!isValidQualifier(parsed.suffix)) {
      return { supportsResponses: false, requiresResponses: false };
    }
    return { supportsResponses: true, requiresResponses: true };
  }

  // Pre-5.6 — check the known supported set (handles -mini suffixes etc.)
  const supports = RESPONSES_CAPABLE_PRE_56_MODELS.has(model);
  return { supportsResponses: supports, requiresResponses: false };
}

/**
 * Determine whether a base URL is the canonical OpenAI API endpoint.
 *
 * Must be `https://api.openai.com` (trailing slash / optional path suffix
 * like `/v1` permitted). Scheme must be `https` so that a cleartext
 * lookalike cannot masquerade as canonical. Hostname is the primary
 * discriminator — port must be default (443) or absent.
 *
 * Custom OpenAI-compatible URLs (proxies, local servers, etc.) are NOT
 * canonical — GPT-5.6+ will stay on Chat Completions for those unless
 * the user explicitly opts into Responses via supported configuration.
 */
export function isOpenAICanonicalBaseURL(baseURL: string | undefined): boolean {
  if (typeof baseURL !== 'string' || baseURL.trim() === '') return false;
  try {
    const url = new URL(baseURL);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'api.openai.com' &&
      (url.port === '' || url.port === '443')
    );
  } catch {
    return false;
  }
}

/**
 * Map the project-canonical `reasoning.effort` value to the OpenAI
 * Responses API wire value for the given model.
 *
 * GPT-5.6 and later renamed the lowest effort level from "minimal" to
 * "none" on the wire. The project setting remains "minimal" for backward
 * compatibility across all providers, so we translate it here.
 *
 * The mapping applies ONLY to models that require the Responses API
 * — i.e. valid GPT-5.6+ bare/tier IDs with documented qualifiers.
 * Malformed lookalikes (gpt-5.6-mini, gpt-5.6-solar, etc.) are NOT
 * mapped so they cannot accidentally receive the wire value `none`.
 *
 * Pre-5.6 Responses API models (o3, o1, gpt-5.5, etc.) still use
 * "minimal".
 */
export function toOpenAIResponsesWireEffort(
  effort: string,
  model: string | undefined,
): string {
  if (effort !== 'minimal' || model === undefined) {
    return effort;
  }
  // Only map for GPT-5.6+ models that require the Responses API.
  const transport = parseOpenAIModelTransport(model);
  if (transport.requiresResponses) {
    return 'none';
  }
  return effort;
}

/**
 * Explicit transport-mode preferences the user can set via provider
 * settings (`apiMode` / `responsesMode`) or the global ephemeral
 * setting (`responses-mode`).
 */
export type ExplicitTransportMode = 'responses' | 'chat' | undefined;

/**
 * Resolve the effective explicit transport mode from the available
 * configuration sources, applying deterministic precedence:
 *
 * 1. Provider-scoped `apiMode`
 * 2. Provider-scoped `responsesMode`
 * 3. Global ephemeral `responses-mode`
 *
 * Only the values `'responses'` and `'chat'` (case-insensitive) are
 * recognized as explicit overrides. Each source is validated
 * independently in precedence order: invalid, stale, or whitespace
 * values are skipped rather than blocking lower-priority sources.
 * When no source yields a recognized mode, the result is `undefined`
 * (no override).
 *
 * Both call sites (execution and UI) use this so they apply the same
 * precedence (issue #2483).
 */
export function resolveExplicitTransportMode(
  providerApiMode: string | undefined,
  providerResponsesMode: string | undefined,
  globalResponsesMode: string | undefined,
): ExplicitTransportMode {
  return (
    normalizeTransportMode(providerApiMode) ??
    normalizeTransportMode(providerResponsesMode) ??
    normalizeTransportMode(globalResponsesMode)
  );
}

/**
 * Normalize a single transport-mode source value, returning `'responses'`
 * or `'chat'` for recognized values (case-insensitive), or `undefined`
 * for absent / whitespace-only / unrecognized values.
 */
function normalizeTransportMode(
  value: string | undefined,
): ExplicitTransportMode {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'responses') return 'responses';
  if (normalized === 'chat') return 'chat';
  return undefined;
}

/**
 * Convenience overload: resolve explicit mode from a raw provider-settings
 * record and a global-mode getter, centralizing the key lookups so both
 * call sites use identical source extraction.
 */
export function resolveExplicitTransportModeFromSources(
  providerSettings: Record<string, unknown>,
  getGlobalMode: () => string | undefined,
): ExplicitTransportMode {
  const apiMode = getValidStringSetting(providerSettings.apiMode);
  const responsesMode = getValidStringSetting(providerSettings.responsesMode);
  const globalMode = getValidStringSetting(getGlobalMode());
  return resolveExplicitTransportMode(apiMode, responsesMode, globalMode);
}

function getValidStringSetting(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed !== '' ? trimmed : undefined;
}

/**
 * Inputs to the unified transport decision. Both the execution path
 * (`OpenAIProvider`) and the UI info path (`getOpenAIProviderInfo`)
 * supply the same structural values so they always agree.
 */
export interface TransportDecisionInput {
  model: string;
  baseURL: string | undefined;
  /**
   * User-facing explicit mode override. Precedence among sources is
   * resolved by the caller (typically `apiMode` → `responsesMode` →
   * `responses-mode`). When `'responses'`, the user explicitly opts
   * into Responses even on custom endpoints. When `'chat'`, the user
   * explicitly opts out — but this is ignored for models that
   * *require* Responses on canonical OpenAI (GPT-5.6+), because Chat
   * Completions is not available for them there.
   */
  explicitMode: ExplicitTransportMode;
  /**
   * Provider-config flag that force-enables Responses on non-canonical
   * base URLs for models that support it.
   */
  openaiResponsesEnabled: boolean | undefined;
}

/**
 * The result of the unified transport decision.
 */
export interface TransportDecision {
  /** Whether the Responses API should be used for this call. */
  useResponses: boolean;
  /**
   * The model-transport classification for the given model ID. Exposed
   * so callers (especially the UI) can answer follow-up questions
   * (e.g. "supports but does not require") without re-parsing.
   */
  transport: OpenAIModelTransport;
}

/**
 * Resolve whether a given OpenAI call should use the Responses API.
 *
 * This is the **single shared authority** used by both the execution
 * provider and the UI info function so they never disagree (issue #2483).
 *
 * Precedence:
 * 1. **Explicit `'responses'` mode** → use Responses (works on custom
 *    endpoints too, honoring user intent).
 * 2. **Explicit `'chat'` mode** → use Chat Completions, *unless* the
 *    model requires Responses on canonical OpenAI (GPT-5.6+ bare/tier
 *    IDs). Forcing those to Chat is impossible, so we ignore the
 *    override to avoid making a promise the API cannot fulfill.
 * 3. **GPT-5.6+ on canonical OpenAI** → use Responses (required).
 * 4. **`openaiResponsesEnabled` on custom endpoint** → use Responses
 *    for models that support it.
 * 5. Otherwise → Chat Completions.
 *
 * Note: the "supports but does not require" delegation (e.g. calling
 * `provider.shouldUseResponses`) is intentionally NOT part of this pure
 * function — it involves provider-instance state. The UI path handles
 * that fallback after calling this function.
 */
export function resolveOpenAITransport(
  input: TransportDecisionInput,
): TransportDecision {
  const transport = parseOpenAIModelTransport(input.model);
  const isCanonical = isOpenAICanonicalBaseURL(input.baseURL);

  // 1. Explicit "responses" mode — user opt-in works everywhere.
  if (input.explicitMode === 'responses') {
    return { useResponses: true, transport };
  }

  // 2. Explicit "chat" mode — honored unless the model requires
  //    Responses on canonical OpenAI (cannot force GPT-5.6+ to Chat).
  if (input.explicitMode === 'chat') {
    if (transport.requiresResponses && isCanonical) {
      return { useResponses: true, transport };
    }
    return { useResponses: false, transport };
  }

  // 3. GPT-5.6+ requires Responses on canonical OpenAI.
  if (transport.requiresResponses && isCanonical) {
    return { useResponses: true, transport };
  }

  // 4. openaiResponsesEnabled force-enables Responses on custom endpoints.
  if (
    input.openaiResponsesEnabled === true &&
    !isCanonical &&
    transport.supportsResponses
  ) {
    return { useResponses: true, transport };
  }

  // 5. Default — Chat Completions.
  return { useResponses: false, transport };
}
