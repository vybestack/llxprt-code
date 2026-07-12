/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ConversationManager - Gemini-specific conversation/history recording layer.
 *
 * This class wraps HistoryService with chatSession-specific recording logic,
 * handling Content→IContent conversion, thinking block attachment, usage
 * metadata injection, and model output consolidation.
 */

import { isDeepStrictEqual } from 'node:util';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ThinkingBlock,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { stampAiTurnModel } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompletedToolCall } from './coreToolScheduler.js';
import { validateHistory } from './MessageConverter.js';

/**
 * Consolidate adjacent `TextBlock`s at the front of `lastContent.blocks`
 * with the leading `TextBlock`(s) of `incoming.blocks`. When both leading
 * blocks are text, their text is concatenated and the remaining blocks of
 * `incoming` are appended. No `.parts` mutation — operates purely on the
 * neutral `ContentBlock[]` representation.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.1
 * @pseudocode lines 28-31
 */
function appendTextContentBlocks(
  lastContent: IContent,
  incoming: IContent,
): void {
  const lastBlocks = lastContent.blocks;
  const incomingBlocks = incoming.blocks;
  if (
    lastBlocks.length > 0 &&
    lastBlocks[0].type === 'text' &&
    incomingBlocks.length > 0 &&
    incomingBlocks[0].type === 'text'
  ) {
    const lastText = lastBlocks[0] as { type: 'text'; text: string };
    const incomingText = incomingBlocks[0] as { type: 'text'; text: string };
    lastText.text += incomingText.text;
    if (incomingBlocks.length > 1) {
      lastContent.blocks = [...lastBlocks, ...incomingBlocks.slice(1)];
    }
    return;
  }
  lastContent.blocks = [...lastBlocks, ...incomingBlocks];
}

/**
 * Block-based test: does the IContent's first block carry non-empty text?
 * Replaces the legacy `hasTextContent(content)` which tested `.parts[0].text`.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.1
 * @pseudocode lines 28-31
 */
function hasLeadingTextBlock(content: IContent | undefined): boolean {
  if (!content || content.blocks.length === 0) {
    return false;
  }
  const first = content.blocks[0];
  return first.type === 'text' && first.text !== '';
}

/**
 * ConversationManager handles conversation history management for ChatSession.
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
   * Stamps turnKey metadata onto an IContent for history recording.
   * The idGen and matcher are carried for future tool-call ID canonicalization
   * but are not applied to already-neutral blocks.
   */
  private stampHistoryIds(
    content: IContent,
    _idGen: (() => string) | undefined,
    _matcher: (() => { historyId: string; toolName?: string }) | undefined,
    turnKey: string,
  ): IContent {
    return {
      ...content,
      metadata: { ...content.metadata, turnId: turnKey },
    };
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
      return result ?? { historyId: '', toolName: undefined };
    };
  }

  /**
   * Converts user input (IContent or IContent[]) to IContent[] for history.
   * Ensures each turn gets a proper turnKey and tool-call ID generation.
   */
  convertUserInputToIContents(userContent: IContent | IContent[]): IContent[] {
    const contents = Array.isArray(userContent) ? userContent : [userContent];
    const matcher = this.makePositionMatcher();
    return contents.map((content) => {
      const turnKey = this.historyService.generateTurnKey();
      const idGen = this.historyService.getIdGeneratorCallback(turnKey);
      return this.stampHistoryIds(content, idGen, matcher, turnKey);
    });
  }

  /**
   * Imports initial history during ChatSession construction.
   * Validates the history and converts each IContent before adding.
   * Called from ChatSession constructor after ConversationManager is created.
   */
  importInitialHistory(initialHistory: IContent[], model: string): void {
    if (initialHistory.length === 0) {
      return;
    }

    // Validate before importing
    validateHistory(initialHistory);

    // Add each entry
    const matcher = this.makePositionMatcher();
    for (const content of initialHistory) {
      const turnKey = this.historyService.generateTurnKey();
      const idGen = this.historyService.getIdGeneratorCallback(turnKey);
      this.historyService.add(
        this.stampHistoryIds(content, idGen, matcher, turnKey),
        model,
      );
    }
  }

  /**
   * Records a completed conversation turn to history.
   * This is the main orchestrator that handles both user and model turns.
   *
   * @param userInput - User's input (IContent or IContent[] for paired tool call/response)
   * @param modelOutput - Model's output IContent array
   * @param automaticFunctionCallingHistory - Optional AFC history
   * @param usageMetadata - Optional usage statistics
   * @param options - Optional overrides for user-input characteristics when the
   *   recorded `userInput` has been filtered/transformed and no longer reflects
   *   the original input shape (for example after eagerly recorded tool
   *   responses are removed before history finalization).
   */
  recordHistory(
    userInput: IContent | IContent[],
    modelOutput: IContent[],
    automaticFunctionCallingHistory?: IContent[],
    usageMetadata?: UsageStats | null,
    options?: {
      userInputWasArray?: boolean;
      userInputWasFunctionResponse?: boolean;
    },
  ): void {
    const newHistoryEntries: IContent[] = [];

    const userContent: IContent | IContent[] = userInput;

    // Capture user input characteristics for model turn logic
    const userInputWasArray =
      options?.userInputWasArray ?? Array.isArray(userInput);
    const singleUserInput =
      !userInputWasArray && !Array.isArray(userInput) ? userInput : undefined;
    const userInputWasFunctionResponse =
      options?.userInputWasFunctionResponse ??
      singleUserInput?.blocks.some(
        (block) => block.type === 'tool_response',
      ) === true;
    const hasAfc = !!(
      automaticFunctionCallingHistory &&
      automaticFunctionCallingHistory.length > 0
    );

    // Record user turn
    this._recordUserTurn(
      userContent,
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
   * Handles user IContent → history recording, including AFC and paired
   * tool call/response scenarios.
   *
   * Mutates newHistoryEntries by appending user turn entries.
   */
  private _recordUserTurn(
    userInput: IContent | IContent[],
    automaticFunctionCallingHistory: IContent[] | undefined,
    newHistoryEntries: IContent[],
  ): void {
    if (
      automaticFunctionCallingHistory &&
      automaticFunctionCallingHistory.length > 0
    ) {
      // Provider AFC history may repeat turns already recorded locally. Compare
      // stable semantic content so generated metadata does not defeat deduping.
      const existingHistory = this.historyService.getCurated();
      let matchingPrefixLength = 0;
      while (
        matchingPrefixLength < existingHistory.length &&
        matchingPrefixLength < automaticFunctionCallingHistory.length &&
        existingHistory[matchingPrefixLength].speaker ===
          automaticFunctionCallingHistory[matchingPrefixLength].speaker &&
        isDeepStrictEqual(
          existingHistory[matchingPrefixLength].blocks,
          automaticFunctionCallingHistory[matchingPrefixLength].blocks,
        )
      ) {
        matchingPrefixLength += 1;
      }
      for (const content of automaticFunctionCallingHistory.slice(
        matchingPrefixLength,
      )) {
        newHistoryEntries.push(stampAiTurnModel(content, this.model));
      }
    } else {
      const matcher = this.makePositionMatcher();
      // Handle both single IContent and IContent[] (for paired tool call/response)
      if (Array.isArray(userInput)) {
        // This is a paired tool call/response from the executor
        // Add each entry to history
        for (const content of userInput) {
          const turnKey = this.historyService.generateTurnKey();
          const idGen = this.historyService.getIdGeneratorCallback(turnKey);
          const userIContent = this.stampHistoryIds(
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
        const userIContent = this.stampHistoryIds(
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
   * Block-based reimplementation (P15): converts the `Content[]` model output
   * to `IContent` early, then filters `ThinkingBlock`s and consolidates
   * adjacent `TextBlock`s on the neutral blocks representation — no `.parts`
   * mutation.
   *
   * Mutates newHistoryEntries by appending model turn entries.
   *
   * @plan:PLAN-20260707-AGENTNEUTRAL.P15
   * @requirement:REQ-005.1
   * @pseudocode lines 28-31
   */
  private _recordModelTurn(
    modelOutput: IContent[],
    usageMetadata: UsageStats | null | undefined,
    newHistoryEntries: IContent[],
    userInputWasArray: boolean,
    userInputWasFunctionResponse: boolean,
    hasAfc: boolean,
  ): void {
    // Filter out thoughts based on reasoning configuration
    const includeThoughtsInHistory =
      this.runtimeContext.ephemerals.reasoning.includeInContext();

    // Model output is already neutral IContent[] — operate on neutral
    // ContentBlock[] throughout (no .parts mutation).
    const allModelIContents: IContent[] = modelOutput;

    // Extract thinking blocks from the neutral blocks (BR-5: drop thought text
    // when includeInContext is false; keep thinking blocks when true).
    const thoughtBlocks: ThinkingBlock[] = includeThoughtsInHistory
      ? allModelIContents
          .flatMap((ic) => ic.blocks)
          .filter((block): block is ThinkingBlock => block.type === 'thinking')
          .filter((block) => block.thought.trim().length > 0)
      : [];

    // Filter thinking blocks out of the non-thought model output blocks.
    const nonThoughtIContents: IContent[] = allModelIContents
      .map((ic) => ({
        ...ic,
        blocks: ic.blocks.filter((block) => block.type !== 'thinking'),
      }))
      .filter((ic) => ic.blocks.length > 0);

    // Determine output IContents
    let outputIContents: IContent[] = [];
    if (nonThoughtIContents.length > 0) {
      outputIContents = nonThoughtIContents;
    } else if (
      modelOutput.length === 0 &&
      !userInputWasArray &&
      !userInputWasFunctionResponse &&
      !hasAfc
    ) {
      // Add an empty model response if the model truly returned nothing
      outputIContents.push({ speaker: 'ai', blocks: [] });
    }

    if (outputIContents.length === 0 && thoughtBlocks.length > 0) {
      outputIContents = [{ speaker: 'ai', blocks: [] }];
    }

    // Consolidate adjacent TextBlock content across model IContents
    const consolidatedIContents = this._consolidateModelOutput(outputIContents);

    // Add consolidated output to new history with thinking blocks
    this._addModelOutputToHistory(
      consolidatedIContents,
      thoughtBlocks,
      usageMetadata,
      newHistoryEntries,
    );
  }

  /**
   * Consolidates adjacent text blocks across model turn IContents.
   * Merges adjacent `TextBlock`-leading IContents to avoid fragmentation.
   *
   * Block-based reimplementation (P15) — replaces the legacy `.parts`-based
   * consolidation.
   *
   * @plan:PLAN-20260707-AGENTNEUTRAL.P15
   * @requirement:REQ-005.1
   * @pseudocode lines 28-31
   */
  private _consolidateModelOutput(outputIContents: IContent[]): IContent[] {
    const consolidated: IContent[] = [];

    if (outputIContents.length > 0) {
      for (const ic of outputIContents) {
        const lastContent = consolidated[consolidated.length - 1];
        if (hasLeadingTextBlock(lastContent) && hasLeadingTextBlock(ic)) {
          appendTextContentBlocks(lastContent, ic);
        } else {
          consolidated.push(ic);
        }
      }
    }

    return consolidated;
  }

  /**
   * Adds consolidated model output IContents to history with thinking blocks
   * and usage metadata. Attaches thinking blocks to the first model entry
   * and ensures proper metadata.
   *
   * Block-based reimplementation (P15) — takes neutral `IContent[]` directly
   * instead of re-converting from `Content[]`.
   *
   * @plan:PLAN-20260707-AGENTNEUTRAL.P15
   * @requirement:REQ-005.1
   * @pseudocode lines 28-31
   */
  private _addModelOutputToHistory(
    consolidatedIContents: IContent[],
    thoughtBlocks: ThinkingBlock[],
    usageMetadata: UsageStats | null | undefined,
    newHistoryEntries: IContent[],
  ): void {
    let didAttachThoughtBlocks = false;

    for (const ic of consolidatedIContents) {
      const turnKey = this.historyService.generateTurnKey();
      const iContent: IContent = {
        speaker: 'ai',
        blocks: ic.blocks,
        metadata: { turnId: turnKey },
      };

      // Attach thinking blocks to first model entry
      if (thoughtBlocks.length > 0 && !didAttachThoughtBlocks) {
        iContent.blocks = [...thoughtBlocks, ...iContent.blocks];
        didAttachThoughtBlocks = true;
      }

      // Add usage metadata if available
      if (usageMetadata !== undefined && usageMetadata !== null) {
        iContent.metadata = {
          ...iContent.metadata,
          usage: usageMetadata,
        };
      }

      // Stamp the generating model so downstream consumers can detect
      // cross-model turns (issue #2335). this.model is the model that produced
      // this output; on a model switch the ChatSession/ConversationManager is
      // rebuilt with the new model while HistoryService is reused.
      newHistoryEntries.push(stampAiTurnModel(iContent, this.model));
    }

    // If we have thinking blocks but nowhere to attach them, create standalone entry
    if (thoughtBlocks.length > 0 && !didAttachThoughtBlocks) {
      const turnKey = this.historyService.generateTurnKey();
      const iContent: IContent = {
        speaker: 'ai',
        blocks: thoughtBlocks,
        metadata: { turnId: turnKey },
      };
      if (usageMetadata !== undefined && usageMetadata !== null) {
        iContent.metadata = {
          ...iContent.metadata,
          usage: usageMetadata,
        };
      }
      newHistoryEntries.push(stampAiTurnModel(iContent, this.model));
    }
  }

  /**
   * Gets the conversation history in neutral IContent format.
   * @param curated - If true, returns curated history; otherwise returns all history
   */
  getHistory(curated: boolean = false): IContent[] {
    // Get history from HistoryService in IContent format (already neutral)
    const iContents = curated
      ? this.historyService.getCurated()
      : this.historyService.getAll();

    // Deep copy the history to avoid mutating the history outside of the
    // chat session.
    return structuredClone(iContents);
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
  addHistory(content: IContent): void {
    const turnKey = this.historyService.generateTurnKey();
    this.historyService.add(
      { ...content, metadata: { ...content.metadata, turnId: turnKey } },
      this.model,
    );
  }

  /**
   * Sets the full chat history, replacing any existing history.
   */
  setHistory(history: IContent[]): void {
    this.historyService.clear();
    for (const content of history) {
      const turnKey = this.historyService.generateTurnKey();
      this.historyService.add(
        { ...content, metadata: { ...content.metadata, turnId: turnKey } },
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
