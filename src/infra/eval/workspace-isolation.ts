/**
 * Workspace Isolation Subsystem.
 *
 * Ensures each benchmark trial executes in a pristine, isolated temporary workspace.
 * Prevents cross-run state pollution, race conditions, and leftover file modifications.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface WorkspaceIsolationOptions {
  /** Optional custom base directory for isolated workspaces */
  readonly baseDir?: string;
  /** Whether to retain workspaces on disk for diagnostic inspection */
  readonly preserveWorkspaces?: boolean;
}

export interface IsolatedWorkspace {
  readonly workspacePath: string;
  readonly initialCommitSha: string;
  readonly cleanup: () => Promise<void>;
}

export class WorkspaceIsolationManager {
  private readonly baseDir: string;
  private readonly preserveWorkspaces: boolean;

  constructor(options?: WorkspaceIsolationOptions) {
    this.baseDir = options?.baseDir ?? path.join(os.tmpdir(), 'vi-bench-workspaces');
    this.preserveWorkspaces = options?.preserveWorkspaces ?? false;

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Create an isolated workspace for a specific benchmark run.
   */
  async createIsolatedWorkspace(params: {
    suiteId: string;
    taskId: string;
    harness: string;
    runIndex: number;
    sourceRepositoryPath?: string;
  }): Promise<IsolatedWorkspace> {
    const sanitizedHarness = params.harness.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const sanitizedTaskId = params.taskId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const prefix = `bench-${params.suiteId}-${sanitizedTaskId}-${sanitizedHarness}-r${params.runIndex}-`;

    const workspacePath = fs.mkdtempSync(path.join(this.baseDir, prefix));

    // Copy source repository fixture files if available
    if (params.sourceRepositoryPath && fs.existsSync(params.sourceRepositoryPath)) {
      this.copyDirectoryRecursive(params.sourceRepositoryPath, workspacePath);
    } else {
      // Initialize minimal project workspace
      const packageJsonPath = path.join(workspacePath, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        fs.writeFileSync(
          packageJsonPath,
          JSON.stringify(
            {
              name: `benchmark-${sanitizedTaskId}`,
              version: '1.0.0',
              description: `Benchmark workspace for task ${params.taskId}`,
              scripts: {
                test: 'node -e "process.exit(0)"',
                lint: 'node -e "process.exit(0)"',
                typecheck: 'node -e "process.exit(0)"',
              },
            },
            null,
            2,
          ),
          'utf-8',
        );
      }
      const tsconfigPath = path.join(workspacePath, 'tsconfig.json');
      if (!fs.existsSync(tsconfigPath)) {
        fs.writeFileSync(
          tsconfigPath,
          JSON.stringify(
            {
              compilerOptions: {
                target: 'ES2022',
                module: 'NodeNext',
                strict: false,
                skipLibCheck: true,
                noEmit: true,
              },
              include: ['src/**/*'],
            },
            null,
            2,
          ),
          'utf-8',
        );
      }
      const srcDir = path.join(workspacePath, 'src');
      if (!fs.existsSync(srcDir)) {
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'index.ts'), 'export const initial = true;\n', 'utf-8');
      }
    }

    const initialCommitSha = `init-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;

    const cleanup = async (): Promise<void> => {
      if (this.preserveWorkspaces) {
        return;
      }
      try {
        if (fs.existsSync(workspacePath)) {
          fs.rmSync(workspacePath, { recursive: true, force: true });
        }
      } catch {
        // Silently ignore cleanup errors in temporary directories
      }
    };

    return {
      workspacePath,
      initialCommitSha,
      cleanup,
    };
  }

  private copyDirectoryRecursive(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') {
          continue;
        }
        this.copyDirectoryRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
