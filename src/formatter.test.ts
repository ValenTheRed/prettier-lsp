import { describe, it, expect } from 'vitest';
import { computeDiff } from './formatter';

describe('computeDiff - LCS-based diff algorithm', () => {
  it('should return empty for identical arrays', () => {
    const oldLines = ['line1', 'line2', 'line3'];
    const newLines = ['line1', 'line2', 'line3'];
    const ops = computeDiff(oldLines, newLines);

    expect(ops.every((op) => op.type === 'equal')).toBe(true);
    expect(ops).toHaveLength(3);
  });

  it('should detect single line replacement', () => {
    const oldLines = ['const x={a:1}'];
    const newLines = ['const x = { a: 1 }'];
    const ops = computeDiff(oldLines, newLines);

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('replace');
    expect(ops[0].oldLine).toBe('const x={a:1}');
    expect(ops[0].newLine).toBe('const x = { a: 1 }');
    expect(ops[0].oldIndex).toBe(0);
  });

  it('should detect single line deletion', () => {
    const oldLines = ['line1', 'lineToDelete', 'line3'];
    const newLines = ['line1', 'line3'];
    const ops = computeDiff(oldLines, newLines);

    const deleteOps = ops.filter((op) => op.type === 'delete');
    expect(deleteOps).toHaveLength(1);
    expect(deleteOps[0].oldLine).toBe('lineToDelete');
    expect(deleteOps[0].oldIndex).toBe(1);
  });

  it('should detect single line insertion', () => {
    const oldLines = ['line1', 'line3'];
    const newLines = ['line1', 'line2', 'line3'];
    const ops = computeDiff(oldLines, newLines);

    const insertOps = ops.filter((op) => op.type === 'insert');
    expect(insertOps).toHaveLength(1);
    expect(insertOps[0].newLine).toBe('line2');
  });

  it('BUG FIX: should handle replace followed by delete correctly', () => {
    // This is the reported bug case
    const oldLines = ['const x={a:1}', 'extraLine', 'const y={b:2}'];
    const newLines = ['const x = { a: 1 }', 'const y = { b: 2 }'];
    const ops = computeDiff(oldLines, newLines);

    // With smart diff merging:
    // Line 0: replace (const x={a:1} -> const x = { a: 1 })
    // Line 1: replace (extraLine -> const y = { b: 2 })
    // Line 2: delete (const y={b:2} is extra)
    const replaceOps = ops.filter((op) => op.type === 'replace');
    const deleteOps = ops.filter((op) => op.type === 'delete');

    expect(replaceOps.length).toBe(2);
    expect(deleteOps.length).toBe(1);

    // First replacement should be line 0
    const firstReplace = ops.find(
      (op) => op.type === 'replace' && op.oldIndex === 0,
    );
    expect(firstReplace).toBeDefined();
    expect(firstReplace?.oldLine).toBe('const x={a:1}');
    expect(firstReplace?.newLine).toBe('const x = { a: 1 }');

    // Second replacement should be line 1
    const secondReplace = ops.find(
      (op) => op.type === 'replace' && op.oldIndex === 1,
    );
    expect(secondReplace).toBeDefined();
    expect(secondReplace?.oldLine).toBe('extraLine');
    expect(secondReplace?.newLine).toBe('const y = { b: 2 }');

    // Line 2 should be deleted
    const deleteOp = ops.find(
      (op) => op.type === 'delete' && op.oldIndex === 2,
    );
    expect(deleteOp).toBeDefined();
    expect(deleteOp?.oldLine).toBe('const y={b:2}');
  });

  it('should handle multiple consecutive replacements', () => {
    const oldLines = ['line1', 'line2', 'line3'];
    const newLines = ['modified1', 'modified2', 'modified3'];
    const ops = computeDiff(oldLines, newLines);

    // All should be replacements
    const replaceOps = ops.filter((op) => op.type === 'replace');
    expect(replaceOps).toHaveLength(3);
  });

  it('should handle line expansion without flagging all subsequent lines', () => {
    // When one line becomes multiple lines
    const oldLines = ['oneline'];
    const newLines = ['line1', 'line2', 'line3'];
    const ops = computeDiff(oldLines, newLines);

    // Should have 1 replace and 2 inserts (not 3 replaces)
    const replaceOps = ops.filter((op) => op.type === 'replace');
    const insertOps = ops.filter((op) => op.type === 'insert');

    expect(replaceOps.length + insertOps.length).toBe(3);
    expect(insertOps.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle complex mix of operations', () => {
    const oldLines = ['keep1', 'change', 'delete', 'keep2'];
    const newLines = ['keep1', 'changed', 'insert', 'keep2'];
    const ops = computeDiff(oldLines, newLines);

    // Should detect keeps, changes, deletes, and inserts appropriately
    const equalOps = ops.filter((op) => op.type === 'equal');
    expect(equalOps.length).toBeGreaterThanOrEqual(2); // keep1 and keep2

    // "keep1" should be equal
    const keep1 = ops.find(
      (op) => op.type === 'equal' && op.oldLine === 'keep1',
    );
    expect(keep1).toBeDefined();

    // "keep2" should be equal
    const keep2 = ops.find(
      (op) => op.type === 'equal' && op.oldLine === 'keep2',
    );
    expect(keep2).toBeDefined();
  });

  it('should handle empty old array (all insertions)', () => {
    const oldLines: string[] = [];
    const newLines = ['line1', 'line2'];
    const ops = computeDiff(oldLines, newLines);

    expect(ops.every((op) => op.type === 'insert')).toBe(true);
    expect(ops).toHaveLength(2);
  });

  it('should handle empty new array (all deletions)', () => {
    const oldLines = ['line1', 'line2'];
    const newLines: string[] = [];
    const ops = computeDiff(oldLines, newLines);

    expect(ops.every((op) => op.type === 'delete')).toBe(true);
    expect(ops).toHaveLength(2);
  });
});
