# Plan: API-Key-Based Provider Quota Support

## Issues
- #1295 - Main Quota Endpoint Feature (umbrella)
- #1296 - Add /stats quota support for zai
- #1298 - /stats quota support for kimi.com
- #1299 - Add /stats quota support for chutes

Also adding synthetic (mentioned in #1295 but no separate issue).

## Architecture Overview

The existing `/stats quota` command works through the OAuth manager for Anthropic and Codex (OAuth-based providers). The new providers (Z.ai, Synthetic, Chutes, Kimi) use **API keys** (not OAuth), so we need a different approach:

1. Detect the current profile's provider from the base URL
2. Read the API key from the keyfile or environment
3. Call the provider-specific quota endpoint
4. Format and display alongside existing OAuth quota info

## Confirmed API Endpoints

### Z.ai (Issue #1296)
- **Endpoint**: `GET https://api.z.ai/api/monitor/usage/quota/limit`
- **Auth**: Raw API key in `Authorization` header (NO "Bearer" prefix)
- **Headers**: `Accept-Language: en-US,en`, `Content-Type: application/json`
- **Detection**: base-url contains `api.z.ai`
- **Response**:
```json
{
  "code": 200,
  "data": {
    "limits": [
      {
        "type": "TIME_LIMIT",
        "unit": 5,
        "number": 1,
        "usage": 4000,
        "currentValue": 0,
        "remaining": 4000,
        "percentage": 0,
        "nextResetTime": 1771522071984,
        "usageDetails": [
          { "modelCode": "search-prime", "usage": 0 },
          { "modelCode": "web-reader", "usage": 0 },
          { "modelCode": "zread", "usage": 0 }
        ]
      },
      {
        "type": "TOKENS_LIMIT",
        "unit": 3,
        "number": 5,
        "percentage": 1,
        "nextResetTime": 1770850349270
      }
    ],
    "level": "max"
  },
  "success": true
}
```

### Synthetic (mentioned in #1295)
- **Endpoint**: `GET https://api.synthetic.new/v2/quotas`
- **Auth**: `Authorization: Bearer <key>`
- **Detection**: base-url contains `synthetic.new`
- **Response**:
```json
{
  "subscription": {
    "limit": 1350,
    "requests": 372.7,
    "renewsAt": "2026-02-11T22:26:48.423Z"
  },
  "search": {
    "hourly": { "limit": 250, "requests": 0, "renewsAt": "..." }
  },
  "toolCallDiscounts": {
    "limit": 16200,
    "requests": 4384,
    "renewsAt": "..."
  }
}
```

### Chutes (Issue #1299)
- **Endpoint**: `GET https://api.chutes.ai/users/me/quotas`
- **Auth**: `Authorization: Bearer <key>`
- **Detection**: base-url contains `chutes.ai`
- **Response**:
```json
[
  {
    "chute_id": "*",
    "is_default": true,
    "user_id": "...",
    "updated_at": "2026-01-14T22:53:09.125889",
    "payment_refresh_date": null,
    "quota": 5000
  }
]
```
- **Also useful**: `GET https://api.chutes.ai/users/me` has `balance` field

### Kimi (Issue #1298)
- **Endpoint**: `GET https://api.moonshot.ai/v1/users/me/balance` (for standard Moonshot API keys)
- **Auth**: `Authorization: Bearer <key>`
- **Detection**: base-url contains `kimi.com` or `moonshot`
- **NOTE**: The `sk-kimi-` prefix keys (Kimi Code subscription keys) do NOT work with the balance endpoint. Only standard Moonshot API keys (`sk-...` without the `-kimi-` prefix) work.
- **Response** (when working):
```json
{
  "available_balance": 10.5,
  "voucher_balance": 0.0,
  "cash_balance": 10.5
}
```
- **Fallback**: For `sk-kimi-` keys, we show a message that quota checking is not available for Kimi Code subscription keys.

## Implementation Plan

### Phase 1: Core Quota Fetchers (packages/core)

#### Task 1A: Z.ai Usage Info (`packages/core/src/providers/zai/usageInfo.ts`)
**Test file**: `packages/core/src/providers/zai/usageInfo.test.ts`

Tests:
1. `fetchZaiUsage` returns null for empty/invalid API key
2. `fetchZaiUsage` fetches quota with correct headers (no Bearer prefix)
3. `fetchZaiUsage` returns parsed data on success
4. `fetchZaiUsage` returns null on HTTP error
5. `fetchZaiUsage` returns null on network error
6. `formatZaiUsage` formats TIME_LIMIT with percentage and reset time
7. `formatZaiUsage` formats TOKENS_LIMIT with percentage and reset time
8. `formatZaiUsage` handles empty limits array
9. `formatZaiUsage` includes plan level
10. Zod schema validates response correctly, rejects invalid data

Implementation:
- Create `ZaiQuotaLimitSchema` with Zod
- Create `fetchZaiUsage(apiKey: string, baseUrl?: string)` function
- Create `formatZaiUsage(usage: ZaiUsageInfo)` function
- Export from core index

#### Task 1B: Synthetic Usage Info (`packages/core/src/providers/synthetic/usageInfo.ts`)
**Test file**: `packages/core/src/providers/synthetic/usageInfo.test.ts`

Tests:
1. `fetchSyntheticUsage` returns null for empty API key
2. `fetchSyntheticUsage` fetches with Bearer auth
3. `fetchSyntheticUsage` returns parsed subscription data
4. `fetchSyntheticUsage` returns null on HTTP error
5. `fetchSyntheticUsage` returns null on network error
6. `formatSyntheticUsage` formats subscription with used/limit and reset time
7. `formatSyntheticUsage` formats toolCallDiscounts if present
8. `formatSyntheticUsage` handles missing optional fields
9. Zod schema validates correctly

Implementation:
- Create `SyntheticQuotaSchema` with Zod
- Create `fetchSyntheticUsage(apiKey: string)` function
- Create `formatSyntheticUsage(usage: SyntheticUsageInfo)` function
- Export from core index

#### Task 1C: Chutes Usage Info (`packages/core/src/providers/chutes/usageInfo.ts`)
**Test file**: `packages/core/src/providers/chutes/usageInfo.test.ts`

Tests:
1. `fetchChutesUsage` returns null for empty API key
2. `fetchChutesUsage` fetches quotas and user info in parallel
3. `fetchChutesUsage` returns combined quota + balance data
4. `fetchChutesUsage` returns null on HTTP error
5. `fetchChutesUsage` returns null on network error
6. `formatChutesUsage` formats daily quota
7. `formatChutesUsage` formats balance
8. `formatChutesUsage` handles zero balance
9. Zod schema validates correctly

Implementation:
- Create `ChutesQuotaSchema` with Zod
- Create `fetchChutesUsage(apiKey: string)` function
- Create `formatChutesUsage(usage: ChutesUsageInfo)` function
- Export from core index

#### Task 1D: Kimi Usage Info (`packages/core/src/providers/kimi/usageInfo.ts`)
**Test file**: `packages/core/src/providers/kimi/usageInfo.test.ts`

Tests:
1. `fetchKimiUsage` returns null for empty API key
2. `fetchKimiUsage` returns null for sk-kimi- prefix keys (not supported)
3. `fetchKimiUsage` fetches balance with Bearer auth for standard keys
4. `fetchKimiUsage` returns parsed balance data
5. `fetchKimiUsage` returns null on HTTP error
6. `fetchKimiUsage` returns null on network error
7. `formatKimiUsage` formats available balance
8. `formatKimiUsage` formats voucher and cash balance separately
9. `formatKimiUsage` shows warning for zero balance
10. Zod schema validates correctly

Implementation:
- Create `KimiBalanceSchema` with Zod
- Create `fetchKimiUsage(apiKey: string, baseUrl?: string)` function
- Create `formatKimiUsage(usage: KimiUsageInfo)` function
- Export from core index

### Phase 2: Provider Detection & Key Resolution

#### Task 2: API Key Quota Resolver (`packages/core/src/providers/apiKeyQuotaResolver.ts`)
**Test file**: `packages/core/src/providers/apiKeyQuotaResolver.test.ts`

Tests:
1. `detectApiKeyProvider` returns 'zai' when base-url contains 'api.z.ai'
2. `detectApiKeyProvider` returns 'synthetic' when base-url contains 'synthetic.new'
3. `detectApiKeyProvider` returns 'chutes' when base-url contains 'chutes.ai'
4. `detectApiKeyProvider` returns 'kimi' when base-url contains 'kimi.com' or 'moonshot'
5. `detectApiKeyProvider` returns null for unknown base URLs
6. `detectApiKeyProvider` returns null when no base-url set
7. `resolveApiKeyFromProfile` reads key from keyfile path
8. `resolveApiKeyFromProfile` falls back to environment variable
9. `resolveApiKeyFromProfile` returns null when no key found
10. `fetchApiKeyProviderQuota` dispatches to correct provider fetcher
11. `fetchApiKeyProviderQuota` returns formatted output

Implementation:
- `detectApiKeyProvider(baseUrl: string): string | null`
- `resolveApiKey(keyfilePath?: string, envKey?: string): Promise<string | null>`
- `fetchApiKeyProviderQuota(provider: string, apiKey: string, baseUrl?: string): Promise<{ provider: string; lines: string[] } | null>`

### Phase 3: Stats Command Integration

#### Task 3: Update statsCommand quota subcommand
**Test file**: `packages/cli/src/ui/commands/statsCommand.test.ts` (extend existing)

Tests:
1. Quota command shows API-key provider info alongside OAuth info
2. Quota command shows Z.ai info when profile uses z.ai base URL
3. Quota command shows Synthetic info when profile uses synthetic.new base URL
4. Quota command shows Chutes info when profile uses chutes.ai base URL
5. Quota command shows Kimi info when profile uses kimi.com base URL
6. Quota command gracefully handles API key provider fetch failure
7. Quota command shows "not available" message for Kimi Code keys
8. Description updated to mention all supported providers

Implementation:
- Read base-url from config ephemeral settings
- Read auth-keyfile from config ephemeral settings
- Detect provider, resolve API key, fetch quota
- Append API-key provider quota output after OAuth sections
- Update description string

## File Changes Summary

### New files:
- `packages/core/src/providers/zai/usageInfo.ts`
- `packages/core/src/providers/zai/usageInfo.test.ts`
- `packages/core/src/providers/synthetic/usageInfo.ts`
- `packages/core/src/providers/synthetic/usageInfo.test.ts`
- `packages/core/src/providers/chutes/usageInfo.ts`
- `packages/core/src/providers/chutes/usageInfo.test.ts`
- `packages/core/src/providers/kimi/usageInfo.ts`
- `packages/core/src/providers/kimi/usageInfo.test.ts`
- `packages/core/src/providers/apiKeyQuotaResolver.ts`
- `packages/core/src/providers/apiKeyQuotaResolver.test.ts`

### Modified files:
- `packages/core/src/index.ts` (add exports)
- `packages/cli/src/ui/commands/statsCommand.ts` (integrate new providers)
- `packages/cli/src/ui/commands/statsCommand.test.ts` (add new tests)

## Execution Order
1. Task 1A: Z.ai usage info (core) → verify
2. Task 1B: Synthetic usage info (core) → verify
3. Task 1C: Chutes usage info (core) → verify
4. Task 1D: Kimi usage info (core) → verify
5. Task 2: API key quota resolver (core) → verify
6. Task 3: Stats command integration (cli) → verify
7. Final verification: full test suite + lint + typecheck + format + build + smoke test
