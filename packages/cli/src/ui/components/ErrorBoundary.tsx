/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, errorInfo: ErrorInfo) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
}

/**
 * Enhanced error boundary that detects and reports React errors,
 * including "Maximum update depth exceeded" errors.
 */
export class ErrorBoundary extends Component<Props, State> {
  private errorTimestamps: number[] = [];
  private readonly ERROR_TIME_WINDOW = 5000; // 5 seconds
  private readonly MAX_ERRORS_IN_WINDOW = 5;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const now = Date.now();
    this.errorTimestamps.push(now);

    // Clean up old timestamps
    this.errorTimestamps = this.errorTimestamps.filter(
      (timestamp) => timestamp > now - this.ERROR_TIME_WINDOW,
    );

    // Check if we're in an error loop
    const isErrorLoop = this.errorTimestamps.length > this.MAX_ERRORS_IN_WINDOW;

    // Special handling for Maximum update depth exceeded
    const isMaxUpdateDepthError = error.message.includes(
      'Maximum update depth exceeded',
    );

    if (isMaxUpdateDepthError || isErrorLoop) {
      console.error('CRITICAL: Render loop detected!');
      console.error('Error:', error.message);
      console.error('Component Stack:', errorInfo.componentStack);

      if (isMaxUpdateDepthError) {
        console.error('\nThis error typically occurs when:');
        console.error('1. setState is called inside render()');
        console.error('2. useEffect has missing or incorrect dependencies');
        console.error(
          '3. Props are recreated on every render (objects, arrays, functions)',
        );
        console.error('\nCheck recent changes to hooks and state updates.');
      }
    }

    // Log error details
    console.error('React Error Boundary caught an error:', error);
    console.error('Error Info:', errorInfo);
    console.error('Error count in window:', this.errorTimestamps.length);

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Update state with error info
    this.setState((prevState) => ({
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }));

    // If we're in an error loop, try to break out
    if (isErrorLoop) {
      // Force a hard refresh after a delay to break the loop
      setTimeout(() => {
        console.error('Attempting to recover from error loop...');
        this.setState({
          hasError: false,
          error: null,
          errorInfo: null,
          errorCount: 0,
        });
        this.errorTimestamps = [];
      }, 1000);
    }
  }

  override render() {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided
      if (this.props.fallback && this.state.errorInfo) {
        return this.props.fallback(this.state.error, this.state.errorInfo);
      }

      // Default error UI
      const isMaxUpdateDepthError = this.state.error.message.includes(
        'Maximum update depth exceeded',
      );

      return (
        <Box flexDirection="column" padding={1}>
          <Text color="red" bold>
            {isMaxUpdateDepthError
              ? 'CRITICAL: Render Loop Error'
              : '❌ An error occurred'}
          </Text>
          <Text color="red">{this.state.error.message}</Text>
          {this.state.errorCount > 1 && (
            <Text color="yellow">Error count: {this.state.errorCount}</Text>
          )}
          {isMaxUpdateDepthError && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="yellow">
                This error indicates an infinite render loop.
              </Text>
              <Text color="yellow">Common causes:</Text>
              <Text color="yellow">• State updates during render</Text>
              <Text color="yellow">• Incorrect useEffect dependencies</Text>
              <Text color="yellow">
                • Non-memoized props causing re-renders
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color={Colors.DimComment}>
              Check the console for more details.
            </Text>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook to wrap a component with an error boundary.
 *
 * @example
 * ```typescript
 * function MyApp() {
 *   return (
 *     <ErrorBoundary onError={(error, info) => logError(error, info)}>
 *       <App />
 *     </ErrorBoundary>
 *   );
 * }
 * ```
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>,
): React.ComponentType<P> {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
}
