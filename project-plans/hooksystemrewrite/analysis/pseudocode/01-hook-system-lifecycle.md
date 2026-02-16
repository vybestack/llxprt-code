# Pseudocode 01: HookSystem Lifecycle

## Interface Contracts

### Inputs
- Config instance with getEnableHooks() and lazy HookSystem accessors

### Outputs
- HookSystem instance when enabled, otherwise undefined
- status object { initialized, totalHooks }

### Dependencies
- HookRegistry, HookPlanner, HookRunner, HookAggregator, HookEventHandler

## Integration Points (Line-by-Line)
- Line 11: top-level enableHooks gate for zero-overhead disabled path
- Line 15: singleton allocation and retention by Config
- Line 24: idempotent initialize call before first event handling
- Line 31: initialization guard for event handler and registry access

## Anti-Pattern Warnings
- [ERROR] Constructing hook infrastructure per trigger call
- [ERROR] Reading hooks config eagerly on Config construction
- [OK] Deferring initialize until first event fire

## Numbered Pseudocode
10: METHOD Config.getHookSystem()
11: IF getEnableHooks() is false THEN RETURN undefined
12: IF this.hookSystem is undefined THEN this.hookSystem = new HookSystem(this)
13: RETURN this.hookSystem
20: METHOD HookSystem.initialize()
21: IF initialized is true THEN RETURN
22: AWAIT registry.initialize()
23: initialized = true
24: RETURN
30: METHOD HookSystem.getEventHandler()
31: IF initialized is false THEN THROW HookSystemNotInitializedError
32: RETURN eventHandler
