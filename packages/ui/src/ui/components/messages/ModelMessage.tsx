import type { JSX } from 'react';
import type { ModelMessageProps } from './types';

export function ModelMessage(props: Readonly<ModelMessageProps>): JSX.Element {
  return (
    <text key={props.id} fg={props.theme.colors.text.responder}>
      {props.text}
    </text>
  );
}

ModelMessage.displayName = 'ModelMessage';
