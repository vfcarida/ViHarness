/**
 * Workspace Tools Suite.
 *
 * Provides real, workspace-scoped filesystem and shell execution tools:
 * - read_file: read files within workspace with traversal protection.
 * - write_file: write files, creating parent directories automatically.
 * - edit_file: targeted search-and-replace block modifications.
 * - revert_file: rollback modifications to clean git baseline state.
 * - list_directory: inspect workspace tree entries.
 * - run_command: execute shell commands in the workspace directory with timeout and output capture.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import type { Tool } from '../../core/interfaces/tool.js';
import type {
  ToolInput,
  ToolResult,
  ToolExecutionContext,
} from '../../core/model/tool-types.js';
import { ToolCategory, ToolRiskLevel } from '../../core/model/tool-types.js';
import type { IdFactory } from '../../core/types/identifiers.js';
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';

export interface WorkspaceToolsOptions {
  readonly idFactory?: IdFactory;
  readonly commandTimeoutMs?: number;
  readonly maxBufferBytes?: number;
  readonly sandbox?: 'local' | 'docker';
  readonly dockerImage?: string;
  readonly dockerWorkdir?: string;
  readonly dockerRunner?: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

function checkDockerCliAvailable(): boolean {
  try {
    const res = child_process.spawnSync('docker', ['info'], { timeout: 2500, stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

const FORBIDDEN_CATASTROPHIC_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+-(?:rf?|fr?)\s+[/~*]/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/(?:sd[a-z]|hd[a-z]|nvme)/i,
];

function sanitizeWorkspacePath(workspacePath: string, targetPath: string): string {
  const resolved = path.resolve(workspacePath, targetPath);
  const normalizedWs = path.resolve(workspacePath);
  if (!resolved.startsWith(normalizedWs)) {
    throw new HarnessError({
      code: ErrorCode.POLICY_DENIED,
      category: ErrorCategory.POLICY,
      message: `Path traversal violation: Access outside workspace is denied (${targetPath})`,
    });
  }
  return resolved;
}

function checkSyntaxIntegrity(filePath: string, content: string): string | null {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    try {
      JSON.parse(content);
    } catch (err: any) {
      return `JSON syntax error: ${err?.message ?? String(err)}`;
    }
    return null;
  }

  // Bracket and brace matching check for source files
  const checkedExts = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.java',
    '.go',
    '.rs',
  ]);

  if (checkedExts.has(ext)) {
    let curly = 0;
    let paren = 0;
    let square = 0;
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < content.length; i++) {
      const ch = content[i]!;
      const next = content[i + 1] ?? '';

      if (inLineComment) {
        if (ch === '\n') inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (inString) {
        if (ch === '\\') {
          i++; // skip escaped char
        } else if (ch === stringChar) {
          inString = false;
        }
        continue;
      }

      if (ch === '/' && next === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }

      if (ch === '"' || ch === '\'' || ch === '`') {
        inString = true;
        stringChar = ch;
        continue;
      }

      if (ch === '{') curly++;
      else if (ch === '}') curly--;
      else if (ch === '(') paren++;
      else if (ch === ')') paren--;
      else if (ch === '[') square++;
      else if (ch === ']') square--;
    }

    if (curly !== 0) {
      return `Unbalanced curly braces '{ }' (net count: ${curly > 0 ? '+' + curly : curly})`;
    }
    if (paren !== 0) {
      return `Unbalanced parentheses '( )' (net count: ${paren > 0 ? '+' + paren : paren})`;
    }
    if (square !== 0) {
      return `Unbalanced square brackets '[ ]' (net count: ${square > 0 ? '+' + square : square})`;
    }
  }

  return null;
}

export class WorkspaceReadFileTool implements Tool {
  public readonly definition = {
    name: 'read_file',
    version: '1.0.0',
    description: 'Read the contents of a target file inside the project workspace.',
    category: ToolCategory.READ,
    riskLevel: ToolRiskLevel.LOW,
    mutating: false,
    idempotent: true,
    defaultTimeoutMs: 30000,
    requiredPermissions: ['fs:read'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path of file inside workspace to read' },
      },
      required: ['path'],
    },
  };

  constructor(
    private readonly workspacePath: string,
    private readonly idFactory?: IdFactory,
  ) {}

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const start = Date.now();
    const callId = (context?.correlationId ?? this.idFactory?.create<'ToolCall'>() ?? 'call-read') as any;
    const rawPath = String(input['path'] ?? '');

    try {
      const filePath = sanitizeWorkspacePath(this.workspacePath, rawPath);
      if (!fs.existsSync(filePath)) {
        return {
          toolCallId: callId,
          name: this.definition.name,
          success: false,
          output: `File not found: ${rawPath}`,
          durationMs: Date.now() - start,
          error: `File not found: ${rawPath}`,
        };
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return {
          toolCallId: callId,
          name: this.definition.name,
          success: false,
          output: `Target path is a directory, not a file: ${rawPath}`,
          durationMs: Date.now() - start,
          error: `Path is a directory: ${rawPath}`,
        };
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: true,
        output: content,
        durationMs: Date.now() - start,
        metadata: { path: rawPath, bytes: stat.size },
      };
    } catch (err: any) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: err?.message ?? String(err),
        durationMs: Date.now() - start,
        error: err?.message ?? String(err),
      };
    }
  }
}

export class WorkspaceWriteFileTool implements Tool {
  public readonly definition = {
    name: 'write_file',
    version: '1.0.0',
    description: 'Write or overwrite content of a target file inside the project workspace.',
    category: ToolCategory.WRITE,
    riskLevel: ToolRiskLevel.MEDIUM,
    mutating: true,
    idempotent: false,
    defaultTimeoutMs: 30000,
    requiredPermissions: ['fs:write'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path of file inside workspace to write' },
        content: { type: 'string', description: 'Content to write into the file' },
      },
      required: ['path', 'content'],
    },
  };

  constructor(
    private readonly workspacePath: string,
    private readonly idFactory?: IdFactory,
  ) {}

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const start = Date.now();
    const callId = (context?.correlationId ?? this.idFactory?.create<'ToolCall'>() ?? 'call-write') as any;
    const rawPath = String(input['path'] ?? '');
    const content = String(input['content'] ?? '');

    try {
      const filePath = sanitizeWorkspacePath(this.workspacePath, rawPath);
      const parentDir = path.dirname(filePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      let output = `Successfully wrote ${Buffer.byteLength(content, 'utf-8')} bytes to ${rawPath}`;
      const syntaxNotice = checkSyntaxIntegrity(filePath, content);
      if (syntaxNotice) {
        output += `\n\n[Vi-Harness Syntax Alert]: ${syntaxNotice}. Please check the file for syntax or structural errors.`;
      }

      return {
        toolCallId: callId,
        name: this.definition.name,
        success: true,
        output,
        durationMs: Date.now() - start,
        metadata: {
          path: rawPath,
          bytesWritten: Buffer.byteLength(content, 'utf-8'),
          ...(syntaxNotice ? { syntaxAlert: syntaxNotice } : {}),
        },
      };
    } catch (err: any) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: err?.message ?? String(err),
        durationMs: Date.now() - start,
        error: err?.message ?? String(err),
      };
    }
  }
}

export class WorkspaceEditFileTool implements Tool {
  public readonly definition = {
    name: 'edit_file',
    version: '1.0.0',
    description:
      'Edit a file by replacing a unique exact text block (old_string) with new text (new_string). For precise edits without rewriting entire files.',
    category: ToolCategory.WRITE,
    riskLevel: ToolRiskLevel.MEDIUM,
    mutating: true,
    idempotent: false,
    defaultTimeoutMs: 30000,
    requiredPermissions: ['fs:write'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path of file inside workspace to edit' },
        old_string: { type: 'string', description: 'Exact text block to be replaced' },
        new_string: { type: 'string', description: 'Replacement text block' },
        replace_all: {
          type: 'boolean',
          description:
            'If true, replace all occurrences. If false, fails if old_string occurs more than once (default: false)',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  };

  constructor(
    private readonly workspacePath: string,
    private readonly idFactory?: IdFactory,
  ) {}

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const start = Date.now();
    const callId = (context?.correlationId ?? this.idFactory?.create<'ToolCall'>() ?? 'call-edit') as any;
    const rawPath = String(input['path'] ?? '');
    const oldString = String(input['old_string'] ?? '');
    const newString = String(input['new_string'] ?? '');
    const replaceAll = Boolean(input['replace_all'] ?? false);

    if (!rawPath) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: 'Parameter "path" is required.',
        durationMs: Date.now() - start,
        error: 'Missing path parameter',
      };
    }

    if (!oldString) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: 'Parameter "old_string" cannot be empty.',
        durationMs: Date.now() - start,
        error: 'Empty old_string parameter',
      };
    }

    try {
      const filePath = sanitizeWorkspacePath(this.workspacePath, rawPath);
      if (!fs.existsSync(filePath)) {
        return {
          toolCallId: callId,
          name: this.definition.name,
          success: false,
          output: `File not found: ${rawPath}`,
          durationMs: Date.now() - start,
          error: `File not found: ${rawPath}`,
        };
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return {
          toolCallId: callId,
          name: this.definition.name,
          success: false,
          output: `Target path is a directory, not a file: ${rawPath}`,
          durationMs: Date.now() - start,
          error: `Path is a directory: ${rawPath}`,
        };
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8');

      // 1. Direct exact matching
      let occurrences = 0;
      let idx = fileContent.indexOf(oldString);
      while (idx !== -1) {
        occurrences++;
        idx = fileContent.indexOf(oldString, idx + oldString.length);
      }

      // 2. CRLF <-> LF tolerant matching fallback if direct match fails
      if (occurrences === 0) {
        const normalizedFile = fileContent.replace(/\r\n/g, '\n');
        const normalizedOld = oldString.replace(/\r\n/g, '\n');

        if (normalizedFile.includes(normalizedOld)) {
          const usesCrlf = fileContent.includes('\r\n');
          const normalizedNew = newString.replace(/\r\n/g, '\n');

          let count = 0;
          let pos = normalizedFile.indexOf(normalizedOld);
          while (pos !== -1) {
            count++;
            pos = normalizedFile.indexOf(normalizedOld, pos + normalizedOld.length);
          }

          if (count > 1 && !replaceAll) {
            return {
              toolCallId: callId,
              name: this.definition.name,
              success: false,
              output: `Found ${count} occurrences of 'old_string' in ${rawPath}. Provide more unique surrounding context lines or set 'replace_all: true'.`,
              durationMs: Date.now() - start,
              error: `Ambiguous match: ${count} occurrences`,
            };
          }

          let updated = replaceAll
            ? normalizedFile.split(normalizedOld).join(normalizedNew)
            : normalizedFile.replace(normalizedOld, normalizedNew);

          if (usesCrlf) {
            updated = updated.replace(/\n/g, '\r\n');
          }

          fs.writeFileSync(filePath, updated, 'utf-8');
          let output = `Successfully replaced ${count} occurrence(s) in ${rawPath}`;
          const syntaxNotice = checkSyntaxIntegrity(filePath, updated);
          if (syntaxNotice) {
            output += `\n\n[Vi-Harness Syntax Alert]: ${syntaxNotice}. Please check the file for syntax or structural errors.`;
          }

          return {
            toolCallId: callId,
            name: this.definition.name,
            success: true,
            output,
            durationMs: Date.now() - start,
            metadata: {
              path: rawPath,
              replacements: count,
              ...(syntaxNotice ? { syntaxAlert: syntaxNotice } : {}),
            },
          };
        }

        return {
          toolCallId: callId,
          name: this.definition.name,
          success: false,
          output: `Target text 'old_string' not found in ${rawPath}. Ensure exact match including whitespace, indentation, and casing.`,
          durationMs: Date.now() - start,
          error: `Target text not found in ${rawPath}`,
        };
      }

      // 3. Ambiguity check on direct match
      if (occurrences > 1 && !replaceAll) {
        return {
          toolCallId: callId,
          name: this.definition.name,
          success: false,
          output: `Found ${occurrences} occurrences of 'old_string' in ${rawPath}. Provide more unique surrounding context lines or set 'replace_all: true'.`,
          durationMs: Date.now() - start,
          error: `Ambiguous match: ${occurrences} occurrences`,
        };
      }

      // 4. Perform direct replacement
      const updated = replaceAll
        ? fileContent.split(oldString).join(newString)
        : fileContent.replace(oldString, newString);

      fs.writeFileSync(filePath, updated, 'utf-8');
      let output = `Successfully replaced ${occurrences} occurrence(s) in ${rawPath}`;
      const syntaxNotice = checkSyntaxIntegrity(filePath, updated);
      if (syntaxNotice) {
        output += `\n\n[Vi-Harness Syntax Alert]: ${syntaxNotice}. Please check the file for syntax or structural errors.`;
      }

      return {
        toolCallId: callId,
        name: this.definition.name,
        success: true,
        output,
        durationMs: Date.now() - start,
        metadata: {
          path: rawPath,
          replacements: occurrences,
          ...(syntaxNotice ? { syntaxAlert: syntaxNotice } : {}),
        },
      };
    } catch (err: any) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: err?.message ?? String(err),
        durationMs: Date.now() - start,
        error: err?.message ?? String(err),
      };
    }
  }
}

export class WorkspaceRevertFileTool implements Tool {
  public readonly definition = {
    name: 'revert_file',
    version: '1.0.0',
    description:
      'Discard modifications to a file or the entire workspace using git checkout / restore. Useful if edits cause unrecoverable errors and you need to roll back to the clean baseline state.',
    category: ToolCategory.EXECUTE,
    riskLevel: ToolRiskLevel.HIGH,
    mutating: true,
    idempotent: false,
    defaultTimeoutMs: 30000,
    requiredPermissions: ['fs:write', 'cmd:exec'],
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative path of file to revert (e.g. "src/main.c"), or "." to discard all unstaged changes in the workspace',
        },
      },
      required: ['path'],
    },
  };

  constructor(
    private readonly workspacePath: string,
    private readonly idFactory?: IdFactory,
  ) {}

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const start = Date.now();
    const callId = (context?.correlationId ?? this.idFactory?.create<'ToolCall'>() ?? 'call-revert') as any;
    const rawPath = String(input['path'] ?? '').trim();

    if (!rawPath) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: 'Parameter "path" is required.',
        durationMs: Date.now() - start,
        error: 'Missing path parameter',
      };
    }

    try {
      let targetArg: string;
      if (rawPath === '.' || rawPath === './') {
        targetArg = '.';
      } else {
        const filePath = sanitizeWorkspacePath(this.workspacePath, rawPath);
        targetArg = path.relative(this.workspacePath, filePath).replace(/\\/g, '/');
      }

      if (!fs.existsSync(path.join(this.workspacePath, '.git'))) {
        return {
          toolCallId: callId,
          name: this.definition.name,
          success: false,
          output: 'Workspace is not a Git repository. Cannot revert files using git rollback.',
          durationMs: Date.now() - start,
          error: 'NOT_A_GIT_REPOSITORY',
        };
      }

      const stdout = child_process.execSync(`git checkout -- "${targetArg}"`, {
        cwd: this.workspacePath,
        encoding: 'utf-8',
        timeout: 10000,
      });

      return {
        toolCallId: callId,
        name: this.definition.name,
        success: true,
        output: `Successfully rolled back changes to ${targetArg}${stdout ? ': ' + stdout.trim() : ''}`,
        durationMs: Date.now() - start,
        metadata: { revertedPath: targetArg },
      };
    } catch (err: any) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: `Failed to revert file: ${err?.message ?? String(err)}`,
        durationMs: Date.now() - start,
        error: err?.message ?? String(err),
      };
    }
  }
}

export class WorkspaceListDirectoryTool implements Tool {
  public readonly definition = {
    name: 'list_directory',
    version: '1.0.0',
    description: 'List files and directories inside the project workspace.',
    category: ToolCategory.READ,
    riskLevel: ToolRiskLevel.LOW,
    mutating: false,
    idempotent: true,
    defaultTimeoutMs: 30000,
    requiredPermissions: ['fs:read'],
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional relative subpath to list (defaults to workspace root)',
        },
      },
    },
  };

  constructor(
    private readonly workspacePath: string,
    private readonly idFactory?: IdFactory,
  ) {}

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const start = Date.now();
    const callId = (context?.correlationId ?? this.idFactory?.create<'ToolCall'>() ?? 'call-list') as any;
    const rawPath = input['path'] ? String(input['path']) : '';

    try {
      const targetDir = rawPath
        ? sanitizeWorkspacePath(this.workspacePath, rawPath)
        : path.resolve(this.workspacePath);

      if (!fs.existsSync(targetDir)) {
        return {
          toolCallId: callId,
          name: this.definition.name,
          success: false,
          output: `Directory not found: ${rawPath || '.'}`,
          durationMs: Date.now() - start,
          error: `Directory not found: ${rawPath || '.'}`,
        };
      }

      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      const listing = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n');

      return {
        toolCallId: callId,
        name: this.definition.name,
        success: true,
        output: listing || '(empty directory)',
        durationMs: Date.now() - start,
        metadata: { path: rawPath || '.', count: entries.length },
      };
    } catch (err: any) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: err?.message ?? String(err),
        durationMs: Date.now() - start,
        error: err?.message ?? String(err),
      };
    }
  }
}

export class WorkspaceRunCommandTool implements Tool {
  public readonly definition = {
    name: 'run_command',
    version: '1.0.0',
    description: 'Execute a shell command inside the project workspace directory (e.g. build, compile, test).',
    category: ToolCategory.EXECUTE,
    riskLevel: ToolRiskLevel.HIGH,
    mutating: true,
    idempotent: false,
    defaultTimeoutMs: 120000,
    requiredPermissions: ['cmd:exec'],
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command string to execute in workspace' },
      },
      required: ['command'],
    },
  };

  private readonly timeoutMs: number;
  private readonly maxBufferBytes: number;
  private readonly sandbox: 'local' | 'docker';
  private readonly dockerImage: string;
  private readonly dockerWorkdir: string;
  private readonly dockerRunner?: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

  constructor(
    private readonly workspacePath: string,
    options?: WorkspaceToolsOptions,
  ) {
    this.timeoutMs = options?.commandTimeoutMs ?? 120000;
    this.maxBufferBytes = options?.maxBufferBytes ?? 10 * 1024 * 1024;
    this.sandbox = options?.sandbox ?? 'local';
    this.dockerImage = options?.dockerImage ?? 'ubuntu:22.04';
    this.dockerWorkdir = options?.dockerWorkdir ?? '/workspace';
    this.dockerRunner = options?.dockerRunner;
  }

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const start = Date.now();
    const callId = (context?.correlationId ?? 'call-exec') as any;
    const command = String(input['command'] ?? '').trim();

    if (!command) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: 'Empty command string',
        durationMs: Date.now() - start,
        error: 'Empty command string',
      };
    }

    // Guard against catastrophic destructive system wipe commands
    for (const pattern of FORBIDDEN_CATASTROPHIC_PATTERNS) {
      if (pattern.test(command)) {
        return {
          toolCallId: callId,
          name: this.definition.name,
          success: false,
          output: `Command rejected: forbidden catastrophic pattern [${command}]`,
          durationMs: Date.now() - start,
          error: 'FORBIDDEN_CATASTROPHIC_COMMAND',
        };
      }
    }

    // 1. Custom or injected container runner (e.g. for testing or orchestration)
    if (this.sandbox === 'docker' && this.dockerRunner) {
      try {
        const runnerRes = await this.dockerRunner(command);
        const durationMs = Date.now() - start;
        let output = runnerRes.stdout ?? '';
        if (runnerRes.stderr) {
          if (output && !output.endsWith('\n')) output += '\n';
          output += `Stderr:\n${runnerRes.stderr}`;
        }
        const hasWarnings =
          runnerRes.exitCode === 0 &&
          /\b(?:warning\s*:|warning\s*\[|CMake Warning|warning CS|ts\(\d+\)|warning\s*\()/i.test(output);

        if (hasWarnings) {
          output +=
            '\n\n[Vi-Harness Compiler Warning Notice]: The command succeeded with warnings. Be aware that strict evaluation environments (like ACMOJ / SWE-bench judges) compile with \'-Wall -Wextra -Werror\' and reject solutions with compiler warnings. Make sure to eliminate any warnings before finishing.';
        }

        return {
          toolCallId: callId,
          name: this.definition.name,
          success: runnerRes.exitCode === 0,
          output: output.trim() || `(Command completed with exit code ${runnerRes.exitCode} and no output)`,
          durationMs,
          metadata: {
            exitCode: runnerRes.exitCode,
            command,
            hasWarnings,
            sandbox: 'docker',
            dockerImage: this.dockerImage,
          },
          error: runnerRes.exitCode !== 0 ? `Command exited with code ${runnerRes.exitCode}` : undefined,
        };
      } catch (err: any) {
        return {
          toolCallId: callId,
          name: this.definition.name,
          success: false,
          output: `Container execution error: ${err.message}`,
          durationMs: Date.now() - start,
          error: err.message,
        };
      }
    }

    // 2. Prepare command string (local vs Docker CLI)
    let executionCommand = command;
    let isDockerActive = false;
    let sandboxNotice = '';

    if (this.sandbox === 'docker') {
      if (checkDockerCliAvailable()) {
        isDockerActive = true;
        const hostMount = path.resolve(this.workspacePath).replace(/\\/g, '/');
        const escapedCmd = command.replace(/'/g, "'\\''");
        executionCommand = `docker run --rm -v "${hostMount}:${this.dockerWorkdir}" -w "${this.dockerWorkdir}" ${this.dockerImage} /bin/bash -c '${escapedCmd}'`;
      } else {
        sandboxNotice = '[Vi-Harness Sandbox Notice]: Docker is unavailable on host system, executed locally.\n';
      }
    }

    return new Promise((resolve) => {
      child_process.exec(
        executionCommand,
        {
          cwd: this.workspacePath,
          timeout: this.timeoutMs,
          maxBuffer: this.maxBufferBytes,
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - start;
          const exitCode = error ? (typeof (error as any).code === 'number' ? (error as any).code : 1) : 0;
          const isKilled = (error as any)?.killed ?? false;

          let output = sandboxNotice;
          if (stdout) output += stdout;
          if (stderr) {
            if (output && !output.endsWith('\n')) output += '\n';
            output += `Stderr:\n${stderr}`;
          }

          if (isKilled) {
            output += `\n[Command timed out after ${this.timeoutMs}ms]`;
          }

          if (!output.trim()) {
            output = `(Command completed with exit code ${exitCode} and no output)`;
          }

          const hasWarnings =
            exitCode === 0 &&
            /\b(?:warning\s*:|warning\s*\[|CMake Warning|warning CS|ts\(\d+\)|warning\s*\()/i.test(output);

          if (hasWarnings) {
            output +=
              '\n\n[Vi-Harness Compiler Warning Notice]: The command succeeded with warnings. Be aware that strict evaluation environments (like ACMOJ / SWE-bench judges) compile with \'-Wall -Wextra -Werror\' and reject solutions with compiler warnings. Make sure to eliminate any warnings before finishing.';
          }

          resolve({
            toolCallId: callId,
            name: this.definition.name,
            success: exitCode === 0 && !isKilled,
            output: output.trim(),
            durationMs,
            metadata: {
              exitCode,
              timedOut: isKilled,
              command,
              hasWarnings,
              sandbox: isDockerActive ? 'docker' : 'local',
              ...(isDockerActive ? { dockerImage: this.dockerImage } : {}),
            },
            error: exitCode !== 0 ? `Command exited with code ${exitCode}` : undefined,
          });
        },
      );
    });
  }
}

/**
 * Convenience factory to create standard workspace tools scoped to a directory.
 */
export function createWorkspaceTools(
  workspacePath: string,
  options?: WorkspaceToolsOptions,
): Tool[] {
  const resolvedPath = path.resolve(workspacePath);
  return [
    new WorkspaceReadFileTool(resolvedPath, options?.idFactory),
    new WorkspaceWriteFileTool(resolvedPath, options?.idFactory),
    new WorkspaceEditFileTool(resolvedPath, options?.idFactory),
    new WorkspaceRevertFileTool(resolvedPath, options?.idFactory),
    new WorkspaceListDirectoryTool(resolvedPath, options?.idFactory),
    new WorkspaceRunCommandTool(resolvedPath, options),
  ];
}
