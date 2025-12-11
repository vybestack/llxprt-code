import type { TextareaRenderable } from '@vybestack/opentui-core';
import { parseColor, stringToStyledText } from '@vybestack/opentui-core';
import React, { useCallback, useEffect, useMemo, type RefObject } from 'react';
import type { ThemeDefinition } from '../../features/theme';

export interface FilterInputProps {
  readonly textareaRef: RefObject<TextareaRenderable | null>;
  readonly placeholder: string;
  readonly theme?: ThemeDefinition;
  readonly onQueryChange: (query: string) => void;
}

export function FilterInput(props: FilterInputProps): React.ReactNode {
  const placeholderText = useMemo(() => {
    const base = stringToStyledText(props.placeholder);
    const fg = parseColor(
      props.theme?.colors.input.placeholder ??
        props.theme?.colors.text.muted ??
        '#888888',
    );
    return { ...base, chunks: base.chunks.map((chunk) => ({ ...chunk, fg })) };
  }, [
    props.placeholder,
    props.theme?.colors.input.placeholder,
    props.theme?.colors.text.muted,
  ]);

  const handleSubmit = useCallback(() => undefined, []);

  const handleContentChange = useCallback(() => {
    props.onQueryChange(props.textareaRef.current?.plainText ?? '');
  }, [props]);

  const handleCursorChange = useCallback(() => {
    props.onQueryChange(props.textareaRef.current?.plainText ?? '');
  }, [props]);

  useEffect(() => {
    props.textareaRef.current?.focus();
  }, [props.textareaRef]);

  return (
    <textarea
      ref={props.textareaRef}
      placeholder={placeholderText}
      keyBindings={[{ name: 'return', action: 'submit' }]}
      onSubmit={handleSubmit}
      onContentChange={handleContentChange}
      onCursorChange={handleCursorChange}
      style={{
        height: 1,
        width: '90%',
        minHeight: 1,
        maxHeight: 1,
      }}
      textColor={props.theme?.colors.input.fg}
      focusedTextColor={props.theme?.colors.input.fg}
      backgroundColor={props.theme?.colors.input.bg}
      focusedBackgroundColor={props.theme?.colors.input.bg}
    />
  );
}
