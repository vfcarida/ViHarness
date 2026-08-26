/**
 * Dynamic Context Manager.
 *
 * Implements interactive dynamic context manipulation inspired by Aider's
 * Watch Mode & interactive slash commands (/add, /drop, /focus, /reset).
 *
 * Allows the agent loop or user to explicitly drop large irrelevant files from
 * the compiled context window, focus on active modules, or re-add critical files.
 */
import type { ContextObject } from '../../core/model/context-object.js';
import { ContextObjectType } from '../../core/model/context-object.js';
import type { DynamicContextCommand, DynamicContextAction } from '../../core/model/symbol-types.js';

export interface DynamicContextState {
  readonly activeFiles: ReadonlySet<string>;
  readonly droppedFiles: ReadonlySet<string>;
  readonly focusedFile?: string;
  readonly commandHistory: ReadonlyArray<DynamicContextCommand>;
}

export class DynamicContextManager {
  private readonly activeFiles = new Set<string>();
  private readonly droppedFiles = new Set<string>();
  private focusedFile?: string;
  private readonly history: DynamicContextCommand[] = [];

  constructor(initialFiles?: ReadonlyArray<string>) {
    if (initialFiles) {
      for (const f of initialFiles) {
        this.activeFiles.add(this.normalizePath(f));
      }
    }
  }

  /**
   * Add a file to active context.
   */
  addFile(filePath: string): void {
    const normalized = this.normalizePath(filePath);
    this.droppedFiles.delete(normalized);
    this.activeFiles.add(normalized);
    this.recordCommand('ADD', normalized, `/add ${filePath}`);
  }

  /**
   * Drop a file from active context (e.g. /drop foo.ts).
   */
  dropFile(filePath: string): boolean {
    const normalized = this.normalizePath(filePath);
    this.activeFiles.delete(normalized);
    this.droppedFiles.add(normalized);
    if (this.focusedFile === normalized) {
      this.focusedFile = undefined;
    }
    this.recordCommand('DROP', normalized, `/drop ${filePath}`);
    return true;
  }

  /**
   * Focus on a specific file, pinning it at top priority.
   */
  focusFile(filePath: string): void {
    const normalized = this.normalizePath(filePath);
    this.addFile(normalized);
    this.focusedFile = normalized;
    this.recordCommand('FOCUS', normalized, `/focus ${filePath}`);
  }

  /**
   * Reset dropped files and active file state.
   */
  reset(): void {
    this.activeFiles.clear();
    this.droppedFiles.clear();
    this.focusedFile = undefined;
    this.recordCommand('RESET', undefined, '/reset');
  }

  /**
   * Parse a dynamic context slash command (e.g., "/drop src/utils.ts").
   */
  parseCommand(input: string): DynamicContextCommand | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0]!.toLowerCase();
    const target = parts[1];

    if (cmd === '/drop' && target) {
      this.dropFile(target);
      return { action: 'DROP', targetPath: target, rawCommand: trimmed };
    }
    if (cmd === '/add' && target) {
      this.addFile(target);
      return { action: 'ADD', targetPath: target, rawCommand: trimmed };
    }
    if (cmd === '/focus' && target) {
      this.focusFile(target);
      return { action: 'FOCUS', targetPath: target, rawCommand: trimmed };
    }
    if (cmd === '/reset') {
      this.reset();
      return { action: 'RESET', rawCommand: trimmed };
    }

    return null;
  }

  /**
   * Filter context objects: discards files that have been explicitly dropped.
   * Invariant: Never discards invariant decisions or constraints.
   */
  filterContextObjects(objects: ReadonlyArray<ContextObject>): ContextObject[] {
    if (this.droppedFiles.size === 0) {
      return [...objects];
    }

    return objects.filter((obj) => {
      // Invariant: Non-file objects (instructions, decisions, constraints) are NEVER dropped by file filter
      if (obj.type !== ContextObjectType.FILE) {
        return true;
      }

      const filePath = String(obj.metadata['filePath'] ?? obj.id);
      const normalized = this.normalizePath(filePath);

      // If explicitly dropped, filter it out
      if (this.droppedFiles.has(normalized)) {
        return false;
      }

      return true;
    });
  }

  getState(): DynamicContextState {
    return {
      activeFiles: new Set(this.activeFiles),
      droppedFiles: new Set(this.droppedFiles),
      focusedFile: this.focusedFile,
      commandHistory: [...this.history],
    };
  }

  private recordCommand(
    action: DynamicContextAction,
    targetPath: string | undefined,
    rawCommand: string,
  ): void {
    this.history.push({ action, targetPath, rawCommand });
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
  }
}
