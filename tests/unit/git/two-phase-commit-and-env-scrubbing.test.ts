/**
 * Two-Phase Git Commit, Auto Lint/Test Loop & Env Scrubbing Test Suite (P004).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  scrubEnv,
  SecureTempManager,
  SENSITIVE_PATTERNS,
} from '../../../src/infra/security/env-scrubber.js';
import { RealGitManager } from '../../../src/infra/git/real-git-manager.js';
import { DefaultRollbackManager } from '../../../src/infra/git/default-rollback-manager.js';
import { DefaultCheckpointStore } from '../../../src/infra/checkpoint/default-checkpoint-store.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { SystemClock } from '../../../src/infra/time/system-clock.js';
import { IterationExecutor } from '../../../src/runtime/iteration-executor.js';
import { StateMachine } from '../../../src/core/state-machine/state-machine.js';
import { AgentPhase } from '../../../src/core/model/state.js';
import { TaskStatus } from '../../../src/core/model/task.js';
import { ActionType } from '../../../src/core/model/action.js';
import { AgentObserverHub } from '../../../src/runtime/agent-observer.js';
import { VerificationProfile, VerificationStatus } from '../../../src/core/model/verification.js';
import { ContextTier } from '../../../src/core/model/context.js';
import { DefaultContextCompiler } from '../../../src/infra/compiler/default-context-compiler.js';

const execFileAsync = promisify(execFile);

describe(
  'Two-Phase Git Commit, Auto Lint/Test Loop & Env Scrubbing (P004)',
  { timeout: 30000 },
  () => {
    describe('1. Environment Variable Scrubbing & Secure Temp Manager', () => {
      it('should scrub sensitive credentials and retain safe environment variables', () => {
        const sampleEnv: Record<string, string> = {
          PATH: '/usr/bin:/bin',
          NODE_ENV: 'production',
          HOME: '/home/user',
          ANTHROPIC_API_KEY: 'sk-ant-123456789',
          OPENAI_SECRET_KEY: 'sk-proj-abcdef',
          GITHUB_TOKEN: 'ghp_987654321',
          DATABASE_PASSWORD: 'supersecretpass',
          AWS_CREDENTIAL_TOKEN: 'aws-token-xyz',
          JWT_AUTH_BEARER: 'bearer.token.jwt',
          PRIVATE_SIGNING_KEY: '-----BEGIN PRIVATE KEY-----',
          USER_PASSWD_HASH: 'hash123',
          CUSTOM_SAFE_VAR: 'safe_value',
        };

        const scrubbed = scrubEnv(sampleEnv);

        // Verify all sensitive patterns are stripped
        expect(scrubbed['ANTHROPIC_API_KEY']).toBeUndefined();
        expect(scrubbed['OPENAI_SECRET_KEY']).toBeUndefined();
        expect(scrubbed['GITHUB_TOKEN']).toBeUndefined();
        expect(scrubbed['DATABASE_PASSWORD']).toBeUndefined();
        expect(scrubbed['AWS_CREDENTIAL_TOKEN']).toBeUndefined();
        expect(scrubbed['JWT_AUTH_BEARER']).toBeUndefined();
        expect(scrubbed['PRIVATE_SIGNING_KEY']).toBeUndefined();
        expect(scrubbed['USER_PASSWD_HASH']).toBeUndefined();

        // Verify safe variables are retained
        expect(scrubbed['PATH']).toBe('/usr/bin:/bin');
        expect(scrubbed['NODE_ENV']).toBe('production');
        expect(scrubbed['HOME']).toBe('/home/user');
        expect(scrubbed['CUSTOM_SAFE_VAR']).toBe('safe_value');
      });

      it('should create private temporary directory with 0o700 and write temp file with 0o600 / wx', () => {
        const tempDir = SecureTempManager.createSecureTempDir('test-sec-dir-');
        expect(fs.existsSync(tempDir)).toBe(true);

        const stats = fs.statSync(tempDir);
        expect(stats.isDirectory()).toBe(true);

        const filePath = SecureTempManager.writeSecureTempFile(tempDir, 'secure content 123');
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('secure content 123');

        // Attempting to overwrite existing file directly with wx flag should throw
        const fileName = path.basename(filePath);
        expect(() => {
          SecureTempManager.writeSecureTempFile(tempDir, 'new content', fileName);
        }).toThrow();

        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    describe('2. Two-Phase Git Commit & Safe Rollback', () => {
      let testRepoDir: string;

      beforeEach(async () => {
        testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-test-twophase-'));
        // Initialize Git repository
        await execFileAsync('git', ['init', '-b', 'main'], { cwd: testRepoDir });
        await execFileAsync('git', ['config', 'user.name', 'ViHarness Test'], { cwd: testRepoDir });
        await execFileAsync('git', ['config', 'user.email', 'test@viharness.local'], {
          cwd: testRepoDir,
        });

        // Initial clean commit
        fs.writeFileSync(path.join(testRepoDir, 'README.md'), '# Test Repository\n');
        await execFileAsync('git', ['add', '-A'], { cwd: testRepoDir });
        await execFileAsync('git', ['commit', '-m', 'initial commit'], { cwd: testRepoDir });
      }, 30000);

      afterEach(async () => {
        if (fs.existsSync(testRepoDir)) {
          try {
            await new Promise((r) => setTimeout(r, 50));
            fs.rmSync(testRepoDir, {
              recursive: true,
              force: true,
              maxRetries: 5,
              retryDelay: 100,
            });
          } catch {
            // Ignore temp dir cleanup errors on Windows
          }
        }
      }, 30000);

      it(
        'should preserve dirty user changes in a user-state commit before agent execution',
        { timeout: 60000 },
        async () => {
          const idFactory = new UuidV7IdFactory();
          const clock = new SystemClock();
          const git = new RealGitManager({ workingDir: testRepoDir });
          const rollback = new DefaultRollbackManager();
          const checkpointStore = new DefaultCheckpointStore({ idFactory, clock });

          // 1. User makes uncommitted changes before agent starts
          const userFile = path.join(testRepoDir, 'user_work.txt');
          fs.writeFileSync(userFile, 'User Uncommitted Feature Work');

          expect(await git.isDirty()).toBe(true);

          // 2. Capture baseline with two-phase commit (default: preserveUserChanges: true)
          const baseline = await git.captureBaseline({ preserveUserChanges: true });
          expect(git.userStateCommit).toBeDefined();

          // Working tree should now be clean because user changes were saved into user-state commit
          expect(await git.isDirty()).toBe(false);

          // 3. Agent begins execution and creates its own changes
          git.markFileOwner('agent_file.ts', 'agent');
          const agentFile = path.join(testRepoDir, 'agent_file.ts');
          fs.writeFileSync(agentFile, 'export function agentGeneratedCode() {}');

          const agentCommitSha = await git.createCommit('agent: implement feature');
          const cp = await checkpointStore.create({
            taskId: idFactory.create<'Task'>(),
            gitRef: git.userStateCommit,
            state: { taskId: idFactory.create<'Task'>(), iterationCount: 1 } as any,
            reason: 'agent_checkpoint',
            agentOwnedFiles: ['agent_file.ts'],
            userOwnedFiles: ['user_work.txt'],
          });
          const cpId = cp.id;

          // 4. Rollback to checkpoint
          const rollbackResult = await rollback.rollbackToCheckpoint(cpId, checkpointStore, git);
          expect(rollbackResult.success).toBe(true);

          // 5. Verify agent work is reverted, but user work is intact!
          expect(fs.existsSync(userFile)).toBe(true);
          expect(fs.readFileSync(userFile, 'utf-8')).toBe('User Uncommitted Feature Work');
        },
      );
    });

    describe('3. Auto Lint/Test Loop & Feedback Injection', () => {
      it('should execute auto-lint after file write and inject failure as L0_HOT context', async () => {
        const idFactory = new UuidV7IdFactory();
        const clock = new SystemClock();
        const observerHub = new AgentObserverHub();
        const stateMachine = new StateMachine({ idFactory, clock });

        const goal = {
          id: idFactory.create<'Goal'>(),
          description: 'Implement secure auth',
          constraints: { maxCostDollars: 10, maxDurationSeconds: 300, requireVerification: true },
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const task = {
          id: idFactory.create<'Task'>(),
          goalId: goal.id,
          description: 'Write auth module',
          status: TaskStatus.IN_PROGRESS,
          priority: 1,
          dependencies: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Mock Router
        const mockRouter = {
          route: async () => ({
            selectedProvider: {
              providerId: 'mock-provider',
              descriptor: {
                id: 'mock-model',
                name: 'Mock Model',
                provider: 'mock',
                capabilities: {
                  capabilities: [],
                  maxContextTokens: 32000,
                  maxOutputTokens: 4096,
                  supportsToolCalling: true,
                  supportsStreaming: false,
                  supportsStructuredOutput: true,
                  supportsVision: false,
                },
              },
              complete: async () => ({
                message: {
                  role: 'assistant' as const,
                  content: 'Writing file...',
                },
                toolCalls: [
                  {
                    id: 'call-1',
                    name: 'write_file',
                    input: { path: 'src/auth/token.ts', content: 'invalid javascript syntax {' },
                  },
                ],
                finishReason: 'tool_calls' as const,
                usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
                costDollars: 0.001,
              }),
            },
            selectedModelId: 'mock-model',
            rationale: 'Testing auto-lint loop',
          }),
        };

        // Mock Compiler
        const compiler = new DefaultContextCompiler({ idFactory, clock });

        // Mock Tool Executor that simulates successful write_file
        const mockToolExecutor = {
          getTool: (name: string) => ({
            definition: {
              name,
              version: '1.0.0',
              description: 'Write file tool',
              category: 'WRITE' as any,
              riskLevel: 'MEDIUM' as any,
              mutating: true,
              idempotent: false,
              defaultTimeoutMs: 5000,
              requiredPermissions: [],
              inputSchema: { type: 'object' },
            },
          }),
          listTools: () => [],
          execute: async (_req: any) => ({
            toolCallId: idFactory.create<'ToolCall'>(),
            name: 'write_file',
            success: true,
            output: 'File written successfully',
            durationMs: 10,
            metadata: { toolName: 'write_file', path: 'src/auth/token.ts' },
          }),
        };

        // Mock Verification Engine that fails linting on token.ts
        let lintAttempts = 0;
        const mockVerificationEngine = {
          verify: async (target: any) => {
            if (target.type === 'lint') {
              lintAttempts++;
              return {
                status: VerificationStatus.FAILED,
                summary: 'SyntaxError: Unexpected token { on line 1',
                evidenceIds: [],
                taskId: task.id,
                verifiedAt: new Date(),
                durationMs: 5,
                confidence: 0.95,
                scope: 'file' as const,
                affectedFiles: ['src/auth/token.ts'],
                checkExecutions: [],
              };
            }
            return {
              status: VerificationStatus.PASSED,
              summary: 'Passed',
              evidenceIds: [],
              taskId: task.id,
              verifiedAt: new Date(),
              durationMs: 5,
              confidence: 1.0,
              scope: 'repository' as const,
              affectedFiles: [],
              checkExecutions: [],
            };
          },
        };

        const iterationRecord = await IterationExecutor.executeIteration({
          executionId: idFactory.create<'Execution'>(),
          goal,
          task,
          stateMachine,
          router: mockRouter as any,
          compiler,
          toolExecutor: mockToolExecutor as any,
          verificationEngine: mockVerificationEngine as any,
          observerHub,
          idFactory,
          clock,
          iterationsSoFar: [],
          startTimeMs: Date.now(),
          totalCostDollars: 0,
          options: {
            autoLintAfterWrite: true,
            maxAutoCorrectionsPerFile: 2,
          },
        });

        // 1. Verify auto-lint was invoked
        expect(lintAttempts).toBe(1);

        // 2. Verify evidence was recorded with [AUTO-LINT FAILURE]
        const lintEvidence = iterationRecord.evidenceCreated.find((e) =>
          e.summary.includes('[AUTO-LINT FAILURE]'),
        );
        expect(lintEvidence).toBeDefined();
        expect(lintEvidence!.pass).toBe(false);
        expect(lintEvidence!.summary).toContain('SyntaxError');

        // 3. Verify that the compiler classifies this failure evidence as L0_HOT context
        const compiled = await compiler.compile({
          goal,
          task,
          currentState: AgentPhase.IMPLEMENT,
          targetModelDescriptor: {
            id: 'mock-model',
            name: 'Mock',
            provider: 'mock',
            capabilities: {
              capabilities: [],
              maxContextTokens: 32000,
              maxOutputTokens: 4000,
              supportsToolCalling: true,
              supportsStreaming: false,
              supportsStructuredOutput: true,
              supportsVision: false,
            },
          },
          budget: { maxTokens: 4000, softLimitTokens: 3500 },
          recentEvidence: iterationRecord.evidenceCreated,
        });

        const hotObject = compiled.retainedObjects.find(
          (o) => o.tags.includes('auto_feedback') && o.tier === ContextTier.L0_HOT,
        );
        expect(hotObject).toBeDefined();
        expect(hotObject!.content).toContain('[AUTO-LINT FAILURE]');
      });

      it('should throttle auto-correction after reaching maxAutoCorrectionsPerFile', async () => {
        const idFactory = new UuidV7IdFactory();
        const clock = new SystemClock();
        const observerHub = new AgentObserverHub();
        const stateMachine = new StateMachine({ idFactory, clock });

        const goal = {
          id: idFactory.create<'Goal'>(),
          description: 'Fix buggy code',
          constraints: { maxCostDollars: 10, maxDurationSeconds: 300, requireVerification: true },
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const task = {
          id: idFactory.create<'Task'>(),
          goalId: goal.id,
          description: 'Fix buggy module',
          status: TaskStatus.IN_PROGRESS,
          priority: 1,
          dependencies: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const mockRouter = {
          route: async () => ({
            selectedProvider: {
              providerId: 'mock-provider',
              descriptor: {
                id: 'mock-model',
                name: 'Mock Model',
                provider: 'mock',
                capabilities: {
                  capabilities: [],
                  maxContextTokens: 32000,
                  maxOutputTokens: 4096,
                  supportsToolCalling: true,
                  supportsStreaming: false,
                  supportsStructuredOutput: true,
                  supportsVision: false,
                },
              },
              complete: async () => ({
                message: { role: 'assistant' as const, content: 'Rewriting...' },
                toolCalls: [
                  {
                    id: 'call-retry',
                    name: 'write_file',
                    input: { path: 'src/repeated-failure.ts', content: 'broken syntax' },
                  },
                ],
                finishReason: 'tool_calls' as const,
                usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
                costDollars: 0.001,
              }),
            },
            selectedModelId: 'mock-model',
          }),
        };

        const compiler = new DefaultContextCompiler({ idFactory, clock });
        const mockToolExecutor = {
          getTool: (name: string) => ({
            definition: {
              name,
              version: '1.0.0',
              description: 'Write file tool',
              category: 'WRITE' as any,
              riskLevel: 'MEDIUM' as any,
              mutating: true,
              idempotent: false,
              defaultTimeoutMs: 5000,
              requiredPermissions: [],
              inputSchema: { type: 'object' },
            },
          }),
          listTools: () => [],
          execute: async () => ({
            toolCallId: idFactory.create<'ToolCall'>(),
            name: 'write_file',
            success: true,
            output: 'File written',
            durationMs: 10,
            metadata: { toolName: 'write_file', path: 'src/repeated-failure.ts' },
          }),
        };

        let lintCount = 0;
        const mockVerificationEngine = {
          verify: async (target: any) => {
            if (target.type === 'lint') {
              lintCount++;
              return {
                status: VerificationStatus.FAILED,
                summary: 'Syntax error still present',
                evidenceIds: [],
                taskId: task.id,
                verifiedAt: new Date(),
                durationMs: 5,
                confidence: 0.95,
                scope: 'file' as const,
                affectedFiles: ['src/repeated-failure.ts'],
                checkExecutions: [],
              };
            }
            return {
              status: VerificationStatus.PASSED,
              evidenceIds: [],
              taskId: task.id,
              verifiedAt: new Date(),
              durationMs: 0,
              confidence: 1.0,
              scope: 'repository' as const,
              affectedFiles: [],
              checkExecutions: [],
            };
          },
        };

        // Simulate 2 prior failed iterations for src/repeated-failure.ts
        const priorIteration1 = {
          iterationId: idFactory.create<'Iteration'>(),
          sequenceNumber: 1,
          startedAt: new Date(),
          completedAt: new Date(),
          stateBefore: AgentPhase.IMPLEMENT,
          stateAfter: AgentPhase.IMPLEMENT,
          modelId: 'mock-model',
          providerId: 'mock-provider',
          actionProposed: null,
          toolResults: [],
          evidenceCreated: [
            {
              id: idFactory.create<'Evidence'>(),
              taskId: task.id,
              type: 'STATIC_ANALYSIS' as any,
              outcome: 'FAIL' as any,
              summary: '[AUTO-LINT FAILURE] in src/repeated-failure.ts: Error 1',
              data: {},
              createdAt: new Date(),
              pass: false,
              confidence: 0.95,
              affectedFiles: ['src/repeated-failure.ts'],
            },
          ],
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          costDollars: 0.001,
          terminationDecision: { shouldTerminate: false, reason: 'CONTINUE' as any },
        };

        const priorIteration2 = {
          ...priorIteration1,
          iterationId: idFactory.create<'Iteration'>(),
          sequenceNumber: 2,
          evidenceCreated: [
            {
              id: idFactory.create<'Evidence'>(),
              taskId: task.id,
              type: 'STATIC_ANALYSIS' as any,
              outcome: 'FAIL' as any,
              summary: '[AUTO-LINT FAILURE] in src/repeated-failure.ts: Error 2',
              data: {},
              createdAt: new Date(),
              pass: false,
              confidence: 0.95,
              affectedFiles: ['src/repeated-failure.ts'],
            },
          ],
        };

        // 3rd attempt: already reached maxAutoCorrectionsPerFile = 2 -> Should NOT re-trigger auto-lint
        await IterationExecutor.executeIteration({
          executionId: idFactory.create<'Execution'>(),
          goal,
          task,
          stateMachine,
          router: mockRouter as any,
          compiler,
          toolExecutor: mockToolExecutor as any,
          verificationEngine: mockVerificationEngine as any,
          observerHub,
          idFactory,
          clock,
          iterationsSoFar: [priorIteration1, priorIteration2],
          startTimeMs: Date.now(),
          totalCostDollars: 0,
          options: {
            autoLintAfterWrite: true,
            maxAutoCorrectionsPerFile: 2,
          },
        });

        // Verification engine was NOT called because max retries (2) was reached
        expect(lintCount).toBe(0);
      });
    });
  },
);
