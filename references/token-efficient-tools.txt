/**
 * Token-Efficient Tool Implementations
 * Implements Claude Code-like token optimization
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Maximum limits for token efficiency
const LIMITS = {
  FILE_LINES: 2000,
  LINE_LENGTH: 2000,
  COMMAND_OUTPUT: 30000,
  GREP_RESULTS: 500,
  GLOB_RESULTS: 1000,
  PREVIEW_LINES: 3
};

/**
 * Read file with offset/limit like Claude Code
 */
async function readFileEfficient(args) {
  try {
    const filePath = path.resolve(process.cwd(), args.path);
    const offset = args.offset || 0;
    const limit = args.limit || LIMITS.FILE_LINES;
    
    // Security check
    if (!filePath.startsWith(process.cwd())) {
      return { error: 'Path traversal not allowed' };
    }
    
    // Check file exists
    if (!fs.existsSync(filePath)) {
      return { error: `File not found: ${args.path}` };
    }
    
    // Get file stats
    const stats = fs.statSync(filePath);
    
    // Handle binary files
    if (isBinaryFile(filePath)) {
      return {
        error: 'Binary file',
        path: args.path,
        size: stats.size,
        type: 'binary'
      };
    }
    
    // Read file
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    // Apply offset and limit
    const selectedLines = lines.slice(offset, offset + limit);
    
    // Format with line numbers and truncate long lines
    const formatted = selectedLines.map((line, i) => {
      const lineNum = offset + i + 1;
      const truncated = line.length > LIMITS.LINE_LENGTH 
        ? line.substring(0, LIMITS.LINE_LENGTH) + '...' 
        : line;
      return `${lineNum.toString().padStart(6)}→${truncated}`;
    }).join('\n');
    
    // Build response
    return {
      content: formatted,
      path: args.path,
      lines: {
        total: lines.length,
        shown: selectedLines.length,
        offset: offset,
        limit: limit
      },
      size: stats.size,
      truncated_lines: selectedLines.some(l => l.length > LIMITS.LINE_LENGTH),
      more_available: lines.length > offset + limit,
      token_estimate: Math.ceil(formatted.length / 4)
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Search with automatic file reading around matches
 */
async function grepWithContext(args) {
  try {
    const pattern = args.pattern;
    const searchPath = args.path || '.';
    const include = args.include || '*';
    const contextLines = args.context || 2;
    const baseDir = path.resolve(process.cwd(), searchPath);
    
    // Security check
    if (!baseDir.startsWith(process.cwd())) {
      return { error: 'Path traversal not allowed' };
    }
    
    // Build grep command with context
    const hasRipgrep = execSync('which rg 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    let grepCmd;
    
    if (hasRipgrep) {
      grepCmd = `rg -n -C ${contextLines} "${pattern}" "${baseDir}"`;
      if (include !== '*') {
        grepCmd += ` -g "${include}"`;
      }
    } else {
      grepCmd = `grep -r -n -C ${contextLines} "${pattern}" "${baseDir}" 2>/dev/null`;
      if (include !== '*') {
        grepCmd += ` --include="${include}"`;
      }
    }
    
    grepCmd += ` | head -${LIMITS.GREP_RESULTS * 5}`; // Extra lines for context
    
    const result = execSync(grepCmd + ' || true', { 
      encoding: 'utf8', 
      maxBuffer: 10 * 1024 * 1024 
    });
    
    // Parse results with context
    const matches = parseGrepContext(result, pattern);
    
    // Sort by modification time
    const enrichedMatches = matches.map(match => {
      try {
        const stat = fs.statSync(match.file);
        return {
          ...match,
          modified: stat.mtime.getTime()
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
    
    enrichedMatches.sort((a, b) => b.modified - a.modified);
    
    // Limit results
    const limited = enrichedMatches.slice(0, 50);
    
    return {
      matches: limited.map(m => ({
        file: path.relative(process.cwd(), m.file),
        line: m.line,
        content: m.content,
        context: m.context
      })),
      pattern: pattern,
      total_files: new Set(enrichedMatches.map(m => m.file)).size,
      total_matches: enrichedMatches.length,
      truncated: enrichedMatches.length > 50,
      token_estimate: limited.length * 50 // ~50 tokens per match with context
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Execute command with smart output handling
 */
async function executeCommandEfficient(args) {
  try {
    const command = args.command;
    const timeout = args.timeout || 30000;
    const saveFullOutput = args.save_full !== false;
    
    // Check permissions (simplified for this example)
    const allowed = checkCommandPermission(command);
    if (!allowed) {
      return { error: 'Command not allowed by permission rules' };
    }
    
    // Execute command
    let result;
    let exitCode = 0;
    
    try {
      result = execSync(command, {
        encoding: 'utf8',
        timeout: timeout,
        maxBuffer: 50 * 1024 * 1024 // 50MB max
      });
    } catch (error) {
      result = error.stdout || error.message;
      exitCode = error.status || 1;
    }
    
    // Handle output
    let output = result;
    let fullOutputPath = null;
    
    if (result.length > LIMITS.COMMAND_OUTPUT) {
      // Save full output
      if (saveFullOutput) {
        fullOutputPath = `/tmp/o3_cmd_${Date.now()}.txt`;
        fs.writeFileSync(fullOutputPath, result);
      }
      
      // Smart truncation - show head and tail
      const headSize = Math.floor(LIMITS.COMMAND_OUTPUT * 0.7);
      const tailSize = Math.floor(LIMITS.COMMAND_OUTPUT * 0.3);
      
      output = result.substring(0, headSize) +
        `\n\n[... Output truncated. Showing ${LIMITS.COMMAND_OUTPUT} of ${result.length} chars ...]\n\n` +
        result.substring(result.length - tailSize);
    }
    
    return {
      output: output,
      command: command,
      exit_code: exitCode,
      truncated: result.length > LIMITS.COMMAND_OUTPUT,
      length: result.length,
      full_output_path: fullOutputPath,
      token_estimate: Math.ceil(output.length / 4)
    };
  } catch (error) {
    return { 
      error: error.message,
      command: args.command,
      exit_code: 1
    };
  }
}

/**
 * List directory with automatic summarization for large dirs
 */
async function listDirectoryEfficient(args) {
  try {
    const dirPath = path.resolve(process.cwd(), args.path || '.');
    const showHidden = args.show_hidden || false;
    const maxItems = args.max_items || 200;
    
    // Security check
    if (!dirPath.startsWith(process.cwd())) {
      return { error: 'Path traversal not allowed' };
    }
    
    // Read directory
    let items = fs.readdirSync(dirPath);
    
    // Filter hidden files
    if (!showHidden) {
      items = items.filter(name => !name.startsWith('.'));
    }
    
    // Get stats and sort by modification time
    const itemsWithStats = items.map(name => {
      try {
        const fullPath = path.join(dirPath, name);
        const stat = fs.statSync(fullPath);
        return {
          name,
          type: stat.isDirectory() ? 'directory' : 'file',
          size: stat.isFile() ? stat.size : null,
          modified: stat.mtime.getTime(),
          isSymlink: stat.isSymbolicLink()
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
    
    itemsWithStats.sort((a, b) => b.modified - a.modified);
    
    // Summarize if too many items
    let summary = null;
    if (itemsWithStats.length > maxItems) {
      const dirs = itemsWithStats.filter(i => i.type === 'directory');
      const files = itemsWithStats.filter(i => i.type === 'file');
      
      summary = {
        total_items: itemsWithStats.length,
        directories: dirs.length,
        files: files.length,
        newest_files: files.slice(0, 10).map(f => f.name),
        largest_files: files.sort((a, b) => b.size - a.size).slice(0, 5).map(f => ({
          name: f.name,
          size: formatFileSize(f.size)
        })),
        common_extensions: getCommonExtensions(files)
      };
    }
    
    // Limit items returned
    const limitedItems = itemsWithStats.slice(0, maxItems);
    
    return {
      path: args.path || '.',
      items: limitedItems.map(i => ({
        name: i.name,
        type: i.type,
        size: i.size ? formatFileSize(i.size) : null
      })),
      total: itemsWithStats.length,
      shown: limitedItems.length,
      truncated: itemsWithStats.length > maxItems,
      summary: summary,
      token_estimate: limitedItems.length * 10 + (summary ? 200 : 0)
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Helper functions
function isBinaryFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const binaryExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib',
    '.mp3', '.mp4', '.avi', '.mov', '.wav',
    '.pyc', '.class', '.o', '.obj'
  ];
  return binaryExtensions.includes(ext);
}

function parseGrepContext(output, pattern) {
  const matches = [];
  const lines = output.split('\n');
  let currentFile = null;
  let currentContext = [];
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Ripgrep format: file:line:content
    // Grep format: file:line:content or file-line-content for context
    const match = line.match(/^([^:]+):(\d+):(.*)$/) || 
                  line.match(/^([^:]+)-(\d+)-(.*)$/);
    
    if (match) {
      const [_, file, lineNum, content] = match;
      
      if (line.includes(':') && content.includes(pattern)) {
        // This is a match line
        matches.push({
          file,
          line: parseInt(lineNum),
          content: content.trim(),
          context: [...currentContext]
        });
        currentContext = [];
      } else {
        // This is context
        currentContext.push({
          line: parseInt(lineNum),
          content: content.trim()
        });
      }
      
      currentFile = file;
    }
  }
  
  return matches;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + 'GB';
}

function getCommonExtensions(files) {
  const extensions = {};
  files.forEach(f => {
    const ext = path.extname(f.name).toLowerCase() || 'no-ext';
    extensions[ext] = (extensions[ext] || 0) + 1;
  });
  
  return Object.entries(extensions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ext, count]) => ({ ext, count }));
}

function checkCommandPermission(command) {
  // Simplified permission check
  const dangerous = ['rm -rf', 'format', 'dd if='];
  return !dangerous.some(d => command.includes(d));
}

// Export enhanced tools
const enhancedTools = require('./o3helper-enhanced');

module.exports = {
  // Token-efficient versions
  readFile: readFileEfficient,
  grep: grepWithContext,
  executeCommand: executeCommandEfficient,
  listDirectory: listDirectoryEfficient,
  
  // All other tools from enhanced
  glob: enhancedTools.glob,
  todoRead: enhancedTools.todoRead,
  todoWrite: enhancedTools.todoWrite,
  multiEdit: enhancedTools.multiEdit,
  webFetch: enhancedTools.webFetch,
  editFile: enhancedTools.editFile,
  createFile: enhancedTools.createFile,
  executeToolCall: enhancedTools.executeToolCall,
  getTools: enhancedTools.getTools
};