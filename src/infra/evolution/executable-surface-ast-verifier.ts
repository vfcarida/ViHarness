/**
 * Wave 5.5 — Static AST Sandbox Verifier for `EXECUTABLE` Surfaces (`scripts` & `plugins`).
 *
 * Uses the TypeScript Compiler API (`ts.createSourceFile` + recursive AST visitor) to
 * semantically inspect `EXECUTABLE` harness surfaces proposed by the optimizer and block:
 * - Forbidden system/network module imports (`child_process`, `fs`, `net`, `http`, `vm`, etc.)
 * - Dynamic `import()` and `require()` calls
 * - Dangerous global identifiers (`eval`, `Function`, `process`, `globalThis`, `fetch`, `WebSocket`)
 * - Prototype/constructor escape chains (`['constructor']`, `.__proto__`)
 * - Unseeded non-deterministic calls (`Math.random()`) in verification scripts
 */
import * as ts from 'typescript';

export interface AstSecurityVerificationResult {
  readonly valid: boolean;
  readonly violations: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

const FORBIDDEN_MODULES = new Set([
  'child_process',
  'node:child_process',
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
  'net',
  'node:net',
  'http',
  'node:http',
  'https',
  'node:https',
  'http2',
  'node:http2',
  'dgram',
  'node:dgram',
  'cluster',
  'node:cluster',
  'worker_threads',
  'node:worker_threads',
  'vm',
  'node:vm',
  'v8',
  'node:v8',
  'inspector',
  'node:inspector',
  'module',
  'node:module',
]);

const FORBIDDEN_GLOBALS = new Set([
  'eval',
  'Function',
  'process',
  'globalThis',
  'global',
  'require',
  'fetch',
  'WebSocket',
  'XMLHttpRequest',
]);

export interface ExecutableSurfaceAstVerifierOptions {
  readonly enforceDeterminism?: boolean;
}

export class ExecutableSurfaceAstVerifier {
  private readonly enforceDeterminism: boolean;

  constructor(options?: ExecutableSurfaceAstVerifierOptions) {
    this.enforceDeterminism = options?.enforceDeterminism ?? true;
  }

  /**
   * Verifies executable source code for `scripts` or `plugins` surfaces.
   */
  verify(
    language: 'typescript' | 'javascript' | 'python' | 'shell' | 'json',
    sourceCode: string,
  ): AstSecurityVerificationResult {
    if (language === 'typescript' || language === 'javascript') {
      return this.verifyTypeScriptOrJavaScriptAst(sourceCode);
    }
    if (language === 'python' || language === 'shell') {
      return this.verifyNonTsExecutableScript(language, sourceCode);
    }
    return { valid: true, violations: [], warnings: [] };
  }

  private verifyTypeScriptOrJavaScriptAst(
    sourceCode: string,
  ): AstSecurityVerificationResult {
    const violations: string[] = [];
    const warnings: string[] = [];

    const sourceFile = ts.createSourceFile(
      'candidate-surface.ts',
      sourceCode,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node): void => {
      // 1. Check static import declarations: import ... from 'child_process'
      if (ts.isImportDeclaration(node)) {
        if (ts.isStringLiteral(node.moduleSpecifier)) {
          const modName = node.moduleSpecifier.text.trim();
          if (FORBIDDEN_MODULES.has(modName)) {
            violations.push(
              `AST Violation: Forbidden module import '${modName}' in EXECUTABLE surface.`,
            );
          }
        }
      }

      // 2. Check dynamic import() or require() calls, and Math.random()
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          violations.push(
            'AST Violation: Dynamic import() expressions are prohibited in EXECUTABLE surfaces.',
          );
        }
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'
        ) {
          violations.push(
            'AST Violation: CommonJS require() calls are prohibited in EXECUTABLE surfaces.',
          );
        }
        if (
          this.enforceDeterminism &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'Math' &&
          node.expression.name.text === 'random'
        ) {
          violations.push(
            'AST Violation: Unseeded Math.random() call violates deterministic EXECUTABLE surface invariant.',
          );
        }
      }

      // 3. Check `new Function(...)`
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Function'
      ) {
        violations.push(
          'AST Violation: Dynamic code generation via `new Function(...)` is prohibited.',
        );
      }

      // 4. Check forbidden global identifiers (excluding property names in obj.prop or declarations)
      if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text)) {
        const parent = node.parent;
        const isPropertyAccessName =
          parent &&
          ts.isPropertyAccessExpression(parent) &&
          parent.name === node;
        const isPropertyDeclarationName =
          parent &&
          (ts.isPropertyAssignment(parent) ||
            ts.isMethodDeclaration(parent) ||
            ts.isPropertySignature(parent)) &&
          parent.name === node;

        if (!isPropertyAccessName && !isPropertyDeclarationName) {
          violations.push(
            `AST Violation: Access to restricted global identifier '${node.text}' is prohibited in EXECUTABLE surfaces.`,
          );
        }
      }

      // 5. Check prototype / constructor escape chains: obj.constructor, obj.__proto__, obj['constructor']
      if (ts.isPropertyAccessExpression(node)) {
        const propName = node.name.text;
        if (propName === 'constructor' || propName === '__proto__') {
          violations.push(
            `AST Violation: Prototype/constructor chain access ('.${propName}') is prohibited.`,
          );
        }
      }

      if (ts.isElementAccessExpression(node)) {
        if (ts.isStringLiteral(node.argumentExpression)) {
          const key = node.argumentExpression.text;
          if (
            key === 'constructor' ||
            key === '__proto__' ||
            key === 'prototype' ||
            FORBIDDEN_GLOBALS.has(key)
          ) {
            violations.push(
              `AST Violation: Computed element access ['${key}'] targeting restricted property is prohibited.`,
            );
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      valid: violations.length === 0,
      violations,
      warnings,
    };
  }

  private verifyNonTsExecutableScript(
    language: 'python' | 'shell',
    sourceCode: string,
  ): AstSecurityVerificationResult {
    const violations: string[] = [];
    const forbiddenPatterns: ReadonlyArray<{
      readonly pattern: RegExp;
      readonly message: string;
    }> =
      language === 'python'
        ? [
            {
              pattern: /\b(?:subprocess|socket|urllib|requests|shutil|ctypes)\b/,
              message:
                'Python EXECUTABLE surface imports restricted system/network module.',
            },
            {
              pattern: /\b(?:eval|exec|__import__|os\.system|os\.popen)\s*\(/,
              message:
                'Python EXECUTABLE surface invokes restricted dynamic execution or shell call.',
            },
          ]
        : [
            {
              pattern: /\b(?:curl|wget|nc|netcat|ssh|scp|sudo|rm\s+-rf|chmod\s+\+s)\b/,
              message:
                'Shell EXECUTABLE surface contains restricted network or destructive command.',
            },
          ];

    for (const rule of forbiddenPatterns) {
      if (rule.pattern.test(sourceCode)) {
        violations.push(`AST Violation: ${rule.message}`);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
      warnings: [],
    };
  }
}
