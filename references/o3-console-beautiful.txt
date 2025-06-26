#!/usr/bin/env node
/**
 * O3 Console Beautiful - With persistent status bar and better UI
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const os = require('os');

// Import enhanced components
const MemoryManager = require('./memory-manager');
const tokenEfficientTools = require('./token-efficient-tools');

// ANSI escape codes
const ansi = {
  // Cursor movement
  cursorUp: (n = 1) => `\x1b[${n}A`,
  cursorDown: (n = 1) => `\x1b[${n}B`,
  cursorForward: (n = 1) => `\x1b[${n}C`,
  cursorBack: (n = 1) => `\x1b[${n}D`,
  cursorPosition: (row, col) => `\x1b[${row};${col}H`,
  
  // Screen control
  clearScreen: '\x1b[2J',
  clearLine: '\x1b[2K',
  saveCursor: '\x1b7',
  restoreCursor: '\x1b8',
  setScrollRegion: (top, bottom) => `\x1b[${top};${bottom}r`,
  resetScrollRegion: '\x1b[r',
  
  // Colors
  reset: '\x1b[32m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  
  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  
  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  bgGray: '\x1b[100m',
  
  // RGB colors (24-bit)
  rgb: (r, g, b) => `\x1b[38;2;${r};${g};${b}m`,
  bgRgb: (r, g, b) => `\x1b[48;2;${r};${g};${b}m`
};

// Model configurations for API routing
const RESPONSES_API_MODELS = ['o3', 'o3-pro', 'o4-mini', 'gpt-4o', 'gpt-4o-2024-08-06'];
const COMPLETIONS_API_MODELS = ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'];

class O3ConsoleBeautiful {
  constructor() {
    // Store original reset for later restoration
    this.originalAnsiReset = ansi.reset;
    // Initialize theme
    this.theme = 'modern'; // 'modern' or 'green' - default to modern
    
    // Default configuration values
    this.defaultConfig = {
      endpoint: process.env.O3_API_BASEURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKeyFile: process.env.O3_API_KEYFILE || path.join(os.homedir(), '.openai_key'),
      response_format: 'text'
    };

    // Load persisted configuration (merge with defaults)
    this.configPath = path.join(os.homedir(), '.o3console_config.json');
    this.config = this.loadConfig();

    // Initialize status first
    this.status = {
      mode: 'chat',
      processing: false,
      lastActivity: 'Ready'
    };
    
    // Cancellation flag for stopping operations
    this.isCancelled = false;
    
    // Initialize context
    this.context = {
      model: 'o3',
      tools: true,
      files: [],
      baseDir: process.cwd(),
      responseFormat: 'text' // 'text' or 'json_object'
    };
    
    // Initialize memory manager
    this.memory = new MemoryManager({
      maxTokens: 100000,
      compressionThreshold: 0.5
    });
    
    // Initialize paste detection
    this.pasteMode = {
      active: false,
      buffer: [],
      startTime: null,
      threshold: 10, // ms between keystrokes to detect paste
      timeout: null
    };
    
    // Initialize @ autocomplete
    this.fileAutocomplete = {
      active: false,
      searchTerm: '',
      suggestions: [],
      selectedIndex: 0,
      startPosition: 0
    };
    
    // Track lines used in scroll region
    this.linesUsed = 5; // Start after header
    
    // Initialize diagnostics array
    this.diagnostics = [];
    
    // Initialize Agent and Plan modes
    const AgentMode = require('./agent-mode');
    const PlanMode = require('./plan-mode');
    this.agentMode = new AgentMode({ verbose: false });
    this.planMode = new PlanMode({ verbose: true });
    
    // Setup terminal after status is initialized
    this.setupTerminal();
    
    this.commands = this.setupCommands();
    
    this.openai = null;
    this.apiKey = this.getApiKey();
    this.initOpenAI();
    
    // Terminal dimensions
    this.updateDimensions();
    process.stdout.on('resize', () => {
      this.updateDimensions();
      this.redraw();
    });
  }

  // ------------------------------
  // Terminal colour helpers
  // ------------------------------
  applyGreenTerminalColors() {
    // Modify the global ansi.reset so that any module that prints "\x1b[0m"
    // immediately continues with green-on-black. This works even on terminals
    // that ignore OSC 10/11.
    ansi.reset = '\x1b[0m' + ansi.rgb(106, 153, 85) + ansi.bgBlack;

    // First, explicitly set the current colors using SGR codes
    // This ensures immediate effect regardless of OSC support
    process.stdout.write(ansi.rgb(106, 153, 85) + ansi.bgBlack);

    // Then try to set terminal default colors with OSC sequences
    // These may or may not work depending on terminal support
    try {
      // Foreground (OSC 10)
      process.stdout.write(`\x1b]10;#6a9955\x07`);
      // Background (OSC 11)
      process.stdout.write(`\x1b]11;#000000\x07`);
    } catch (e) {
      // OSC not supported, but SGR above already set colors
    }
  }

  resetTerminalColors() {
    // Restore the original reset string and ask the terminal to revert its
    // palette to the user defaults.
    ansi.reset = this.originalAnsiReset;
    
    // First apply a plain reset to clear current attributes
    process.stdout.write(ansi.reset);
    
    // Then try to reset terminal default colors
    try {
      process.stdout.write('\x1b]110\x07'); // reset fg
      process.stdout.write('\x1b]111\x07'); // reset bg
    } catch (_) { /* ignore */ }
  }
  
  setupTerminal() {
    // Enable raw mode for better control
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      readline.emitKeypressEvents(process.stdin);
      process.stdin.resume();
    }
    
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.getPrompt(),
      completer: this.completer.bind(this)
    });
    
    // Set up paste detection after readline is created
    this.setupPasteDetection();
    
    // Store original _refreshLine for theme updates
    const originalRefreshLine = this.rl._refreshLine;
    
    // Override readline's _refreshLine to use theme-aware prompt
    this.rl._refreshLine = () => {
      // Update prompt with current theme colors
      this.rl._prompt = this.getPrompt();
      originalRefreshLine.call(this.rl);
    };
    
    // Override readline's _writeToOutput for custom display
    this.rl._writeToOutput = (stringToWrite) => {
      if (stringToWrite.includes('\n')) {
        this.updateStatusBar();
      }
      
      // Ensure cursor doesn't go into status bar area
      const cursorRegex = /\x1b\[(\d+);(\d+)H/;
      const match = stringToWrite.match(cursorRegex);
      if (match) {
        const row = parseInt(match[1]);
        if (row > this.scrollBottom) {
          // Force cursor back to safe area
          stringToWrite = stringToWrite.replace(cursorRegex, ansi.cursorPosition(this.scrollBottom - 1, 1));
        }
      }
      
      // Apply green color to user input in modern theme
      if (this.theme === 'modern' && !stringToWrite.includes('\x1b[')) {
        stringToWrite = ansi.green + stringToWrite;
      }
      
      this.rl.output.write(stringToWrite);
    };
  }
  
  setupPasteDetection() {
    const self = this;
    let lastInputTime = 0;
    let lineBuffer = [];
    let pasteTimeout = null;
    
    // Store the original line handler
    const originalLine = this.rl._onLine.bind(this.rl);
    
    // Override the internal _onLine method to intercept all line inputs
    this.rl._onLine = function(line) {
      const now = Date.now();
      const timeSinceLastLine = now - lastInputTime;
      lastInputTime = now;
      
      // If lines are coming in rapidly (< 10ms apart), it's likely a paste
      if (timeSinceLastLine < 10 && lineBuffer.length > 0) {
        // We're in paste mode
        if (!self.pasteMode.active) {
          self.pasteMode.active = true;
          // Show paste indicator
          process.stdout.write('\r' + ansi.clearLine);
          const pasteColor = self.theme === 'green' ? self.getColor('dim') : ansi.green;
          process.stdout.write(pasteColor + '[Pasting...]' + ansi.reset);
        }
        
        lineBuffer.push(line);
        
        // Clear existing timeout
        if (pasteTimeout) {
          clearTimeout(pasteTimeout);
        }
        
        // Set new timeout to process when paste is complete
        pasteTimeout = setTimeout(() => {
          // Process all buffered lines
          const lines = lineBuffer;
          lineBuffer = [];
          self.pasteMode.active = false;
          
          // Clear paste indicator
          process.stdout.write('\r' + ansi.clearLine);
          
          // Show paste summary
          const displayColor = self.theme === 'green' ? self.getColor('info') : ansi.green;
          console.log(`${displayColor}[${lines.length} lines pasted]${ansi.reset}`);
          
          // Process as single combined input
          const combinedInput = lines.join('\n');
          self.handleInput(combinedInput);
        }, 50);
      } else {
        // Single line or first line of potential paste
        if (lineBuffer.length > 0 && !self.pasteMode.active) {
          // Process any buffered single line
          const singleLine = lineBuffer[0];
          lineBuffer = [];
          originalLine.call(this, singleLine);
        }
        
        // Start new potential paste buffer
        lineBuffer = [line];
        
        // Set timeout to process as single line if no more input
        if (pasteTimeout) {
          clearTimeout(pasteTimeout);
        }
        
        pasteTimeout = setTimeout(() => {
          if (lineBuffer.length === 1 && !self.pasteMode.active) {
            const singleLine = lineBuffer[0];
            lineBuffer = [];
            originalLine.call(this, singleLine);
          }
        }, 20);
      }
    };
  }
  
  updateDimensions() {
    this.width = process.stdout.columns || 80;
    this.height = process.stdout.rows || 24;
    // Re-calculate layout regions each resize
    this.statusLines = 3;          // separator + status + token bar
    this.bufferLines = 2;          // visual buffer above status bar
    this.scrollBottom = this.height - (this.statusLines + this.bufferLines);
    this.contentHeight = this.scrollBottom; // usable scrollable content area
    
    // Update scroll region when terminal is resized
    if (this.rl) {
      process.stdout.write(ansi.setScrollRegion(1, this.scrollBottom));
    }
  }
  
  getPrompt() {
    if (this.theme === 'green') {
      // Simple green prompt with LLxprt Green
      return `${this.getColor('bright')}>${ansi.rgb(106, 153, 85)} `;
    } else {
      // Modern colorful prompt
      const prefix = this.status.processing ? '⏳' : '▶';
      const color = ansi.green;
      return `${color}${prefix} LLxprt Code${ansi.reset} ${ansi.green}│${ansi.reset} `;
    }
  }
  
  setupCommands() {
    return {
      '/help': this.showHelp.bind(this),
      '/h': this.showHelp.bind(this),
      '/model': this.setModel.bind(this),
      '/tools': this.toggleTools.bind(this),
      '/file': this.addFile.bind(this),
      '/files': this.listFiles.bind(this),
      '/clear': this.clearFiles.bind(this),
      '/cd': this.changeDirectory.bind(this),
      '/pwd': this.printWorkingDirectory.bind(this),
      '/history': this.showHistory.bind(this),
      '/save': this.saveConversation.bind(this),
      '/config': this.showConfig.bind(this),
      '/todos': this.showTodos.bind(this),
      '/memory': this.showMemory.bind(this),
      '/project': this.editProject.bind(this),
      '/tokens': this.showTokens.bind(this),
      '/theme': this.cycleTheme.bind(this),
      '/key': this.setApiKey.bind(this),
      '/keyfile': this.setKeyFile.bind(this),
      '/endpoint': this.setEndpoint.bind(this),
      '/response_format': this.setResponseFormat.bind(this),
      '/agent': this.runAgent.bind(this),
      '/plan': this.createPlan.bind(this),
      '/execute_plan': this.executePlan.bind(this),
      '/exit_plan_mode': this.exitPlanMode.bind(this),
      '/test_responses': this.testResponsesAPI.bind(this),
      '/test_simple': this.testSimpleResponse.bind(this),
      '/exit': this.exit.bind(this),
      '/quit': this.exit.bind(this)
    };
  }
  
  // ------------------------------
  // Config load / save helpers
  // ------------------------------
  loadConfig() {
    let cfg = { ...this.defaultConfig };
    if (fs.existsSync(this.configPath)) {
      try {
        const disk = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        cfg = { ...cfg, ...disk };
      } catch (_) {
        console.error(`${ansi.red}Warning: invalid config file${ansi.reset}`);
      }
    }
    return cfg;
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (_) {
      console.error(`${ansi.red}Warning: cannot save config${ansi.reset}`);
    }
  }

  // ------------------------------
  // API key handling
  // ------------------------------
  getApiKey() {
    const keyPath = this.config.apiKeyFile || path.join(os.homedir(), '.openai_key');
    
    if (process.env.OPENAI_API_KEY) {
      return process.env.OPENAI_API_KEY;
    }
    
    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath, 'utf8').trim();
    }
    
    console.error('Error: OpenAI API key not found');
    process.exit(1);
  }
  
  initOpenAI() {
    // Debug logging to file
    fs.appendFileSync('/tmp/o3-console-debug.log', `\n${new Date().toISOString()} [initOpenAI] Creating OpenAI client\n`);
    fs.appendFileSync('/tmp/o3-console-debug.log', `  API Key: ${this.apiKey ? 'Set' : 'Not set'}\n`);
    fs.appendFileSync('/tmp/o3-console-debug.log', `  Base URL: ${this.config.endpoint}\n`);
    
    this.openai = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.config.endpoint
    });
    
    fs.appendFileSync('/tmp/o3-console-debug.log', `  OpenAI client created\n`);
    fs.appendFileSync('/tmp/o3-console-debug.log', `  Available properties: ${Object.keys(this.openai).join(', ')}\n`);
    fs.appendFileSync('/tmp/o3-console-debug.log', `  openai.responses exists? ${!!this.openai.responses}\n`);
    
    // Check if this is an older version of the SDK without responses API
    if (!this.openai.responses && RESPONSES_API_MODELS.includes(this.context.model)) {
      this.printWarning('OpenAI SDK may be outdated. Responses API not available.');
      this.printInfo('Run: npm install openai@latest');
    }
    
    // Detect API support for current model
    this.apiType = this.detectAPIType();
  }
  
  detectAPIType() {
    // Determine which API to use based on the model
    if (RESPONSES_API_MODELS.includes(this.context.model)) {
      return 'responses';
    } else if (COMPLETIONS_API_MODELS.includes(this.context.model)) {
      return 'completions';
    } else {
      // Default to completions API for unknown models
      return 'completions';
    }
  }
  
  useResponsesAPI() {
    return this.apiType === 'responses';
  }
  
  async detectAPISupport() {
    // Try to detect if Responses API is available for the current model
    if (!RESPONSES_API_MODELS.includes(this.context.model)) {
      console.error(`[detectAPISupport] Model ${this.context.model} not in RESPONSES_API_MODELS list`);
      return 'completions';
    }
    
    // First check if openai.responses even exists
    if (!this.openai.responses) {
      console.error('[detectAPISupport] ERROR: openai.responses property does not exist on OpenAI client!');
      console.error('[detectAPISupport] Available properties on openai:', Object.keys(this.openai));
      return 'completions';
    }
    
    try {
      console.log(`[detectAPISupport] Testing Responses API for model: ${this.context.model}`);
      
      // Try a minimal Responses API call
      const testResponse = await this.openai.responses.create({
        model: this.context.model,
        instructions: 'Test',
        input: 'Test',
        max_output_tokens: 16
      });
      
      if (testResponse) {
        // console.log('[detectAPISupport] Responses API test successful');
        return 'responses';
      }
    } catch (error) {
      // Log to file instead of console
      fs.appendFileSync('/tmp/o3-console-error.log', `${new Date().toISOString()} [detectAPISupport] ERROR: ${error.status} ${error.message}\n`);
      
      // If error is 404 or mentions responses not found, API is not available
      if (error.status === 404 || error.message?.includes('responses')) {
        // console.log(`Note: Responses API not available for ${this.context.model}, using Completions API`);
        return 'completions';
      }
    }
    
    console.log('[detectAPISupport] Defaulting to completions API');
    return 'completions';
  }
  
  convertMessagesToResponsesFormat(messages) {
    // Extract system instructions and find the last user message
    let instructions = '';
    let lastUserMessage = '';
    let conversationContext = '';
    let toolResults = '';
    
    // First pass: extract system messages and build conversation history
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'system') {
        instructions += (instructions ? '\n\n' : '') + msg.content;
      } else if (msg.role === 'user') {
        lastUserMessage = msg.content;
        // Add previous messages to context
        if (i < messages.length - 1) {
          conversationContext += (conversationContext ? '\n\n' : '') + 'User: ' + msg.content;
        }
      } else if (msg.role === 'assistant' && i < messages.length - 1) {
        conversationContext += '\n\nAssistant: ' + msg.content;
      } else if (msg.role === 'tool') {
        // Handle tool responses by including them in the context
        toolResults += '\n\nTool Result (' + msg.tool_call_id + '):\n' + msg.content;
      }
    }
    
    // If no explicit system message, use a default instruction
    if (!instructions) {
      instructions = 'You are a helpful AI assistant.';
    }
    
    // Add conversation context to instructions if it exists
    if (conversationContext) {
      instructions += '\n\nPrevious conversation:\n' + conversationContext;
    }
    
    // Add tool results to instructions if any
    if (toolResults) {
      instructions += '\n\nTool execution results:' + toolResults;
    }
    
    // The input should be just the current user message or a continuation prompt
    let input = lastUserMessage || '';
    
    // If the last message was a tool result, add a continuation prompt
    if (messages.length > 0 && messages[messages.length - 1].role === 'tool') {
      input = 'Based on the tool results above, please continue with your response.';
    }
    
    return { instructions, input };
  }
  
  convertToolsForResponsesAPI(tools) {
    // Convert from Completions API tool format to Responses API format
    // Responses API wants a flattened structure with type field
    if (!tools || !Array.isArray(tools)) return undefined;
    
    return tools.map(tool => {
      if (tool.type === 'function' && tool.function) {
        return {
          type: tool.type,
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        };
      }
      return tool;
    });
  }
  
  start() {
    this.clearScreen();
    
    // Apply green theme if set (use OSC 10/11 to set default colors)
    // MUST be done after clearScreen to ensure clean state
    if (this.theme === 'green') {
      this.applyGreenTerminalColors();
    }
    
    this.printHeader();
    
    // Check for session restoration
    const restored = this.memory.restoreSession();
    if (restored.restored) {
      this.printInfo(`✓ Restored session (${restored.age}m old, ${restored.messageCount} messages)`);
    }
    
    // Check for project context
    if (this.memory.projectContext) {
      this.printInfo(`✓ Loaded project: ${this.getProjectName()}`);
    }
    
    this.printDivider();
    this.setupStatusBar();
    
    // Set scroll region to exclude status bar (bottom 3 lines)
    process.stdout.write(ansi.setScrollRegion(1, this.scrollBottom));
    
    // Position cursor in content area
    process.stdout.write(ansi.cursorPosition(5, 1));
    
    this.rl.prompt();
    
    // Intercept input to handle @ before it reaches readline
    const originalTtyWrite = this.rl._ttyWrite.bind(this.rl);
    this.rl._ttyWrite = (s, key) => {
      // Handle special keys during autocomplete
      if (this.fileAutocomplete.active) {
        if (key && key.name === 'tab') {
          // Tab accepts the current suggestion
          this.acceptAutocompleteSuggestion();
          return;
        } else if (key && key.name === 'return') {
          // Enter also accepts current suggestion
          this.acceptAutocompleteSuggestion();
          return;
        } else if (key && key.name === 'up') {
          this.previousAutocompleteSuggestion();
          return;
        } else if (key && key.name === 'down') {
          this.nextAutocompleteSuggestion();
          return;
        }
      }
      
      // Check for @ at word boundary
      if (s === '@' && !this.fileAutocomplete.active) {
        const line = this.rl.line;
        const cursor = this.rl.cursor;
        if (cursor === 0 || line[cursor - 1] === ' ') {
          // Let @ be added to the line first
          originalTtyWrite(s, key);
          // Then start autocomplete
          this.startFileAutocomplete();
          return;
        }
      }
      
      // Let readline handle it normally
      originalTtyWrite(s, key);
      
      // If autocomplete is active and this was a regular character, update search
      if (this.fileAutocomplete.active && s && !key.ctrl && !key.meta) {
        setTimeout(() => this.updateFileAutocomplete(), 0);
      }
    };
    
    this.rl.on('line', (line) => {
      this.handleInput(line.trim());
    });
    
    this.rl.on('close', () => {
      this.exit();
    });
    
    // Handle special keys
    process.stdin.on('keypress', (str, key) => {
      // ESC key to stop current action
      if (key && key.name === 'escape') {
        if (this.status.processing) {
          this.stopCurrentAction();
        } else if (this.fileAutocomplete.active) {
          this.cancelFileAutocomplete();
        }
        return;
      }
      
      
      // We handle autocomplete navigation in _ttyWrite, so just handle backspace here
      if (this.fileAutocomplete.active) {
        if (key && (key.name === 'backspace' || key.name === 'delete')) {
          // Let backspace work normally but update search
          setTimeout(() => this.updateFileAutocomplete(), 0);
        }
      }
    });
    
    // Update status bar periodically
    this.statusInterval = setInterval(() => {
      this.updateStatusBar();
    }, 1000);
    
    // Auto-save on exit
    process.on('SIGINT', () => this.exit());
    process.on('SIGTERM', () => this.exit());
  }
  
  clearScreen() {
    process.stdout.write(ansi.clearScreen + ansi.cursorPosition(1, 1));
  }
  
  printHeader() {
    const title = this.theme === 'green' ? 'LLxprt TERMINAL' : 'LLxprt Code';
    const subtitle = this.theme === 'green' ? 'LLxprt Green Terminal Mode' : 'Claude-like interface with memory & tokens';
    
    process.stdout.write(ansi.cursorPosition(1, 1));
    process.stdout.write(ansi.clearLine);
    
    // Centered title
    const padding = Math.floor((this.width - title.length) / 2);
    process.stdout.write(' '.repeat(padding));
    const titleColor = this.theme === 'green' ? this.getColor('bright') : ansi.green;
    process.stdout.write(`${ansi.bright}${titleColor}${title}${ansi.reset}\n`);
    
    // Centered subtitle
    const subPadding = Math.floor((this.width - subtitle.length) / 2);
    const subtitleColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
    process.stdout.write(' '.repeat(subPadding));
    process.stdout.write(`${subtitleColor}${subtitle}${ansi.reset}\n`);
  }
  
  printDivider() {
    const color = this.theme === 'green' ? this.getColor('dim') : ansi.gray;
    process.stdout.write(`${color}${'─'.repeat(this.width)}${ansi.reset}\n`);
  }
  
  printInfo(message) {
    const color = this.theme === 'green' ? this.getColor('info') : ansi.green;
    process.stdout.write(`  ${color}${message}${ansi.reset}\n`);
  }
  
  setupStatusBar() {
    // Save current position
    process.stdout.write(ansi.saveCursor);
    
    // Draw initial status bar
    this.updateStatusBar();
    
    // Restore position
    process.stdout.write(ansi.restoreCursor);
  }
  
  updateStatusBar() {
    // Save current cursor position
    process.stdout.write(ansi.saveCursor);
    
    // Move to status bar area (bottom 3 lines)
    const statusRow = this.height - 2;
    
    // Line 1: Separator
    process.stdout.write(ansi.cursorPosition(statusRow - 1, 1));
    process.stdout.write(ansi.clearLine);
    const sepColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
    process.stdout.write(`${sepColor}${'─'.repeat(this.width)}${ansi.reset}`);
    
    // Line 2: Status info
    process.stdout.write(ansi.cursorPosition(statusRow, 1));
    process.stdout.write(ansi.clearLine);
    
    // Build status line
    const left = this.buildStatusLeft();
    const center = this.buildStatusCenter();
    const right = this.buildStatusRight();
    
    // Calculate spacing
    const leftLen = this.stripAnsi(left).length;
    const centerLen = this.stripAnsi(center).length;
    const rightLen = this.stripAnsi(right).length;
    const totalLen = leftLen + centerLen + rightLen;
    const spacing = Math.max(1, Math.floor((this.width - totalLen) / 2));
    
    // Write status line
    process.stdout.write(left);
    process.stdout.write(' '.repeat(spacing));
    process.stdout.write(center);
    process.stdout.write(' '.repeat(this.width - leftLen - spacing - centerLen - spacing - rightLen));
    process.stdout.write(right);
    
    // Line 3: Token bar
    process.stdout.write(ansi.cursorPosition(statusRow + 1, 1));
    process.stdout.write(ansi.clearLine);
    this.drawTokenBar();
    
    // Restore cursor position
    process.stdout.write(ansi.restoreCursor);
  }
  
  buildStatusLeft() {
    const parts = [];
    
    // Mode indicator
    if (this.status.mode === 'plan') {
      const modeColor = this.theme === 'green' ? this.getColor('warning') : ansi.green;
      parts.push(`${modeColor}[PLAN MODE]${ansi.reset}`);
    }
    
    // Model
    const modelColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    parts.push(`${modelColor}${this.context.model}${ansi.reset}`);
    
    // Tools indicator
    if (this.context.tools) {
      const toolColor = this.theme === 'green' ? this.getColor('bright') : ansi.green;
      parts.push(`${toolColor}◆ tools${ansi.reset}`);
    }
    
    // Files indicator
    if (this.context.files.length > 0) {
      const fileColor = this.theme === 'green' ? this.getColor('info') : ansi.green;
      const fileIcon = this.theme === 'green' ? `[${this.context.files.length}]` : `📁 ${this.context.files.length}`;
      parts.push(`${fileColor}${fileIcon}${ansi.reset}`);
    }
    
    return parts.join(' │ ');
  }
  
  buildStatusCenter() {
    if (this.status.processing) {
      const color = this.theme === 'green' ? this.getColor('warning') : ansi.green;
      return `${color}${this.getSpinner()} ${this.status.lastActivity}${ansi.reset}`;
    }
    const color = this.theme === 'green' ? this.getColor('dim') : ansi.green;
    return `${color}${this.status.lastActivity}${ansi.reset}`;
  }
  
  buildStatusRight() {
    const parts = [];
    const color = this.theme === 'green' ? this.getColor('dim') : ansi.green;
    
    // Memory status
    const memStats = this.memory.getMemoryStats();
    parts.push(`${color}${memStats.messages} msgs${ansi.reset}`);
    
    // Current directory (truncated)
    const cwd = process.cwd();
    const home = os.homedir();
    let displayPath = cwd.replace(home, '~');
    if (displayPath.length > 30) {
      displayPath = '...' + displayPath.slice(-27);
    }
    parts.push(`${color}${displayPath}${ansi.reset}`);
    
    return parts.join(' │ ');
  }
  
  drawTokenBar() {
    const report = this.memory.getTokenReport();
    const percentage = parseFloat(report.percentage);
    
    // Calculate bar width (leave space for text)
    const textWidth = 20;
    const barWidth = Math.max(20, this.width - textWidth);
    const filled = Math.round((percentage / 100) * barWidth);
    const empty = barWidth - filled;
    
    // Choose color based on usage
    let barColor;
    if (percentage > 90) barColor = ansi.red;
    else if (percentage > 70) barColor = ansi.green;
    else if (percentage > 50) barColor = ansi.green;
    else barColor = ansi.green;
    
    // Draw bar
    let fillColor, emptyColor;
    if (this.theme === 'green') {
      // Use shades of green for the bar
      if (percentage > 90) fillColor = this.getColor('bright');
      else if (percentage > 70) fillColor = this.getColor('primary');
      else fillColor = this.getColor('dim');
      emptyColor = ansi.rgb(43, 62, 34); // Very dark green
    } else {
      fillColor = barColor;
      emptyColor = ansi.green;
    }
    
    const bar = `${fillColor}${'█'.repeat(filled)}${emptyColor}${'░'.repeat(empty)}${ansi.reset}`;
    const text = ` ${percentage.toFixed(1)}% │ ${(report.total / 1000).toFixed(1)}k tokens`;
    
    process.stdout.write(bar + text);
  }
  
  getSpinner() {
    const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return spinners[Math.floor(Date.now() / 100) % spinners.length];
  }
  
  stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }
  
  // Simple theme color helper
  getColor(colorType) {
    if (this.theme === 'green') {
      // Green theme - LLxprt Green shades
      switch(colorType) {
        case 'primary': return ansi.rgb(106, 153, 85);      // LLxprt Green #6a9955
        case 'bright': return ansi.rgb(144, 207, 108);      // Brighter green
        case 'dim': return ansi.rgb(74, 107, 59);           // Darker green
        case 'error': return ansi.rgb(106, 153, 85);        // Green (no red)
        case 'warning': return ansi.rgb(144, 207, 108);     // Bright green for warnings
        case 'info': return ansi.rgb(106, 153, 85);         // Standard green
        default: return ansi.rgb(106, 153, 85);
      }
    } else {
      // Modern theme - normal colors
      switch(colorType) {
        case 'primary': return ansi.cyan;
        case 'bright': return ansi.bright + ansi.cyan;
        case 'dim': return ansi.gray;
        case 'error': return ansi.red;
        case 'warning': return ansi.yellow;
        case 'info': return ansi.blue;
        default: return ansi.reset;
      }
    }
  }
  
  getProjectName() {
    // Extract project name from context or path
    const projectMatch = this.memory.projectContext.match(/^#\s*(.+?)[\n\r]/);
    if (projectMatch) return projectMatch[1].trim();
    return path.basename(process.cwd());
  }
  
  async handleInput(input) {
    if (!input) {
      this.rl.prompt();
      return;
    }
    
    // Increment lines used
    this.linesUsed += 2; // For the prompt and response
    
    // Add to memory
    this.memory.commandHistory.push(input);
    
    // Check if it's a command
    if (input.startsWith('/')) {
      const [cmd, ...args] = input.split(' ');
      if (this.commands[cmd]) {
        await this.commands[cmd](args.join(' '));
      } else {
        this.printError(`Unknown command: ${cmd}`);
      }
      this.rl.prompt();
      return;
    }
    
    // Check for plain "exit" or "quit" commands (without leading slash)
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      this.exit();
      return;
    }

    // Add user message to memory
    this.memory.addMessage('user', input);
    
    // Send to O3
    this.status.processing = true;
    this.status.lastActivity = 'Thinking...';
    this.updateStatusBar();
    
    await this.askO3WithMemory(input);
    
    this.status.processing = false;
    this.status.lastActivity = 'Ready';
    this.updateStatusBar();
    
    this.rl.prompt();
  }
  
  printError(message) {
    const color = this.theme === 'green' ? this.getColor('error') : ansi.red;
    console.log(`${color}✗ ${message}${ansi.reset}`);
  }
  
  printSuccess(message) {
    const color = this.theme === 'green' ? this.getColor('bright') : ansi.green;
    console.log(`${color}✓ ${message}${ansi.reset}`);
  }
  
  printWarning(message) {
    const color = this.theme === 'green' ? this.getColor('warning') : ansi.green;
    console.log(`${color}⚠ ${message}${ansi.reset}`);
  }
  
  async askO3WithMemory(prompt) {
    // Set processing status and reset cancellation flag
    this.status.processing = true;
    this.isCancelled = false;
    
    // Don't jump to bottom, just print where we are
    const o3Color = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    console.log(`\n${ansi.bright}${o3Color}LLxprt:${ansi.reset} `);
    this.linesUsed += 2;
    
    // Build context-aware messages
    const messages = this.memory.buildContext(prompt);
    
    // Add file contents if any
    if (this.context.files.length > 0) {
      const fileContents = await this.loadFilesEfficiently(this.context.files);
      if (fileContents.length > 0) {
        messages[messages.length - 1].content += '\n\n---FILES---\n' + fileContents;
      }
    }
    
    try {
      // Check token usage
      const tokenCheck = this.checkTokenUsage(messages);
      if (tokenCheck.warning) {
        this.printWarning(tokenCheck.warning);
      }
      
      // Update status
      this.status.lastActivity = 'Generating response...';
      this.updateStatusBar();
      
      // Create completion using appropriate API
      if (this.useResponsesAPI()) {
        try {
          // Use Responses API for supported models
          if (this.context.tools && this.context.model.startsWith('o3')) {
            await this.askO3ResponsesAPIWithoutStreaming(messages);
          } else {
            await this.askO3ResponsesAPIStreaming(messages);
          }
        } catch (responsesApiError) {
          // Log to file instead of console to avoid UI interference
          const errorLog = `[askO3WithMemory] Responses API error: ${responsesApiError.status} ${responsesApiError.message}`;
          fs.appendFileSync('/tmp/o3-console-error.log', `${new Date().toISOString()} ${errorLog}\n`);
          
          // If Responses API fails, fallback to Completions API
          if (responsesApiError.status === 404 || responsesApiError.message?.includes('responses')) {
            this.printWarning('Responses API not available, falling back to Completions API');
            this.apiType = 'completions'; // Switch to completions API
            
            if (this.context.tools && this.context.model.startsWith('o3')) {
              await this.askO3NonStreaming(messages);
            } else {
              await this.askO3Streaming(messages);
            }
          } else {
            // Re-throw if it's not a Responses API specific error
            throw responsesApiError;
          }
        }
      } else {
        // Use traditional Completions API
        if (this.context.tools && this.context.model.startsWith('o3')) {
          await this.askO3NonStreaming(messages);
        } else {
          await this.askO3Streaming(messages);
        }
      }
      
    } catch (error) {
      // Check if it was cancelled by user
      if (this.isCancelled) {
        // Already handled by stopCurrentAction
        return;
      }
      
      this.printError(`Error: ${error.message}`);
      
      if (error.message.includes('maximum context length')) {
        this.status.lastActivity = 'Compressing memory...';
        this.updateStatusBar();
        
        await this.memory.compressConversation();
        const compressedMessages = this.memory.buildContext(prompt);
        await this.askO3NonStreaming(compressedMessages);
      }
    } finally {
      // Clean up
      this.status.processing = false;
      this.updateStatusBar();
    }
    
    console.log(); // Extra line for spacing
  }
  
  async askO3Streaming(messages) {
    const apiParams = {
      model: this.context.model,
      messages: messages,
      stream: true,
      tools: this.context.tools ? tokenEfficientTools.getTools() : undefined,
      response_format: this.context.responseFormat === 'json_object' ? { type: 'json_object' } : undefined
    };
    
    if (this.context.model.startsWith('o3')) {
      apiParams.max_completion_tokens = 4096;
    } else {
      apiParams.max_tokens = 4096;
      apiParams.temperature = 0.7;
    }
    
    const stream = await this.openai.chat.completions.create(apiParams);
    
    let fullResponse = '';
    let toolCalls = [];
    
    for await (const chunk of stream) {
      // Check if cancelled
      if (this.isCancelled) {
        break;
      }
      
      const delta = chunk.choices[0]?.delta;
      
      if (delta?.content) {
        fullResponse += delta.content;
        process.stdout.write(delta.content);
        // Count newlines to track lines used
        const newlines = (delta.content.match(/\n/g) || []).length;
        this.linesUsed += newlines;
      }
      
      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          if (!toolCalls[toolCall.index]) {
            toolCalls[toolCall.index] = {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' }
            };
          }
          
          const tc = toolCalls[toolCall.index];
          if (toolCall.id) tc.id = toolCall.id;
          if (toolCall.function?.name) tc.function.name = toolCall.function.name;
          if (toolCall.function?.arguments) tc.function.arguments += toolCall.function.arguments;
        }
      }
    }
    
    this.memory.addMessage('assistant', fullResponse);
    
    if (toolCalls.length > 0 && !this.isCancelled) {
      await this.processToolCalls(toolCalls, messages);
    }
  }
  
  async askO3NonStreaming(messages) {
    const apiParams = {
      model: this.context.model,
      messages: messages,
      tools: this.context.tools ? tokenEfficientTools.getTools() : undefined,
      response_format: this.context.responseFormat === 'json_object' ? { type: 'json_object' } : undefined
    };
    
    if (this.context.model.startsWith('o3')) {
      apiParams.max_completion_tokens = 4096;
    } else {
      apiParams.max_tokens = 4096;
      apiParams.temperature = 0.7;
    }
    
    const response = await this.openai.chat.completions.create(apiParams);
    const message = response.choices[0].message;
    
    if (message.content) {
      console.log(message.content);
      this.memory.addMessage('assistant', message.content);
    }
    
    if (message.tool_calls && message.tool_calls.length > 0 && !this.isCancelled) {
      messages.push(message);
      await this.processToolCalls(message.tool_calls, messages);
    }
  }
  
  async askO3ResponsesAPIStreaming(messages) {
    const { instructions, input } = this.convertMessagesToResponsesFormat(messages);
    
    const apiParams = {
      model: this.context.model,
      instructions: instructions,
      input: input,
      tools: this.context.tools ? this.convertToolsForResponsesAPI(tokenEfficientTools.getTools()) : undefined,
      response_format: this.context.responseFormat === 'json_object' ? { type: 'json_object' } : undefined
    };
    
    // Include conversation_id if we have one
    const conversationId = this.memory.getConversationId();
    if (conversationId) {
      apiParams.conversation_id = conversationId;
    }
    
    if (this.context.model.startsWith('o3')) {
      apiParams.max_output_tokens = 4096;
    } else {
      // Ensure minimum of 16 tokens for Responses API
      apiParams.max_output_tokens = 1000;
    }
    
    // Debug logging to file
    fs.appendFileSync('/tmp/o3-console-debug.log', `\n${new Date().toISOString()} [askO3ResponsesAPIStreaming] Called with params: ${JSON.stringify(apiParams, null, 2)}\n`);
    
    const stream = await this.openai.responses.stream(apiParams);
    
    let fullResponse = '';
    let toolCalls = [];
    let hasReceivedContent = false;
    
    // Handle streaming events
    stream
      .on('response.created', (response) => {
        // Store conversation and response IDs when response is created
        if (response.conversation_id) {
          this.memory.setConversationId(response.conversation_id);
        }
        if (response.id) {
          this.memory.setResponseId(response.id);
        }
      })
      .on('response.output_text.delta', (diff) => {
        if (diff.delta) {
          fullResponse += diff.delta;
          process.stdout.write(diff.delta);
          hasReceivedContent = true;
        }
        // Update sequence number if provided
        if (diff.sequence_number !== undefined) {
          this.memory.setSequenceNumber(diff.sequence_number);
        }
      })
      .on('response.function_call', (call) => {
        // Collect tool calls for processing
        toolCalls.push({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments)
          }
        });
      })
      .on('response.function_call_output', (output) => {
        // Handle function output if needed
        console.log(`\n${ansi.gray}[Function ${output.name} completed]${ansi.reset}\n`);
      })
      .on('error', (error) => {
        fs.appendFileSync('/tmp/o3-console-debug.log', `${new Date().toISOString()} [askO3ResponsesAPIStreaming] Stream error: ${error}\n`);
      });
    
    // Wait for stream to complete
    const result = await stream.finalResponse();
    
    // Log the final response structure
    fs.appendFileSync('/tmp/o3-console-debug.log', `${new Date().toISOString()} [askO3ResponsesAPIStreaming] Final response: ${JSON.stringify(result, null, 2)}\n`);
    
    // Add the assistant's response to memory
    // The fullResponse was built from the streaming deltas
    if (fullResponse) {
      this.memory.addMessage('assistant', fullResponse);
    } else if (result.output_text) {
      // Fallback to output_text from final response if available
      console.log(result.output_text);
      this.memory.addMessage('assistant', result.output_text);
    } else if (result.output && typeof result.output === 'string') {
      // Another fallback for different response formats
      console.log(result.output);
      this.memory.addMessage('assistant', result.output);
    } else {
      // Log warning if no content was received
      fs.appendFileSync('/tmp/o3-console-debug.log', `${new Date().toISOString()} [askO3ResponsesAPIStreaming] WARNING: No output text found! hasReceivedContent=${hasReceivedContent}\n`);
      this.printWarning('No response text received from streaming API');
    }
    
    // Process any tool calls
    if (toolCalls.length > 0 && !this.isCancelled) {
      await this.processToolCalls(toolCalls, messages);
    }
  }
  
  async askO3ResponsesAPIWithoutStreaming(messages) {
    const { instructions, input } = this.convertMessagesToResponsesFormat(messages);
    
    const apiParams = {
      model: this.context.model,
      instructions: instructions,
      input: input,
      tools: this.context.tools ? this.convertToolsForResponsesAPI(tokenEfficientTools.getTools()) : undefined,
      response_format: this.context.responseFormat === 'json_object' ? { type: 'json_object' } : undefined
    };
    
    // Include conversation_id if we have one
    const conversationId = this.memory.getConversationId();
    if (conversationId) {
      apiParams.conversation_id = conversationId;
    }
    
    if (this.context.model.startsWith('o3')) {
      apiParams.max_output_tokens = 4096;
    } else {
      // Ensure minimum of 16 tokens for Responses API
      apiParams.max_output_tokens = 1000;
    }
    
    // Debug logging to file
    fs.appendFileSync('/tmp/o3-console-debug.log', `\n${new Date().toISOString()} [askO3ResponsesAPIWithoutStreaming] Called with params: ${JSON.stringify(apiParams, null, 2)}\n`);
    
    const response = await this.openai.responses.create(apiParams);
    
    // Log the full response structure for debugging
    fs.appendFileSync('/tmp/o3-console-debug.log', `${new Date().toISOString()} [askO3ResponsesAPIWithoutStreaming] Response structure: ${JSON.stringify(response, null, 2)}\n`);
    
    // Store conversation and response IDs
    if (response.conversation_id) {
      this.memory.setConversationId(response.conversation_id);
    }
    if (response.id) {
      this.memory.setResponseId(response.id);
    }
    
    // Extract the actual text from the response - the correct property is output_text
    let outputText = '';
    if (response.output_text) {
      outputText = response.output_text;
    } else if (response.output && typeof response.output === 'string') {
      // Fallback: if output is a string
      outputText = response.output;
    } else if (Array.isArray(response.output)) {
      // Fallback: extract from output array if output_text is not available
      const messageObj = response.output.find(o => o.type === 'message');
      if (messageObj && messageObj.content && messageObj.content[0]) {
        outputText = messageObj.content[0].text;
      }
    }
    
    // Debug log what we extracted
    fs.appendFileSync('/tmp/o3-console-debug.log', `${new Date().toISOString()} [askO3ResponsesAPIWithoutStreaming] Extracted outputText: "${outputText}"\n`);
    
    // Extract tool calls from the output array
    let toolCalls = [];
    if (Array.isArray(response.output)) {
      toolCalls = response.output
        .filter(item => item.type === 'function_call')
        .map(tc => ({
          id: tc.call_id || tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.arguments
          }
        }));
    }
    
    // Also check response.tool_calls for backward compatibility
    if (!toolCalls.length && response.tool_calls && response.tool_calls.length > 0) {
      toolCalls = response.tool_calls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments)
        }
      }));
    }
    
    if (outputText) {
      console.log(outputText);
      this.memory.addMessage('assistant', outputText);
    } else if (toolCalls.length > 0) {
      // If there's no text but there are tool calls, that's normal
      fs.appendFileSync('/tmp/o3-console-debug.log', `${new Date().toISOString()} [askO3ResponsesAPIWithoutStreaming] No text output, but found ${toolCalls.length} tool calls\n`);
    } else {
      // Only warn if there's neither text nor tool calls
      fs.appendFileSync('/tmp/o3-console-debug.log', `${new Date().toISOString()} [askO3ResponsesAPIWithoutStreaming] WARNING: No output text or tool calls found!\n`);
      this.printWarning('No response received from API');
    }
    
    // Process tool calls if present
    if (toolCalls.length > 0 && !this.isCancelled) {
      await this.processToolCalls(toolCalls, messages);
    }
  }
  
  async processToolCalls(toolCalls, messages) {
    // Don't jump to bottom
    const toolColor = this.theme === 'green' ? this.getColor('warning') : ansi.green;
    console.log(`\n${toolColor}◆ Executing ${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''}...${ansi.reset}\n`);
    
    for (const toolCall of toolCalls) {
      // Check if cancelled
      if (this.isCancelled) {
        return;
      }
      
      const functionName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
      
      this.status.lastActivity = `Running ${functionName}...`;
      this.updateStatusBar();
      
      const arrowColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
      console.log(`  ${arrowColor}→ ${functionName}${ansi.reset}`);
      
      let result;
      const startTime = Date.now();
      try {
        console.error(`[o3-console] Calling tool: ${functionName}`);
        result = await tokenEfficientTools.executeToolCall(functionName, args);
        
        this.memory.addToolUsage(functionName, args, result);
        
        if (functionName === 'read_file' || functionName === 'edit_file') {
          this.memory.addFileAccess(args.path, functionName);
        }
        
        // Record diagnostics for edit operations
        if ((functionName === 'edit_file' || functionName === 'multi_edit') && this.config.diagnostics) {
          this.recordEditDiagnostics(functionName, args, result, Date.now() - startTime);
        }
        
        if (result.error) {
          const errorColor = this.theme === 'green' ? this.getColor('error') : ansi.red;
          console.log(`    ${errorColor}✗ ${result.error}${ansi.reset}`);
        } else {
          const successColor = this.theme === 'green' ? this.getColor('bright') : ansi.green;
          console.log(`    ${successColor}✓ Success${ansi.reset}`);
          
          // Show syntax warning if present (from edit_file tool)
          if (result.syntaxWarning) {
            const warnColor = this.theme === 'green' ? this.getColor('warning') : ansi.yellow;
            console.log(`    ${warnColor}⚠ ${result.syntaxWarning.warning}${ansi.reset}`);
            if (result.syntaxWarning.details) {
              console.log(`    ${ansi.gray}  ${result.syntaxWarning.details}${ansi.reset}`);
            }
            console.log(`    ${ansi.gray}  ${result.syntaxWarning.rollback}${ansi.reset}`);
          }
          
          if (result.token_estimate && result.token_estimate > 1000) {
            const tokenColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
            console.log(`    ${tokenColor}~${result.token_estimate} tokens${ansi.reset}`);
          }
        }
      } catch (error) {
        result = { error: error.message };
        const errorColor = this.theme === 'green' ? this.getColor('error') : ansi.red;
        console.log(`    ${errorColor}✗ ${error.message}${ansi.reset}`);
      }
      
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result)
      });
    }
    
    // Don't jump to bottom
    const o3Color = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    console.log(`\n${ansi.bright}${o3Color}O3 (continued):${ansi.reset} `);
    this.status.lastActivity = 'Generating follow-up...';
    this.updateStatusBar();
    
    // Check if cancelled before continuing
    if (this.isCancelled) {
      return;
    }
    
    // Use the appropriate API based on the model
    if (this.useResponsesAPI()) {
      try {
        if (this.context.tools && this.context.model.startsWith('o3')) {
          await this.askO3ResponsesAPIWithoutStreaming(messages);
        } else {
          await this.askO3ResponsesAPIStreaming(messages);
        }
      } catch (error) {
        // If Responses API fails, fallback to Completions API
        fs.appendFileSync('/tmp/o3-console-error.log', `${new Date().toISOString()} [processToolCalls] Responses API error: ${error.status} ${error.message}\n`);
        if (error.status === 404 || error.message?.includes('responses')) {
          this.printWarning('Responses API not available, falling back to Completions API');
          this.apiType = 'completions';
          
          if (this.context.tools && this.context.model.startsWith('o3')) {
            await this.askO3NonStreaming(messages);
          } else {
            await this.askO3Streaming(messages);
          }
        } else {
          throw error;
        }
      }
    } else {
      if (this.context.model.startsWith('o3')) {
        await this.askO3NonStreaming(messages);
      } else {
        await this.askO3Streaming(messages);
      }
    }
  }
  
  async loadFilesEfficiently(filePaths) {
    const maxTokensForFiles = 20000;
    let totalTokens = 0;
    const contents = [];
    
    for (const filePath of filePaths) {
      const result = await tokenEfficientTools.readFile({ 
        path: filePath,
        limit: 500
      });
      
      if (result.error) {
        contents.push(`\n${filePath}: Error - ${result.error}\n`);
        continue;
      }
      
      const estimatedTokens = result.token_estimate || 2000;
      if (totalTokens + estimatedTokens > maxTokensForFiles) {
        contents.push(`\n${filePath}: [Skipped - token limit reached]\n`);
        continue;
      }
      
      const ext = path.extname(filePath).slice(1) || 'txt';
      contents.push(`\n${filePath}:\n\`\`\`${ext}\n${result.content}\n\`\`\`\n`);
      totalTokens += estimatedTokens;
      
      this.memory.addFileTokens(result.content);
    }
    
    return contents.join('');
  }
  
  checkTokenUsage(messages) {
    const estimatedTokens = messages.reduce((sum, msg) => 
      sum + this.memory.estimateTokens(msg.content), 0
    );
    
    const report = this.memory.getTokenReport();
    
    if (report.status === 'critical') {
      return {
        warning: `Critical token usage: ${report.percentage}% - Consider starting new conversation`,
        shouldCompress: true
      };
    } else if (report.status === 'high') {
      return {
        warning: `High token usage: ${report.percentage}% - Being selective with file reads`,
        shouldCompress: false
      };
    }
    
    return { ok: true };
  }
  
  // ------------------------------
  // Additional configuration commands
  // ------------------------------
  setApiKey(key) {
    if (!key) {
      this.printError('Usage: /key <api_key>');
      return;
    }
    // Mask key when displaying
    const masked = key.slice(0, 4) + '...' + key.slice(-4);
    this.apiKey = key;
    // Persist in key file if path defined
    try {
      fs.writeFileSync(this.config.apiKeyFile, key + '\n', { mode: 0o600 });
      this.printSuccess(`API key saved (${masked})`);
    } catch (err) {
      this.printError(`Failed to save key: ${err.message}`);
    }
    this.initOpenAI();
  }

  setKeyFile(filePath) {
    if (!filePath) {
      this.printError('Usage: /keyfile <path>');
      return;
    }
    this.config.apiKeyFile = path.resolve(this.context.baseDir, filePath);
    this.saveConfig();
    this.printSuccess(`Key file set to ${this.config.apiKeyFile}`);
  }

  setEndpoint(url) {
    if (!url) {
      this.printError('Usage: /endpoint <url>');
      return;
    }
    this.config.endpoint = url;
    this.saveConfig();
    this.printSuccess(`Endpoint set to ${url}`);
    this.initOpenAI();
  }

  setResponseFormat(fmt) {
    if (!fmt || (fmt !== 'text' && fmt !== 'json_object')) {
      this.printError('Usage: /response_format <text|json_object>');
      return;
    }
    this.context.responseFormat = fmt;
    this.printSuccess(`Response format set to ${fmt}`);
  }

  // Command implementations
  
  showHelp() {
    // Build descriptions map using defaults, can expand for unknowns
    const DESCRIPTIONS = {
      '/help': 'Show this help',
      '/h': 'Alias for /help',
      '/exit': 'Exit console',
      '/quit': 'Alias for /exit',
      '/history': 'Show recent commands',
      '/save': 'Save current conversation to file',
      '/model': 'Set model (e.g. o3, gpt-4o)',
      '/tools': 'Toggle tools on/off',
      '/theme': 'Cycle theme (modern/green)',
      '/key': 'Set & save API key',
      '/keyfile': 'Set key file location',
      '/endpoint': 'Set API endpoint URL',
      '/response_format': 'Preferred assistant response format',
      '/config': 'Show current configuration summary',
      '/memory': 'Show memory statistics',
      '/tokens': 'Show token usage',
      '/project': 'Edit project context file',
      '/todos': 'Display task list',
      '/file': 'Add file to context',
      '/files': 'List context files',
      '/clear': 'Remove all files from context',
      '/cd': 'Change working directory',
      '/pwd': 'Show current directory',
      '/agent': 'Run autonomous agent for complex tasks',
      '/plan': 'Create execution plan for approval',
      '/execute_plan': 'Execute the current plan',
      '/exit_plan_mode': 'Exit plan mode and execute'
    };

    // Categorise commands for nicer layout
    const CATEGORIES = {
      General: ['/help','/h','/exit','/quit','/history','/save'],
      Configuration: ['/model','/tools','/theme','/key','/keyfile','/endpoint','/response_format','/config'],
      Memory: ['/memory','/tokens','/project','/todos'],
      Files: ['/file','/files','/clear'],
      Navigation: ['/cd','/pwd'],
      Advanced: ['/agent','/plan','/execute_plan','/exit_plan_mode']
    };

    // Add uncategorised commands to "Other"
    const allCmds = Object.keys(this.commands);
    const known = new Set(Object.values(CATEGORIES).flat());
    const otherCmds = allCmds.filter(c => !known.has(c));
    if (otherCmds.length) {
      CATEGORIES.Other = otherCmds;
    }

    const cmdColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    const sectionColor = this.theme === 'green' ? this.getColor('warning') : ansi.green;

    let output = `\n${ansi.bright}${cmdColor}Commands:${ansi.reset}\n`;

    for (const [section, cmds] of Object.entries(CATEGORIES)) {
      output += `\n${sectionColor}${section}:${ansi.reset}\n`;
      cmds.forEach(cmd => {
        const desc = DESCRIPTIONS[cmd] || '';
        const padding = ' '.repeat(Math.max(1, 18 - cmd.length));
        output += `  ${cmd}${padding}${desc}\n`;
      });
    }

    console.log(output);
    
    // Add special features section
    const featureColor = this.theme === 'green' ? this.getColor('primary') : ansi.cyan;
    console.log(`\n${ansi.bright}${featureColor}Special Features:${ansi.reset}`);
    console.log(`  ${ansi.bright}@${ansi.reset}             Type @ to autocomplete and add files to context`);
    console.log(`                ${ansi.gray}Use Tab/↑/↓ to navigate, Enter to select${ansi.reset}`);
    console.log(`  ${ansi.bright}ESC${ansi.reset}           Cancel current action or close autocomplete`);
    console.log(`  ${ansi.bright}Paste Mode${ansi.reset}    Automatically detects multi-line pastes`);
  }
  
  async showMemory() {
    const stats = this.memory.getMemoryStats();
    const tokens = stats.tokens;
    
    const titleColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    const dividerColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
    console.log(`\n${ansi.bright}${titleColor}Memory Statistics${ansi.reset}`);
    console.log(`${dividerColor}${'─'.repeat(40)}${ansi.reset}`);
    
    // Messages and files
    console.log(`Messages:     ${ansi.bright}${stats.messages}${ansi.reset}`);
    console.log(`Files:        ${ansi.bright}${stats.files}${ansi.reset} accessed`);
    console.log(`Edits:        ${ansi.bright}${stats.edits}${ansi.reset} made`);
    console.log(`Session age:  ${ansi.bright}${stats.session.age}${ansi.reset} minutes`);
    
    console.log(`\n${ansi.bright}${titleColor}Token Breakdown${ansi.reset}`);
    console.log(`${dividerColor}${'─'.repeat(40)}${ansi.reset}`);
    
    // Token breakdown with visual bars
    const categories = this.theme === 'green' ? [
      { name: 'System', value: tokens.usage.system, color: this.getColor('dim') },
      { name: 'Project', value: tokens.usage.project, color: this.getColor('primary') },
      { name: 'Conversation', value: tokens.usage.conversation, color: this.getColor('bright') },
      { name: 'Files', value: tokens.usage.files, color: this.getColor('warning') },
      { name: 'Tools', value: tokens.usage.tools, color: this.getColor('primary') }
    ] : [
      { name: 'System', value: tokens.usage.system, color: ansi.green },
      { name: 'Project', value: tokens.usage.project, color: ansi.green },
      { name: 'Conversation', value: tokens.usage.conversation, color: ansi.green },
      { name: 'Files', value: tokens.usage.files, color: ansi.green },
      { name: 'Tools', value: tokens.usage.tools, color: ansi.green }
    ];
    
    const maxValue = Math.max(...categories.map(c => c.value));
    const barWidth = 20;
    
    categories.forEach(cat => {
      const percentage = maxValue > 0 ? (cat.value / maxValue) : 0;
      const filled = Math.round(percentage * barWidth);
      const emptyColor = this.theme === 'green' ? ansi.rgb(43, 62, 34) : ansi.green;
      const bar = cat.color + '█'.repeat(filled) + emptyColor + '░'.repeat(barWidth - filled) + ansi.reset;
      console.log(`${cat.name.padEnd(12)} ${bar} ${cat.value.toLocaleString()}`);
    });
    
    console.log(`\n${ansi.bright}Total:${ansi.reset}       ${tokens.total.toLocaleString()} / ${tokens.limit.toLocaleString()} (${tokens.percentage}%)`);
    
    // Status indicator
    const statusColor = this.theme === 'green' ? 
                       (tokens.status === 'critical' ? this.getColor('bright') :
                        tokens.status === 'high' ? this.getColor('warning') :
                        tokens.status === 'medium' ? this.getColor('primary') :
                        this.getColor('dim')) :
                       (tokens.status === 'critical' ? ansi.red :
                        tokens.status === 'high' ? ansi.green :
                        tokens.status === 'medium' ? ansi.green :
                        ansi.green);
    console.log(`${ansi.bright}Status:${ansi.reset}      ${statusColor}${tokens.status}${ansi.reset}`);
  }
  
  async showTokens() {
    const report = this.memory.getTokenReport();
    const percentage = parseFloat(report.percentage);
    
    const titleColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    const dividerColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
    console.log(`\n${ansi.bright}${titleColor}Token Usage${ansi.reset}`);
    console.log(`${dividerColor}${'─'.repeat(40)}${ansi.reset}`);
    
    // Large visual bar
    const barWidth = Math.min(60, this.width - 10);
    const filled = Math.round((percentage / 100) * barWidth);
    const empty = barWidth - filled;
    
    let barColor;
    if (percentage > 90) barColor = ansi.red;
    else if (percentage > 70) barColor = ansi.green;
    else if (percentage > 50) barColor = ansi.green;
    else barColor = ansi.green;
    
    const emptyBarColor = this.theme === 'green' ? ansi.rgb(43, 62, 34) : ansi.green;
    console.log(`\n  ${barColor}${'█'.repeat(filled)}${emptyBarColor}${'░'.repeat(empty)}${ansi.reset}`);
    console.log(`\n  ${ansi.bright}${percentage.toFixed(1)}%${ansi.reset} used`);
    console.log(`  ${report.total.toLocaleString()} / ${report.limit.toLocaleString()} tokens`);
    console.log(`  ${report.remaining.toLocaleString()} remaining`);
    
    if (percentage > 70) {
      const warnColor = this.theme === 'green' ? this.getColor('warning') : ansi.green;
      console.log(`\n  ${warnColor}⚠ Consider compressing or starting new session${ansi.reset}`);
    }
  }
  
  setModel(modelName) {
    if (!modelName) {
      const modelColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
      console.log(`Current model: ${modelColor}${this.context.model}${ansi.reset}`);
      return;
    }
    this.context.model = modelName;
    // Re-detect API type when model changes
    this.apiType = this.detectAPIType();
    const apiInfo = this.useResponsesAPI() ? ' (using Responses API)' : ' (using Completions API)';
    this.printSuccess(`Model set to ${modelName}${apiInfo}`);
    this.updateStatusBar();
  }
  
  toggleTools() {
    this.context.tools = arguments.length === 0 ? this.context.tools : !this.context.tools;
    this.printSuccess(`Tools ${this.context.tools ? 'enabled' : 'disabled'}`);
    this.rl.setPrompt(this.getPrompt());
    this.updateStatusBar();
  }
  
  cycleTheme() {
    this.theme = this.theme === 'modern' ? 'green' : 'modern';
    
    // Apply terminal colors for the selected theme
    if (this.theme === 'green') {
      this.applyGreenTerminalColors();
    } else {
      this.resetTerminalColors();
    }
    
    // Temporarily reset scroll region for full redraw
    process.stdout.write(ansi.resetScrollRegion);
    
    this.clearScreen();
    this.printHeader();
    this.printDivider();
    this.setupStatusBar();
    
    // Re-establish scroll region
    process.stdout.write(ansi.setScrollRegion(1, this.scrollBottom));
    
    // Position in content area
    process.stdout.write(ansi.cursorPosition(5, 1));
    
    this.printSuccess(`Switched to ${this.theme} theme`);
    
    // Force readline to refresh with new theme prompt
    this.rl._prompt = this.getPrompt();
    this.rl.setPrompt(this.getPrompt());
    this.rl._refreshLine();
  }
  
  stopCurrentAction() {
    if (this.status.processing) {
      this.isCancelled = true;
      this.status.processing = false;
      this.status.lastActivity = 'Action cancelled';
      this.updateStatusBar();
      this.printWarning('Action cancelled by user (ESC)');
      
      // Force a new line and prompt
      console.log();
      this.rl.prompt();
    }
  }

  // File Autocomplete Methods
  startFileAutocomplete() {
    this.fileAutocomplete.active = true;
    this.fileAutocomplete.startPosition = this.rl.cursor;
    this.fileAutocomplete.searchTerm = '';
    this.fileAutocomplete.selectedIndex = 0;
    this.searchFiles('');
  }

  cancelFileAutocomplete() {
    if (!this.fileAutocomplete.active) return;
    
    this.fileAutocomplete.active = false;
    this.fileAutocomplete.suggestions = [];
    this.clearAutocompleteSuggestions();
    this.rl._refreshLine();
  }

  updateFileAutocomplete() {
    if (!this.fileAutocomplete.active) return;
    
    const line = this.rl.line;
    const cursor = this.rl.cursor;
    
    // Find the @ position
    let atPos = -1;
    for (let i = cursor - 1; i >= 0; i--) {
      if (line[i] === '@') {
        atPos = i;
        break;
      }
      if (line[i] === ' ') break;
    }
    
    if (atPos === -1) {
      this.cancelFileAutocomplete();
      return;
    }
    
    // Extract search term (everything after @)
    this.fileAutocomplete.searchTerm = line.substring(atPos + 1, cursor);
    this.fileAutocomplete.startPosition = atPos;
    this.searchFiles(this.fileAutocomplete.searchTerm);
  }

  async searchFiles(searchTerm) {
    try {
      const { execSync } = require('child_process');
      
      // Use find to search for files
      let findCmd;
      if (searchTerm) {
        // Search for files containing the search term
        findCmd = `find . -type f -name "*${searchTerm}*" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -20`;
      } else {
        // Show recently modified files
        findCmd = `find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/.*" 2>/dev/null | xargs ls -t 2>/dev/null | head -20`;
      }
      
      const result = execSync(findCmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
      const files = result.split('\n').filter(f => f);
      
      this.fileAutocomplete.suggestions = files.map(f => {
        // Clean up path (remove ./ prefix)
        return f.startsWith('./') ? f.substring(2) : f;
      });
      
      this.fileAutocomplete.selectedIndex = 0;
      this.showAutocompleteSuggestions();
    } catch (error) {
      // If search fails, just clear suggestions
      this.fileAutocomplete.suggestions = [];
      this.showAutocompleteSuggestions();
    }
  }

  getCursorRow() {
    // Estimate cursor row based on lines used
    // This is approximate but sufficient for our needs
    return this.linesUsed;
  }

  showAutocompleteSuggestions() {
    if (!this.fileAutocomplete.active || this.fileAutocomplete.suggestions.length === 0) {
      this.clearAutocompleteSuggestions();
      return;
    }
    
    // First clear any existing suggestions
    this.clearAutocompleteSuggestions();
    
    // Check if we're near the bottom of the screen
    // We need space for autocomplete (up to 6 lines)
    const currentRow = this.getCursorRow();
    const spaceNeeded = 6; // Max autocomplete lines
    const bottomThreshold = this.scrollBottom - spaceNeeded;
    
    if (currentRow >= bottomThreshold) {
      // Scroll the content area up by 10 lines
      for (let i = 0; i < 10; i++) {
        process.stdout.write('\n');
      }
      // Move cursor back up 10 lines
      process.stdout.write(ansi.cursorUp(10));
    }
    
    // Temporarily reset scroll region to allow writing below
    process.stdout.write(ansi.resetScrollRegion);
    
    // Save cursor and move below
    process.stdout.write(ansi.saveCursor);
    process.stdout.write('\n');
    
    // Show suggestions (max 5) - window around selected item
    const maxShow = Math.min(5, this.fileAutocomplete.suggestions.length);
    
    // Calculate window to keep selected item in view
    let startIdx = 0;
    if (this.fileAutocomplete.suggestions.length > maxShow) {
      // Keep selected item in the middle of the window when possible
      startIdx = Math.max(0, Math.min(
        this.fileAutocomplete.selectedIndex - Math.floor(maxShow / 2),
        this.fileAutocomplete.suggestions.length - maxShow
      ));
    }
    const endIdx = startIdx + maxShow;
    
    for (let i = startIdx; i < endIdx; i++) {
      const suggestion = this.fileAutocomplete.suggestions[i];
      const isSelected = i === this.fileAutocomplete.selectedIndex;
      
      // Clear line and show suggestion
      process.stdout.write(ansi.clearLine);
      
      if (isSelected) {
        // Just use > symbol and bright text for selected
        process.stdout.write(` > ${suggestion}\n`);
      } else {
        process.stdout.write(`   ${suggestion}\n`);
      }
    }
    
    // Show count if more
    if (this.fileAutocomplete.suggestions.length > maxShow) {
      process.stdout.write(ansi.clearLine);
      process.stdout.write(`   ... ${this.fileAutocomplete.suggestions.length - maxShow} more\n`);
    }
    
    // Restore cursor position
    process.stdout.write(ansi.restoreCursor);
    
    // Re-establish scroll region
    process.stdout.write(ansi.setScrollRegion(1, this.scrollBottom));
  }

  clearAutocompleteSuggestions() {
    // Temporarily reset scroll region
    process.stdout.write(ansi.resetScrollRegion);
    
    // Save cursor
    process.stdout.write(ansi.saveCursor);
    
    // Move down and clear each line
    for (let i = 1; i <= 6; i++) {
      process.stdout.write(ansi.cursorDown(1));
      process.stdout.write(ansi.clearLine);
    }
    
    // Restore cursor
    process.stdout.write(ansi.restoreCursor);
    
    // Re-establish scroll region
    process.stdout.write(ansi.setScrollRegion(1, this.scrollBottom));
  }

  nextAutocompleteSuggestion() {
    if (!this.fileAutocomplete.active || this.fileAutocomplete.suggestions.length === 0) return;
    
    const prevIndex = this.fileAutocomplete.selectedIndex;
    this.fileAutocomplete.selectedIndex = 
      (this.fileAutocomplete.selectedIndex + 1) % this.fileAutocomplete.suggestions.length;
    
    // Only update display if index actually changed
    if (prevIndex !== this.fileAutocomplete.selectedIndex) {
      this.showAutocompleteSuggestions();
    }
  }

  previousAutocompleteSuggestion() {
    if (!this.fileAutocomplete.active || this.fileAutocomplete.suggestions.length === 0) return;
    
    this.fileAutocomplete.selectedIndex = 
      (this.fileAutocomplete.selectedIndex - 1 + this.fileAutocomplete.suggestions.length) % 
      this.fileAutocomplete.suggestions.length;
    this.showAutocompleteSuggestions();
  }

  acceptAutocompleteSuggestion() {
    if (!this.fileAutocomplete.active || this.fileAutocomplete.suggestions.length === 0) return;
    
    const selectedFile = this.fileAutocomplete.suggestions[this.fileAutocomplete.selectedIndex];
    const line = this.rl.line;
    const cursor = this.rl.cursor;
    
    // Find the @ position
    let atPos = this.fileAutocomplete.startPosition;
    if (atPos === undefined) {
      // Find @ before cursor
      for (let i = cursor - 1; i >= 0; i--) {
        if (line[i] === '@') {
          atPos = i;
          break;
        }
      }
    }
    
    // Replace from @ to cursor with the selected file
    const before = line.substring(0, atPos);
    const after = line.substring(cursor);
    const newLine = before + '@' + selectedFile + ' ' + after;
    
    // Update readline
    this.rl.line = newLine;
    this.rl.cursor = before.length + selectedFile.length + 2; // +2 for @ and space
    
    // Add file to context
    this.addFileToContext(selectedFile);
    
    // Clean up
    this.cancelFileAutocomplete();
    this.rl._refreshLine();
  }

  addFileToContext(filePath) {
    const fullPath = path.resolve(this.context.baseDir, filePath);
    if (fs.existsSync(fullPath)) {
      if (!this.context.files.includes(fullPath)) {
        this.context.files.push(fullPath);
        // Quick inline confirmation
        const fileColor = this.theme === 'green' ? this.getColor('bright') : ansi.green;
        process.stdout.write(`${fileColor}[+${path.basename(filePath)}]${ansi.reset} `);
      }
    }
  }

  exit() {
    clearInterval(this.statusInterval);
    
    // Reset scroll region
    process.stdout.write(ansi.resetScrollRegion);
    
    // Clear status bar area
    process.stdout.write(ansi.cursorPosition(this.height - 2, 1));
    process.stdout.write(ansi.clearLine);
    process.stdout.write(ansi.cursorPosition(this.height - 1, 1));
    process.stdout.write(ansi.clearLine);
    process.stdout.write(ansi.cursorPosition(this.height, 1));
    process.stdout.write(ansi.clearLine);
    
    const saveColor = this.theme === 'green' ? this.getColor('info') : ansi.green;
    const successColor = this.theme === 'green' ? this.getColor('bright') : ansi.green;
    const goodbyeColor = this.theme === 'green' ? this.getColor('info') : ansi.green;
    
    console.log(`\n${saveColor}Saving session...${ansi.reset}`);
    this.memory.saveSession();
    console.log(`${successColor}✓ Session saved${ansi.reset}`);
    console.log(`${goodbyeColor}Goodbye!${ansi.reset}\n`);
    
    // Reset terminal colors before exit
    this.resetTerminalColors();
    
    process.exit(0);
  }
  
  // Simplified command implementations...
  addFile(filePath) {
    if (!filePath) {
      this.printError('Please specify a file path');
      return;
    }
    
    const fullPath = path.resolve(this.context.baseDir, filePath);
    if (!fs.existsSync(fullPath)) {
      this.printError(`File not found: ${filePath}`);
      return;
    }
    
    if (!this.context.files.includes(fullPath)) {
      this.context.files.push(fullPath);
      this.memory.addFileAccess(filePath, 'context');
      this.printSuccess(`Added file: ${filePath}`);
      
      const stats = fs.statSync(fullPath);
      const estimatedTokens = Math.ceil(stats.size / 4);
      if (estimatedTokens > 5000) {
        this.printWarning(`Large file (~${estimatedTokens} tokens)`);
      }
      
      this.updateStatusBar();
    } else {
      this.printWarning('File already in context');
    }
  }
  
  listFiles() {
    if (this.context.files.length === 0) {
      console.log(`${ansi.green}No files in context${ansi.reset}`);
      return;
    }
    
    const headerColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    console.log(`\n${headerColor}Files in context:${ansi.reset}`);
    this.context.files.forEach((file, index) => {
      const relativePath = path.relative(this.context.baseDir, file);
      const stats = fs.statSync(file);
      const tokens = Math.ceil(stats.size / 4);
      console.log(`  ${index + 1}. ${relativePath} ${ansi.green}(~${tokens} tokens)${ansi.reset}`);
    });
  }
  
  clearFiles() {
    this.context.files = [];
    this.printSuccess('Cleared all files from context');
    this.updateStatusBar();
  }
  
  changeDirectory(newPath) {
    if (!newPath) {
      this.printError('Please specify a directory');
      return;
    }
    
    const fullPath = path.resolve(this.context.baseDir, newPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
      this.printError(`Directory not found: ${newPath}`);
      return;
    }
    
    this.context.baseDir = fullPath;
    process.chdir(fullPath);
    this.printSuccess(`Changed to: ${fullPath}`);
    this.updateStatusBar();
  }
  
  printWorkingDirectory() {
    const dirColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    console.log(`${dirColor}${this.context.baseDir}${ansi.reset}`);
  }
  
  showHistory() {
    const recent = this.memory.commandHistory.slice(-20);
    if (recent.length === 0) {
      console.log(`${ansi.green}No history yet${ansi.reset}`);
      return;
    }
    
    const histColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    console.log(`\n${histColor}Recent commands:${ansi.reset}`);
    recent.forEach((cmd, index) => {
      console.log(`  ${ansi.green}${index + 1}.${ansi.reset} ${cmd}`);
    });
  }
  
  async saveConversation(filename) {
    if (!filename) {
      filename = `o3-conversation-${new Date().toISOString().slice(0, 10)}.md`;
    }
    
    const messages = this.memory.messages.map(m => {
      const role = m.role === 'user' ? '**You**' : '**O3**';
      return `${role}: ${m.content}`;
    }).join('\n\n');
    
    const filePath = path.join(this.context.baseDir, filename);
    
    try {
      fs.writeFileSync(filePath, messages);
      this.printSuccess(`Conversation saved to: ${filename}`);
    } catch (error) {
      this.printError(`Error saving: ${error.message}`);
    }
  }
  
  showConfig() {
    const memStats = this.memory.getMemoryStats();
    
    const titleColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    const dividerColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
    console.log(`\n${ansi.bright}${titleColor}Configuration${ansi.reset}`);
    console.log(`${dividerColor}${'─'.repeat(40)}${ansi.reset}`);
    
    console.log(`Model:        ${ansi.bright}${this.context.model}${ansi.reset}`);
    const enabledColor = this.theme === 'green' ? this.getColor('bright') : ansi.green;
    const disabledColor = this.theme === 'green' ? this.getColor('error') : ansi.red;
    console.log(`Tools:        ${this.context.tools ? enabledColor + 'enabled' : disabledColor + 'disabled'}${ansi.reset}`);
    console.log(`Directory:    ${ansi.bright}${this.context.baseDir}${ansi.reset}`);
    console.log(`Files:        ${ansi.bright}${this.context.files.length}${ansi.reset} in context`);
    console.log(`Session:      ${ansi.bright}${memStats.messages}${ansi.reset} messages, ${ansi.bright}${memStats.session.age}${ansi.reset}m old`);
    console.log(`Tokens:       ${this.getTokenStatusColor(memStats.tokens)}${memStats.tokens.percentage}%${ansi.reset} (${memStats.tokens.status})`);
  }
  
  getTokenStatusColor(tokens) {
    if (this.theme === 'green') {
      return tokens.status === 'critical' ? this.getColor('bright') :
             tokens.status === 'high' ? this.getColor('warning') :
             tokens.status === 'medium' ? this.getColor('primary') :
             this.getColor('dim');
    } else {
      return tokens.status === 'critical' ? ansi.red :
             tokens.status === 'high' ? ansi.green :
             tokens.status === 'medium' ? ansi.green :
             ansi.green;
    }
  }
  
  async showTodos() {
    try {
      const result = await tokenEfficientTools.todoRead({});
      
      if (result.todos && result.todos.length > 0) {
        const titleColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
        const dividerColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
        console.log(`\n${ansi.bright}${titleColor}Tasks${ansi.reset}`);
        console.log(`${dividerColor}${'─'.repeat(40)}${ansi.reset}\n`);
        
        const grouped = {
          in_progress: result.todos.filter(t => t.status === 'in_progress'),
          pending: result.todos.filter(t => t.status === 'pending'),
          completed: result.todos.filter(t => t.status === 'completed')
        };
        
        if (grouped.in_progress.length > 0) {
          const progressColor = this.theme === 'green' ? this.getColor('warning') : ansi.green;
          const priorityColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
          console.log(`${progressColor}◆ In Progress${ansi.reset}`);
          grouped.in_progress.forEach(todo => {
            console.log(`  ${todo.content} ${priorityColor}[${todo.priority}]${ansi.reset}`);
          });
          console.log();
        }
        
        if (grouped.pending.length > 0) {
          const pendingColor = this.theme === 'green' ? this.getColor('info') : ansi.green;
          const priorityColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
          console.log(`${pendingColor}◆ Pending${ansi.reset}`);
          grouped.pending.forEach(todo => {
            console.log(`  ${todo.content} ${priorityColor}[${todo.priority}]${ansi.reset}`);
          });
          console.log();
        }
        
        if (grouped.completed.length > 0) {
          const completedColor = this.theme === 'green' ? this.getColor('bright') : ansi.green;
          const dimColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
          console.log(`${completedColor}◆ Completed${ansi.reset}`);
          grouped.completed.slice(0, 5).forEach(todo => {
            console.log(`  ${dimColor}${todo.content}${ansi.reset}`);
          });
          if (grouped.completed.length > 5) {
            const moreColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
            console.log(`  ${moreColor}... and ${grouped.completed.length - 5} more${ansi.reset}`);
          }
        }
      } else {
        const noTaskColor = this.theme === 'green' ? this.getColor('dim') : ansi.green;
        console.log(`${noTaskColor}No tasks yet${ansi.reset}`);
      }
    } catch (error) {
      this.printError(`Error reading todos: ${error.message}`);
    }
  }
  
  async editProject() {
    const openColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    console.log(`${openColor}Opening project file: ${this.memory.projectFile}${ansi.reset}`);
    
    const editor = process.env.EDITOR || 'nano';
    const { spawn } = require('child_process');
    
    // Hide status bar during editor
    process.stdout.write(ansi.cursorPosition(this.height - 2, 1));
    process.stdout.write(ansi.clearLine);
    process.stdout.write(ansi.cursorPosition(this.height - 1, 1));
    process.stdout.write(ansi.clearLine);
    process.stdout.write(ansi.cursorPosition(this.height, 1));
    process.stdout.write(ansi.clearLine);
    
    const child = spawn(editor, [this.memory.projectFile], {
      stdio: 'inherit'
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        this.memory.loadProjectContext();
        this.printSuccess('Reloaded project context');
      }
      this.updateStatusBar();
      this.rl.prompt();
    });
  }
  
  // Agent Mode implementation
  async runAgent(taskDescription) {
    if (!taskDescription) {
      this.printError('Usage: /agent <task description>');
      this.printInfo('Example: /agent find all console.log statements and remove them');
      return;
    }
    
    this.status.processing = true;
    this.status.lastActivity = 'Agent running...';
    this.updateStatusBar();
    
    const startColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    console.log(`\n${startColor}🤖 Starting Agent Mode${ansi.reset}`);
    console.log(`Task: ${taskDescription}\n`);
    
    try {
      const result = await this.agentMode.execute(taskDescription, {
        baseDir: this.context.baseDir,
        model: this.context.model
      });
      
      if (result.success) {
        console.log(`\n${result.report}`);
        this.printSuccess(`Agent completed in ${Math.round(result.duration / 1000)}s`);
        
        if (result.filesAccessed.length > 0) {
          console.log(`\nFiles accessed: ${result.filesAccessed.join(', ')}`);
        }
      } else {
        this.printError(`Agent failed: ${result.error}`);
      }
      
    } catch (error) {
      this.printError(`Agent error: ${error.message}`);
    } finally {
      this.status.processing = false;
      this.status.lastActivity = 'Ready';
      this.updateStatusBar();
    }
  }
  
  // Plan Mode implementation
  async createPlan(taskDescription) {
    if (!taskDescription) {
      this.printError('Usage: /plan <task description>');
      this.printInfo('Example: /plan migrate from Express to Fastify');
      return;
    }
    
    this.status.processing = true;
    this.status.lastActivity = 'Creating plan...';
    this.updateStatusBar();
    
    const planColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    console.log(`\n${planColor}📋 Creating Execution Plan${ansi.reset}`);
    
    try {
      const plan = await this.planMode.createPlan(taskDescription, {
        files: this.context.files,
        baseDir: this.context.baseDir
      });
      
      console.log(`\n${plan}`);
      
      const promptColor = this.theme === 'green' ? this.getColor('warning') : ansi.green;
      console.log(`\n${promptColor}Plan created. Use /execute_plan to run or /exit_plan_mode to approve and execute.${ansi.reset}`);
      
      // Update status to show plan mode
      this.status.mode = 'plan';
      
    } catch (error) {
      this.printError(`Plan creation failed: ${error.message}`);
    } finally {
      this.status.processing = false;
      this.status.lastActivity = 'Plan ready';
      this.updateStatusBar();
    }
  }
  
  async executePlan() {
    if (!this.planMode.getCurrentPlan()) {
      this.printError('No plan available. Create one with /plan <task>');
      return;
    }
    
    this.status.processing = true;
    this.status.lastActivity = 'Executing plan...';
    this.updateStatusBar();
    
    const execColor = this.theme === 'green' ? this.getColor('primary') : ansi.green;
    console.log(`\n${execColor}🚀 Executing Plan${ansi.reset}\n`);
    
    try {
      const result = await this.planMode.executePlan(true); // Skip approval since user explicitly called execute
      
      if (result.success) {
        this.printSuccess(`Plan executed successfully! ${result.stepsCompleted}/${result.stepsTotal} steps completed.`);
      } else {
        this.printError(`Plan execution failed. ${result.stepsCompleted}/${result.stepsTotal} steps completed.`);
        
        if (result.errors.length > 0) {
          console.log('\nErrors:');
          result.errors.forEach(e => {
            console.log(`  Step ${e.step}: ${e.error}`);
          });
        }
      }
      
      // Clear plan after execution
      this.planMode.clearPlan();
      this.status.mode = 'chat';
      
    } catch (error) {
      this.printError(`Execution error: ${error.message}`);
    } finally {
      this.status.processing = false;
      this.status.lastActivity = 'Ready';
      this.updateStatusBar();
    }
  }
  
  async exitPlanMode() {
    if (!this.planMode.getCurrentPlan()) {
      this.printError('No plan active');
      return;
    }
    
    // This simulates the Claude Code behavior where exit_plan_mode approves and executes
    const confirmColor = this.theme === 'green' ? this.getColor('warning') : ansi.green;
    console.log(`\n${confirmColor}Approving and executing plan...${ansi.reset}`);
    
    await this.executePlan();
  }
  
  async testResponsesAPI() {
    console.log('\n[testResponsesAPI] Starting test...');
    console.log('  Current model:', this.context.model);
    console.log('  openai.responses exists?', !!this.openai.responses);
    
    if (!this.openai.responses) {
      console.error('ERROR: openai.responses is undefined!');
      return;
    }
    
    console.log('  openai.responses.create exists?', typeof this.openai.responses.create);
    console.log('  openai.responses.stream exists?', typeof this.openai.responses.stream);
    
    try {
      console.log('\n[testResponsesAPI] Attempting minimal responses.create call...');
      const response = await this.openai.responses.create({
        model: this.context.model,
        instructions: 'You are a helpful assistant.',
        input: 'Say hello',
        max_output_tokens: 20
      });
      
      console.log('[testResponsesAPI] SUCCESS! Response:', response);
      
    } catch (error) {
      console.error('\n[testResponsesAPI] ERROR calling responses.create:');
      console.error('  Error type:', error.constructor.name);
      console.error('  Status:', error.status);
      console.error('  Status text:', error.statusText);
      console.error('  Message:', error.message);
      console.error('  URL:', error.url);
      console.error('  Headers:', error.headers);
      console.error('  Response body:', error.response?.body);
      console.error('  Full error object:', error);
      
      if (error.response) {
        console.error('\n  Response details:');
        console.error('    Status:', error.response.status);
        console.error('    Status text:', error.response.statusText);
        console.error('    Headers:', Object.fromEntries(error.response.headers.entries()));
        
        try {
          const body = await error.response.text();
          console.error('    Body:', body);
        } catch (e) {
          console.error('    Could not read body:', e.message);
        }
      }
    }
    
    console.log('\n[testResponsesAPI] Test complete.');
  }
  
  async testSimpleResponse() {
    console.log('\nTesting simple response through normal flow...');
    this.status.processing = true;
    this.status.lastActivity = 'Testing...';
    this.updateStatusBar();
    
    try {
      // Force a simple test through the normal flow
      await this.askO3WithMemory('Hello, please respond with a simple greeting.');
      console.log('\nTest complete. Check /tmp/o3-console-debug.log for details.');
    } catch (error) {
      this.printError(`Test failed: ${error.message}`);
    } finally {
      this.status.processing = false;
      this.status.lastActivity = 'Ready';
      this.updateStatusBar();
    }
  }
  
  recordEditDiagnostics(functionName, args, result, timeTaken) {
    if (!this.diagnostics) {
      this.diagnostics = [];
    }
    
    const diagnostic = {
      timestamp: new Date().toISOString(),
      function: functionName,
      timeTaken: timeTaken,
      request: args,
      response: result
    };
    
    // Add file hash if available
    if (args.path && fs.existsSync(args.path)) {
      try {
        const content = fs.readFileSync(args.path, 'utf8');
        const crypto = require('crypto');
        diagnostic.fileHash = crypto.createHash('sha1').update(content).digest('hex');
      } catch (error) {
        diagnostic.fileHash = 'error: ' + error.message;
      }
    }
    
    // Add syntax check result if present
    if (result.syntaxWarning) {
      diagnostic.syntaxCheck = {
        passed: false,
        warning: result.syntaxWarning.warning,
        details: result.syntaxWarning.details,
        rollbackFile: result.syntaxWarning.rollback
      };
    } else if (result.error) {
      diagnostic.syntaxCheck = {
        passed: false,
        error: result.error
      };
    } else {
      diagnostic.syntaxCheck = {
        passed: true
      };
    }
    
    this.diagnostics.push(diagnostic);
    
    // Save to file if diagnosticsFile is configured
    if (this.config.diagnosticsFile) {
      try {
        fs.writeFileSync(
          this.config.diagnosticsFile,
          JSON.stringify(this.diagnostics, null, 2),
          'utf8'
        );
      } catch (error) {
        // Silently fail - don't interrupt the flow
      }
    }
  }
  
  completer(line) {
    const commands = Object.keys(this.commands);
    const hits = commands.filter((c) => c.startsWith(line));
    return [hits.length ? hits : commands, line];
  }
  
  redraw() {
    // Save cursor position
    process.stdout.write(ansi.saveCursor);
    
    // Temporarily reset scroll region for full redraw
    process.stdout.write(ansi.resetScrollRegion);
    
    this.clearScreen();
    this.printHeader();
    this.printDivider();
    this.setupStatusBar();
    
    // Re-establish scroll region
    process.stdout.write(ansi.setScrollRegion(1, this.scrollBottom));
    
    // Restore cursor position
    process.stdout.write(ansi.restoreCursor);
    
    this.rl.prompt();
  }
}

// Check dependencies
try {
  require('openai');
} catch (error) {
  console.error(`${ansi.red}Error: OpenAI module not found${ansi.reset}`);
  console.error('Please run: npm install openai');
  process.exit(1);
}

// Start the console
const consoleApp = new O3ConsoleBeautiful();
consoleApp.start();
