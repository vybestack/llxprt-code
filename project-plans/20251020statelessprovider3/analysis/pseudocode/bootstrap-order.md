/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P02
 * @requirement REQ-SP3-001
 */
1: function bootstrapCli(args):
2:   parsed = parseEarlyArgs(args) // no provider calls
3:   runtime = createProviderRuntimeContext(parsed.runtimeMetadata)
4:   setActiveProviderRuntimeContext(runtime)
5:   manager, oauth = createProviderManager({ settingsService: runtime.settingsService, config: runtime.config })
6:   registerCliProviderInfrastructure(manager, oauth)
7:   if parsed.profileName is not null:
8:     profileResult = loadProfileForRuntime(parsed.profileName, runtime, manager)
9:     logWarnings(profileResult.warnings)
10:  return { runtimeId: runtime.runtimeId, providerManager: manager }
