/**
 * TBench Docker Environment Manager.
 *
 * Provides isolated container execution for Terminal-Bench 2.0 tasks with resource limits,
 * network isolation, timeout enforcement, and automated cleanup.
 */
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type {
  DockerEnvironment,
  DockerEnvironmentOptions,
  TBenchTask,
  Container,
  ExecResult,
} from './types.js';

export class DefaultDockerEnvironment implements DockerEnvironment {
  private readonly baseImage: string;
  private readonly cpuLimit: number;
  private readonly memoryLimitMb: number;
  private readonly networkIsolated: boolean;
  private readonly defaultTimeoutMs: number;
  private readonly driver: 'docker' | 'mock';
  private readonly mockDriver: MockDockerEnvironment;

  constructor(options?: DockerEnvironmentOptions) {
    this.baseImage = options?.baseImage ?? 'ubuntu:22.04';
    this.cpuLimit = options?.cpuLimit ?? 2;
    this.memoryLimitMb = options?.memoryLimitMb ?? 4096;
    this.networkIsolated = options?.networkIsolated ?? false;
    this.defaultTimeoutMs = options?.timeoutMs ?? 1800000; // 30 min default
    this.driver = options?.driver ?? (this.isDockerAvailable() ? 'docker' : 'mock');
    this.mockDriver = new MockDockerEnvironment(options);
  }

  private isDockerAvailable(): boolean {
    try {
      const res = child_process.spawnSync('docker', ['info'], { timeout: 2000, stdio: 'ignore' });
      return res.status === 0;
    } catch {
      return false;
    }
  }

  async create(task: TBenchTask): Promise<Container> {
    if (this.driver === 'mock' || !this.isDockerAvailable()) {
      return this.mockDriver.create(task);
    }

    const containerName = `tbench-${task.id}-${Date.now()}`;
    const netFlag = this.networkIsolated ? '--network none' : '';
    const memFlag = `--memory ${this.memoryLimitMb}m`;
    const cpusFlag = `--cpus ${this.cpuLimit}`;

    const dockerCmd = `docker run -d --name ${containerName} ${netFlag} ${memFlag} ${cpusFlag} -i ${this.baseImage} /bin/bash`;

    await new Promise<void>((resolve, reject) => {
      child_process.exec(dockerCmd, (error) => {
        if (error) reject(new Error(`Failed to create docker container: ${error.message}`));
        else resolve();
      });
    });

    return {
      id: containerName,
      name: containerName,
      task,
      status: 'running',
      createdAt: Date.now(),
      workdir: task.workdir ?? '/root',
      metadata: { baseImage: this.baseImage, driver: 'docker' },
    };
  }

  async exec(container: Container, cmd: string): Promise<ExecResult> {
    if (
      this.driver === 'mock' ||
      container.metadata?.['driver'] === 'mock' ||
      !this.isDockerAvailable()
    ) {
      return this.mockDriver.exec(container, cmd);
    }

    if (container.status !== 'running') {
      throw new Error(`Cannot execute command in non-running container (${container.status})`);
    }

    const start = Date.now();
    const timeoutMs = container.task.timeout
      ? container.task.timeout * 1000
      : this.defaultTimeoutMs;

    return new Promise((resolve) => {
      const escapedCmd = cmd.replace(/'/g, "'\\''");
      const fullCmd = `docker exec -w ${container.workdir} ${container.name} /bin/bash -c '${escapedCmd}'`;

      child_process.exec(
        fullCmd,
        { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const duration = Date.now() - start;
          const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
          resolve({
            stdout: stdout || '',
            stderr: stderr || (error ? error.message : ''),
            exitCode,
            duration,
          });
        },
      );
    });
  }

  async verify(container: Container, testScript: string): Promise<boolean> {
    if (
      this.driver === 'mock' ||
      container.metadata?.['driver'] === 'mock' ||
      !this.isDockerAvailable()
    ) {
      return this.mockDriver.verify(container, testScript);
    }

    const res = await this.exec(container, testScript);
    return res.exitCode === 0;
  }

  async destroy(container: Container): Promise<void> {
    if (
      this.driver === 'mock' ||
      container.metadata?.['driver'] === 'mock' ||
      !this.isDockerAvailable()
    ) {
      return this.mockDriver.destroy(container);
    }

    container.status = 'destroyed';
    await new Promise<void>((resolve) => {
      child_process.exec(`docker rm -f ${container.name}`, () => resolve());
    });
  }
}

/**
 * In-memory Mock Docker Environment for testing and non-Docker platforms.
 */
export class MockDockerEnvironment implements DockerEnvironment {
  private readonly defaultTimeoutMs: number;
  private readonly containers = new Map<string, { tempDir: string; container: Container }>();

  constructor(options?: DockerEnvironmentOptions) {
    this.defaultTimeoutMs = options?.timeoutMs ?? 30000;
  }

  async create(task: TBenchTask): Promise<Container> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `tbench-mock-${task.id}-`));

    // Initialize task environment
    if (task.environment) {
      const envPath = path.join(tempDir, '.env');
      const envLines = Object.entries(task.environment).map(([k, v]) => `${k}=${v}`);
      fs.writeFileSync(envPath, envLines.join('\n'), 'utf-8');
    }

    const containerId = `mock-${task.id}-${Date.now()}`;
    const container: Container = {
      id: containerId,
      name: containerId,
      task,
      status: 'running',
      createdAt: Date.now(),
      workdir: tempDir,
      metadata: { driver: 'mock', tempDir },
    };

    this.containers.set(containerId, { tempDir, container });
    return container;
  }

  async exec(container: Container, cmd: string): Promise<ExecResult> {
    const record = this.containers.get(container.id);
    if (!record || container.status !== 'running') {
      throw new Error(`Container is not running or not found: ${container.id}`);
    }

    const start = Date.now();
    const timeoutMs = container.task.timeout
      ? container.task.timeout * 1000
      : this.defaultTimeoutMs;

    return new Promise((resolve) => {
      // Execute command in mock container temp directory
      child_process.exec(
        cmd,
        {
          cwd: record.tempDir,
          timeout: timeoutMs,
          maxBuffer: 5 * 1024 * 1024,
          env: {
            ...process.env,
            ...(container.task.environment ?? {}),
            TBENCH_TASK_ID: container.task.id,
            TBENCH_CATEGORY: container.task.category,
          },
        },
        (error, stdout, stderr) => {
          const duration = Date.now() - start;
          const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
          resolve({
            stdout: stdout || '',
            stderr: stderr || (error ? error.message : ''),
            exitCode,
            duration,
          });
        },
      );
    });
  }

  async verify(container: Container, testScript: string): Promise<boolean> {
    const record = this.containers.get(container.id);
    if (!record) return false;

    // If test script is a script string or path
    const scriptPath = path.join(record.tempDir, '_tbench_verify.sh');
    fs.writeFileSync(scriptPath, testScript, 'utf-8');

    // Run via node or bash
    const isWindows = process.platform === 'win32';
    const runnerCmd =
      isWindows && !testScript.includes('#!/bin/bash')
        ? testScript.includes('node ')
          ? testScript
          : `node -e "${testScript.replace(/"/g, '\\"')}"`
        : isWindows
          ? `bash _tbench_verify.sh`
          : `/bin/bash _tbench_verify.sh`;

    const result = await this.exec(container, runnerCmd);
    return result.exitCode === 0;
  }

  async destroy(container: Container): Promise<void> {
    const record = this.containers.get(container.id);
    if (record) {
      container.status = 'destroyed';
      try {
        fs.rmSync(record.tempDir, { recursive: true, force: true });
      } catch {
        // Ignore deletion cleanup errors
      }
      this.containers.delete(container.id);
    }
  }
}
