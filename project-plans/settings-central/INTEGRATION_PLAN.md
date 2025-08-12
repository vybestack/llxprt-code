# SettingsService Integration Plan

## Overview
The SettingsService is an **ephemeral runtime coordinator** that provides a unified API for all core settings during application runtime. It does NOT persist data itself but coordinates between existing storage systems (ProfileManager, environment variables, Config class).

## Core Principle
**The SettingsService is a runtime state manager, not a storage system.**

## Phase 10: Integration Analysis and Planning
**Goal**: Understand all integration points and create detailed wiring plan

### Tasks:
1. Map all Config class methods to SettingsService equivalents
2. Identify all places that directly access ephemeralSettings
3. Document ProfileManager integration points
4. List all provider-specific settings access
5. Create backward compatibility strategy

### Deliverables:
- Integration map showing all touchpoints
- Compatibility layer design
- Risk assessment for each integration

## Phase 11: Config Class Integration
**Goal**: Wire SettingsService into the existing Config class

### Tasks:
1. Add SettingsService instance to Config class
2. Initialize SettingsService in Config constructor
3. Migrate ephemeralSettings to use SettingsService
4. Update getEphemeralSetting/setEphemeralSetting to delegate to SettingsService
5. Ensure all ephemeral settings changes go through SettingsService

### Key Files:
- `/packages/core/src/config/config.ts`
- `/packages/core/src/config/types.ts`

### Testing:
- Verify existing ephemeral settings still work
- Test that changes trigger SettingsService events
- Ensure backward compatibility

## Phase 12: Provider Settings Integration
**Goal**: Make providers use SettingsService for configuration

### Tasks:
1. Update Provider base class to accept SettingsService
2. Migrate model parameters to SettingsService
3. Move API key management to SettingsService
4. Update base URL configuration to use SettingsService
5. Ensure provider switches update SettingsService

### Key Files:
- `/packages/core/src/providers/BaseProvider.ts`
- `/packages/core/src/providers/*/Provider.ts`
- `/packages/cli/src/ui/commands/providerCommand.ts`

### Testing:
- Test provider switching updates settings correctly
- Verify model parameters persist through provider changes
- Ensure API keys are managed properly

## Phase 13: Profile System Integration
**Goal**: Make ProfileManager work through SettingsService

### Tasks:
1. Update ProfileManager.save() to get settings from SettingsService
2. Update ProfileManager.load() to apply settings through SettingsService
3. Add profile tracking to SettingsService (current profile name)
4. Ensure profile switches update all dependent systems
5. Add profile change events

### Key Files:
- `/packages/core/src/config/profileManager.ts`
- `/packages/cli/src/ui/commands/profileCommand.ts`

### Testing:
- Test profile save captures all settings
- Test profile load applies all settings
- Verify profile switch updates diagnostics correctly

## Phase 14: Diagnostics Command Integration
**Goal**: Make diagnostics pull all data from SettingsService

### Tasks:
1. Update diagnosticsCommand to use SettingsService as primary source
2. Remove direct access to config.getEphemeralSettings()
3. Get provider info through SettingsService
4. Get model parameters through SettingsService
5. Maintain backward compatibility for any missing data

### Key Files:
- `/packages/cli/src/ui/commands/diagnosticsCommand.ts`

### Testing:
- Verify diagnostics shows correct data after profile load
- Test that provider switches reflect immediately
- Ensure all settings categories are displayed

## Phase 15: Command Integration Sweep
**Goal**: Update all commands to use SettingsService

### Tasks:
1. Update keyCommand to use SettingsService for API keys
2. Update modelCommand to use SettingsService for model selection
3. Update setCommand to use SettingsService for ephemeral settings
4. Update authCommand to coordinate with SettingsService
5. Ensure all setting modifications go through SettingsService

### Key Files:
- `/packages/cli/src/ui/commands/keyCommand.ts`
- `/packages/cli/src/ui/commands/modelCommand.ts`
- `/packages/cli/src/ui/commands/setCommand.ts`
- `/packages/cli/src/ui/commands/authCommand.ts`

### Testing:
- Test each command updates SettingsService
- Verify changes are reflected in diagnostics
- Ensure no direct ephemeral settings access remains

## Phase 16: Event System and Notifications
**Goal**: Implement comprehensive change tracking

### Tasks:
1. Add granular event types for different setting categories
2. Implement change history tracking
3. Add validation events before changes
4. Create setting dependency tracking
5. Implement cascade updates for dependent settings

### Deliverables:
- Event flow documentation
- Validation pipeline
- Dependency graph

## Phase 17: Testing and Validation
**Goal**: Comprehensive testing of integrated system

### Tasks:
1. Create integration tests for all setting flows
2. Test profile -> provider -> model -> settings flow
3. Verify all commands work with new system
4. Test backward compatibility
5. Performance testing for setting access

### Test Scenarios:
- Load profile -> switch provider -> check diagnostics
- Change settings -> save profile -> reload -> verify
- Multiple rapid setting changes
- Concurrent access patterns

## Phase 18: Migration and Cleanup
**Goal**: Remove old code and complete migration

### Tasks:
1. Deprecate direct ephemeralSettings access
2. Remove redundant setting storage
3. Update documentation
4. Create migration guide
5. Final cleanup and optimization

### Deliverables:
- Migration guide
- Updated documentation
- Performance metrics

## Implementation Notes

### Critical Integration Points
1. **Config.ephemeralSettings** - Must migrate to SettingsService
2. **ProfileManager save/load** - Must use SettingsService API
3. **Provider model parameters** - Must be managed by SettingsService
4. **Diagnostics command** - Must pull from single source

### Backward Compatibility Requirements
1. Existing Config methods must continue working
2. Profile format must remain compatible
3. Command interfaces must not change
4. Settings files must be readable

### Risk Mitigation
1. Implement behind feature flag initially
2. Keep old code paths during migration
3. Extensive testing at each phase
4. Gradual rollout with monitoring

## Success Criteria
1. All settings accessible through single API
2. No duplicate setting storage
3. Diagnostics shows correct data after profile/provider changes
4. All existing functionality preserved
5. Improved performance and reliability

## Anti-Patterns to Avoid
1. **DO NOT** create new persistence mechanisms
2. **DO NOT** duplicate existing storage
3. **DO NOT** break existing APIs
4. **DO NOT** mix UI settings with core settings
5. **DO NOT** create circular dependencies

This plan ensures the SettingsService becomes the central runtime coordinator for all core settings while respecting existing storage systems and maintaining backward compatibility.