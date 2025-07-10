import { IMessage } from '../IMessage.js';

interface CacheEntry {
  conversationId: string;
  parentId: string;
  messages: IMessage[];
  timestamp: number;
  promptTokensAccum: number;
}

export class ConversationCache {
  private cache: Map<string, CacheEntry> = new Map();
  private accessOrder: string[] = [];
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number = 100, ttlHours: number = 2) {
    this.maxSize = maxSize;
    this.ttlMs = ttlHours * 60 * 60 * 1000;
  }

  private generateKey(conversationId: string, parentId: string): string {
    return `${conversationId}:${parentId}`;
  }

  private evictIfNeeded(): void {
    while (this.accessOrder.length > this.maxSize) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
  }

  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.ttlMs;
  }

  set(
    conversationId: string,
    parentId: string,
    messages: IMessage[],
    promptTokensAccum: number = 0,
  ): void {
    const key = this.generateKey(conversationId, parentId);

    const entry: CacheEntry = {
      conversationId,
      parentId,
      messages,
      timestamp: Date.now(),
      promptTokensAccum,
    };

    this.cache.set(key, entry);
    this.updateAccessOrder(key);
    this.evictIfNeeded();
  }

  get(conversationId: string, parentId: string): IMessage[] | null {
    const key = this.generateKey(conversationId, parentId);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      return null;
    }

    this.updateAccessOrder(key);
    return entry.messages;
  }

  has(conversationId: string, parentId: string): boolean {
    const key = this.generateKey(conversationId, parentId);
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      return false;
    }

    return true;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  size(): number {
    return this.cache.size;
  }

  getAccumulatedTokens(conversationId: string, parentId: string): number {
    const key = this.generateKey(conversationId, parentId);
    const entry = this.cache.get(key);

    if (!entry || this.isExpired(entry)) {
      return 0;
    }

    return entry.promptTokensAccum;
  }

  updateTokenCount(
    conversationId: string,
    parentId: string,
    additionalTokens: number,
  ): void {
    const key = this.generateKey(conversationId, parentId);
    const entry = this.cache.get(key);

    if (entry && !this.isExpired(entry)) {
      entry.promptTokensAccum += additionalTokens;
      this.updateAccessOrder(key);
    }
  }

  invalidate(conversationId: string, parentId: string): void {
    const key = this.generateKey(conversationId, parentId);
    this.cache.delete(key);
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }
}
