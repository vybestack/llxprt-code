<!-- @plan:PLAN-20251020-STATELESSPROVIDER3.P02 -->

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P02
 * @requirement REQ-SP3-001
 */
1: function bootstrapCli(args):
2:   parsed = parseEarlyArgs(args) // no provider calls
3:   runtime = createProviderRuntimeContext(parsed.runtimeMetadata)
4:   if runtime is null:
5:     throw BootError('runtime unavailable for stateless provider build')
6:   setActiveProviderRuntimeContext(runtime)
7:   manager, oauth = createProviderManager({ settingsService: runtime.settingsService, config: runtime.config })
8:   if manager is null:
9:     throw BootError('provider manager not initialised')
10:  registerCliProviderInfrastructure(manager, oauth)
11:  if parsed.profileName is not null:
12:    profileResult = loadProfileForRuntime(parsed.profileName, runtime, manager)
13:    if profileResult.error:
14:      logError(profileResult.error)
15:      return { runtimeId: runtime.runtimeId, providerManager: manager, profileLoaded: false }
16:    logWarnings(profileResult.warnings)
17:  return { runtimeId: runtime.runtimeId, providerManager: manager, profileLoaded: parsed.profileName is not null }
