<!-- @plan PLAN-20260223-ISSUE1598.P02 -->
# Pseudocode: Bucket Classification (Pass 1)

**Plan ID**: PLAN-20260223-ISSUE1598  
**Purpose**: Classify the triggering bucket based on its current state  
**Requirements**: REQ-1598-CL01 through CL09

---

## Algorithm: classifyTriggeringBucket

```
1   function classifyTriggeringBucket(
2     provider: string,
3     currentBucket: string,
4     context?: FailoverContext
5   ): Promise<BucketFailureReason>
6   
7   // Check for explicit 429 status
8   if context?.triggeringStatus === 429 then
9     return "quota-exhausted"
10  end if
11  
12  // Attempt to retrieve token for classification
13  let token: OAuthToken | null = null
14  try
15    token = await oauthManager.getOAuthToken(provider, currentBucket)
16  catch error
17    logger.warn(`Token read failed for ${provider}/${currentBucket}:`, error)
18    return "no-token"
19  end try
20  
21  // Handle null token
22  if token === null then
23    return "no-token"
24  end if
25  
26  // Check token expiry
27  let nowSec = Math.floor(Date.now() / 1000)
28  let remainingSec = token.expiry - nowSec
29  
30  // Token expired — attempt refresh
31  if remainingSec <= 0 then
32    try
33      let refreshed = await oauthManager.refreshOAuthToken(provider, currentBucket)
34      if refreshed === true then
35        logger.debug("Refresh succeeded for triggering bucket — no failover needed")
36        return null  // Signal immediate success
37      end if
38    catch refreshError
39      logger.debug(`Refresh failed for triggering bucket:`, refreshError)
40    end try
41    return "expired-refresh-failed"
42  end if
43  
44  // Token not expired but call failed — fallback classification
45  if context?.triggeringStatus === 500 or context?.triggeringStatus === 503 then
46    return "quota-exhausted"
47  else
48    return "no-token"
49  end if
50  
51  end function
```

---

## Key Decision Points

### Line 8-10: 429 Detection
**Rule**: Immediate classification for rate limiting  
**Rationale**: 429 is unambiguous — quota exhausted, cannot be fixed by refresh

### Line 16-19: Token-Store Read Error Handling
**Rule**: Classify as `no-token` for pragmatic recovery  
**Rationale**: Read errors may be transient; reauth can potentially recover

### Line 30-42: Expired Token Refresh Attempt
**Rule**: Try refresh before classifying as failed  
**Rationale**: Successful refresh means current bucket recovered — no failover needed

### Line 36: Immediate Success Signal
**Rule**: Return `null` (or special sentinel) to signal early exit  
**Rationale**: Pass 1 refresh success bypasses Pass 2 entirely

### Line 44-49: Fallback Classification
**Rule**: Use status code hints for non-429 failures  
**Rationale**: 5xx errors likely server-side; treat as quota issue

---

## Usage in tryFailover()

```
// At start of tryFailover()
let reason = await classifyTriggeringBucket(provider, currentBucket, context)
if reason === null then
  return true  // Pass 1 refresh succeeded
end if

lastFailoverReasons[currentBucket] = reason
triedBucketsThisSession.add(currentBucket)
```

---

## Requirements Traceability

| Line | Requirement | Description |
|------|-------------|-------------|
| 8-10 | REQ-1598-CL01 | 429 → quota-exhausted |
| 16-19 | REQ-1598-CL04 | Token-store read error → no-token |
| 22-24 | REQ-1598-CL03 | Null token → no-token |
| 30-42 | REQ-1598-CL02, CL07 | Expired + refresh logic |
| 36 | REQ-1598-CL07 | Immediate return on refresh success |

---

## Edge Cases

1. **Malformed token (missing expiry)**: Line 28 will produce `NaN`, line 31 condition becomes true → refresh attempted
2. **Token with remainingSec = 0**: Line 31 condition true → refresh attempted
3. **getOAuthToken throws**: Line 16-19 catches and classifies as `no-token`
4. **refreshOAuthToken throws**: Line 38-40 catches and proceeds to line 41

---

## State Mutations

- **None in this function** — classification is read-only
- **Caller responsibility**: Record reason in `lastFailoverReasons`, add bucket to `triedBucketsThisSession`
