import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  FindDefinitionsTool,
  FindReferencesTool,
  GetOutlineTool,
  createSemanticNavigationTools,
} from '../../../src/infra/tools/semantic-navigation-tools.js';
import { createWorkspaceTools } from '../../../src/infra/tools/workspace-tools.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';

describe('Semantic Navigation Tools (find_definitions, find_references, get_outline)', () => {
  let tmpDir: string;
  const idFactory = new UuidV7IdFactory();

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sem-nav-test-'));

    // Create a mock mini-codebase
    const srcDir = path.join(tmpDir, 'src');
    const authDir = path.join(srcDir, 'auth');
    await fs.promises.mkdir(authDir, { recursive: true });

    await fs.promises.writeFile(
      path.join(authDir, 'auth-service.ts'),
      `
export interface UserSession {
  userId: string;
  token: string;
}

export class AuthService {
  private activeSessions: Map<string, UserSession> = new Map();

  login(userId: string): UserSession {
    return { userId, token: 'secret' };
  }
}
      `.trim(),
      'utf-8',
    );

    await fs.promises.writeFile(
      path.join(srcDir, 'index.ts'),
      `
import { AuthService, UserSession } from './auth/auth-service.js';

export function bootstrap(): AuthService {
  const auth = new AuthService();
  return auth;
}
      `.trim(),
      'utf-8',
    );
  });

  afterEach(async () => {
    if (fs.existsSync(tmpDir)) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe('FindDefinitionsTool', () => {
    it('finds class and interface declarations across workspace files', async () => {
      const tool = new FindDefinitionsTool(tmpDir, idFactory);

      const res = await tool.execute({ symbol: 'AuthService' }, {});
      expect(res.success).toBe(true);
      expect(res.output).toContain("Found 1 definition(s) for 'AuthService':");
      expect(res.output).toContain('• [CLASS] src/auth/auth-service.ts');
      expect(res.output).toContain('class AuthService');

      const ifaceRes = await tool.execute({ symbol: 'UserSession' }, {});
      expect(ifaceRes.success).toBe(true);
      expect(ifaceRes.output).toContain('• [INTERFACE] src/auth/auth-service.ts');

      const funcRes = await tool.execute({ symbol: 'bootstrap' }, {});
      expect(funcRes.success).toBe(true);
      expect(funcRes.output).toContain('• [FUNCTION] src/index.ts');
    });

    it('returns not found message for unknown symbols', async () => {
      const tool = new FindDefinitionsTool(tmpDir, idFactory);
      const res = await tool.execute({ symbol: 'NonExistentSymbol' }, {});
      expect(res.success).toBe(true);
      expect(res.output).toContain("No definition found for symbol 'NonExistentSymbol'");
    });

    it('rejects empty symbol parameter', async () => {
      const tool = new FindDefinitionsTool(tmpDir, idFactory);
      const res = await tool.execute({ symbol: '' }, {});
      expect(res.success).toBe(false);
      expect(res.output).toContain("Parameter 'symbol' is required.");
    });
  });

  describe('FindReferencesTool', () => {
    it('locates usages, calls, and imports across files', async () => {
      const tool = new FindReferencesTool(tmpDir, idFactory);
      const res = await tool.execute({ symbol: 'AuthService' }, {});

      expect(res.success).toBe(true);
      expect(res.output).toContain("Found 4 reference(s) to 'AuthService':");
      expect(res.output).toContain('src/index.ts:1');
      expect(res.output).toContain('import { AuthService, UserSession }');
      expect(res.output).toContain('src/auth/auth-service.ts:6');
    });

    it('returns not found message when symbol has no references', async () => {
      const tool = new FindReferencesTool(tmpDir, idFactory);
      const res = await tool.execute({ symbol: 'FakeSymbol' }, {});
      expect(res.success).toBe(true);
      expect(res.output).toContain("No references found for symbol 'FakeSymbol'");
    });
  });

  describe('GetOutlineTool', () => {
    it('extracts high-level outline without reading entire file body', async () => {
      const tool = new GetOutlineTool(tmpDir, idFactory);
      const res = await tool.execute({ path: 'src/auth/auth-service.ts' }, {});

      expect(res.success).toBe(true);
      expect(res.output).toContain('Outline for src/auth/auth-service.ts');
      expect(res.output).toContain('• [INTERFACE] export UserSession');
      expect(res.output).toContain('• [CLASS] export AuthService');
      expect(res.output).toContain('• [METHOD] login');
    });

    it('denies access outside workspace', async () => {
      const tool = new GetOutlineTool(tmpDir, idFactory);
      const res = await tool.execute({ path: '../../etc/passwd' }, {});
      expect(res.success).toBe(false);
      expect(res.error).toBe('POLICY_DENIED');
    });

    it('handles non-existent files', async () => {
      const tool = new GetOutlineTool(tmpDir, idFactory);
      const res = await tool.execute({ path: 'src/missing.ts' }, {});
      expect(res.success).toBe(false);
      expect(res.error).toBe('FILE_NOT_FOUND');
    });
  });

  describe('Integration with createWorkspaceTools', () => {
    it('includes semantic navigation tools when enableSemanticNavigation is true', () => {
      const tools = createWorkspaceTools(tmpDir, { enableSemanticNavigation: true });
      const toolNames = tools.map((t) => t.definition.name);

      expect(toolNames).toContain('find_definitions');
      expect(toolNames).toContain('find_references');
      expect(toolNames).toContain('get_outline');
    });

    it('omits semantic navigation tools by default for minimal baseline footprint', () => {
      const tools = createWorkspaceTools(tmpDir);
      const toolNames = tools.map((t) => t.definition.name);

      expect(toolNames).not.toContain('find_definitions');
      expect(toolNames).not.toContain('find_references');
      expect(toolNames).not.toContain('get_outline');
    });
  });
});
