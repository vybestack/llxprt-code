/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ConversationManager - Gemini-specific conversation/history recording layer.
 *
 * This class wraps HistoryService with geminiChat-specific recording logic,
 * handling Content→IContent conversion, thinking block attachment, usage
 * metadata injection, and model output consolidation.
 */

import type { Content } from '@google/genai';
import type { AgentRuntimeContext } from '../runtime/AgentRuntimeContext.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import type {
  IContent,
  ThinkingBlock,
  UsageStats,
} from '../services/history/IContent.js';
import type { CompletedToolCall } from './coreToolScheduler.js';
import { isFunctionResponse } from '../utils/messageInspectors.js';
import { isThoughtPart } from './geminiChatTypes.js';
import {
  extractCuratedHistory,
  hasTextContent,
  validateHistory,
} from './MessageConverter.js';

/**
 * ConversationManager handles conversation history management for GeminiChat.
 * It provides methods for recording turns, converting Content to IContent,
 * and managing conversation state.
 */
export class ConversationManager {
  private readonly historyService: HistoryService;
  private readonly runtimeContext: AgentRuntimeContext;
  private readonly model: string;

  constructor(
    historyService: HistoryService,
    runtimeContext: AgentRuntimeContext,
    model: string,
  ) {
    this.historyService = historyService;
    this.runtimeContext = runtimeContext;
    this.model = model;
  }

  /**
   * Get the underlying HistoryService instance
   */
  getHistoryService(): HistoryService {
    return this.historyService;
  }

  /**
   * Creates a position-based matcher for Gemini tool responses.
   * Returns a function that matches tool responses to their calls, or undefined
   * if there are no unmatched tool calls.
   */
  makePositionMatcher():
    | (() => { historyId: string; toolName?: string })
    | undefined {
    const queue = this.historyService
      .findUnmatchedToolCalls()
      .map((b) => ({ historyId: b.id, toolName: b.name }));

    // Return undefined if there are no unmatched tool calls
    if (queue.length === 0) {
      return undefined;
    }

    // Return a function that always returns a valid value (never undefined)
    return () => {
      const result = queue.shift();
      // If queue is empty, return a fallback value
      return result || { historyId: '', toolName: undefined };
    };
  }

  /**
   * Converts user input (Content or Content[]) to IContent[] for history.
   * This consolidates the Content→IContent conversion pattern used in:
   * - Constructor initial history import
   * - sendMessage pre-send
   * - sendMessageStream pre-send
   *
   * These all share the same semantics: model + matcher/idGen.
   */
  convertUserInputToIContents(userContent: Content | Content[]): IContent[] {
    const contents = Array.isArray(userContent) ? userContent : [userContent];
    return contents.map((content) => {
      const turnKey = this.historyService.generateTurnKey();
      const idGen = this.historyService.getIdGeneratorCallback(turnKey);
      const matcher = this.makePositionMatcher();
      return ContentConverters.toIContent(content, idGen, matcher, turnKey);
    });
  }

  /**
   * Imports initial history during GeminiChat construction.
   * Validates the history and converts each Content to IContent before adding.
   * Called from GeminiChat constructor after ConversationManager is created.
   */
  importInitialHistory(initialHistory: Content[], model: string): void {
    if (initialHistory.length === 0) {
      return;
    }

    // Validate before importing
    validateHistory(initialHistory);

    // Convert and add each entry
    for (const content of initialHistory) {
      const turnKey = this.historyService.generateTurnKey();
      const idGen = this.historyService.getIdGeneratorCallback(turnKey);
      const matcher = this.makePositionMatcher();
      this.historyService.add(
        ContentConverters.toIContent(content, idGen, matcher, turnKey),
        model,
      );
    }
  }

  /**
   * Records a completed conversation turn to history.
   * This is the main orchestrator that handles both user and model turns.
   *
   * @param userInput - User's input (Content or Content[] for paired tool call/response)
   * @param modelOutput - Model's output Content array
   * @param automaticFunctionCallingHistory - Optional AFC history from Gemini SDK
   * @param usageMetadata - Optional usage statistics
   */
  recordHistory(
    userInput: Content | Content[],
    modelOutput: Content[],
    automaticFunctionCallingHistory?: Content[],
    usageMetadata?: UsageStats | null,
  ): void {
    const newHistoryEntries: IContent[] = [];

    // Capture user input characteristics for model turn logic
    const userInputWasArray = Array.isArray(userInput);
    const userInputWasFunctionResponse =
      !userInputWasArray && isFunctionResponse(userInput);
    const hasAfc = !!(
      automaticFunctionCallingHistory &&
      automaticFunctionCallingHistory.length > 0
    );

    // Record user turn
    this._recordUserTurn(
      userInput,
      automaticFunctionCallingHistory,
      newHistoryEntries,
    );

    // Record model turn
    this._recordModelTurn(
      modelOutput,
      usageMetadata,
      newHistoryEntries,
      userInputWasArray,
      userInputWasFunctionResponse,
      hasAfc,
    );

    // Add all entries to history service
    for (const entry of newHistoryEntries) {
      this.historyService.add(entry, this.model);
    }
  }

  /**
   * Handles user Content → IContent conversion, including AFC and paired
   * tool call/response scenarios.
   *
   * Mutates newHistoryEntries by appending user turn entries.
   */
  private _recordUserTurn(
    userInput: Content | Content[],
    automaticFunctionCallingHistory: Content[] | undefined,
    newHistoryEntries: IContent[],
  ): void {
    if (
      automaticFunctionCallingHistory &&
      automaticFunctionCallingHistory.length > 0
    ) {
      // AFC branch: extract curated history
      const curatedAfc = extractCuratedHistory(automaticFunctionCallingHistory);
      for (const content of curatedAfc) {
        const turnKey = this.historyService.generateTurnKey();
        newHistoryEntries.push(
          ContentConverters.toIContent(content, undefined, undefined, turnKey),
        );
      }
    } else {
      // Handle both single Content and Content[] (for paired tool call/response)
      if (Array.isArray(userInput)) {
        // This is a paired tool call/response from the executor
        // Add each part to history
        for (const content of userInput) {
          const turnKey = this.historyService.generateTurnKey();
          const idGen = this.historyService.getIdGeneratorCallback(turnKey);
          const matcher = this.makePositionMatcher();
          const userIContent = ContentConverters.toIContent(
            content,
            idGen,
            matcher,
            turnKey,
          );
          newHistoryEntries.push(userIContent);
        }
      } else {
        // Normal user message
        const turnKey = this.historyService.generateTurnKey();
        const idGen = this.historyService.getIdGeneratorCallback(turnKey);
        const matcher = this.makePositionMatcher();
        const userIContent = ContentConverters.toIContent(
          userInput,
          idGen,
          matcher,
          turnKey,
        );
        newHistoryEntries.push(userIContent);
      }
    }
  }

  /**
   * Handles model output filtering, thinking block attachment, consolidation,
   * and usage metadata injection.
   *
   * Mutates newHistoryEntries by appending model turn entries.
   */
  private _recordModelTurn(
    modelOutput: Content[],
    usageMetadata: UsageStats | null | undefined,
    newHistoryEntries: IContent[],
    userInputWasArray: boolean,
    userInputWasFunctionResponse: boolean,
    hasAfc: boolean,
  ): void {
    // Filter out thoughts based on reasoning configuration
    const includeThoughtsInHistory =
      this.runtimeContext.ephemerals.reasoning.includeInContext();

    const nonThoughtModelOutput = modelOutput
      .map((content) => ({
        ...content,
        parts: (content.parts ?? []).filter((part) => !isThoughtPart(part)),
      }))
      .filter((content) => (content.parts?.length ?? 0) > 0);

    // Extract thinking blocks if needed
    const thoughtBlocks: ThinkingBlock[] = includeThoughtsInHistory
      ? modelOutput
          .flatMap((content) => content.parts ?? [])
          .filter(isThoughtPart)
          .map(
            (part): ThinkingBlock => ({
              type: 'thinking',
              thought: (part.text ?? '').trim(),
              sourceField: part.llxprtSourceField ?? 'thought',
              signature: part.thoughtSignature,
            }),
          )
          .filter((block) => block.thought.length > 0)
      : [];

    // Determine output contents
    let outputContents: Content[] = [];
    if (nonThoughtModelOutput.length > 0) {
      outputContents = nonThoughtModelOutput;
    } else if (
      modelOutput.length === 0 &&
      !userInputWasArray &&
      !userInputWasFunctionResponse &&
      !hasAfc
    ) {
      // Add an empty model response if the model truly returned nothing
      outputContents.push({ role: 'model', parts: [] } as Content);
    }

    if (outputContents.length === 0 && thoughtBlocks.length > 0) {
      outputContents = [{ role: 'model', parts: [] } as Content];
    }

    // Consolidate model response parts
    const consolidatedOutputContents =
      this._consolidateModelOutput(outputContents);

    // Add consolidated output to new history with thinking blocks
    this._addModelOutputToHistory(
      consolidatedOutputContents,
      thoughtBlocks,
      usageMetadata,
      newHistoryEntries,
    );
  }

  /**
   * Consolidates the parts of a model's turn response.
   * Merges adjacent text content to avoid fragmentation.
   */
  private _consolidateModelOutput(outputContents: Content[]): Content[] {
    const consolidatedOutputContents: Content[] = [];

    if (outputContents.length > 0) {
      for (const content of outputContents) {
        const lastContent =
          consolidatedOutputContents[consolidatedOutputContents.length - 1];
        if (hasTextContent(lastContent) && hasTextContent(content)) {
          lastContent.parts[0].text += content.parts[0].text || '';
          if (content.parts.length > 1) {
            lastContent.parts.push(...content.parts.slice(1));
          }
        } else {
          consolidatedOutputContents.push(content);
        }
      }
    }

    return consolidatedOutputContents;
  }

  /**
   * Adds consolidated model output to history with thinking blocks and usage metadata.
   * Attaches thinking blocks to the first model entry and ensures proper metadata.
   */
  private _addModelOutputToHistory(
    consolidatedOutputContents: Content[],
    thoughtBlocks: ThinkingBlock[],
    usageMetadata: UsageStats | null | undefined,
    newHistoryEntries: IContent[],
  ): void {
    let didAttachThoughtBlocks = false;

    for (const content of consolidatedOutputContents) {
      const turnKey = this.historyService.generateTurnKey();
      const iContent = ContentConverters.toIContent(
        content,
        undefined,
        undefined,
        turnKey,
      );

      // Attach thinking blocks to first model entry
      if (thoughtBlocks.length > 0 && !didAttachThoughtBlocks) {
        iContent.blocks = [...thoughtBlocks, ...iContent.blocks];
        didAttachThoughtBlocks = true;
      }

      // Add usage metadata if available
      if (usageMetadata) {
        iContent.metadata = {
          ...iContent.metadata,
          usage: usageMetadata,
        };
      }

      newHistoryEntries.push(iContent);
    }

    // If we have thinking blocks but nowhere to attach them, create standalone entry
    if (thoughtBlocks.length > 0 && !didAttachThoughtBlocks) {
      const turnKey = this.historyService.generateTurnKey();
      const iContent: IContent = {
        speaker: 'ai',
        blocks: thoughtBlocks,
        metadata: { turnId: turnKey },
      };
      if (usageMetadata) {
        iContent.metadata = {
          ...iContent.metadata,
          usage: usageMetadata,
        };
      }
      newHistoryEntries.push(iContent);
    }
  }

  /**
   * Gets the conversation history in Gemini Content format.
   * @param curated - If true, returns curated history; otherwise returns all history
   */
  getHistory(curated: boolean = false): Content[] {
    // Get history from HistoryService in IContent format
    const iContents = curated
      ? this.historyService.getCurated()
      : this.historyService.getAll();

    // Convert to Gemini Content format
    const contents = ContentConverters.toGeminiContents(iContents);

    // Deep copy the history to avoid mutating the history outside of the
    // chat session.
    return structuredClone(contents);
  }

  /**
   * Clears the chat history.
   */
  clearHistory(): void {
    this.historyService.clear();
  }

  /**
   * Adds a new entry to the chat history.
   */
  addHistory(content: Content): void {
    const turnKey = this.historyService.generateTurnKey();
    this.historyService.add(
      ContentConverters.toIContent(content, undefined, undefined, turnKey),
      this.model,
    );
  }

  /**
   * Sets the full chat history, replacing any existing history.
   */
  setHistory(history: Content[]): void {
    this.historyService.clear();
    for (const content of history) {
      const turnKey = this.historyService.generateTurnKey();
      this.historyService.add(
        ContentConverters.toIContent(content, undefined, undefined, turnKey),
        this.model,
      );
    }
  }

  /**
   * Compatibility stub for tool call recording.
   * This is a no-op maintained for backward compatibility.
   */
  recordCompletedToolCalls(
    _model: string,
    _toolCalls: CompletedToolCall[],
  ): void {
    // No-op stub for compatibility
  }
}
