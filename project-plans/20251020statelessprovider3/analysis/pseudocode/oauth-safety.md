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
8:   if hasMethod(base, 'clearAuthCache'):
9:     base.clearAuthCache()
10:  if hasProperty(base, '_cachedAuthKey'):
11:    base._cachedAuthKey = undefined
12:  if hasMethod(base, 'clearState'):
13:    base.clearState()

14: function unwrapLoggingProvider(maybeWrapped):
15:   if hasProperty(maybeWrapped, 'wrappedProvider'):
16:     return unwrapLoggingProvider(maybeWrapped.wrappedProvider)
17:   return maybeWrapped
