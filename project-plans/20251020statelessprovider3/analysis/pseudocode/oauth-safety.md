<!-- @plan:PLAN-20251020-STATELESSPROVIDER3.P02 -->

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P02
 * @requirement REQ-SP3-003
 */
1: function clearProviderAuthCaches(providerName):
2:   manager = getCliProviderManager()
3:   provider = manager.getProviderByName(providerName)
4:   if provider is null:
5:     debug(`Provider ${providerName} not registered; skipping auth cache clear`)
6:     return
7:   base = unwrapLoggingProvider(provider)
8:   try:
9:     if hasMethod(base, 'clearAuthCache'):
10:      base.clearAuthCache()
11:     if hasProperty(base, '_cachedAuthKey'):
12:      base._cachedAuthKey = undefined
13:     if hasMethod(base, 'clearState'):
14:      base.clearState()
15:   catch error:
16:     logWarning(`OAuth cache clear failed for ${providerName}: ${error.message}`)

17: function unwrapLoggingProvider(maybeWrapped):
18:   if hasProperty(maybeWrapped, 'wrappedProvider'):
19:     return unwrapLoggingProvider(maybeWrapped.wrappedProvider)
20:   return maybeWrapped
