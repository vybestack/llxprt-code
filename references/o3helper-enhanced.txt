#!/usr/bin/env node
/**
 * O3 Helper Enhanced - With Claude Code-like tools
 * Includes: Glob, Advanced Grep, TodoRead/TodoWrite, MultiEdit, WebFetch
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');
const editFile = require('./edit-file-tool');

// Color codes for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  reset: '\x1b[0m'
};

// Global state for todos
let todosState = [];
const todosFile = path.join(process.cwd(), '.o3helper-todos.json');

// Load todos from file if exists
function loadTodos() {
  try {
    if (fs.existsSync(todosFile)) {
      todosState = JSON.parse(fs.readFileSync(todosFile, 'utf8'));
    }
  } catch (error) {
    console.error('Warning: Could not load todos:', error.message);
  }
}

// Save todos to file
function saveTodos() {
  try {
    fs.writeFileSync(todosFile, JSON.stringify(todosState, null, 2));
  } catch (error) {
    console.error('Warning: Could not save todos:', error.message);
  }
}

// Initialize by loading todos
loadTodos();

/**
 * Glob - Fast file pattern matching tool
 * Supports glob patterns like "**\/*.js" or "src/**\/*.ts"
 */
async function glob(args) {
  try {
    const pattern = args.pattern;
    const searchPath = args.path || '.';
    const baseDir = path.resolve(process.cwd(), searchPath);
    
    // Security check
    if (!baseDir.startsWith(process.cwd())) {
      return { error: 'Path traversal not allowed' };
    }
    
    // Use find command for glob matching
    let findCmd;
    if (pattern.includes('**')) {
      // Convert ** to find syntax
      const findPattern = pattern
        .replace(/\*\*/g, '*')
        .replace(/\*/g, '*')
        .split('/')
        .pop();
      
      findCmd = `find "${baseDir}" -type f -name "${findPattern}" 2>/dev/null | head -1000`;
    } else {
      // Simple glob
      findCmd = `find "${baseDir}" -maxdepth 1 -type f -name "${pattern}" 2>/dev/null | head -1000`;
    }
    
    const result = execSync(findCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const files = result.trim().split('\n').filter(f => f);
    
    // Sort by modification time
    const filesWithStats = files.map(file => {
      try {
        const stat = fs.statSync(file);
        return {
          path: path.relative(process.cwd(), file),
          modified: stat.mtime.getTime(),
          size: stat.size
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
    
    filesWithStats.sort((a, b) => b.modified - a.modified);
    
    return {
      matches: filesWithStats.map(f => f.path),
      count: filesWithStats.length,
      pattern: pattern,
      truncated: files.length >= 1000
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Advanced Grep - Fast content search with structured results
 */
async function grep(args) {
  try {
    const pattern = args.pattern;
    const searchPath = args.path || '.';
    const include = args.include || '*';
    const baseDir = path.resolve(process.cwd(), searchPath);
    
    // Security check
    if (!baseDir.startsWith(process.cwd())) {
      return { error: 'Path traversal not allowed' };
    }
    
    // Build grep command (prefer ripgrep)
    let grepCmd;
    const hasRipgrep = execSync('which rg 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    
    if (hasRipgrep) {
      grepCmd = `rg -l --sort modified "${pattern}" "${baseDir}"`;
      if (include !== '*') {
        grepCmd += ` -g "${include}"`;
      }
    } else {
      grepCmd = `grep -r -l "${pattern}" "${baseDir}" 2>/dev/null`;
      if (include !== '*') {
        grepCmd += ` --include="${include}"`;
      }
    }
    
    grepCmd += ' | head -500';
    
    const result = execSync(grepCmd + ' || true', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const files = result.trim().split('\n').filter(f => f);
    
    // Get match counts for each file
    const filesWithMatches = files.map(file => {
      try {
        const countCmd = hasRipgrep 
          ? `rg -c "${pattern}" "${file}" 2>/dev/null || echo "0"`
          : `grep -c "${pattern}" "${file}" 2>/dev/null || echo "0"`;
        
        const count = parseInt(execSync(countCmd, { encoding: 'utf8' }).trim());
        const stat = fs.statSync(file);
        
        return {
          path: path.relative(process.cwd(), file),
          matches: count,
          modified: stat.mtime.getTime(),
          size: stat.size
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
    
    // Sort by modification time
    filesWithMatches.sort((a, b) => b.modified - a.modified);
    
    return {
      files: filesWithMatches.map(f => ({
        path: f.path,
        match_count: f.matches
      })),
      total_matches: filesWithMatches.reduce((sum, f) => sum + f.matches, 0),
      pattern: pattern,
      include_pattern: include,
      truncated: files.length >= 500
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * TodoWrite - Create and manage a structured task list
 */
async function todoWrite(args) {
  try {
    const newTodos = args.todos || [];
    
    // Validate todo structure
    for (const todo of newTodos) {
      if (!todo.content || !todo.status || !todo.priority || !todo.id) {
        return { error: 'Invalid todo format. Each todo must have: content, status, priority, id' };
      }
      if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
        return { error: `Invalid status: ${todo.status}. Must be: pending, in_progress, completed` };
      }
      if (!['high', 'medium', 'low'].includes(todo.priority)) {
        return { error: `Invalid priority: ${todo.priority}. Must be: high, medium, low` };
      }
    }
    
    // Update todos
    todosState = newTodos;
    saveTodos();
    
    // Generate summary
    const summary = {
      total: todosState.length,
      pending: todosState.filter(t => t.status === 'pending').length,
      in_progress: todosState.filter(t => t.status === 'in_progress').length,
      completed: todosState.filter(t => t.status === 'completed').length
    };
    
    return {
      success: true,
      message: 'Todos updated successfully',
      summary: summary,
      todos: todosState
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * TodoRead - Read the current to-do list
 */
async function todoRead(args) {
  try {
    // Reload from file to ensure fresh data
    loadTodos();
    
    const summary = {
      total: todosState.length,
      pending: todosState.filter(t => t.status === 'pending').length,
      in_progress: todosState.filter(t => t.status === 'in_progress').length,
      completed: todosState.filter(t => t.status === 'completed').length
    };
    
    return {
      todos: todosState,
      summary: summary,
      file_path: todosFile
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * MultiEdit - Perform multiple edits to a single file atomically
 */
async function multiEdit(args) {
  try {
    const filePath = path.resolve(process.cwd(), args.file_path);
    const edits = args.edits || [];
    
    // Security check
    if (!filePath.startsWith(process.cwd())) {
      return { error: 'Path traversal not allowed' };
    }
    
    // Check file exists
    if (!fs.existsSync(filePath)) {
      return { error: `File not found: ${args.file_path}` };
    }
    
    // Read file content
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;
    
    // Validate all edits first
    const validationErrors = [];
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      if (!edit.old_string || !edit.new_string) {
        validationErrors.push(`Edit ${i + 1}: Missing old_string or new_string`);
        continue;
      }
      
      if (edit.old_string === edit.new_string) {
        validationErrors.push(`Edit ${i + 1}: old_string and new_string are identical`);
        continue;
      }
      
      // Check if old_string exists
      if (!content.includes(edit.old_string)) {
        // Try to provide helpful context
        const lines = edit.old_string.split('\n');
        const firstLine = lines[0];
        if (content.includes(firstLine)) {
          const index = content.indexOf(firstLine);
          const context = content.substring(Math.max(0, index - 50), Math.min(content.length, index + 150));
          validationErrors.push(`Edit ${i + 1}: Text not found. First line was found but full match failed. Context: ...${context}...`);
        } else {
          validationErrors.push(`Edit ${i + 1}: Text not found in file`);
        }
      }
    }
    
    if (validationErrors.length > 0) {
      return {
        error: 'Validation failed',
        validation_errors: validationErrors,
        file_path: args.file_path
      };
    }
    
    // Apply edits in sequence
    const appliedEdits = [];
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const before = content;
      
      // Check uniqueness before replacing
      const count = before.split(edit.old_string).length - 1;
      if (count === 0) {
        // Will be caught by validation
      } else if (count > 1) {
        return {
          error: `Edit ${i + 1}: Text occurs ${count} times. Each search text must be unique.`,
          file_path: args.file_path
        };
      }
      
      // Replace all occurrences (following searchAndReplace behavior)
      content = content.split(edit.old_string).join(edit.new_string);
      appliedEdits.push({
        index: i + 1,
        replacements: count,
        old_string_preview: edit.old_string.substring(0, 50) + (edit.old_string.length > 50 ? '...' : ''),
        new_string_preview: edit.new_string.substring(0, 50) + (edit.new_string.length > 50 ? '...' : '')
      });
    }
    
    // Create backup
    const backupPath = `${filePath}.bak-${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
    
    // Write to temp first for syntax check when editing JS/TS files (self-edit safety)
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, content, 'utf8');

    let syntaxOk = true;

    // If we are editing a JavaScript/TypeScript file that is inside the current repo (possible self-edit)
    if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs') || filePath.endsWith('.ts')) {
      try {
        // Syntax check using Node – returns non-zero exit code on error
        execSync(`node --check "${tmpPath}"`, { stdio: 'ignore' });
      } catch (e) {
        syntaxOk = false;
        // Remove bad tmp file
        fs.unlinkSync(tmpPath);
        return {
          error: 'Syntax error detected in patched file. Aborting update and restoring original.',
          detail: e.message,
          file_path: args.file_path,
          backup_path: path.basename(backupPath)
        };
      }
    }

    // If syntax is OK (or not a JS file) replace original atomically
    if (syntaxOk) {
      fs.renameSync(tmpPath, filePath);
    }
    
    // Clean up temp file if it still exists
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
    
    return {
      success: true,
      message: `Applied ${edits.length} edits successfully`,
      file_path: args.file_path,
      backup_path: path.basename(backupPath),
      edits_applied: appliedEdits
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * WebFetch - Fetch and process web content
 */
async function webFetch(args) {
  try {
    const url = args.url;
    const prompt = args.prompt || 'Summarize this content';
    
    // Basic URL validation
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { error: 'URL must start with http:// or https://' };
    }
    
    // Simple cache implementation
    const cacheDir = path.join(os.tmpdir(), 'o3helper-cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    const urlHash = require('crypto').createHash('md5').update(url).digest('hex');
    const cacheFile = path.join(cacheDir, `${urlHash}.cache`);
    
    let content;
    let fromCache = false;
    
    // Check cache (15 minutes)
    if (fs.existsSync(cacheFile)) {
      const stat = fs.statSync(cacheFile);
      const age = Date.now() - stat.mtime.getTime();
      if (age < 15 * 60 * 1000) {
        content = fs.readFileSync(cacheFile, 'utf8');
        fromCache = true;
      }
    }
    
    if (!fromCache) {
      // Fetch content
      content = await new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        
        client.get(url, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            resolve(data);
          });
          
        }).on('error', (err) => {
          reject(err);
        });
      });
      
      // Save to cache
      fs.writeFileSync(cacheFile, content);
    }
    
    // Convert HTML to text (simple approach)
    let textContent = content;
    if (content.includes('<html') || content.includes('<HTML')) {
      // Remove script and style tags
      textContent = textContent.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      textContent = textContent.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      // Remove HTML tags
      textContent = textContent.replace(/<[^>]+>/g, ' ');
      // Clean up whitespace
      textContent = textContent.replace(/\s+/g, ' ').trim();
    }
    
    // Truncate if too long
    const maxLength = 50000;
    if (textContent.length > maxLength) {
      textContent = textContent.substring(0, maxLength) + '\n\n[Content truncated...]';
    }
    
    return {
      url: url,
      title: content.match(/<title>(.*?)<\/title>/i)?.[1] || 'No title',
      content_length: content.length,
      text_content: textContent,
      from_cache: fromCache,
      prompt: prompt,
      note: 'Process this content with the provided prompt'
    };
  } catch (error) {
    return { error: error.message };
  }
}

// edit_file is now imported from edit-file-tool.js

// Tool definitions for OpenAI
function getTools() {
  return [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the contents of a file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the file to read" }
          },
          required: ["path"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "list_directory",
        description: "List files and directories in a given path",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory path (default: current directory)" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "glob",
        description: "Find files using glob patterns like '**/*.js' or 'src/**/*.ts'. Returns files sorted by modification time.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Glob pattern to match files" },
            path: { type: "string", description: "Base directory to search in (default: current directory)" }
          },
          required: ["pattern"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "grep",
        description: "Search for patterns in files with structured results. Returns files sorted by modification time with match counts.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Pattern to search for" },
            path: { type: "string", description: "Directory to search in (default: current directory)" },
            include: { type: "string", description: "File pattern to include (e.g., '*.js', default: all files)" }
          },
          required: ["pattern"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "edit_file",
        description: "Edit a file by replacing text. The search text must occur exactly once in the file. Handles indentation differences automatically.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the file to edit" },
            search: { type: "string", description: "Text to search for (must be unique in the file)" },
            replace: { type: "string", description: "Text to replace with" }
          },
          required: ["path", "search", "replace"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "multi_edit",
        description: "Perform multiple edits to a single file atomically. All edits succeed or none are applied.",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file to edit" },
            edits: {
              type: "array",
              description: "Array of edit operations",
              items: {
                type: "object",
                properties: {
                  old_string: { type: "string", description: "Text to search for (must be unique in the file)" },
                  new_string: { type: "string", description: "Text to replace with" }
                },
                required: ["old_string", "new_string"]
              }
            }
          },
          required: ["file_path", "edits"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "create_file",
        description: "Create a new file with content",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path for the new file" },
            content: { type: "string", description: "Content to write to the file" }
          },
          required: ["path", "content"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "todo_read",
        description: "Read the current task list. Returns todos with their status, priority, and content.",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    },
    {
      type: "function",
      function: {
        name: "todo_write",
        description: "Update the task list. Each todo must have: content, status (pending/in_progress/completed), priority (high/medium/low), and id.",
        parameters: {
          type: "object",
          properties: {
            todos: {
              type: "array",
              description: "Array of todo items",
              items: {
                type: "object",
                properties: {
                  content: { type: "string", description: "Task description" },
                  status: { type: "string", enum: ["pending", "in_progress", "completed"], description: "Task status" },
                  priority: { type: "string", enum: ["high", "medium", "low"], description: "Task priority" },
                  id: { type: "string", description: "Unique identifier for the task" }
                },
                required: ["content", "status", "priority", "id"]
              }
            }
          },
          required: ["todos"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "web_fetch",
        description: "Fetch content from a URL and convert to text. Includes 15-minute cache.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to fetch (must start with http:// or https://)" },
            prompt: { type: "string", description: "How to process the content (default: 'Summarize this content')" }
          },
          required: ["url"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "execute_command",
        description: "Execute a shell command with permission check",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Command to execute" },
            timeout: { type: "number", description: "Timeout in milliseconds (default: 30000)" }
          },
          required: ["command"]
        }
      }
    }
  ];
}

// Execute tool calls
async function executeToolCall(toolName, args) {
  switch (toolName) {
    case 'read_file':
      return readFile(args);
    case 'list_directory':
      return listDirectory(args);
    case 'glob':
      return glob(args);
    case 'grep':
      return grep(args);
    case 'edit_file':
      return editFile(args);
    case 'multi_edit':
      return multiEdit(args);
    case 'create_file':
      return createFile(args);
    case 'todo_read':
      return todoRead(args);
    case 'todo_write':
      return todoWrite(args);
    case 'web_fetch':
      return webFetch(args);
    case 'execute_command':
      return executeCommand(args);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// Include existing tool implementations (readFile, listDirectory, createFile, executeCommand)
// ... [These would be copied from the original o3helper.js]

// For brevity, I'll include simplified versions
async function readFile(args) {
  try {
    const filePath = path.resolve(process.cwd(), args.path);
    if (!filePath.startsWith(process.cwd())) {
      return { error: 'Path traversal not allowed' };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return { content, path: args.path };
  } catch (error) {
    return { error: error.message };
  }
}

async function listDirectory(args) {
  try {
    const dirPath = path.resolve(process.cwd(), args.path || '.');
    if (!dirPath.startsWith(process.cwd())) {
      return { error: 'Path traversal not allowed' };
    }
    const items = fs.readdirSync(dirPath).map(name => {
      const fullPath = path.join(dirPath, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.isFile() ? stat.size : null
      };
    });
    return { items, path: args.path || '.' };
  } catch (error) {
    return { error: error.message };
  }
}

async function createFile(args) {
  try {
    const filePath = path.resolve(process.cwd(), args.path);
    if (!filePath.startsWith(process.cwd())) {
      return { error: 'Path traversal not allowed' };
    }
    if (fs.existsSync(filePath)) {
      return { error: 'File already exists' };
    }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, args.content || '', 'utf8');
    return { success: true, path: args.path };
  } catch (error) {
    return { error: error.message };
  }
}

async function executeCommand(args) {
  try {
    const command = args.command;
    const timeout = args.timeout || 30000;
    
    // Check permissions
    const permissionsFile = path.join(process.cwd(), '.o3helper-permissions.json');
    let permissions = { rules: [], default: 'ask' };
    
    if (fs.existsSync(permissionsFile)) {
      permissions = JSON.parse(fs.readFileSync(permissionsFile, 'utf8'));
    }
    
    // Check against rules
    let allowed = null;
    for (const rule of permissions.rules) {
      if (new RegExp(rule.pattern).test(command)) {
        allowed = rule.permission === 'always';
        break;
      }
    }
    
    if (allowed === false) {
      return { error: 'Command not allowed by permission rules' };
    }
    
    if (allowed === null && permissions.default === 'never') {
      return { error: 'Command not allowed by default permission' };
    }
    
    // Execute command
    const result = execSync(command, {
      encoding: 'utf8',
      timeout: timeout,
      maxBuffer: 10 * 1024 * 1024
    });
    
    return {
      output: result,
      command: command,
      exit_code: 0
    };
  } catch (error) {
    return {
      error: error.message,
      command: args.command,
      exit_code: error.status || 1
    };
  }
}

// Main execution logic would go here...
// This is a tool library that would be called by the main o3helper script

module.exports = {
  glob,
  grep,
  todoRead,
  todoWrite,
  multiEdit,
  webFetch,
  editFile,
  readFile,
  listDirectory,
  createFile,
  executeCommand,
  executeToolCall,
  getTools
};