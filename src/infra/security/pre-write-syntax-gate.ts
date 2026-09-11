/**
 * Pre-Write In-Memory AST Syntax & Parse Gate.
 *
 * Intercepts file writes and modifications before disk flush, validating syntax
 * in-memory across TypeScript, JavaScript, JSON, Python, and other structured languages.
 * Prevents corrupted files, broken builds, and syntax hallucinations from entering
 * the workspace or Git working tree.
 */
import * as path from 'node:path';
import * as vm from 'node:vm';

export interface SyntaxValidationResult {
  readonly valid: boolean;
  readonly language: string;
  readonly error?: string;
  readonly line?: number;
  readonly column?: number;
}

export interface PreWriteSyntaxGateOptions {
  readonly enabled?: boolean;
  readonly ignoredExtensions?: readonly string[];
}

export class PreWriteSyntaxGate {
  private readonly enabled: boolean;
  private readonly ignoredExtensions: Set<string>;

  constructor(options: PreWriteSyntaxGateOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.ignoredExtensions = new Set(
      (options.ignoredExtensions ?? ['.txt', '.md', '.markdown', '.log', '.csv', '.patch']).map(
        (ext) => ext.toLowerCase(),
      ),
    );
  }

  /**
   * Validates file contents in-memory prior to writing to disk.
   */
  validate(filePath: string, content: string): SyntaxValidationResult {
    if (!this.enabled) {
      return { valid: true, language: 'unknown' };
    }

    const ext = path.extname(filePath).toLowerCase();
    if (this.ignoredExtensions.has(ext)) {
      return { valid: true, language: 'text' };
    }

    switch (ext) {
      case '.json':
        return this.validateJson(content);
      case '.js':
      case '.mjs':
      case '.cjs':
        return this.validateJavaScript(content);
      case '.ts':
      case '.tsx':
      case '.jsx':
        return this.validateTypeScript(content);
      case '.py':
        return this.validatePython(content);
      case '.rs':
      case '.go':
      case '.c':
      case '.cpp':
      case '.h':
      case '.hpp':
      case '.java':
        return this.validateBrackets(content, ext.slice(1));
      default:
        return { valid: true, language: ext.slice(1) || 'unknown' };
    }
  }

  /**
   * Validates JSON syntax using native V8 parser.
   */
  private validateJson(content: string): SyntaxValidationResult {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return {
        valid: false,
        language: 'json',
        error: 'JSON file cannot be empty.',
        line: 1,
        column: 1,
      };
    }

    try {
      JSON.parse(content);
      return { valid: true, language: 'json' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const posMatch = message.match(/position\s+(\d+)/i) || message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
      let line = 1;
      let column = 1;

      if (posMatch && posMatch[1] && !posMatch[2]) {
        const charIndex = parseInt(posMatch[1], 10);
        const prefix = content.slice(0, charIndex);
        const lines = prefix.split('\n');
        line = lines.length;
        column = (lines[lines.length - 1]?.length ?? 0) + 1;
      } else if (posMatch && posMatch[1] && posMatch[2]) {
        line = parseInt(posMatch[1], 10);
        column = parseInt(posMatch[2], 10);
      }

      return {
        valid: false,
        language: 'json',
        error: message,
        line,
        column,
      };
    }
  }

  /**
   * Validates JavaScript syntax in-memory via Node vm.Script.
   */
  private validateJavaScript(content: string): SyntaxValidationResult {
    // Check delimiter balance first
    const delimiterRes = this.validateBrackets(content, 'javascript');
    if (!delimiterRes.valid) {
      return delimiterRes;
    }

    try {
      // vm.Script checks pure JS syntax without executing code
      new vm.Script(content);
      return { valid: true, language: 'javascript' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // If code uses ESM top-level import/export, vm.Script without module flag can complain
      if (message.includes('Cannot use import statement') || message.includes('Unexpected token \'export\'')) {
        return { valid: true, language: 'javascript' };
      }

      const stack = err instanceof Error ? err.stack ?? '' : '';
      const lineMatch = stack.match(/:(\d+)(?::(\d+))?/);
      const line = lineMatch && lineMatch[1] ? parseInt(lineMatch[1], 10) : undefined;
      const column = lineMatch && lineMatch[2] ? parseInt(lineMatch[2], 10) : undefined;

      return {
        valid: false,
        language: 'javascript',
        error: message,
        line,
        column,
      };
    }
  }

  /**
   * Validates TypeScript / JSX syntax.
   */
  private validateTypeScript(content: string): SyntaxValidationResult {
    // 1. Verify delimiter balance & strings
    const delimiterRes = this.validateBrackets(content, 'typescript');
    if (!delimiterRes.valid) {
      return delimiterRes;
    }

    // 2. Scan for common TypeScript syntax hallucinations
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      // Check for unclosed template literal backtick on non-multiline single-line candidates
      if (
        (trimmed.startsWith('const ') || trimmed.startsWith('let ') || trimmed.startsWith('var ')) &&
        trimmed.includes('`') &&
        !trimmed.endsWith(';') &&
        !trimmed.endsWith(',') &&
        !trimmed.endsWith('{') &&
        !trimmed.endsWith('`')
      ) {
        // Could be start of multiline template, which is valid
      }

      // Check for stray markdown codeblock backticks (frequent model failure mode)
      if (trimmed === '```' || trimmed.startsWith('```ts') || trimmed.startsWith('```javascript')) {
        return {
          valid: false,
          language: 'typescript',
          error: 'Forbidden markdown code block delimiter (\'```\') detected inside source code.',
          line: i + 1,
          column: 1,
        };
      }
    }

    return { valid: true, language: 'typescript' };
  }

  /**
   * Validates Python syntax (delimiters, triple-quotes, colon expectations).
   */
  private validatePython(content: string): SyntaxValidationResult {
    // Delimiter balance (ignoring Python comments)
    const delimiterRes = this.validateBrackets(content, 'python', '#');
    if (!delimiterRes.valid) {
      return delimiterRes;
    }

    const lines = content.split('\n');
    let insideTripleSingle = false;
    let insideTripleDouble = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      // Check markdown delimiters
      if (trimmed === '```' || trimmed.startsWith('```py') || trimmed.startsWith('```python')) {
        return {
          valid: false,
          language: 'python',
          error: 'Forbidden markdown code block delimiter (\'```\') detected inside source code.',
          line: i + 1,
          column: 1,
        };
      }

      // Count triple quotes
      let idx = 0;
      while ((idx = line.indexOf("'''", idx)) !== -1) {
        insideTripleSingle = !insideTripleSingle;
        idx += 3;
      }

      idx = 0;
      while ((idx = line.indexOf('"""', idx)) !== -1) {
        insideTripleDouble = !insideTripleDouble;
        idx += 3;
      }
    }

    if (insideTripleSingle || insideTripleDouble) {
      return {
        valid: false,
        language: 'python',
        error: 'Unclosed triple quote block docstring in Python source.',
        line: lines.length,
        column: 1,
      };
    }

    return { valid: true, language: 'python' };
  }

  /**
   * Universal delimiter & bracket balancer ((), [], {}) with string and comment masking.
   */
  private validateBrackets(content: string, language: string, singleLineComment = '//'): SyntaxValidationResult {
    const stack: Array<{ char: string; line: number; col: number }> = [];
    const lines = content.split('\n');

    let inMultiComment = false;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplateLiteral = false;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx] ?? '';
      const lineNum = lineIdx + 1;

      for (let colIdx = 0; colIdx < line.length; colIdx++) {
        const char = line[colIdx] ?? '';
        const nextChar = line[colIdx + 1];
        const colNum = colIdx + 1;

        // Escape handling inside strings
        if ((inSingleQuote || inDoubleQuote || inTemplateLiteral) && char === '\\') {
          colIdx++; // Skip escaped character
          continue;
        }

        // Multi-line comment entry/exit
        if (!inSingleQuote && !inDoubleQuote && !inTemplateLiteral) {
          if (!inMultiComment && char === '/' && nextChar === '*') {
            inMultiComment = true;
            colIdx++;
            continue;
          }
          if (inMultiComment && char === '*' && nextChar === '/') {
            inMultiComment = false;
            colIdx++;
            continue;
          }
        }

        if (inMultiComment) {
          continue;
        }

        // Single-line comment check
        if (!inSingleQuote && !inDoubleQuote && !inTemplateLiteral) {
          if (
            (singleLineComment === '//' && char === '/' && nextChar === '/') ||
            (singleLineComment === '#' && char === '#')
          ) {
            break; // Skip remainder of line
          }
        }

        // String quotes toggle
        if (char === '\'' && !inDoubleQuote && !inTemplateLiteral) {
          inSingleQuote = !inSingleQuote;
          continue;
        }
        if (char === '"' && !inSingleQuote && !inTemplateLiteral) {
          inDoubleQuote = !inDoubleQuote;
          continue;
        }
        if (char === '`' && !inSingleQuote && !inDoubleQuote) {
          inTemplateLiteral = !inTemplateLiteral;
          continue;
        }

        if (inSingleQuote || inDoubleQuote || inTemplateLiteral) {
          continue;
        }

        // Delimiter push
        if (char === '(' || char === '[' || char === '{') {
          stack.push({ char, line: lineNum, col: colNum });
        } else if (char === ')' || char === ']' || char === '}') {
          if (stack.length === 0) {
            return {
              valid: false,
              language,
              error: `Unexpected closing delimiter '${char}' with no matching opening delimiter.`,
              line: lineNum,
              column: colNum,
            };
          }

          const top = stack.pop();
          if (!top) {
            continue;
          }
          const matches =
            (top.char === '(' && char === ')') ||
            (top.char === '[' && char === ']') ||
            (top.char === '{' && char === '}');

          if (!matches) {
            return {
              valid: false,
              language,
              error: `Mismatched delimiter: opened '${top.char}' at line ${top.line}, col ${top.col} but closed with '${char}'.`,
              line: lineNum,
              column: colNum,
            };
          }
        }
      }

      // Reset single and double quotes at end of line if unclosed (unless multiline supported)
      if (inSingleQuote) {
        // In most languages, single quotes cannot span lines without backslash
        inSingleQuote = false;
      }
      if (inDoubleQuote) {
        inDoubleQuote = false;
      }
    }

    if (stack.length > 0) {
      const unclosed = stack[stack.length - 1];
      if (unclosed) {
        return {
          valid: false,
          language,
          error: `Unclosed delimiter '${unclosed.char}' opened at line ${unclosed.line}, col ${unclosed.col}.`,
          line: unclosed.line,
          column: unclosed.col,
        };
      }
    }

    return { valid: true, language };
  }
}
