import path from 'node:path';
import {
  resolvePrettier,
  resolveConfig,
  resolveFile,
  type ResolverOptions,
} from './resolver';

export interface FormatOptions extends ResolverOptions {
  ignorePath?: string;
  editorconfig?: boolean;
}

export interface FormattingDiagnostic {
  line: number;
  originalLine: string;
  formattedLine: string;
  message: string;
}

/**
 * Compute diff between two arrays using a simple LCS-based approach
 * Returns operations: 'equal', 'delete', 'insert', 'replace'
 */
export interface DiffOp {
  type: 'equal' | 'delete' | 'insert' | 'replace';
  oldIndex: number;
  newIndex: number;
  oldLine?: string;
  newLine?: string;
}

export function computeDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;

  // Build LCS (Longest Common Subsequence) table
  const lcs: number[][] = Array(n + 1)
    .fill(0)
    .map(() => Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff operations
  const ops: DiffOp[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.unshift({
        type: 'equal',
        oldIndex: i - 1,
        newIndex: j - 1,
        oldLine: oldLines[i - 1],
        newLine: newLines[j - 1],
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      ops.unshift({
        type: 'insert',
        oldIndex: i - 1,
        newIndex: j - 1,
        newLine: newLines[j - 1],
      });
      j--;
    } else if (i > 0) {
      ops.unshift({
        type: 'delete',
        oldIndex: i - 1,
        newIndex: j - 1,
        oldLine: oldLines[i - 1],
      });
      i--;
    }
  }

  // Merge delete/insert sequences into replace operations
  // Group consecutive deletes, then consecutive inserts, then pair them up
  const deletes: DiffOp[] = [];
  const inserts: DiffOp[] = [];
  const mergedOps: DiffOp[] = [];

  for (const op of ops) {
    if (op.type === 'delete') {
      deletes.push(op);
    } else if (op.type === 'insert') {
      inserts.push(op);
    } else {
      // Process accumulated deletes/inserts before adding this equal
      while (deletes.length > 0 || inserts.length > 0) {
        if (deletes.length > 0 && inserts.length > 0) {
          // Pair up as replacement
          const del = deletes.shift()!;
          const ins = inserts.shift()!;
          mergedOps.push({
            type: 'replace',
            oldIndex: del.oldIndex,
            newIndex: ins.newIndex,
            oldLine: del.oldLine,
            newLine: ins.newLine,
          });
        } else if (deletes.length > 0) {
          mergedOps.push(deletes.shift()!);
        } else {
          mergedOps.push(inserts.shift()!);
        }
      }
      mergedOps.push(op);
    }
  }

  // Process any remaining deletes/inserts at the end
  while (deletes.length > 0 || inserts.length > 0) {
    if (deletes.length > 0 && inserts.length > 0) {
      const del = deletes.shift()!;
      const ins = inserts.shift()!;
      mergedOps.push({
        type: 'replace',
        oldIndex: del.oldIndex,
        newIndex: ins.newIndex,
        oldLine: del.oldLine,
        newLine: ins.newLine,
      });
    } else if (deletes.length > 0) {
      mergedOps.push(deletes.shift()!);
    } else {
      mergedOps.push(inserts.shift()!);
    }
  }

  return mergedOps;
}

/**
 * Get detailed formatting diagnostics for lines that need formatting
 */
export async function getFormattingDiagnostics(
  uri: string,
  text: string,
  workspaceRoot: string,
  options: FormatOptions = {},
): Promise<FormattingDiagnostic[]> {
  const {
    ignorePath = '.prettierignore',
    editorconfig = true,
    localOnly,
    defaultConfig,
  } = options;

  // Convert URI to file path
  const filePath = uri.replace(/^file:\/\//, '');
  const fullPath = resolveFile(workspaceRoot, filePath);

  // Resolve prettier module
  const resolvedPrettier = await resolvePrettier(path.dirname(fullPath), {
    localOnly,
    defaultConfig,
  });
  if (!resolvedPrettier) {
    return []; // If prettier not found, no diagnostics
  }

  const { module: prettier } = resolvedPrettier;

  // Check if file is ignored
  const { ignored } = await prettier.getFileInfo(fullPath, { ignorePath });
  if (ignored) {
    return []; // Ignored files have no diagnostics
  }

  // Resolve configuration
  const fileOptions = await resolveConfig(prettier, fullPath, {
    editorconfig,
    defaultConfig,
  });

  // Format and compare
  try {
    const formatted = await prettier.format(text, {
      ...fileOptions,
      filepath: fullPath,
    });

    if (formatted === text) {
      return []; // Already formatted
    }

    // Use smart diff to compare lines
    const originalLines = text.split('\n');
    const formattedLines = formatted.split('\n');
    const diagnostics: FormattingDiagnostic[] = [];

    const diffOps = computeDiff(originalLines, formattedLines);

    for (const op of diffOps) {
      if (op.type === 'replace') {
        // Line needs to be changed - show what's different
        const oldLine = op.oldLine || '';
        const newLine = op.newLine || '';

        // Create a more informative message showing the change
        let message: string;
        if (oldLine.trim() === newLine.trim()) {
          // Only whitespace changed (indentation/trailing spaces)
          message = `Whitespace issue. Expected: ${JSON.stringify(newLine)}`;
        } else if (oldLine.trim() === '' && newLine.trim() !== '') {
          // Blank line should have content
          message = `Replace blank line with: ${newLine}`;
        } else if (oldLine.trim() !== '' && newLine.trim() === '') {
          // Content line should be blank
          message = `Replace with blank line (delete content)`;
        } else {
          // Content changed
          message = `Replace with: ${newLine}`;
        }

        diagnostics.push({
          line: op.oldIndex,
          originalLine: oldLine,
          formattedLine: newLine,
          message,
        });
      } else if (op.type === 'delete') {
        // Line should be removed
        const oldLine = op.oldLine || '';
        const message =
          oldLine.trim() === ''
            ? 'Delete this blank line'
            : `Delete line: ${oldLine}`;

        diagnostics.push({
          line: op.oldIndex,
          originalLine: oldLine,
          formattedLine: '',
          message,
        });
      } else if (op.type === 'insert') {
        // A line is missing - show on previous line or first line
        const targetLine = Math.max(0, op.oldIndex);
        const newLine = op.newLine || '';
        const message =
          newLine.trim() === ''
            ? 'Insert blank line after this'
            : `Insert line after this: ${newLine}`;

        diagnostics.push({
          line: targetLine,
          originalLine: originalLines[targetLine] || '',
          formattedLine: newLine,
          message,
        });
      }
      // Skip 'equal' operations - those lines are fine
    }

    return diagnostics;
  } catch (error) {
    console.error('Prettier formatting diagnostics error:', error);
    return []; // On error, no diagnostics
  }
}

/**
 * Formats text using prettier
 */
export async function formatText(
  uri: string,
  text: string,
  workspaceRoot: string,
  options: FormatOptions = {},
): Promise<string | null> {
  const {
    ignorePath = '.prettierignore',
    editorconfig = true,
    localOnly,
    defaultConfig,
  } = options;

  // Convert URI to file path
  const filePath = uri.replace(/^file:\/\//, '');
  const fullPath = resolveFile(workspaceRoot, filePath);

  // Resolve prettier module
  const resolvedPrettier = await resolvePrettier(path.dirname(fullPath), {
    localOnly,
    defaultConfig,
  });
  if (!resolvedPrettier) {
    console.error('Prettier not found');
    return null;
  }

  const { module: prettier } = resolvedPrettier;

  // Check if file is ignored
  const { ignored } = await prettier.getFileInfo(fullPath, { ignorePath });
  if (ignored) {
    return null;
  }

  // Resolve configuration
  const fileOptions = await resolveConfig(prettier, fullPath, {
    editorconfig,
    defaultConfig,
  });

  // Format the text
  try {
    const formatted = await prettier.format(text, {
      ...fileOptions,
      filepath: fullPath,
    });
    return formatted;
  } catch (error) {
    console.error('Prettier formatting error:', error);
    throw error;
  }
}
