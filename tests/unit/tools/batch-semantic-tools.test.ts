import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  BatchFindSymbolsTool,
  SearchCodeTool,
  createSemanticNavigationTools,
} from '../../../src/infra/tools/semantic-navigation-tools.js';
import { createWorkspaceTools } from '../../../src/infra/tools/workspace-tools.js';

describe('Batch Semantic Discovery Tools', () => {
  describe('BatchFindSymbolsTool', () => {
    it('returns error when symbols parameter is empty', async () => {
      const tool = new BatchFindSymbolsTool(process.cwd());
      const res = await tool.execute({ symbols: [] }, { correlationId: 'call-1' } as any);

      expect(res.success).toBe(false);
      expect(res.error).toBe('EMPTY_SYMBOLS');
    });

    it('locates declarations for multiple symbols across files in a single turn', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-sym-'));
      try {
        fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

        const fileA = `
export interface UserToken {
  userId: string;
  role: string;
}

export class AuthService {
  validate(token: UserToken): boolean {
    return true;
  }
}
`;
        const fileB = `
export function computeTotal(items: number[]): number {
  return items.reduce((a, b) => a + b, 0);
}
`;
        fs.writeFileSync(path.join(tmpDir, 'src/auth.ts'), fileA, 'utf-8');
        fs.writeFileSync(path.join(tmpDir, 'src/math.ts'), fileB, 'utf-8');

        const tool = new BatchFindSymbolsTool(tmpDir);
        const res = await tool.execute(
          {
            symbols: ['UserToken', 'AuthService', 'computeTotal', 'NonExistentSymbol'],
            max_matches_per_symbol: 5,
          },
          { correlationId: 'call-2' } as any,
        );

        expect(res.success).toBe(true);
        expect(res.output).toContain("Symbol 'UserToken' (1 match)");
        expect(res.output).toContain("Symbol 'AuthService' (1 match)");
        expect(res.output).toContain("Symbol 'computeTotal' (1 match)");
        expect(res.output).toContain("Symbol 'NonExistentSymbol': 0 matches found");
        expect(res.metadata?.['totalMatches']).toBe(3);
        expect(res.metadata?.['symbolsSearched']).toBe(4);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('SearchCodeTool', () => {
    it('returns error when queries parameter is empty', async () => {
      const tool = new SearchCodeTool(process.cwd());
      const res = await tool.execute({ queries: [] }, { correlationId: 'call-1' } as any);

      expect(res.success).toBe(false);
      expect(res.error).toBe('EMPTY_QUERIES');
    });

    it('searches for multiple patterns concurrently with context lines', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-code-'));
      try {
        fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

        const file1 = `// Auth module
const SECRET_KEY = 'super-secret-token';
export function getSecret() {
  return SECRET_KEY;
}
`;
        const file2 = `// Database client
export class DatabaseClient {
  connect() {
    console.log('Connecting to database...');
  }
}
`;
        fs.writeFileSync(path.join(tmpDir, 'src/secret.ts'), file1, 'utf-8');
        fs.writeFileSync(path.join(tmpDir, 'src/db.ts'), file2, 'utf-8');

        const tool = new SearchCodeTool(tmpDir);
        const res = await tool.execute(
          {
            queries: ['SECRET_KEY', 'DatabaseClient'],
            context_lines: 1,
            max_matches: 10,
          },
          { correlationId: 'call-3' } as any,
        );

        expect(res.success).toBe(true);
        expect(res.output).toContain('SECRET_KEY');
        expect(res.output).toContain('DatabaseClient');
        expect(res.output).toContain('src/secret.ts');
        expect(res.output).toContain('src/db.ts');
        expect(res.metadata?.['matchesCount']).toBeGreaterThanOrEqual(2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('filters by file_pattern properly', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-filter-'));
      try {
        fs.writeFileSync(path.join(tmpDir, 'test.py'), 'FOO = 1\n', 'utf-8');
        fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'export const FOO = 2;\n', 'utf-8');

        const tool = new SearchCodeTool(tmpDir);
        const res = await tool.execute(
          {
            queries: ['FOO'],
            file_pattern: '.py',
          },
          { correlationId: 'call-4' } as any,
        );

        expect(res.success).toBe(true);
        expect(res.output).toContain('test.py');
        expect(res.output).not.toContain('test.ts');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('Factory Registrations', () => {
    it('createSemanticNavigationTools includes batch tools', () => {
      const tools = createSemanticNavigationTools(process.cwd());
      const names = tools.map((t) => t.definition.name);

      expect(names).toContain('find_definitions');
      expect(names).toContain('find_references');
      expect(names).toContain('get_outline');
      expect(names).toContain('batch_find_symbols');
      expect(names).toContain('search_code');
    });

    it('createWorkspaceTools registers batch tools when enableSemanticNavigation is true', () => {
      const tools = createWorkspaceTools(process.cwd(), { enableSemanticNavigation: true });
      const names = tools.map((t) => t.definition.name);

      expect(names).toContain('batch_find_symbols');
      expect(names).toContain('search_code');
    });
  });
});
