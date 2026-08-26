import { describe, it, expect, beforeEach } from 'vitest';
import {
  DefaultPolicyEngine,
  RiskClassifier,
  LocalDevelopmentSandbox,
} from '../../../src/infra/index.js';
import { PolicyDecisionType, ActionRiskCategory } from '../../../src/core/index.js';
import type { PermissionContext } from '../../../src/core/index.js';

describe('Security & Execution-Policy Layer', () => {
  let policyEngine: DefaultPolicyEngine;

  beforeEach(() => {
    policyEngine = new DefaultPolicyEngine();
  });

  it('should ALLOW safe file read on project source files', async () => {
    const decision = await policyEngine.evaluate({
      type: 'read_file',
      resource: 'src/main.ts',
      metadata: {},
      irreversible: false,
    });

    expect(decision.decision).toBe(PolicyDecisionType.ALLOW);
  });

  it('should ALLOW safe file write inside working tree', async () => {
    const decision = await policyEngine.evaluate({
      type: 'write_file',
      resource: 'dist/bundle.js',
      metadata: { content: 'console.log("hi");' },
      irreversible: false,
    });

    expect(decision.decision).toBe(PolicyDecisionType.ALLOW);
  });

  it('should DENY actions accessing forbidden credential files (.env, .pem, id_rsa, .aws)', async () => {
    const envDecision = await policyEngine.evaluate({
      type: 'read_file',
      resource: '.env.production',
      metadata: {},
      irreversible: false,
    });

    expect(envDecision.decision).toBe(PolicyDecisionType.DENY);
    expect(envDecision.reason).toContain('credential or secret resource');

    const keyDecision = await policyEngine.evaluate({
      type: 'read_file',
      resource: 'id_rsa',
      metadata: {},
      irreversible: false,
    });

    expect(keyDecision.decision).toBe(PolicyDecisionType.DENY);
  });

  it('should DENY forbidden shell commands (sudo, rm -rf /, chmod 777)', async () => {
    const sudoDecision = await policyEngine.evaluate({
      type: 'run_command',
      resource: 'sudo apt-get update',
      metadata: {},
      irreversible: true,
    });

    expect(sudoDecision.decision).toBe(PolicyDecisionType.DENY);

    const rmDecision = await policyEngine.evaluate({
      type: 'run_command',
      resource: 'rm -rf /',
      metadata: {},
      irreversible: true,
    });

    expect(rmDecision.decision).toBe(PolicyDecisionType.DENY);
  });

  it('should DENY outbound network requests when networkAccess is disabled', async () => {
    const noNetContext: PermissionContext = {
      allowedPaths: ['./'],
      forbiddenPaths: [],
      allowedCommands: [],
      forbiddenCommands: [],
      networkAccess: false,
      environment: 'DEVELOPMENT',
    };

    const decision = await policyEngine.evaluate(
      {
        type: 'http_request',
        resource: 'https://api.external.com/data',
        metadata: {},
        irreversible: false,
      },
      noNetContext,
    );

    expect(decision.decision).toBe(PolicyDecisionType.DENY);
    expect(decision.reason).toContain('Outbound network access is disabled');
  });

  it('should REQUIRE_APPROVAL for actions in PRODUCTION environment unless user-approved', async () => {
    const prodContext: PermissionContext = {
      allowedPaths: ['./'],
      forbiddenPaths: [],
      allowedCommands: [],
      forbiddenCommands: [],
      networkAccess: true,
      userApproved: false, // Not user approved yet
      environment: 'PRODUCTION',
    };

    const decision = await policyEngine.evaluate(
      {
        type: 'write_file',
        resource: 'prod.config.json',
        metadata: {},
        irreversible: true,
      },
      prodContext,
    );

    expect(decision.decision).toBe(PolicyDecisionType.REQUIRE_APPROVAL);
    expect(decision.reason).toContain('human approval required');

    // When userApproved is true
    const approvedContext: PermissionContext = {
      ...prodContext,
      userApproved: true,
    };

    const approvedDecision = await policyEngine.evaluate(
      {
        type: 'write_file',
        resource: 'prod.config.json',
        metadata: {},
        irreversible: true,
      },
      approvedContext,
    );

    expect(approvedDecision.decision).toBe(PolicyDecisionType.ALLOW);
  });

  it('should enforce Deny-Precedence when composing multiple policy rules', async () => {
    // Action matches safe path but accesses credential pattern -> DENY takes precedence over ALLOW
    const decision = await policyEngine.evaluate({
      type: 'read_file',
      resource: 'src/secrets.json',
      metadata: {},
      irreversible: false,
    });

    expect(decision.decision).toBe(PolicyDecisionType.DENY);
  });

  it('should maintain structured audit logs of all policy evaluations', async () => {
    await policyEngine.evaluate({
      type: 'read_file',
      resource: 'src/app.ts',
      metadata: {},
      irreversible: false,
    });

    await policyEngine.evaluate({
      type: 'run_command',
      resource: 'sudo rm -rf /',
      metadata: {},
      irreversible: true,
    });

    const logs = policyEngine.getAuditLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0]!.decision).toBe(PolicyDecisionType.ALLOW);
    expect(logs[1]!.decision).toBe(PolicyDecisionType.DENY);
  });

  it('should enforce boundaries in LocalDevelopmentSandbox', async () => {
    const sandbox = new LocalDevelopmentSandbox({
      rootDir: './',
    });

    const isHealthy = await sandbox.isHealthy();
    expect(isHealthy).toBe(true);

    const result = await sandbox.execute({
      command: 'npm test',
      workingDirectory: './',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('npm test');

    const blockedResult = await sandbox.execute({
      command: 'sudo rm -rf /',
    });

    expect(blockedResult.exitCode).toBe(126);
    expect(blockedResult.stderr).toContain('Sandbox blocked command');
  });

  it('should classify action risk categories correctly using RiskClassifier', () => {
    const credCategories = RiskClassifier.classify({
      type: 'read_file',
      resource: '.env.local',
      metadata: {},
      irreversible: false,
    });
    expect(credCategories).toContain(ActionRiskCategory.CREDENTIALS);

    const execCategories = RiskClassifier.classify({
      type: 'run_command',
      resource: 'npm test',
      metadata: {},
      irreversible: false,
    });
    expect(execCategories).toContain(ActionRiskCategory.EXECUTE);
  });
});
