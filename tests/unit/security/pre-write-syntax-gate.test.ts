import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { PreWriteSyntaxGate } from '../../../src/infra/security/pre-write-syntax-gate.js';
import {
  WorkspaceWriteFileTool,
  WorkspaceEditFileTool,
} from '../../../src/infra/tools/workspace-tools.js';

describe('PreWriteSyntaxGate & Workspace Tools Integration', () => {
  const gate = new PreWriteSyntaxGate();

  describe('JSON Validation', () => {
    it('approves well-formed JSON', () => {
      const res = gate.validate('package.json', '{"name": "test", "version": "1.0.0"}');
      expect(res.valid).toBe(true);
      expect(res.language).toBe('json');
    });

    it('rejects empty JSON content', () => {
      const res = gate.validate('data.json', '');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('cannot be empty');
    });

    it('rejects malformed JSON with syntax details', () => {
      const res = gate.validate('config.json', '{\n  "name": "test",\n  "broken": \n}');
      expect(res.valid).toBe(false);
      expect(res.language).toBe('json');
      expect(res.line).toBeGreaterThanOrEqual(1);
    });
  });

  describe('JavaScript Validation', () => {
    it('approves standard JavaScript code', () => {
      const code = 'function add(a, b) {\n  return a + b;\n}\nconsole.log(add(2, 3));';
      const res = gate.validate('index.js', code);
      expect(res.valid).toBe(true);
      expect(res.language).toBe('javascript');
    });

    it('approves ESM code with imports and exports', () => {
      const code = 'import { foo } from "./foo.js";\nexport const bar = foo + 1;';
      const res = gate.validate('module.mjs', code);
      expect(res.valid).toBe(true);
    });

    it('rejects unclosed curly braces in JavaScript', () => {
      const code = 'function broken() {\n  const x = 1;\n';
      const res = gate.validate('broken.js', code);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Unclosed delimiter');
      expect(res.line).toBe(1);
    });
  });

  describe('TypeScript & Delimiter Validation', () => {
    it('approves valid TypeScript interfaces and functions', () => {
      const code = `
interface User {
  id: string;
  count: number;
}

export function processUser(user: User): string {
  const arr = [1, 2, 3];
  return \`User: \${user.id} (\${arr.length})\`;
}
`;
      const res = gate.validate('user.ts', code);
      expect(res.valid).toBe(true);
      expect(res.language).toBe('typescript');
    });

    it('rejects mismatched delimiters in TypeScript', () => {
      const code = 'const items = [1, 2, 3};';
      const res = gate.validate('bad.ts', code);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Mismatched delimiter');
      expect(res.line).toBe(1);
    });

    it('rejects model hallucinated markdown codeblock backticks', () => {
      const code = 'export const value = 42;\n```\nconst after = 10;';
      const res = gate.validate('code.ts', code);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Forbidden markdown code block delimiter');
      expect(res.line).toBe(2);
    });
  });

  describe('Python Validation', () => {
    it('approves valid Python functions and comments', () => {
      const code = `
def compute_sum(items: list[int]) -> int:
    # Compute sum with comment
    total = 0
    for x in items:
        total += x
    return total
`;
      const res = gate.validate('calc.py', code);
      expect(res.valid).toBe(true);
      expect(res.language).toBe('python');
    });

    it('rejects unclosed parentheses in Python', () => {
      const code = 'def test():\n    print("hello"\n';
      const res = gate.validate('test.py', code);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Unclosed delimiter');
    });

    it('rejects unclosed triple quote docstrings', () => {
      const code = 'def test():\n    """Unfinished docstring\n    return 1';
      const res = gate.validate('doc.py', code);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Unclosed triple quote');
    });
  });

  describe('Workspace Tools Disk Protection Integration', () => {
    it('prevents WorkspaceWriteFileTool from writing broken code to disk', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-write-'));
      try {
        const writeTool = new WorkspaceWriteFileTool(tmpDir, undefined, undefined, gate);
        const badCode = 'export function bad() {\n  const x = [1, 2};\n';

        const result = await writeTool.execute(
          { path: 'src/bad.ts', content: badCode },
          { correlationId: 'test-call' } as any,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('SYNTAX_VALIDATION_FAILED');
        expect(result.output).toContain('[PreWriteSyntaxGate Error]');

        // Verify file was NOT created on disk!
        expect(fs.existsSync(path.join(tmpDir, 'src/bad.ts'))).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('allows WorkspaceWriteFileTool to write valid code to disk', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-write-ok-'));
      try {
        const writeTool = new WorkspaceWriteFileTool(tmpDir, undefined, undefined, gate);
        const goodCode = 'export function good(): number {\n  return 42;\n}\n';

        const result = await writeTool.execute(
          { path: 'src/good.ts', content: goodCode },
          { correlationId: 'test-call' } as any,
        );

        expect(result.success).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, 'src/good.ts'))).toBe(true);
        expect(fs.readFileSync(path.join(tmpDir, 'src/good.ts'), 'utf-8')).toBe(goodCode);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('prevents WorkspaceEditFileTool from corrupting a valid file on disk', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-edit-'));
      try {
        const originalContent = 'export function calculate(): number {\n  return 10;\n}\n';
        const targetPath = path.join(tmpDir, 'calc.ts');
        fs.writeFileSync(targetPath, originalContent, 'utf-8');

        const editTool = new WorkspaceEditFileTool(tmpDir, undefined, undefined, gate);

        // Model attempts to replace `return 10;` with unbalanced syntax `return [10, 20;`
        const result = await editTool.execute(
          {
            path: 'calc.ts',
            old_string: 'return 10;',
            new_string: 'return [10, 20;',
          },
          { correlationId: 'test-edit' } as any,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('SYNTAX_VALIDATION_FAILED');
        expect(result.output).toContain('[PreWriteSyntaxGate Error]');

        // Verify disk content was NOT corrupted! Original content is preserved!
        expect(fs.readFileSync(targetPath, 'utf-8')).toBe(originalContent);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
