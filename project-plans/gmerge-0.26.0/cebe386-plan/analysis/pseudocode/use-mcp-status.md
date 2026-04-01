# Pseudocode: useMcpStatus Hook (useMcpStatus.ts)

## Interface Contracts

```typescript
// INPUT: Config instance (to access McpClientManager)
import { type Config, coreEvents, MCPDiscoveryState, CoreEvent } from '@vybestack/llxprt-code-core';

// OUTPUT: MCP status object
interface UseMcpStatusReturn {
  discoveryState: MCPDiscoveryState;
  mcpServerCount: number;
  isMcpReady: boolean;
}

// DEPENDENCIES (real, injected):
//   config.getMcpClientManager() — returns McpClientManager | undefined
//   coreEvents singleton — CoreEventEmitter for subscription
//   CoreEvent.McpClientUpdate — event to listen for
```

## Pseudocode

```
01: FUNCTION useMcpStatus(config: Config) -> UseMcpStatusReturn:
02:
03: // === STATE INITIALIZATION (synchronous, from current manager state) ===
04:   STATE discoveryState = useState<MCPDiscoveryState>(
05:     INITIALIZER: () =>
06:       config.getMcpClientManager()?.getDiscoveryState()
07:       ?? MCPDiscoveryState.NOT_STARTED
08:   )
09:
10:   STATE mcpServerCount = useState<number>(
11:     INITIALIZER: () =>
12:       config.getMcpClientManager()?.getMcpServerCount()
13:       ?? 0
14:   )
15:
16: // === EVENT SUBSCRIPTION (effect with cleanup) ===
17:   useEffect(() => {
18:     DEFINE onChange handler:
19:       LET manager = config.getMcpClientManager()
20:       IF manager exists:
21:         SET discoveryState = manager.getDiscoveryState()
22:         SET mcpServerCount = manager.getMcpServerCount()
23:
24:     SUBSCRIBE: coreEvents.on(CoreEvent.McpClientUpdate, onChange)
25:
26:     CLEANUP: () => {
27:       UNSUBSCRIBE: coreEvents.off(CoreEvent.McpClientUpdate, onChange)
28:     }
29:   }, [config])  // re-subscribe only if config instance changes
30:
31: // === DERIVED STATE ===
32:   COMPUTE isMcpReady:
33:     discoveryState === MCPDiscoveryState.COMPLETED
34:     OR (discoveryState === MCPDiscoveryState.NOT_STARTED AND mcpServerCount === 0)
35:
36:   RETURN { discoveryState, mcpServerCount, isMcpReady }
```

## Integration Points

```
Lines 04-08: useState initializer reads current state SYNCHRONOUSLY
         - This handles the case where discovery completes before the hook mounts
         - No event emission needed — just reads the manager's current state
         - If getMcpClientManager() returns undefined, defaults are safe (NOT_STARTED, 0)

Lines 10-14: Server count initialization from getMcpServerCount()
         - This method must be added to McpClientManager (see mcp-manager-emits.md line 48-50)
         - Returns this.clients.size

Lines 17-29: Effect subscribes to CoreEvent.McpClientUpdate
         - Handler reads CURRENT state from manager (not from event payload)
         - This avoids stale closure issues — always gets latest values
         - Cleanup function removes listener on unmount (prevents leak)
         - Dependency on [config] means re-subscribe if config changes (rare)

Lines 32-34: isMcpReady derivation logic
         - COMPLETED → always ready (even if some servers failed)
         - NOT_STARTED + 0 servers → ready (no MCP to wait for)
         - NOT_STARTED + servers → not ready (discovery hasn't begun yet)
         - IN_PROGRESS → never ready (still discovering)
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Initialize state from defaults (NOT_STARTED, 0) without reading manager
[OK] DO: Use useState initializer to read current manager state synchronously

[ERROR] DO NOT: Derive mcpServerCount from event payload only (would miss initial state)
[OK] DO: Read from manager in both initializer and onChange handler

[ERROR] DO NOT: Forget the cleanup function in useEffect (listener leak)
[OK] DO: Return () => coreEvents.off(CoreEvent.McpClientUpdate, onChange)

[ERROR] DO NOT: Subscribe to appEvents (wrong emitter — events won't arrive)
[OK] DO: Subscribe to coreEvents (where McpClientManager now emits)

[ERROR] DO NOT: Compute isMcpReady as a separate useState (derived state should not be state)
[OK] DO: Compute isMcpReady inline from discoveryState and mcpServerCount

[ERROR] DO NOT: Use the event payload to set discoveryState (payload has clients, not state)
[OK] DO: Read discoveryState from manager.getDiscoveryState() inside the handler
```
