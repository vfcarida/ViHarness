/**
 * Command Sanitizer.
 *
 * "Defense-in-depth: Never execute uninspected, unconstrained shell strings directly from an LLM."
 *
 * Normalizes shell command execution requests and blocks dangerous command vectors,
 * command chaining injection (`&&`, `;`, `|`, `$()`), privilege escalation,
 * environment variable exfiltration, and unauthorized network tools.
 */

const FORBIDDEN_DESTRUCTIVE_PATTERNS: ReadonlyArray<{ pattern: RegExp; description: string }> = [
  { pattern: /\bsudo\b/i, description: 'Privilege escalation with sudo' },
  { pattern: /\bsu\s+/i, description: 'Switch user command' },
  {
    pattern: /\brm\s+-(?:rf?|fr?)\s+[/~*]/i,
    description: 'Destructive recursive root/home deletion',
  },
  { pattern: /\bmkfs\b/i, description: 'Filesystem formatting' },
  { pattern: /\bdd\s+if=/i, description: 'Direct disk write with dd' },
  { pattern: /\bfdisk\b/i, description: 'Disk partitioning' },
  { pattern: /\bparted\b/i, description: 'Disk partitioning' },
  {
    pattern: /\bchmod\s+(?:777|a\+rwx|-R\s+777)\b/i,
    description: 'Dangerous permissive permission change',
  },
  { pattern: /\|\s*(?:sh|bash|zsh|dash)\b/i, description: 'Pipe to shell interpreter' },
  { pattern: />\s*\/dev\/(?:sd[a-z]|hd[a-z]|nvme)/i, description: 'Raw block device redirection' },
  {
    pattern: /\b(?:eval|child_process|powershell\s+-(?:enc|encodedcommand)|cmd\.exe\s+\/c)\b/i,
    description: 'Child process execution or obfuscated eval shell execution',
  },
];

const ENV_EXFILTRATION_PATTERNS: ReadonlyArray<{ pattern: RegExp; description: string }> = [
  { pattern: /^(?:printenv|env)\b/i, description: 'Environment variable dump (printenv/env)' },
  {
    pattern: /(?:\b(?:export\s+-p|set\b)|Get-ChildItem\s+env:|dir\s+env:)/i,
    description: 'Environment listing command',
  },
];

const NETWORK_EXFILTRATION_PATTERNS: ReadonlyArray<{ pattern: RegExp; description: string }> = [
  { pattern: /\b(?:curl|wget)\b/i, description: 'Outbound HTTP download/exfiltration tool' },
  { pattern: /\b(?:nc|netcat|ncat|socat)\b/i, description: 'Raw TCP socket / reverse shell tool' },
  { pattern: /\b(?:ssh|scp|sftp|ftp|telnet)\b/i, description: 'Remote shell / transfer protocol' },
  {
    pattern: /\b(?:Invoke-WebRequest|Invoke-RestMethod)\b/i,
    description: 'PowerShell outbound HTTP call',
  },
];

const COMMAND_CHAINING_PATTERNS: ReadonlyArray<{ pattern: RegExp; description: string }> = [
  { pattern: /;\s*/, description: 'Semicolon command chaining' },
  { pattern: /&&\s*/, description: 'AND command chaining (&&)' },
  { pattern: /\|\|\s*/, description: 'OR command chaining (||)' },
  { pattern: /\$\([\s\S]*?\)/, description: 'Command substitution $()' },
  { pattern: /`[^`]*`/, description: 'Backtick command substitution' },
  { pattern: /(?<!\w)\|(?!\|)/, description: 'Pipe operator (|)' },
  { pattern: />{1,2}\s*/, description: 'Output redirection operator (> or >>)' },
];

export interface CommandSanitizerOptions {
  readonly allowChaining?: boolean;
  readonly allowNetwork?: boolean;
  readonly allowEnv?: boolean;
}

export interface CommandSanitizationResult {
  readonly allowed: boolean;
  readonly normalizedCommand: string;
  readonly reason?: string;
  readonly errorCode?:
    | 'SHELL_INJECTION'
    | 'FORBIDDEN_COMMAND'
    | 'ENV_EXFILTRATION'
    | 'NETWORK_EXFILTRATION'
    | 'EMPTY_COMMAND';
}

export class CommandSanitizer {
  /**
   * Normalize and evaluate a shell command string for dangerous execution vectors.
   */
  static sanitize(
    command: string,
    options: CommandSanitizerOptions = {},
  ): CommandSanitizationResult {
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return {
        allowed: false,
        normalizedCommand: '',
        reason: 'Empty command string',
        errorCode: 'EMPTY_COMMAND',
      };
    }

    // Normalize whitespace and control characters
    const normalizedCommand = command.trim().replace(/\s+/g, ' ');

    // 1. Command Chaining & Substitution (Shell Injection)
    if (!options.allowChaining) {
      for (const { pattern, description } of COMMAND_CHAINING_PATTERNS) {
        if (pattern.test(normalizedCommand)) {
          return {
            allowed: false,
            normalizedCommand,
            reason: `Unsafe shell metacharacter detected: ${description}`,
            errorCode: 'SHELL_INJECTION',
          };
        }
      }
    }

    // 2. Destructive & Forbidden Command Vectors
    for (const { pattern, description } of FORBIDDEN_DESTRUCTIVE_PATTERNS) {
      if (pattern.test(normalizedCommand)) {
        return {
          allowed: false,
          normalizedCommand,
          reason: `Forbidden shell command vector: ${description}`,
          errorCode: 'FORBIDDEN_COMMAND',
        };
      }
    }

    // 3. Environment Variable Exfiltration
    if (!options.allowEnv) {
      for (const { pattern, description } of ENV_EXFILTRATION_PATTERNS) {
        if (pattern.test(normalizedCommand)) {
          return {
            allowed: false,
            normalizedCommand,
            reason: `Environment exfiltration vector detected: ${description}`,
            errorCode: 'ENV_EXFILTRATION',
          };
        }
      }
    }

    // 4. Network Exfiltration Tools
    if (!options.allowNetwork) {
      for (const { pattern, description } of NETWORK_EXFILTRATION_PATTERNS) {
        if (pattern.test(normalizedCommand)) {
          return {
            allowed: false,
            normalizedCommand,
            reason: `Network tool prohibited without explicit network permission: ${description}`,
            errorCode: 'NETWORK_EXFILTRATION',
          };
        }
      }
    }

    return {
      allowed: true,
      normalizedCommand,
    };
  }
}
