/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { randomBytes } from 'crypto';

export interface IConversationContext {
  conversationId?: string;
  parentId?: string;
}

/**
 * Manages the state of the active conversation context for the CLI session.
 * This is a singleton that holds the current conversationId and parentId.
 */
class ConversationContextManager {
  private context: IConversationContext = {};

  /**
   * Generates a new, random conversation ID.
   */
  private generateConversationId(): string {
    return `conv_${randomBytes(16).toString('hex')}`;
  }

  /**
   * Starts a new conversation, generating a new ID and clearing the parent ID.
   */
  startNewConversation(): void {
    this.context = {
      conversationId: this.generateConversationId(),
      parentId: undefined,
    };
    if (process.env.DEBUG) {
      console.log(
        `[ConversationContext] Started new conversation: ${this.context.conversationId}`,
      );
    }
  }

  /**
   * Retrieves the current conversation context.
   * If no conversation is active, it starts a new one.
   */
  getContext(): IConversationContext {
    if (!this.context.conversationId) {
      this.startNewConversation();
    }
    return this.context;
  }

  /**
   * Updates the parent ID for the next turn in the conversation.
   * @param newParentId The ID of the most recent message, which becomes the parent for the next message.
   */
  setParentId(newParentId: string): void {
    if (this.context.conversationId) {
      this.context.parentId = newParentId;
      if (process.env.DEBUG) {
        console.log(`[ConversationContext] Set parentId to: ${newParentId}`);
      }
    } else {
      console.warn(
        '[ConversationContext] Cannot set parentId without an active conversation.',
      );
    }
  }

  /**
   * Restores the full conversation context, e.g., when loading a session.
   * @param newContext The full context to restore.
   */
  setContext(newContext: IConversationContext): void {
    this.context = newContext;
    if (process.env.DEBUG) {
      console.log(
        `[ConversationContext] Restored context: convId=${newContext.conversationId}, parentId=${newContext.parentId}`,
      );
    }
  }

  /**
   * Clears the current conversation context.
   */
  reset(): void {
    this.context = {};
  }
}

// Export a singleton instance.
export const ConversationContext = new ConversationContextManager();
