import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  FileSpillStore,
  createSpillPreview,
  createRetrieveOutputTool,
  type SpillPolicy,
} from '../../../src/core/tools/spill/index.js';
import { ParallelToolExecutor } from '../../../src/core/tools/parallel-executor.js';
import type { ToolDefinition, ToolRegistry } from '../../../src/core/index.js';

describe('Tool Output Spill System — P018', () => {
  let tempDir: string;
  let spillStore: FileSpillStore;
  const testPolicy: SpillPolicy = {
    maxInlineChars: 100,
    previewHeadChars: 20,
    previewTailChars: 20,
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-spill-test-'));
    spillStore = new FileSpillStore(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup error */
    }
  });

  it('1. Output under threshold remains inline without creating spill files', () => {
    const preview = createSpillPreview(
      'Short output',
      { id: 'loc-1', totalChars: 12, totalLines: 1 },
      testPolicy,
    );
    expect(preview).toContain('Short output');
  });

  it('2. Output over threshold is saved to disk and replaced with bounded preview', () => {
    const longContent = 'A'.repeat(50) + '\n' + 'MIDDLE'.repeat(30) + '\n' + 'Z'.repeat(50);
    const locator = spillStore.save('session-1', 'call-1', longContent);

    expect(locator.id).toBe('spill-session-1-call-1');
    expect(locator.totalChars).toBe(longContent.length);
    expect(fs.existsSync(locator.path)).toBe(true);

    const preview = createSpillPreview(longContent, locator, testPolicy);
    expect(preview).toContain(longContent.slice(0, 20));
    expect(preview).toContain(longContent.slice(-20));
    expect(preview).toContain('[Full output saved to: spill-session-1-call-1]');
    expect(preview).toContain('[Use retrieve_output tool to read specific line ranges]');
  });

  it('3. retrieve_output tool extracts specific 1-indexed line ranges from spilled content', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: Sample data payload`);
    const fullContent = lines.join('\n');

    const locator = spillStore.save('session-123', 'call-999', fullContent);
    const retrieveTool = createRetrieveOutputTool(spillStore);

    const result = await retrieveTool.execute({
      locator_id: locator.id,
      start_line: 10,
      end_line: 12,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain(
      'Retrieved lines 10-12 of 50 from [spill-session-123-call-999]',
    );
    expect(result.output).toContain('Line 10: Sample data payload');
    expect(result.output).toContain('Line 11: Sample data payload');
    expect(result.output).toContain('Line 12: Sample data payload');
    expect(result.output).not.toContain('Line 13:');
  });

  it('4. retrieve_output clamps out-of-bound start and end lines gracefully', async () => {
    const fullContent = 'Line 1\nLine 2\nLine 3';
    const locator = spillStore.save('s1', 'c1', fullContent);
    const retrieveTool = createRetrieveOutputTool(spillStore);

    const result = await retrieveTool.execute({
      locator_id: locator.id,
      start_line: 1,
      end_line: 100, // Beyond end
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Retrieved lines 1-3 of 3');
    expect(result.output).toContain('Line 1\nLine 2\nLine 3');
  });

  it('5. retrieve_output returns descriptive error when locator is not found', async () => {
    const retrieveTool = createRetrieveOutputTool(spillStore);
    const result = await retrieveTool.execute({
      locator_id: 'non-existent-locator-id',
      start_line: 1,
      end_line: 5,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Failed to retrieve output: Spill content not found');
  });

  it('6. Cleanup removes session spill directory and unregisters locators', () => {
    const locator = spillStore.save('session-to-clean', 'call-1', 'Some long content to spill');
    expect(fs.existsSync(locator.path)).toBe(true);

    spillStore.cleanup('session-to-clean');
    expect(fs.existsSync(locator.path)).toBe(false);
    expect(() => spillStore.retrieve(locator.id)).toThrow(/Spill content not found/);
  });

  it('7. Automatic spill integration in ParallelToolExecutor', async () => {
    const oversizedTool: ToolDefinition = {
      name: 'large_output_tool',
      parameters: { type: 'object' },
      isConcurrencySafe: () => true,
      execute: async () => ({
        success: true,
        output: 'X'.repeat(500),
      }),
    };

    const map = new Map<string, ToolDefinition>();
    map.set('large_output_tool', oversizedTool);
    const registry: ToolRegistry = {
      registerTool: (t) => map.set(t.name, t),
      getTool: (name) => map.get(name),
      listTools: () => Array.from(map.values()),
      hasTool: (name) => map.has(name),
    };

    const executor = new ParallelToolExecutor(registry, {
      spillPolicy: { maxInlineChars: 100, previewHeadChars: 10, previewTailChars: 10 },
      spillStore,
    });

    const results = await executor.execute(
      [{ id: 'auto-spill-call', name: 'large_output_tool', arguments: {} }],
      { sessionId: 'auto-session' },
    );

    expect(results.length).toBe(1);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.output).toContain(
      '[Full output saved to: spill-auto-session-auto-spill-call]',
    );
    expect(results[0]?.output).toContain('[Use retrieve_output tool to read specific line ranges]');
  });

  it('8. Negative start_line clamps to line 1', async () => {
    const locator = spillStore.save('s1', 'c1', 'A\nB\nC');
    const retrieveTool = createRetrieveOutputTool(spillStore);

    const result = await retrieveTool.execute({
      locator_id: locator.id,
      start_line: -5,
      end_line: 2,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Retrieved lines 1-2 of 3');
  });

  it('9. Multiple sessions maintain isolated spill storage', () => {
    const locA = spillStore.save('sess-a', 'call-1', 'Content A');
    const locB = spillStore.save('sess-b', 'call-2', 'Content B');

    expect(spillStore.retrieve(locA.id)).toBe('Content A');
    expect(spillStore.retrieve(locB.id)).toBe('Content B');

    spillStore.cleanup('sess-a');
    expect(() => spillStore.retrieve(locA.id)).toThrow();
    expect(spillStore.retrieve(locB.id)).toBe('Content B');
  });
});
