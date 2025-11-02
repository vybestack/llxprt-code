<!-- @plan:PLAN-20251020-STATELESSPROVIDER3.P02 -->

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P02
 * @requirement REQ-SP3-002
 */
1: function loadProfileForRuntime(profileName, runtime, manager):
2:   profile = profileManager.loadProfile(profileName)
3:   if profile is null:
4:     return { error: `Profile '${profileName}' not found`, warnings: [] }
5:   requestedProvider = profile.provider
6:   available = manager.listProviders()
7:   targetProvider = chooseAvailableProvider(requestedProvider, available)
8:   if targetProvider != requestedProvider:
9:     warnings.push(`Provider '${requestedProvider}' unavailable, using '${targetProvider}'`)
10:  result = applyProfileSnapshot(runtime, profile, targetProvider)
11:  return { provider: targetProvider, warnings: warnings.concat(result.warnings) }

12: function applyProfileSnapshot(runtime, profile, providerName):
13:   manager = getCliProviderManager()
14:   provider = manager.getProviderByName(providerName)
15:   if provider is null:
16:     warnings.push(`Provider '${providerName}' not registered; skipping tokenized updates`)
17:   setActiveProvider(providerName) // guards internally for REQ-SP3-002.1
18:   setActiveModel(profile.model)
19:   restoreEphemeralIfPresent('base-url', profile.ephemeralSettings['base-url'])
20:   restoreEphemeralIfPresent('auth-key', profile.ephemeralSettings['auth-key'])
21:   restoreEphemeralIfPresent('auth-keyfile', profile.ephemeralSettings['auth-keyfile'])
22:   return { warnings }
