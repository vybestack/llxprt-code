# Plan 08: Stale Socket Cleanup Before Bind (R25.4)

**Spec Reference**: requirements.md R25.4  
**File**: `packages/cli/src/auth/proxy/credential-proxy-server.ts`  
**Prerequisite**: None (can be implemented independently)

---

## Overview

When the proxy starts and a socket file already exists at the generated path (due to PID reuse or unclean shutdown), it must remove the stale socket before binding. This prevents bind failures and ensures reliable startup.

---

## Requirements Trace

| Requirement | Source | Description |
|-------------|--------|-------------|
| R25.4 | Spec | When proxy starts and socket file exists at generated path, remove stale socket before binding |
| R25.1a | Spec | If socket bind fails (after cleanup attempt), abort with actionable error before container spawn |

---

## Current State

The current implementation may or may not handle stale sockets. Let's check:

```typescript
// credential-proxy-server.ts - buildSocketPath generates path
private buildSocketPath(): string {
  const tmpdir = os.tmpdir();
  const uid = process.getuid?.() ?? 0;
  const nonce = crypto.randomBytes(16).toString('hex');
  // llxprt-proxy-<uid>-<pid>-<nonce>.sock
  const dir = path.join(tmpdir, `llxprt-proxy-${uid}`);
  // ...
}

// start() binds the server
async start(): Promise<string> {
  const socketPath = this.options.socketPath ?? this.buildSocketPath();
  // ... creates directory, but what about existing socket?
  await new Promise<void>((resolve, reject) => {
    this.server.listen(socketPath, resolve);
    this.server.once('error', reject);
  });
  // ...
}
```

The nonce makes collision unlikely, but PID reuse can still cause issues if:
1. Previous process crashed without cleanup
2. Same PID is reused quickly
3. Nonce happens to collide (rare but possible)

---

## Target State

```typescript
import * as fs from 'node:fs';
import * as net from 'node:net';

async start(): Promise<string> {
  const socketPath = this.options.socketPath ?? this.buildSocketPath();
  const dir = path.dirname(socketPath);
  
  // Ensure directory exists with proper permissions
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  
  // Clean up stale socket if it exists
  await this.cleanupStaleSocket(socketPath);
  
  // Now bind the server
  await new Promise<void>((resolve, reject) => {
    this.server.listen(socketPath, () => {
      // Set socket file permissions after bind
      fs.chmodSync(socketPath, 0o600);
      resolve();
    });
    this.server.once('error', (err) => {
      // Provide actionable error message per R25.1a
      const enhanced = this.enhanceBindError(err, socketPath);
      reject(enhanced);
    });
  });
  
  this.socketPath = socketPath;
  return socketPath;
}

/**
 * Remove stale socket file if it exists.
 * 
 * Strategy:
 * 1. Check if file exists
 * 2. If it's a socket, try to connect briefly
 * 3. If connection fails (ECONNREFUSED), it's stale - remove it
 * 4. If connection succeeds, another server is running - throw error
 * 5. If it's not a socket, throw error (unexpected file type)
 */
private async cleanupStaleSocket(socketPath: string): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(socketPath);
  } catch (err) {
    // File doesn't exist - good, nothing to clean up
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw err;
  }
  
  // Check if it's a socket
  if (!stat.isSocket()) {
    throw new Error(
      `Socket path ${socketPath} exists but is not a socket (mode: ${stat.mode.toString(8)}). ` +
      `Please remove this file manually.`
    );
  }
  
  // It's a socket - check if it's alive
  const isAlive = await this.isSocketAlive(socketPath);
  
  if (isAlive) {
    throw new Error(
      `Socket at ${socketPath} is already in use by another process. ` +
      `Another instance of the credential proxy may be running.`
    );
  }
  
  // Socket is stale - remove it
  this.logger?.debug?.(`Removing stale socket at ${socketPath}`);
  await fs.promises.unlink(socketPath);
}

/**
 * Check if a socket is actively listening.
 * Attempts a brief connection to detect if a server is running.
 */
private isSocketAlive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = 100; // 100ms connection timeout
    const socket = net.createConnection(socketPath);
    
    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };
    
    const timer = setTimeout(() => {
      cleanup();
      resolve(false); // Timeout = not alive
    }, timeout);
    
    socket.once('connect', () => {
      clearTimeout(timer);
      cleanup();
      resolve(true); // Connected = alive
    });
    
    socket.once('error', (err) => {
      clearTimeout(timer);
      cleanup();
      // ECONNREFUSED means socket exists but no listener = stale
      // ENOENT means socket doesn't exist (race condition) = safe to proceed
      const code = (err as NodeJS.ErrnoException).code;
      resolve(code !== 'ECONNREFUSED' && code !== 'ENOENT');
    });
  });
}

/**
 * Enhance bind errors with actionable messages.
 */
private enhanceBindError(err: Error, socketPath: string): Error {
  const errno = (err as NodeJS.ErrnoException).code;
  
  switch (errno) {
    case 'EADDRINUSE':
      return new Error(
        `Cannot bind to ${socketPath}: address already in use. ` +
        `Another instance may be running, or a stale socket file exists. ` +
        `Try: rm ${socketPath}`
      );
    
    case 'EACCES':
      return new Error(
        `Cannot bind to ${socketPath}: permission denied. ` +
        `Check directory permissions for ${path.dirname(socketPath)}`
      );
    
    case 'ENAMETOOLONG':
      return new Error(
        `Socket path too long: ${socketPath} (${socketPath.length} chars). ` +
        `Unix sockets have a 108 character limit. Set a shorter TMPDIR.`
      );
    
    default:
      return new Error(
        `Failed to bind socket at ${socketPath}: ${err.message} (${errno})`
      );
  }
}
```

---

## Behavioral Test Scenarios

### Scenario 1: Clean start with no existing socket (NON-FAKEABLE)

```gherkin
@given no socket file exists at the target path
@when the server starts
@then the socket is created successfully
@and the server begins listening
```

**Non-Fakeable Test** (uses real filesystem):
```typescript
describe('Stale socket cleanup - clean start', () => {
  it('starts successfully when no socket exists', async () => {
    // This test is non-fakeable because:
    // 1. Uses real filesystem
    // 2. Creates actual Unix socket
    // 3. Verifies socket is functional
    
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'proxy-test-'));
    const socketPath = path.join(tmpDir, 'test.sock');
    
    try {
      const server = new CredentialProxyServer({
        tokenStore: new InMemoryTokenStore(),
        providerKeyStorage: new InMemoryProviderKeyStorage(),
        socketPath,
      });
      
      const actualPath = await server.start();
      expect(actualPath).toBe(socketPath);
      
      // Verify socket exists and is functional
      const stat = await fs.promises.stat(socketPath);
      expect(stat.isSocket()).toBe(true);
      
      // Verify we can connect
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('error', reject);
      });
      client.destroy();
      
      await server.stop();
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
```

### Scenario 2: Stale socket is cleaned up (NON-FAKEABLE)

```gherkin
@given a stale socket file exists at the target path
@and no server is listening on that socket
@when the server starts
@then the stale socket is removed
@and a new socket is created
@and the server begins listening
```

**Non-Fakeable Test**:
```typescript
describe('Stale socket cleanup - removes dead socket', () => {
  it('removes stale socket and starts successfully', async () => {
    // This test is non-fakeable because:
    // 1. Creates a real socket file
    // 2. Server that created it is stopped (simulating crash)
    // 3. New server must detect staleness and clean up
    
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'proxy-test-'));
    const socketPath = path.join(tmpDir, 'test.sock');
    
    try {
      // Create a server and then stop it (simulates crash leaving stale socket)
      const oldServer = net.createServer();
      await new Promise<void>((resolve) => {
        oldServer.listen(socketPath, resolve);
      });
      // Close without removing socket file
      await new Promise<void>((resolve) => {
        oldServer.close(() => resolve());
      });
      
      // Socket file still exists but no one is listening
      expect(await fileExists(socketPath)).toBe(true);
      
      // New server should clean up and start
      const server = new CredentialProxyServer({
        tokenStore: new InMemoryTokenStore(),
        providerKeyStorage: new InMemoryProviderKeyStorage(),
        socketPath,
      });
      
      const actualPath = await server.start();
      expect(actualPath).toBe(socketPath);
      
      // Should be able to connect to new server
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('error', reject);
      });
      client.destroy();
      
      await server.stop();
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.promises.access(path);
    return true;
  } catch {
    return false;
  }
}
```

### Scenario 3: Active socket causes error (NON-FAKEABLE)

```gherkin
@given a socket file exists at the target path
@and another server IS listening on that socket
@when the server tries to start
@then an error is thrown indicating another instance is running
```

**Non-Fakeable Test**:
```typescript
describe('Stale socket cleanup - active socket error', () => {
  it('throws error when socket is actively used', async () => {
    // This test is non-fakeable because:
    // 1. Real socket with real listener
    // 2. Must detect the listener through actual connection attempt
    
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'proxy-test-'));
    const socketPath = path.join(tmpDir, 'test.sock');
    
    try {
      // Start a real server on the socket
      const existingServer = net.createServer();
      await new Promise<void>((resolve) => {
        existingServer.listen(socketPath, resolve);
      });
      
      // Try to start our proxy on the same socket
      const server = new CredentialProxyServer({
        tokenStore: new InMemoryTokenStore(),
        providerKeyStorage: new InMemoryProviderKeyStorage(),
        socketPath,
      });
      
      await expect(server.start()).rejects.toThrow(/already in use/);
      
      // Clean up existing server
      await new Promise<void>((resolve) => {
        existingServer.close(() => resolve());
      });
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
```

### Scenario 4: Non-socket file causes error

```gherkin
@given a regular file (not a socket) exists at the target path
@when the server tries to start
@then an error is thrown indicating unexpected file type
```

**Test Code**:
```typescript
describe('Stale socket cleanup - wrong file type', () => {
  it('throws error when path is not a socket', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'proxy-test-'));
    const socketPath = path.join(tmpDir, 'test.sock');
    
    try {
      // Create a regular file at the socket path
      await fs.promises.writeFile(socketPath, 'not a socket');
      
      const server = new CredentialProxyServer({
        tokenStore: new InMemoryTokenStore(),
        providerKeyStorage: new InMemoryProviderKeyStorage(),
        socketPath,
      });
      
      await expect(server.start()).rejects.toThrow(/not a socket/);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
```

### Scenario 5: Bind error provides actionable message

```gherkin
@given the socket directory doesn't exist and can't be created
@when the server tries to start
@then an error is thrown with actionable guidance
```

**Test Code**:
```typescript
describe('Stale socket cleanup - actionable errors', () => {
  it('provides actionable message for ENAMETOOLONG', async () => {
    // Create a path that's definitely too long
    const longName = 'a'.repeat(200);
    const socketPath = path.join(os.tmpdir(), longName, 'test.sock');
    
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
      socketPath,
    });
    
    await expect(server.start()).rejects.toThrow(/too long|108/);
  });
  
  it('provides actionable message for permission errors', async () => {
    // Skip on Windows where permissions work differently
    if (process.platform === 'win32') return;
    
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'proxy-test-'));
    const restrictedDir = path.join(tmpDir, 'restricted');
    await fs.promises.mkdir(restrictedDir, { mode: 0o000 });
    
    try {
      const socketPath = path.join(restrictedDir, 'test.sock');
      
      const server = new CredentialProxyServer({
        tokenStore: new InMemoryTokenStore(),
        providerKeyStorage: new InMemoryProviderKeyStorage(),
        socketPath,
      });
      
      await expect(server.start()).rejects.toThrow(/permission/i);
    } finally {
      await fs.promises.chmod(restrictedDir, 0o755);
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
```

---

## Implementation Steps

### Step 8.1: Add cleanupStaleSocket method

```typescript
private async cleanupStaleSocket(socketPath: string): Promise<void> {
  // ... implementation from target state
}
```

### Step 8.2: Add isSocketAlive helper

```typescript
private isSocketAlive(socketPath: string): Promise<boolean> {
  // ... implementation from target state
}
```

### Step 8.3: Add enhanceBindError helper

```typescript
private enhanceBindError(err: Error, socketPath: string): Error {
  // ... implementation from target state
}
```

### Step 8.4: Update start() to call cleanup

```typescript
async start(): Promise<string> {
  const socketPath = this.options.socketPath ?? this.buildSocketPath();
  const dir = path.dirname(socketPath);
  
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  await this.cleanupStaleSocket(socketPath); // NEW
  
  // ... rest of existing start logic with enhanced error handling
}
```

---

## Verification Criteria

| Criterion | Verification Method |
|-----------|---------------------|
| Clean start works | Integration test with real filesystem |
| Stale socket removed | Integration test with pre-created dead socket |
| Active socket detected | Integration test with live server |
| Non-socket file rejected | Integration test with regular file |
| Actionable error messages | Unit test for error enhancement |
| Socket permissions correct | Integration test checking file mode |

---

## Edge Cases

1. **Race Condition**: Between stat() and unlink(), another process could start. The bind() will fail with EADDRINUSE, which is correct behavior.

2. **Symlink**: If the path is a symlink to a socket, stat() follows the link. This is correct - we care about what it points to.

3. **Permission During Check**: If we can't stat() due to permissions, we can't bind either, so let bind() fail with its own error.

4. **Rapid Restart**: If our own process restarts rapidly before OS reclaims the socket, isSocketAlive() correctly detects no listener.

---

## Security Considerations

1. **TOCTOU**: There's a time-of-check-time-of-use race between cleanup and bind. The bind() call is atomic protection.

2. **Symlink Attack**: An attacker could create a symlink at the socket path. The stat() check and subsequent unlink() operate on the target. This is safe because:
   - Socket permissions (0o600) restrict who can create files in the directory
   - Directory permissions (0o700) restrict directory access

3. **Denial of Service**: An attacker with write access to the socket directory could repeatedly create files. This is mitigated by the restricted directory permissions created by buildSocketPath().
