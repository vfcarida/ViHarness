import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { QaAuditorGate } from '../../../src/infra/verification/qa-auditor-gate.js';
import { parseSolveArgs } from '../../../src/cli/commands/solve.js';

describe('QaAuditorGate & Adversarial Verification', () => {
  const auditor = new QaAuditorGate();

  describe('Patch Security & Defensive Checks', () => {
    it('detects command injection risks in patch', async () => {
      const maliciousPatch = `
--- a/src/deploy.ts
+++ b/src/deploy.ts
@@ -10,3 +10,4 @@
+  const cmd = \`sh deploy.sh \${target}\`;
+  execSync(cmd);
`;
      const res = await auditor.audit({
        workspacePath: process.cwd(),
        patch: maliciousPatch,
      });

      expect(res.approved).toBe(false);
      expect(res.findings.some((f) => f.category === 'security')).toBe(true);
      expect(res.findings.some((f) => f.description.includes('command injection'))).toBe(true);
    });

    it('detects hardcoded secret tokens in patch', async () => {
      const secretPatch = `
--- a/src/client.ts
+++ b/src/client.ts
@@ -5,3 +5,4 @@
+const API_KEY = "sk-live-secret-token-1234567890abcdef";
`;
      const res = await auditor.audit({
        workspacePath: process.cwd(),
        patch: secretPatch,
      });

      expect(res.approved).toBe(false);
      expect(res.findings.some((f) => f.severity === 'critical')).toBe(true);
      expect(res.findings.some((f) => f.description.includes('credential'))).toBe(true);
    });

    it('flags unsafe type assertion "as any"', async () => {
      const unsafePatch = `
--- a/src/service.ts
+++ b/src/service.ts
@@ -8,3 +8,4 @@
+  const payload = (req.body as any).data;
`;
      const res = await auditor.audit({
        workspacePath: process.cwd(),
        patch: unsafePatch,
      });

      expect(res.findings.some((f) => f.category === 'type_safety')).toBe(true);
    });
  });

  describe('File-Level Invariants & Resource Management', () => {
    it('flags unclosed file streams as potential resource leaks', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-leak-'));
      try {
        fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
        const code = `
export function streamData() {
  const stream = fs.createReadStream('input.txt');
  stream.on('data', (chunk) => console.log(chunk));
}
`;
        fs.writeFileSync(path.join(tmpDir, 'src/reader.ts'), code, 'utf-8');

        const patch = `
--- a/src/reader.ts
+++ b/src/reader.ts
@@ -1,1 +1,6 @@
+export function streamData() {
+  const stream = fs.createReadStream('input.txt');
+  stream.on('data', (chunk) => console.log(chunk));
+}
`;
        const res = await auditor.audit({
          workspacePath: tmpDir,
          patch,
        });

        expect(res.findings.some((f) => f.category === 'resource_leak')).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('flags silent empty catch blocks', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-catch-'));
      try {
        fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
        const code = `
export function process() {
  try {
    doSomething();
  } catch (err) {}
}
`;
        fs.writeFileSync(path.join(tmpDir, 'src/worker.ts'), code, 'utf-8');
        const patch = `
--- a/src/worker.ts
+++ b/src/worker.ts
@@ -1,1 +1,6 @@
+export function process() {
+  try {
+    doSomething();
+  } catch (err) {}
+}
`;
        const res = await auditor.audit({
          workspacePath: tmpDir,
          patch,
        });

        expect(res.findings.some((f) => f.category === 'contract_violation')).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('approves robust and clean defensive code', async () => {
      const cleanPatch = `
--- a/src/calc.ts
+++ b/src/calc.ts
@@ -1,3 +1,6 @@
+export function safeAdd(a: number, b: number): number {
+  return Number.isFinite(a) && Number.isFinite(b) ? a + b : 0;
+}
`;
      const res = await auditor.audit({
        workspacePath: process.cwd(),
        patch: cleanPatch,
      });

      expect(res.approved).toBe(true);
      expect(res.score).toBe(100);
      expect(res.findings).toHaveLength(0);
      expect(res.summary).toContain('QA Auditor approved');
    });
  });

  describe('formatAuditorPrompt', () => {
    it('formats rejected findings into an actionable remediation prompt', () => {
      const prompt = QaAuditorGate.formatAuditorPrompt({
        approved: false,
        score: 50,
        summary: 'Rejected due to issues',
        findings: [
          {
            category: 'security',
            severity: 'critical',
            description: 'Unescaped shell argument',
            file: 'src/runner.ts',
            line: 42,
            recommendation: 'Use execFile instead',
          },
        ],
      });

      expect(prompt).toContain('ADVERSARIAL QA AUDITOR VERDICT: REJECTED');
      expect(prompt).toContain('CRITICAL');
      expect(prompt).toContain('src/runner.ts:42');
      expect(prompt).toContain('Use execFile instead');
    });
  });

  describe('CLI Options Parsing', () => {
    it('parses --adversarial-qa and --no-adversarial-qa', () => {
      const parsedTrue = parseSolveArgs(['-p', 'Test task', '--adversarial-qa']);
      expect(parsedTrue.adversarialQa).toBe(true);

      const parsedFalse = parseSolveArgs(['-p', 'Test task', '--no-adversarial-qa']);
      expect(parsedFalse.adversarialQa).toBe(false);
    });
  });
});
