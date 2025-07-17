/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConversationContext,
  IConversationContext,
} from './ConversationContext.js';

describe('ConversationContextManager', () => {
  // Reset the singleton before each test to ensure isolation
  beforeEach(() => {
    ConversationContext.reset();
  });

  it('should initialize with a new context when getContext is called for the first time', () => {
    const context = ConversationContext.getContext();
    expect(context.conversationId).toBeDefined();
    expect(context.conversationId).toMatch(/^conv_/);
    expect(context.parentId).toBeUndefined();
  });

  it('should start a new conversation with a new ID', () => {
    const firstContext = ConversationContext.getContext();
    ConversationContext.startNewConversation();
    const secondContext = ConversationContext.getContext();

    expect(secondContext.conversationId).toBeDefined();
    expect(secondContext.conversationId).not.toEqual(
      firstContext.conversationId,
    );
    expect(secondContext.parentId).toBeUndefined();
  });

  it('should correctly set and retrieve the parentId', () => {
    ConversationContext.startNewConversation(); // Ensure a conversation is active
    const parentId = 'parent_12345';
    ConversationContext.setParentId(parentId);
    const context = ConversationContext.getContext();

    expect(context.parentId).toEqual(parentId);
  });

  it('should correctly restore a full context object', () => {
    const newContext: IConversationContext = {
      conversationId: 'restored_conv_abc',
      parentId: 'restored_parent_def',
    };
    ConversationContext.setContext(newContext);
    const restoredContext = ConversationContext.getContext();

    expect(restoredContext).toEqual(newContext);
  });

  it('should reset the context and start fresh', () => {
    // Set an initial context
    ConversationContext.setContext({
      conversationId: 'initial_conv',
      parentId: 'initial_parent',
    });

    // Reset the context
    ConversationContext.reset();

    // Get the context again, which should trigger a new one to be created
    const freshContext = ConversationContext.getContext();

    expect(freshContext.conversationId).toBeDefined();
    expect(freshContext.conversationId).not.toEqual('initial_conv');
    expect(freshContext.parentId).toBeUndefined();
  });

  it('should not set parentId if no conversation is active (after a reset)', () => {
    ConversationContext.reset();
    ConversationContext.setParentId('should_not_be_set');
    const context = ConversationContext.getContext(); // This will initialize a new context

    expect(context.parentId).toBeUndefined();
  });
});
