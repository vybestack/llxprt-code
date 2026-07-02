/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { InputPromptStateResult } from './inputPromptHooks.js';
import { useMousePaste, useRuntimeState } from './inputPromptHooks.js';
import {
  PromptInputBox,
  useGhostTextLines,
  useSuggestionsNodes,
} from './inputPromptRender.js';
import type { InputPromptProps } from './inputPromptTypes.js';
import type { TextBuffer } from './shared/text-buffer.js';
import type React from 'react';

export { calculatePromptWidths } from './inputPromptText.js';
export type { InputPromptProps } from './inputPromptTypes.js';

type InputPromptViewProps = {
  buffer: TextBuffer;
  placeholder: string;
  focus: boolean;
  inputWidth: number;
  suggestionsPosition: 'above' | 'below';
  shellModeActive: boolean;
  state: InputPromptStateResult;
  suggestionsNode: React.ReactNode;
  ghostText: { inlineGhost: string; additionalLines: string[] };
};

const InputPromptView: React.FC<InputPromptViewProps> = ({
  buffer,
  placeholder,
  focus,
  inputWidth,
  suggestionsPosition,
  shellModeActive,
  state,
  suggestionsNode,
  ghostText,
}) => (
  <>
    {suggestionsPosition === 'above' && suggestionsNode}
    <PromptInputBox
      buffer={buffer}
      placeholder={placeholder}
      focus={focus}
      shellModeActive={shellModeActive}
      reverseSearchActive={state.reverseSearchActive}
      inputWidth={inputWidth}
      inlineGhost={ghostText.inlineGhost}
      additionalLines={ghostText.additionalLines}
    />
    {suggestionsPosition === 'below' && suggestionsNode}
  </>
);

export const InputPrompt: React.FC<InputPromptProps> = ({
  placeholder = '  Type your message or @path/to/file',
  focus = true,
  inputWidth,
  suggestionsWidth,
  suggestionsPosition = 'below',
  ...runtimeProps
}) => {
  const state = useRuntimeState({ ...runtimeProps, focus });
  useMousePaste(focus, runtimeProps.isEmbeddedShellFocused, state);
  const ghostText = useGhostTextLines(
    state.completion,
    runtimeProps.buffer,
    inputWidth,
  );
  const suggestionsNode = useSuggestionsNodes(
    state.completion,
    runtimeProps.shellModeActive,
    state.reverseSearchActive,
    state.reverseSearchCompletion,
    state.shellPathCompletion,
    suggestionsWidth,
    runtimeProps.buffer.text,
  );

  return (
    <InputPromptView
      buffer={runtimeProps.buffer}
      placeholder={placeholder}
      focus={focus}
      inputWidth={inputWidth}
      suggestionsPosition={suggestionsPosition}
      shellModeActive={runtimeProps.shellModeActive}
      state={state}
      suggestionsNode={suggestionsNode}
      ghostText={ghostText}
    />
  );
};
