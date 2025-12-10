// Override JSX namespace to allow ReactNode as Element
// This is needed because OpenTUI's JSX types are stricter than standard React
import type React from 'react';

declare global {
  namespace JSX {
    type Element = React.ReactNode;
  }
}

export {};
