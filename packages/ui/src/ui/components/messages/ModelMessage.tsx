import React from 'react';
import type { ModelMessageProps } from './types';

export function ModelMessage(
  props: Readonly<ModelMessageProps>,
): React.ReactNode {
  return (
    <text key={props.id} fg={props.theme.colors.text.responder}>
      {props.text}
    </text>
  );
}

ModelMessage.displayName = 'ModelMessage';
