# UI Design for nui

## Current UI Design

The nui project implements a terminal-based chat interface using OpenTUI and React. The UI is structured into four primary regions that create a cohesive chat experience in the terminal environment.

### Layout Architecture

The UI consists of a vertical layout with four distinct bands:

1. **Header** (1-5 lines): Displays application title and branding
2. **Scrollback** (flexible height): Main conversation area with message history
3. **Input** (1-10 lines): Multi-line text input area with submission controls
4. **Status Bar** (1-3 lines): Shows stream state, word count, and scroll indicators

### Core Components

#### ChatLayout

The main layout orchestrates all UI components and manages:

- Overall component arrangement
- Input height constraints (1-10 lines with automatic adjustment)
- Theme application and color management
- Mouse interaction handling for clipboard selection

#### Message Rendering System

Messages are rendered by role-specific components:

- **UserMessage**: Left border (┃) with user color scheme
- **ModelMessage**: Standard appearance with responder color
- **SystemMessage**: Left border (│) with distinct background and text color
- **ThinkingMessage**: Special formatting for AI reasoning content

Each message component receives:

- Unique ID
- Text content
- Theme definition for colors and styling
- Consistent spacing and border treatment

#### Tool Display

Tool calls have dedicated rendering with:

- Status indicators (○, ◎, [OK], , ?, -)
- Parameter formatting with line truncation for long values
- Output display with scrollable regions for large results
- Border styling based on execution status (success, error, warning)
- Streaming indicators for active tool calls

#### Input Management

The input component provides:

- Multi-line text input (1-10 lines)
- Custom key bindings (Enter to submit, Shift+Enter/Option+Enter for newline)
- Placeholder text with theme-appropriate styling
- Automatic height adjustment as content grows

#### Autocomplete/Suggestion System

The suggestion panel displays:

- Command and file path completions
- Paging for large suggestion sets
- Selection indicators with highlighting
- Context-aware filtering based on current input

### Visual Design Language

#### Color System

All colors are defined in JSON themes with the following structure:

- Background and panel colors
- Text colors by role (user,Responder, system, thinking, tool)
- Input colors (background, text, placeholder, border)
- Status colors for different states
- Accent colors for visual emphasis
- Selection colors for highlighted items

#### Border Styles

Different message types use distinct border characters:

- User messages: Custom vertical borders (┃, ╹, ╻)
- System messages: Standard vertical borders (│, ╵, ╷)
- Tool blocks: Rounded or single borders based on type

### Interaction Patterns

#### Keyboard Navigation

- **Enter**: Submit input
- **Shift+Enter/Option+Enter**: Insert newline
- **Escape**: Cancel streaming or clear input
- **Arrow keys**: Navigation through suggestions and scrollback
- **Tab**: Accept suggestion

#### Visual Feedback

- Streaming content appears incrementally
- Status indicators show current operation state
- Tool execution progress with status changes
- Selection highlighting in suggestion panels

### Context Management

#### Dialog System

Modal dialogs use a stack-based approach:

- Single dialog at a time
- Escape key dismissal
- Context providers for dialog state
- Command triggering from dialogs

#### Command System

Commands are registered components that:

- Connect to the dialog system
- Provide consistent execution patterns
- Support async operations
- Handle configuration changes

## Future UI Design Standards

While the current implementation provides a solid foundation, the following standards should guide UI evolution:

### Component Design Principles

1. **Minimalism Over Density**
   - Terminal UI benefits from clear separation
   - Use whitespace deliberately to guide attention
   - Avoid visual noise and unnecessary embellishments
   - Allow content to breathe with appropriate padding

2. **Terminal-Appropriate Interactions**
   - Leverage terminal strengths: text precision, keyboard shortcuts
   - Avoid emulating GUI patterns that don't translate well
   - Design for efficient, keyboard-first navigation
   - Consider accessibility with contrast and readability

3. **Responsive to Content**
   - UI should adapt to content rather than forcing content into rigid containers
   - Components should expand/contract based on their content's needs
   - Prioritize content visibility over chrome
   - Implement content-aware resizing that respects terminal constraints

4. **Progressive Enhancement**
   - Basic structure must be functional without advanced features
   - Advanced interactions should enhance, not replace core functionality
   - Fallback options for environments with limited capabilities
   - Graceful degradation in constrained environments

5. **Size-Aware Components**
   - Components should be aware of available space
   - Implement adaptive layouts that respond to size changes
   - Provide alternative representations when space is limited
   - Ensure core functionality remains accessible at any reasonable terminal size

### Visual Standards

#### Color Usage

1. **Semantic Color Mapping**
   - Use colors consistently for semantic meaning
   - Status colors indicate state, not aesthetics
   - Maintain theme consistency across components

2. **Contrast and Readability**
   - Ensure sufficient contrast for all text elements
   - Test readability across all supported themes
   - Prioritize legibility over creative color choices

#### Layout Standards

1. **Hierarchical Grouping**
   - Use visual grouping to indicate relationships
   - Maintain consistent spacing patterns
   - Implement clear content hierarchy
   - Use whitespace strategically to improve scannability

2. **Responsive Dimensions**
   - Design for various terminal sizes (minimum 80x24 characters)
   - Implement minimum/maximum constraints for components
   - Prioritize content over UI chrome when space is limited
   - Provide alternative content layouts as size changes
   - Maintain component relationships during resize operations

3. **Consistent Spacing System**
   - Use standardized spacing units (characters/lines)
   - Apply consistent padding and margins across components
   - Define spacing scale similar to CSS frameworks
   - Ensure spacing is proportional to terminal size

### Interaction Standards

#### Input Patterns

1. **Predictable Behavior**
   - Standard text operations should work as expected
   - Provide visible feedback for all interactions
   - Use familiar keyboard shortcuts where possible

2. **Error Prevention**
   - Prevent invalid input where possible
   - Provide clear validation feedback
   - Offer recovery paths from error states

#### State Communication

1. **Clear Status Indicators**
   - Always communicate current state
   - Use universally understood symbols
   - Provide context for status changes

2. **Progressive Disclosure**
   - Show relevant information first
   - Allow access to details when needed
   - Use progressive disclosure to manage complexity

### Architectural Patterns

#### Component Structure

1. **Single Responsibility**
   - Each component should have one clear purpose
   - Avoid components that try to do too much
   - Keep component interfaces minimal and focused

2. **Composition Over Inheritance**
   - Build complex UI through composition
   - Use composition to extend functionality
   - Avoid deep inheritance hierarchies

#### State Management

1. **Isolated State**
   - State should be as close to its usage as possible
   - Avoid global state except for truly global concerns
   - Use clear state propagation patterns

2. **Immutable Updates**
   - All state updates should be immutable
   - Use functional update patterns
   - Minimize state mutation to prevent subtle bugs

### Responsive Design Standards

#### Terminal Size Adaptability

1. **Minimum Terminal Size Support**
   - Ensure core functionality works at 80x24 characters minimum
   - Provide graceful degradation at smaller sizes
   - Implement strategic content collapsing when necessary
   - Maintain readability as the primary concern

2. **Dynamic Component Scaling**
   - Layout should adapt both horizontally and vertically
   - Implement fluid or elastic sizing where appropriate
   - Use flexible containers that redistribute content
   - Preserve component relationships during resize operations

3. **Content Prioritization**
   - Critical content should remain visible at all sizes
   - Non-essential UI elements can be hidden at smaller sizes
   - Implement progressive disclosure based on available space
   - Maintain access to core functionality regardless of terminal size

#### Boundary Conditions

1. **Size Thresholds**
   - Define clear breakpoints for UI reorganization
   - Smooth transitions between size categories
   - Component behavior should be predictable at boundary conditions
   - No content should become permanently inaccessible

2. **Aspect Ratio Considerations**
   - Account for both tall and wide terminal configurations
   - Optimize for common aspect ratios while supporting extremes
   - Ensure UI remains usable in non-standard proportions
   - Test with both portrait and landscape terminal layouts

### Performance Standards

#### Rendering Efficiency

1. **Minimize Re-renders**
   - Optimize components to prevent unnecessary re-renders
   - Use memoization strategically
   - Profile and optimize critical paths

2. **Progressive Loading**
   - Load and render content progressively
   - Provide immediate feedback for user actions
   - Use placeholders for loading states

3. **Resize Performance**
   - Optimize for smooth terminal resize operations
   - Implement debouncing for resize event handling
   - Avoid expensive recalculations during intermediate resize states
   - Maintain responsiveness during size transitions

### Accessibility Standards

1. **Keyboard Navigation**
   - Ensure full functionality is available via keyboard
   - Provide clear focus indicators
   - Implement logical tab order

2. **Screen Reader Compatibility**
   - Use semantic HTML elements where applicable
   - Provide meaningful labeling for interactive elements
   - Test with screen readers when possible

### Testing Standards

1. **Visual Testing**
   - Implement visual regression tests for UI components
   - Test across different terminal sizes
   - Verify theme consistency

2. **Interaction Testing**
   - Test all user interaction paths
   - Verify keyboard navigation
   - Test component state transitions

## Implementation Guidelines

### Adding New Components

1. Follow the established component structure:

   ```typescript
   export function ComponentName(props: ComponentProps): JSX.Element {
     // Implementation
   }
   ComponentName.displayName = 'ComponentName';
   ```

2. Use the ThemeDefinition prop for all styling:

   ```typescript
   const Component = ({ theme, ...props }: ComponentProps) => {
     return (
       <box style={{ color: theme.colors.text.primary }}>
         {/* content */}
       </box>
     );
   };
   ```

3. Implement keyboard navigation with useKeyboard when needed

4. Add responsive behavior for new components:

   ```typescript
   const Component = ({ theme, isSmall, ...props }: ComponentProps) => {
     // Use isSmall flag to adapt rendering for terminals below size threshold
     if (isSmall) {
       return <SimplifiedLayout />;
     }
     return <StandardLayout />;
   };
   ```

5. Follow minimum size requirements:
   - Ensure critical content remains visible at 80x24 characters
   - Test components in both narrow and tall terminal configurations
   - Implement graceful degradation when space is limited

### Theme Development

1. Include all required color properties
2. Ensure sufficient contrast ratios
3. Test with all components for compatibility
4. Provide both light and dark variants when appropriate
5. Consider how colors might need to adapt for different terminal sizes:
   - Ensure critical elements remain distinguishable in cramped layouts
   - Maintain readability across all supported terminal dimensions
   - Test at both minimum and maximum expected terminal sizes

### State Management

1. Keep component state local when possible
2. Use centralized state only when necessary
3. Follow immutable update patterns
4. Provide clear interfaces between components

5. Implement size-aware state management:
   ```typescript
   const [terminalSize, setTerminalSize] = useState({ width: 80, height: 24 });
   const isAboveMinimum = terminalSize.width >= 80 && terminalSize.height >= 24;
   ```
6. Consider terminal resize in state effects
7. Store size-dependent preferences that persist across resize operations

### Responsive Implementation Practices

1. **Size Detection**
   - Implement reliable terminal size detection
   - Set up event listeners for resize operations
   - Debounce resize events to prevent excessive re-renders

2. **Layout Adaptation**
   - Use flexible boxes and containers with constraints
   - Implement content priorities for different sizes
   - Design components to be "size-aware" and adapt accordingly

3. **Content Strategies**
   - Implement summarization for large content in small terminals
   - Use paging or scrolling for content that exceeds available space
   - Provide alternative views for complex components when space is limited

4. **Testing Considerations**
   - Test components at minimum supported size (80x24)
   - Test with common terminal sizes (120x40, 160x50, etc.)
   - Verify content remains readable and accessible at extreme ratios
   - Check smooth transitions during resize operations

These standards should guide UI development decisions as nui evolves, ensuring a consistent, efficient, and pleasant user experience in the terminal environment.
