/**
 * Prefix Caching Compiler Unit Tests.
 *
 * Verifies clean segregation of static context (system instructions, schemas, repo maps)
 * and dynamic context (iteration tasks, active file contents, observations) with ephemeral caching metadata.
 */
import { describe, it, expect } from 'vitest';
import { PrefixCachingCompiler } from '../../../src/infra/index.js';
import { MessageRole } from '../../../src/core/index.js';

describe('PrefixCachingCompiler Unit Tests', () => {
  it('compiles static and dynamic segments with cacheControl and computes token distribution', () => {
    const payload = PrefixCachingCompiler.compile({
      systemPrompt: 'You are an autonomous engineering agent for Vi-Harness.',
      codingStandards: 'Strict TypeScript. No any types. Full test coverage required.',
      toolSchemasText: 'read_file(path), write_file(path, content), run_command(command)',
      repoMapOutline: 'class AuthController { login(), logout() }\nclass UserService { getUser() }',
      taskDescription: 'Fix SQL injection vulnerability in auth module',
      currentPhase: 'DECIDE',
      iterationNumber: 3,
      dynamicObservations: ['Found vulnerable raw string concatenation in src/auth/login.ts'],
      activeFileContents: [
        {
          path: 'src/auth/login.ts',
          content:
            'export function login(user, pass) { db.query("SELECT * FROM users WHERE user=" + user); }',
        },
      ],
    });

    expect(payload.segments.length).toBe(3); // Static System, Static RepoMap, Dynamic State

    // 1. Static System Block
    const staticSys = payload.segments[0]!;
    expect(staticSys.segmentType).toBe('STATIC');
    expect(staticSys.role).toBe(MessageRole.SYSTEM);
    expect(staticSys.cacheControl).toEqual({ type: 'ephemeral' });
    expect(staticSys.content).toContain('Repository Coding Standards');
    expect(staticSys.content).toContain('Available Tools & Schemas');

    // 2. Static Repo-Map Block
    const staticMap = payload.segments[1]!;
    expect(staticMap.segmentType).toBe('STATIC');
    expect(staticMap.role).toBe(MessageRole.SYSTEM);
    expect(staticMap.cacheControl).toEqual({ type: 'ephemeral' });
    expect(staticMap.content).toContain('AuthController');

    // 3. Dynamic State Block
    const dynamicState = payload.segments[2]!;
    expect(dynamicState.segmentType).toBe('DYNAMIC');
    expect(dynamicState.role).toBe(MessageRole.USER);
    expect(dynamicState.cacheControl).toBeUndefined();
    expect(dynamicState.content).toContain('Iteration: 3');
    expect(dynamicState.content).toContain('SELECT * FROM users');

    // 4. Token Accounting & Ratios
    expect(payload.totalStaticTokens).toBeGreaterThan(0);
    expect(payload.totalDynamicTokens).toBeGreaterThan(0);
    expect(payload.staticTokenRatio).toBeGreaterThan(0.3); // High static cacheable portion

    // 5. Formatted Model Messages
    expect(payload.formattedMessages.length).toBe(3);
    expect(payload.formattedMessages[0]!.metadata?.cacheControl).toEqual({ type: 'ephemeral' });
  });
});
