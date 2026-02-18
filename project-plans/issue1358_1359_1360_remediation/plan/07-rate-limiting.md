# Plan 07: Per-Connection Rate Limiting (R22.1)

**Spec Reference**: requirements.md R22.1  
**File**: `packages/cli/src/auth/proxy/credential-proxy-server.ts`  
**Prerequisite**: Plans 01-06

---

## Overview

The server must enforce a rate limit of 60 requests per second per connection to prevent abuse and resource exhaustion. This is distinct from the refresh-specific cooldown (30s per provider:bucket) handled by `RefreshCoordinator`.

---

## Requirements Trace

| Requirement | Source | Description |
|-------------|--------|-------------|
| R22.1 | Spec | If more than 60 requests/second arrive on a single connection, return `RATE_LIMITED` for excess |
| R23.2 | Spec | `RATE_LIMITED` response shall include `retryAfter` field (seconds until retry allowed) |

---

## Current State

The current implementation has no per-connection rate limiting. A malicious or buggy client could flood the server with requests.

```typescript
// credential-proxy-server.ts - dispatchRequest has NO rate limiting
private async dispatchRequest(
  socket: net.Socket,
  frame: Record<string, unknown>,
): Promise<void> {
  const id = frame.id as string;
  const op = frame.op as string;
  const payload = (frame.payload as Record<string, unknown>) ?? {};
  // ... dispatch to handlers, no rate check
}
```

---

## Target State

### Rate Limiter Design

Use a sliding window algorithm per connection:

```typescript
/**
 * Sliding window rate limiter for per-connection request limiting.
 * Tracks timestamps of recent requests and rejects when window is full.
 */
class ConnectionRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly timestamps: number[] = [];
  
  constructor(maxRequestsPerSecond: number = 60) {
    this.windowMs = 1000; // 1 second window
    this.maxRequests = maxRequestsPerSecond;
  }
  
  /**
   * Check if a new request should be allowed.
   * @returns { allowed: true } or { allowed: false, retryAfterMs: number }
   */
  checkLimit(): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Remove timestamps outside the window
    while (this.timestamps.length > 0 && this.timestamps[0] < windowStart) {
      this.timestamps.shift();
    }
    
    if (this.timestamps.length >= this.maxRequests) {
      // Calculate when the oldest request will leave the window
      const oldestInWindow = this.timestamps[0];
      const retryAfterMs = (oldestInWindow + this.windowMs) - now;
      return { allowed: false, retryAfterMs: Math.max(1, retryAfterMs) };
    }
    
    // Allow and record
    this.timestamps.push(now);
    return { allowed: true };
  }
  
  /**
   * Reset the limiter (for testing or connection reset).
   */
  reset(): void {
    this.timestamps.length = 0;
  }
}
```

### Server Integration

```typescript
export class CredentialProxyServer {
  // Per-connection rate limiters
  private readonly connectionLimiters = new WeakMap<net.Socket, ConnectionRateLimiter>();
  
  // Configurable rate limit (default 60 req/s per R22.1)
  private readonly maxRequestsPerSecond: number;
  
  constructor(options: CredentialProxyServerOptions) {
    // ... existing
    this.maxRequestsPerSecond = options.maxRequestsPerSecond ?? 60;
  }
  
  private handleConnection(socket: net.Socket): void {
    // ... existing peer verification
    
    // Create rate limiter for this connection
    const rateLimiter = new ConnectionRateLimiter(this.maxRequestsPerSecond);
    this.connectionLimiters.set(socket, rateLimiter);
    
    // Clean up on close
    socket.once('close', () => {
      this.connectionLimiters.delete(socket);
    });
    
    // ... rest of connection handling
  }
  
  private async dispatchRequest(
    socket: net.Socket,
    frame: Record<string, unknown>,
  ): Promise<void> {
    const id = frame.id as string;
    
    // Check rate limit BEFORE processing
    const limiter = this.connectionLimiters.get(socket);
    if (limiter) {
      const check = limiter.checkLimit();
      if (!check.allowed) {
        const retryAfterSec = Math.ceil(check.retryAfterMs / 1000);
        this.sendError(socket, id, 'RATE_LIMITED', 
          `Rate limit exceeded. Retry after ${retryAfterSec} seconds.`);
        // Include retryAfter in error response per R23.2
        // Note: sendError needs extension for additional fields
        return;
      }
    }
    
    // ... existing dispatch logic
  }
  
  // Extended sendError to support additional fields
  private sendRateLimitedError(
    socket: net.Socket,
    id: string,
    retryAfterSec: number,
  ): void {
    const response: Record<string, unknown> = {
      v: PROTOCOL_VERSION,
      id,
      ok: false,
      code: 'RATE_LIMITED',
      error: `Rate limit exceeded. Retry after ${retryAfterSec} seconds.`,
      retryAfter: retryAfterSec,
    };
    socket.write(encodeFrame(response));
  }
}
```

### Options Extension

```typescript
interface CredentialProxyServerOptions {
  // ... existing fields
  maxRequestsPerSecond?: number; // Default 60 per R22.1
}
```

---

## Behavioral Test Scenarios

### Scenario 1: Requests under limit are allowed (NON-FAKEABLE)

```gherkin
@given a connection is established
@when 60 requests are sent within 1 second
@then all 60 requests succeed
```

**Non-Fakeable Test** (must use real timing, not mocked clock):
```typescript
describe('Rate limiting - under limit', () => {
  it('allows 60 requests per second', async () => {
    // This test is non-fakeable because:
    // 1. It uses real socket connections
    // 2. It measures actual timing behavior
    // 3. A stub that always returns OK would fail the over-limit test
    
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
      maxRequestsPerSecond: 60,
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    // Send exactly 60 requests as fast as possible
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        client.request('list_providers', {})
      )
    );
    
    // All should succeed
    expect(results.every(r => r.ok)).toBe(true);
    
    client.close();
    await server.stop();
  });
});
```

### Scenario 2: 61st request within 1 second is rate limited (NON-FAKEABLE)

```gherkin
@given a connection is established
@when 61 requests are sent within 1 second
@then the 61st request returns RATE_LIMITED
@and the response includes retryAfter field
```

**Non-Fakeable Test**:
```typescript
describe('Rate limiting - over limit', () => {
  it('returns RATE_LIMITED for 61st request within 1 second', async () => {
    // This test is non-fakeable because:
    // 1. A stub returning OK for everything would fail
    // 2. Must actually track request counts
    // 3. Must correctly calculate retryAfter
    
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
      maxRequestsPerSecond: 60,
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    // Send 61 requests quickly
    const startTime = Date.now();
    const results: Array<{ ok: boolean; code?: string; retryAfter?: number }> = [];
    
    for (let i = 0; i < 61; i++) {
      const result = await client.request('list_providers', {});
      results.push(result);
    }
    
    const elapsedMs = Date.now() - startTime;
    
    // If all completed within 1 second, the 61st should be rate limited
    if (elapsedMs < 1000) {
      const rateLimitedCount = results.filter(r => r.code === 'RATE_LIMITED').length;
      expect(rateLimitedCount).toBeGreaterThanOrEqual(1);
      
      // Find the rate limited response
      const limited = results.find(r => r.code === 'RATE_LIMITED');
      expect(limited?.retryAfter).toBeDefined();
      expect(limited?.retryAfter).toBeGreaterThan(0);
      expect(limited?.retryAfter).toBeLessThanOrEqual(1); // At most 1 second wait
    }
    
    client.close();
    await server.stop();
  });
});
```

### Scenario 3: Rate limit resets after window expires (NON-FAKEABLE)

```gherkin
@given a connection hit the rate limit
@when 1 second passes
@then subsequent requests are allowed
```

**Non-Fakeable Test**:
```typescript
describe('Rate limiting - window reset', () => {
  it('allows requests after rate limit window expires', async () => {
    // This test uses real timing - cannot be faked without breaking semantics
    
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
      maxRequestsPerSecond: 5, // Low limit for faster test
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    // Exhaust the limit
    for (let i = 0; i < 5; i++) {
      await client.request('list_providers', {});
    }
    
    // Next request should be rate limited
    const limited = await client.request('list_providers', {});
    expect(limited.code).toBe('RATE_LIMITED');
    
    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Now requests should work again
    const afterWait = await client.request('list_providers', {});
    expect(afterWait.ok).toBe(true);
    
    client.close();
    await server.stop();
  }, 5000); // 5 second timeout for this test
});
```

### Scenario 4: Different connections have independent limits

```gherkin
@given connection A has exhausted its rate limit
@when connection B sends a request
@then connection B's request succeeds
```

**Test Code**:
```typescript
describe('Rate limiting - per connection', () => {
  it('maintains independent limits per connection', async () => {
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
      maxRequestsPerSecond: 5,
    });
    const socketPath = await server.start();
    
    // Connection A exhausts limit
    const clientA = await connectClient(socketPath);
    for (let i = 0; i < 6; i++) {
      await clientA.request('list_providers', {});
    }
    
    // Connection A is now rate limited
    const limitedA = await clientA.request('list_providers', {});
    expect(limitedA.code).toBe('RATE_LIMITED');
    
    // Connection B should still work
    const clientB = await connectClient(socketPath);
    const resultB = await clientB.request('list_providers', {});
    expect(resultB.ok).toBe(true);
    
    clientA.close();
    clientB.close();
    await server.stop();
  });
});
```

### Scenario 5: Unit test for ConnectionRateLimiter

```typescript
describe('ConnectionRateLimiter', () => {
  it('allows requests under limit', () => {
    const limiter = new ConnectionRateLimiter(3);
    
    expect(limiter.checkLimit()).toEqual({ allowed: true });
    expect(limiter.checkLimit()).toEqual({ allowed: true });
    expect(limiter.checkLimit()).toEqual({ allowed: true });
  });
  
  it('rejects requests over limit', () => {
    const limiter = new ConnectionRateLimiter(3);
    
    // First 3 allowed
    limiter.checkLimit();
    limiter.checkLimit();
    limiter.checkLimit();
    
    // 4th rejected
    const result = limiter.checkLimit();
    expect(result.allowed).toBe(false);
    expect('retryAfterMs' in result).toBe(true);
  });
  
  it('calculates correct retryAfterMs', () => {
    // Use fake timers for precise control
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    
    const limiter = new ConnectionRateLimiter(2);
    
    limiter.checkLimit(); // t=0
    
    vi.setSystemTime(now + 100);
    limiter.checkLimit(); // t=100ms
    
    vi.setSystemTime(now + 200);
    const result = limiter.checkLimit(); // t=200ms, over limit
    
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      // Should wait until t=1000 when first request leaves window
      // At t=200, need to wait 800ms
      expect(result.retryAfterMs).toBeCloseTo(800, -2);
    }
    
    vi.useRealTimers();
  });
  
  it('allows requests after window expires', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    
    const limiter = new ConnectionRateLimiter(2);
    
    limiter.checkLimit();
    limiter.checkLimit();
    
    // Over limit
    expect(limiter.checkLimit().allowed).toBe(false);
    
    // Advance past window
    vi.setSystemTime(now + 1001);
    
    // Now allowed again
    expect(limiter.checkLimit().allowed).toBe(true);
    
    vi.useRealTimers();
  });
  
  it('reset clears all timestamps', () => {
    const limiter = new ConnectionRateLimiter(2);
    
    limiter.checkLimit();
    limiter.checkLimit();
    expect(limiter.checkLimit().allowed).toBe(false);
    
    limiter.reset();
    
    expect(limiter.checkLimit().allowed).toBe(true);
  });
});
```

---

## Implementation Steps

### Step 7.1: Create ConnectionRateLimiter class

Extract to `packages/cli/src/auth/proxy/connection-rate-limiter.ts`:
```typescript
export class ConnectionRateLimiter {
  // ... implementation from above
}
```

### Step 7.2: Add maxRequestsPerSecond to options

Update `CredentialProxyServerOptions`:
```typescript
interface CredentialProxyServerOptions {
  // ... existing
  maxRequestsPerSecond?: number; // Default: 60
}
```

### Step 7.3: Create limiter on connection

In `handleConnection()`:
```typescript
const rateLimiter = new ConnectionRateLimiter(this.maxRequestsPerSecond);
this.connectionLimiters.set(socket, rateLimiter);
socket.once('close', () => this.connectionLimiters.delete(socket));
```

### Step 7.4: Check limit in dispatchRequest

Add limit check before processing:
```typescript
const limiter = this.connectionLimiters.get(socket);
if (limiter) {
  const check = limiter.checkLimit();
  if (!check.allowed) {
    this.sendRateLimitedError(socket, id, Math.ceil(check.retryAfterMs / 1000));
    return;
  }
}
```

### Step 7.5: Add sendRateLimitedError method

Extends error response with `retryAfter` field.

---

## Verification Criteria

| Criterion | Verification Method |
|-----------|---------------------|
| 60 requests/sec allowed | Integration test with real timing |
| 61st request rejected | Integration test with real timing |
| retryAfter in response | Unit test + integration test |
| Window reset works | Integration test with delay |
| Per-connection isolation | Integration test with 2 clients |
| Unit tests for limiter | Unit tests with fake timers |

---

## Performance Considerations

1. **Sliding Window**: O(n) where n is max requests in window. For 60 req/s, this is negligible.

2. **WeakMap for Cleanup**: Using `WeakMap` ensures limiters are garbage collected when sockets close.

3. **No Global Lock**: Each connection has independent limiter, no contention.

---

## Security Considerations

1. **DoS Protection**: Limits resource consumption from any single connection.

2. **Per-Connection Scope**: A bad actor can't exhaust limits for legitimate clients on other connections.

3. **Error Information**: `retryAfter` gives clients guidance without revealing internal state.
