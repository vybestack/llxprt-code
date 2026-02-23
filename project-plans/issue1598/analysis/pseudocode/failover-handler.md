<!-- @plan PLAN-20260223-ISSUE1598.P02 -->
# Pseudocode: Full Failover Handler (Three-Pass Algorithm)

**Plan ID**: PLAN-20260223-ISSUE1598  
**Purpose**: Complete tryFailover() implementation with classification, candidate search, and reauth  
**Requirements**: REQ-1598-FL01 through FL18

---

## Algorithm: tryFailover (Full Three-Pass)

```
1   async function tryFailover(context?: FailoverContext): Promise<boolean>
2   
3   // Clear reasons from previous attempt (REQ-1598-CL09)
4   this.lastFailoverReasons = {}
5   
6   // Determine triggering bucket
7   let currentBucket = this.sessionBucket ?? this.buckets[0]
8   
9   // ============================================================
10  // PASS 1: CLASSIFY TRIGGERING BUCKET
11  // ============================================================
12  
13  let reason: BucketFailureReason | null = null
14  
15  if context?.triggeringStatus === 429 then
16    reason = "quota-exhausted"
17  else
18    // Attempt to get token for classification
19    let token: OAuthToken | null = null
20    try
21      token = await this.oauthManager.getOAuthToken(this.provider, currentBucket)
22    catch error
23      logger.warn(`Token read failed for ${this.provider}/${currentBucket}:`, error)
24      reason = "no-token"
25    end try
26    
27    if token !== null and reason === null then
28      let nowSec = Math.floor(Date.now() / 1000)
29      let remainingSec = token.expiry - nowSec
30      
31      if remainingSec <= 0 then
32        // Token expired — attempt refresh
33        try
34          let refreshed = await this.oauthManager.refreshOAuthToken(this.provider, currentBucket)
35          if refreshed === true then
36            logger.debug("Refresh succeeded for triggering bucket — no failover needed")
37            return true  // Immediate success (REQ-1598-CL07)
38          end if
39        catch refreshError
40          logger.debug(`Refresh failed for triggering bucket:`, refreshError)
41        end try
42        reason = "expired-refresh-failed"
43      else
44        // Token not expired but call failed — fallback classification
45        if context?.triggeringStatus === 500 or context?.triggeringStatus === 503 then
46          reason = "quota-exhausted"
47        else
48          reason = "no-token"
49        end if
50      end if
51    else if reason === null then
52      reason = "no-token"
53    end if
54  end if
55  
56  // Record reason and mark bucket as tried
57  this.lastFailoverReasons[currentBucket] = reason
58  this.triedBucketsThisSession.add(currentBucket)
59  
60  // ============================================================
61  // PASS 2: FIND NEXT CANDIDATE WITH VALID/REFRESHABLE TOKEN
62  // ============================================================
63  
64  for each bucket in this.buckets do  // Profile order (REQ-1598-FL13)
65    if this.triedBucketsThisSession.has(bucket) then
66      this.lastFailoverReasons[bucket] = "skipped"
67      continue
68    end if
69    
70    // Attempt to retrieve token
71    let token: OAuthToken | null = null
72    try
73      token = await this.oauthManager.getOAuthToken(this.provider, bucket)
74    catch error
75      logger.warn(`Token read failed for ${this.provider}/${bucket}:`, error)
76      this.lastFailoverReasons[bucket] = "no-token"
77      continue
78    end try
79    
80    if token === null then
81      this.lastFailoverReasons[bucket] = "no-token"
82      continue
83    end if
84    
85    let nowSec = Math.floor(Date.now() / 1000)
86    let remainingSec = token.expiry - nowSec
87    
88    // Token expired — attempt refresh (REQ-1598-FL17)
89    if remainingSec <= 0 then
90      try
91        let refreshed = await this.oauthManager.refreshOAuthToken(this.provider, bucket)
92        if refreshed === true then
93          // Refresh succeeded — switch bucket
94          this.sessionBucket = bucket
95          try
96            await this.oauthManager.setSessionBucket(this.provider, bucket)
97          catch setError
98            logger.warn(`Failed to set session bucket during pass-2 refresh: ${setError}`)
99            // Continue anyway — setSessionBucket failure should not abort failover
100         end try
101         logger.info(`Switched to bucket after refresh: ${bucket}`)
102         return true
103       end if
104     catch refreshError
105       logger.debug(`Refresh failed for ${bucket}:`, refreshError)
106     end try
107     this.lastFailoverReasons[bucket] = "expired-refresh-failed"
108     continue
109   end if
110   
111   // Valid token found — switch and succeed (REQ-1598-FL03, FL18)
112   this.sessionBucket = bucket
113   try
114     await this.oauthManager.setSessionBucket(this.provider, bucket)
115   catch setError
116     logger.warn(`Failed to set session bucket during pass-2 switch: ${setError}`)
117     // Continue anyway
118   end try
119   logger.info(`Switched to bucket: ${bucket}`)
120   return true
121 end for
122 
123 // ============================================================
124 // PASS 3: FOREGROUND REAUTH FOR EXPIRED/MISSING TOKENS
125 // ============================================================
126 
127 // Find first bucket classified as expired-refresh-failed or no-token (not tried yet)
128 let candidateBucket: string | undefined = undefined
129 for each bucket in this.buckets do
130   if not this.triedBucketsThisSession.has(bucket) and
131      (this.lastFailoverReasons[bucket] === "expired-refresh-failed" or
132       this.lastFailoverReasons[bucket] === "no-token") then
133     candidateBucket = bucket
134     break
135   end if
136 end for
137 
138 if candidateBucket !== undefined then
139   try
140     logger.info(`Attempting foreground reauth for bucket: ${candidateBucket}`)
141     await this.oauthManager.authenticate(this.provider, candidateBucket)
142     
143     // Verify token exists after reauth (REQ-1598-FL08)
144     let token = await this.oauthManager.getOAuthToken(this.provider, candidateBucket)
145     if token === null then
146       logger.warn(`Foreground reauth succeeded but token is null for bucket: ${candidateBucket}`)
147       this.lastFailoverReasons[candidateBucket] = "reauth-failed"
148       this.triedBucketsThisSession.add(candidateBucket)
149     else
150       // Reauth succeeded — switch bucket
151       this.sessionBucket = candidateBucket
152       try
153         await this.oauthManager.setSessionBucket(this.provider, candidateBucket)
154       catch setError
155         logger.warn(`Failed to set session bucket during pass-3 reauth: ${setError}`)
156         // Continue anyway
157       end try
158       logger.info(`Foreground reauth succeeded for bucket: ${candidateBucket}`)
159       return true
160     end if
161   catch reauthError
162     logger.warn(`Foreground reauth failed for bucket ${candidateBucket}:`, reauthError)
163     this.lastFailoverReasons[candidateBucket] = "reauth-failed"
164     this.triedBucketsThisSession.add(candidateBucket)
165   end try
166 end if
167 
168 // All passes exhausted — failover unsuccessful
169 logger.warn("All buckets exhausted — failover unsuccessful")
170 return false
171 
172 end function
```

---

## Pass Summaries

### Pass 1: Classification (Lines 10-58)
**Purpose**: Determine why the triggering bucket failed  
**Outputs**: 
- `lastFailoverReasons[currentBucket]` set
- `triedBucketsThisSession` updated
- Early exit if refresh succeeds (line 37)

**Key Requirements**:
- REQ-1598-CL01 (429 → quota-exhausted)
- REQ-1598-CL02 (expired + refresh failed)
- REQ-1598-CL03 (null token → no-token)
- REQ-1598-CL04 (token-store error → no-token)
- REQ-1598-CL07 (non-429 expired refresh success → immediate return)

### Pass 2: Candidate Search (Lines 60-121)
**Purpose**: Find next bucket with usable token  
**Iteration**: Profile order (line 64)  
**Outputs**:
- Bucket switch if valid token found
- Classification reasons for failed buckets
- Early exit if candidate found (lines 102, 120)

**Key Requirements**:
- REQ-1598-FL03 (valid token → switch)
- REQ-1598-FL04, FL05 (expired token → refresh → switch)
- REQ-1598-FL13 (profile order iteration)
- REQ-1598-FL17 (expired token handling)
- REQ-1598-FL18 (near-expiry acceptance)
- REQ-1598-CL05 (skipped classification)

### Pass 3: Foreground Reauth (Lines 123-166)
**Purpose**: Attempt user-interactive auth for recoverable failures  
**Target**: First bucket with `expired-refresh-failed` or `no-token` not yet tried  
**Outputs**:
- Bucket switch if reauth succeeds
- `reauth-failed` classification if fails

**Key Requirements**:
- REQ-1598-FL07 (single reauth candidate)
- REQ-1598-FL08 (post-reauth token validation)
- REQ-1598-FL09 (reauth success but null token)
- REQ-1598-FL10 (reauth failure handling)
- REQ-1598-FR01 (authenticate() call)
- REQ-1598-FR03 (eligible bucket types)

---

## State Management

### Variables Modified
- `this.lastFailoverReasons`: Lines 4, 57, 66, 76, 81, 107, 147, 163
- `this.triedBucketsThisSession`: Lines 58, 148, 164
- `this.sessionBucket`: Lines 94, 112, 151

### Clearing Rules
- `lastFailoverReasons` cleared at start (line 4) per REQ-1598-CL09
- `triedBucketsThisSession` NOT cleared here — caller (RetryOrchestrator) must call `resetSession()`

---

## Error Handling

### setSessionBucket Failures
**Lines**: 95-100, 113-118, 152-157  
**Strategy**: Log warning, continue failover  
**Rationale**: Session persistence failure should not prevent bucket switch

### Token-Store Read Errors
**Lines**: 22-25, 74-78  
**Strategy**: Log warning, classify as `no-token`  
**Rationale**: Read errors may be transient; reauth can potentially recover

### Refresh Errors
**Lines**: 39-41, 104-106  
**Strategy**: Log debug message, classify as `expired-refresh-failed`  
**Rationale**: Refresh failures are expected; proceed to next recovery method

### Reauth Errors
**Lines**: 161-165  
**Strategy**: Log warning, classify as `reauth-failed`, add to tried set  
**Rationale**: Reauth failures are terminal for that bucket in this request

---

## Integration Points

### Called By
- `RetryOrchestrator.handleRetry()` when API error detected

### Calls
- `oauthManager.getOAuthToken(provider, bucket)`
- `oauthManager.refreshOAuthToken(provider, bucket)`
- `oauthManager.setSessionBucket(provider, bucket)`
- `oauthManager.authenticate(provider, bucket)` (Pass 3 only)

### Returns
- `true`: Bucket switch successful, retry request
- `false`: All buckets exhausted, caller should throw `AllBucketsExhaustedError`

---

## Verification Points

### After Execution
1. Check `lastFailoverReasons` has entries for all evaluated buckets
2. Verify `triedBucketsThisSession` includes triggering bucket
3. If returned `true`, verify `sessionBucket` changed
4. If returned `false`, verify all buckets either tried or classified

### Timeout Enforcement (External)
- RetryOrchestrator wraps `tryFailover()` in 5-minute timeout via `Promise.race`
- Line 141 (authenticate call) may hang indefinitely — timeout is caller's responsibility

---

## Requirements Coverage Summary

| Pass | Requirements Implemented |
|------|--------------------------|
| Pass 1 | CL01, CL02, CL03, CL04, CL07, CL09, FL12 |
| Pass 2 | CL05, FL03, FL04, FL05, FL13, FL14, FL17, FL18 |
| Pass 3 | FL07, FL08, FL09, FL10, FR01, FR03 |
| Overall | FL01, FL06, FL11 |
