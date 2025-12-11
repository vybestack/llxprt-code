import { type IContent } from '../../services/history/IContent.js';

interface CacheEntry {
  conversationId: string;
  parentId: string;
  messages: IContent[];
  timestamp: number;
  promptTokensAccum: number;
}

interface CacheScopeState {
  cache: Map<string, CacheEntry>;
  accessOrder: string[];
}

export class ConversationCache {
  private static readonly scopes: Map<string | symbol, CacheScopeState> =
    new Map();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly scopeKey: string | symbol;

  constructor(
    maxSize: number = 100,
    ttlHours: number = 2,
    scopeKey?: string | symbol,
  ) {
    this.maxSize = maxSize;
    this.ttlMs = ttlHours * 60 * 60 * 1000;
    this.scopeKey =
      typeof scopeKey === 'string' && scopeKey.trim() !== ''
        ? scopeKey.trim()
        : (scopeKey ?? Symbol('conversation-cache-scope'));
  }

  private getOrCreateScope(): CacheScopeState {
    let scope = ConversationCache.scopes.get(this.scopeKey);
    if (!scope) {
      scope = { cache: new Map(), accessOrder: [] };
      ConversationCache.scopes.set(this.scopeKey, scope);
    }
    return scope;
  }

  private peekScope(): CacheScopeState | undefined {
    return ConversationCache.scopes.get(this.scopeKey);
  }

  private generateKey(conversationId: string, parentId: string): string {
    return `${conversationId}:${parentId}`;
  }

  private evictIfNeeded(scope: CacheScopeState): void {
    while (scope.accessOrder.length > this.maxSize) {
      const oldestKey = scope.accessOrder.shift();
      if (oldestKey) {
        scope.cache.delete(oldestKey);
      }
    }
  }

  private updateAccessOrder(scope: CacheScopeState, key: string): void {
    const index = scope.accessOrder.indexOf(key);
    if (index > -1) {
      scope.accessOrder.splice(index, 1);
    }
    scope.accessOrder.push(key);
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.ttlMs;
  }

  set(
    conversationId: string,
    parentId: string,
    messages: IContent[],
    promptTokensAccum: number = 0,
  ): void {
    const scope = this.getOrCreateScope();
    const key = this.generateKey(conversationId, parentId);

    const entry: CacheEntry = {
      conversationId,
      parentId,
      messages,
      timestamp: Date.now(),
      promptTokensAccum,
    };

    scope.cache.set(key, entry);
    this.updateAccessOrder(scope, key);
    this.evictIfNeeded(scope);
  }

  get(conversationId: string, parentId: string): IContent[] | null {
    const scope = this.peekScope();
    if (!scope) {
      return null;
    }

    const key = this.generateKey(conversationId, parentId);
    const entry = scope.cache.get(key);

    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      scope.cache.delete(key);
      const index = scope.accessOrder.indexOf(key);
      if (index > -1) {
        scope.accessOrder.splice(index, 1);
      }
      if (scope.cache.size === 0) {
        ConversationCache.scopes.delete(this.scopeKey);
      }
      return null;
    }

    this.updateAccessOrder(scope, key);
    return entry.messages;
  }

  has(conversationId: string, parentId: string): boolean {
    const scope = this.peekScope();
    if (!scope) {
      return false;
    }

    const key = this.generateKey(conversationId, parentId);
    const entry = scope.cache.get(key);

    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      scope.cache.delete(key);
      const index = scope.accessOrder.indexOf(key);
      if (index > -1) {
        scope.accessOrder.splice(index, 1);
      }
      if (scope.cache.size === 0) {
        ConversationCache.scopes.delete(this.scopeKey);
      }
      return false;
    }

    return true;
  }

  clear(): void {
    const scope = this.peekScope();
    if (!scope) {
      return;
    }
    scope.cache.clear();
    scope.accessOrder.length = 0;
    ConversationCache.scopes.delete(this.scopeKey);
  }

  size(): number {
    const scope = this.peekScope();
    return scope ? scope.cache.size : 0;
  }

  getAccumulatedTokens(conversationId: string, parentId: string): number {
    const scope = this.peekScope();
    if (!scope) {
      return 0;
    }

    const key = this.generateKey(conversationId, parentId);
    const entry = scope.cache.get(key);

    if (!entry || this.isExpired(entry)) {
      if (entry) {
        scope.cache.delete(key);
        const index = scope.accessOrder.indexOf(key);
        if (index > -1) {
          scope.accessOrder.splice(index, 1);
        }
        if (scope.cache.size === 0) {
          ConversationCache.scopes.delete(this.scopeKey);
        }
      }
      return 0;
    }

    return entry.promptTokensAccum;
  }

  updateTokenCount(
    conversationId: string,
    parentId: string,
    additionalTokens: number,
  ): void {
    const scope = this.peekScope();
    if (!scope) {
      return;
    }

    const key = this.generateKey(conversationId, parentId);
    const entry = scope.cache.get(key);

    if (entry && !this.isExpired(entry)) {
      entry.promptTokensAccum += additionalTokens;
      this.updateAccessOrder(scope, key);
    }
  }

  invalidate(conversationId: string, parentId: string): void {
    const scope = this.peekScope();
    if (!scope) {
      return;
    }

    const key = this.generateKey(conversationId, parentId);
    scope.cache.delete(key);
    const index = scope.accessOrder.indexOf(key);
    if (index > -1) {
      scope.accessOrder.splice(index, 1);
    }
    if (scope.cache.size === 0) {
      ConversationCache.scopes.delete(this.scopeKey);
    }
  }
}
