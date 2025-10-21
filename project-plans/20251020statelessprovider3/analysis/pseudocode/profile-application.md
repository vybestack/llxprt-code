/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P02
 * @requirement REQ-SP3-002
 */
1: function loadProfileForRuntime(profileName, runtime, manager):
2:   profile = profileManager.loadProfile(profileName)
3:   requestedProvider = profile.provider
4:   available = manager.listProviders()
5:   targetProvider = chooseAvailableProvider(requestedProvider, available)
6:   if targetProvider != requestedProvider:
7:     warnings.push(`Provider '${requestedProvider}' unavailable, using '${targetProvider}'`)
8:   result = applyProfileSnapshot(runtime, profile, targetProvider)
9:   return { provider: targetProvider, warnings: warnings.concat(result.warnings) }

10: function applyProfileSnapshot(runtime, profile, providerName):
11:   manager = getCliProviderManager()
12:   provider = manager.getProviderByName(providerName)
13:   if provider is null:
14:     warnings.push(`Provider '${providerName}' not registered; skipping tokenized updates`)
15:   setActiveProvider(providerName) // guards internally
16:  setActiveModel(profile.model)
17:  restoreEphemeral('base-url', profile.ephemeralSettings['base-url'])
18:  restoreEphemeral('auth-key', profile.ephemeralSettings['auth-key'])
19:  restoreEphemeral('auth-keyfile', profile.ephemeralSettings['auth-keyfile'])
20:  return { warnings }
