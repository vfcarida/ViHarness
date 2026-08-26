/**
 * ProjDevBench Workspace Manager.
 *
 * Prepares and manages isolated workspaces for generative project construction benchmarks.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ProjDevProblem } from './types.js';

export interface ProjDevIsolatedWorkspace {
  readonly problemId: string;
  readonly workspacePath: string;
  readonly initialFiles: ReadonlySet<string>;
  readonly cleanup: () => Promise<void>;
  getModifiedFiles: () => Promise<ReadonlyArray<string>>;
}

export interface WorkspaceManagerOptions {
  readonly baseDir?: string;
  readonly preserveWorkspaces?: boolean;
}

export class ProjDevWorkspaceManager {
  private readonly baseDir: string;
  private readonly preserveWorkspaces: boolean;

  constructor(options?: WorkspaceManagerOptions) {
    this.baseDir = options?.baseDir ?? path.join(os.tmpdir(), 'vi-projdevbench-workspaces');
    this.preserveWorkspaces = options?.preserveWorkspaces ?? false;

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Allocates an isolated workspace directory and populates problem files.
   */
  async createWorkspace(problem: ProjDevProblem): Promise<ProjDevIsolatedWorkspace> {
    const sanitizedId = problem.id.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const prefix = `pdb-${sanitizedId}-`;
    const workspacePath = fs.mkdtempSync(path.join(this.baseDir, prefix));

    const initialFiles = new Set<string>();

    // 1. Copy source files if available (excluding problem.json and config.json)
    if (problem.sourcePath && fs.existsSync(problem.sourcePath)) {
      const copyDirRecursive = (src: string, dest: string, relPath = '') => {
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
          if (
            entry.name === 'problem.json' ||
            entry.name === 'config.json' ||
            entry.name === '.git'
          ) {
            continue;
          }
          const srcFull = path.join(src, entry.name);
          const destFull = path.join(dest, entry.name);
          const rel = path.join(relPath, entry.name).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            if (!fs.existsSync(destFull)) fs.mkdirSync(destFull, { recursive: true });
            copyDirRecursive(srcFull, destFull, rel);
          } else if (entry.isFile()) {
            fs.copyFileSync(srcFull, destFull);
            initialFiles.add(rel);
          }
        }
      };
      copyDirRecursive(problem.sourcePath, workspacePath);
    }

    // 2. Write explicit templateFiles if provided
    if (problem.templateFiles) {
      for (const [relPath, content] of Object.entries(problem.templateFiles)) {
        const destPath = path.join(workspacePath, relPath);
        const parentDir = path.dirname(destPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(destPath, content, 'utf-8');
        initialFiles.add(relPath.replace(/\\/g, '/'));
      }
    }

    // 3. Ensure minimal package.json exists if from scratch and no package.json present
    const packageJsonPath = path.join(workspacePath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      const defaultPkg = {
        name: `projdevbench-${sanitizedId}`,
        version: '1.0.0',
        type: 'module',
        scripts: { test: 'node --test' },
      };
      fs.writeFileSync(packageJsonPath, JSON.stringify(defaultPkg, null, 2), 'utf-8');
      initialFiles.add('package.json');
    }

    const getModifiedFiles = async (): Promise<ReadonlyArray<string>> => {
      const modified: string[] = [];
      const scanDir = (current: string, rel = '') => {
        if (!fs.existsSync(current)) return;
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          const full = path.join(current, entry.name);
          const relP = path.join(rel, entry.name).replace(/\\/g, '/');
          if (entry.isDirectory()) {
            scanDir(full, relP);
          } else if (entry.isFile()) {
            modified.push(relP);
          }
        }
      };
      scanDir(workspacePath);
      return modified;
    };

    const cleanup = async (): Promise<void> => {
      if (!this.preserveWorkspaces && fs.existsSync(workspacePath)) {
        try {
          fs.rmSync(workspacePath, { recursive: true, force: true });
        } catch {
          // Best effort cleanup
        }
      }
    };

    return {
      problemId: problem.id,
      workspacePath,
      initialFiles,
      cleanup,
      getModifiedFiles,
    };
  }
}
