/**
 * ExecutionSandbox interface.
 *
 * Defines the contract for isolated code/tool execution environments.
 * Encapsulates filesystem, process, network, and environment boundaries.
 */
import type {
  SandboxConfig,
  SandboxExecutionRequest,
  SandboxExecutionResult,
} from '../model/sandbox-types.js';

export interface ExecutionSandbox {
  /** Effective sandbox isolation configuration. */
  readonly config: SandboxConfig;

  /** Execute a command inside the isolated sandbox environment. */
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>;

  /** Check if the sandbox provider is healthy and operational. */
  isHealthy(): Promise<boolean>;
}
