#!/usr/bin/env node
/**
 * json-output.mjs — Output formatting utilities for career-ops CLI
 *
 * Provides a standard JSON envelope and parsers that extract structured data
 * from the human-readable stdout of each pipeline script.
 */

/**
 * Wrap any result in a standard JSON envelope.
 * @param {boolean} success - Whether the operation succeeded
 * @param {*} data - Structured result data
 * @param {string|null} error - Error message if failed
 * @param {number} durationMs - Execution time in milliseconds
 * @returns {{ success: boolean, data: *, error: string|null, duration_ms: number, timestamp: string }}
 */
export function jsonResult(success, data, error = null, durationMs = 0) {
  return {
    success,
    data,
    error,
    duration_ms: durationMs,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Parse merge-tracker.mjs stdout into structured counts.
 *
 * Looks for the summary line:
 *   "📊 Summary: +N added, 🔄N updated, ⏭️N skipped"
 *
 * @param {string} stdout
 * @returns {{ added: number, updated: number, skipped: number }}
 */
export function parseMergeOutput(stdout) {
  const result = { added: 0, updated: 0, skipped: 0 };

  // Match "+N added" or "N added"
  const addedMatch = stdout.match(/\+?(\d+)\s*added/i);
  if (addedMatch) result.added = parseInt(addedMatch[1], 10);

  // Match "N updated"
  const updatedMatch = stdout.match(/(\d+)\s*updated/i);
  if (updatedMatch) result.updated = parseInt(updatedMatch[1], 10);

  // Match "N skipped"
  const skippedMatch = stdout.match(/(\d+)\s*skipped/i);
  if (skippedMatch) result.skipped = parseInt(skippedMatch[1], 10);

  return result;
}

/**
 * Parse dedup-tracker.mjs stdout into structured counts.
 *
 * Looks for: "📊 N duplicates removed"
 *
 * @param {string} stdout
 * @returns {{ removed: number }}
 */
export function parseDedupOutput(stdout) {
  const result = { removed: 0 };

  const match = stdout.match(/(\d+)\s*duplicates?\s*removed/i);
  if (match) result.removed = parseInt(match[1], 10);

  return result;
}

/**
 * Parse normalize-statuses.mjs stdout into structured data.
 *
 * Looks for:
 *   "📊 N statuses normalized"
 *   "⚠️  N unknown statuses:"
 *   Individual unknown lines: '  #N (line M): "STATUS"'
 *
 * @param {string} stdout
 * @returns {{ normalized: number, unknowns: string[] }}
 */
export function parseNormalizeOutput(stdout) {
  const result = { normalized: 0, unknowns: [] };

  const normalizedMatch = stdout.match(/(\d+)\s*statuses?\s*normalized/i);
  if (normalizedMatch) result.normalized = parseInt(normalizedMatch[1], 10);

  // Extract individual unknown status lines
  const unknownPattern = /#(\d+)\s*\(line\s*\d+\):\s*"([^"]+)"/g;
  let m;
  while ((m = unknownPattern.exec(stdout)) !== null) {
    result.unknowns.push(`#${m[1]}: ${m[2]}`);
  }

  return result;
}

/**
 * Parse verify-pipeline.mjs stdout into structured health data.
 *
 * Looks for:
 *   "📊 Pipeline Health: N errors, M warnings"
 *   Individual check lines starting with ✅, ❌, or ⚠️
 *
 * @param {string} stdout
 * @returns {{ errors: number, warnings: number, status: "healthy"|"errors"|"warnings", checks: string[] }}
 */
export function parseVerifyOutput(stdout) {
  const result = { errors: 0, warnings: 0, status: 'healthy', checks: [] };

  // Parse summary line
  const summaryMatch = stdout.match(/(\d+)\s*errors?,\s*(\d+)\s*warnings?/i);
  if (summaryMatch) {
    result.errors = parseInt(summaryMatch[1], 10);
    result.warnings = parseInt(summaryMatch[2], 10);
  }

  // Determine status
  if (result.errors > 0) {
    result.status = 'errors';
  } else if (result.warnings > 0) {
    result.status = 'warnings';
  }

  // Extract individual check lines (✅, ❌, ⚠️)
  const lines = stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[✅❌⚠️]/.test(trimmed)) {
      result.checks.push(trimmed);
    }
  }

  return result;
}

/**
 * Parse cv-sync-check.mjs stdout into structured data.
 *
 * Looks for:
 *   "ERROR: ..." lines
 *   "WARN: ..." lines
 *   "All checks passed."
 *
 * @param {string} stdout
 * @returns {{ errors: string[], warnings: string[], status: "pass"|"fail" }}
 */
export function parseSyncCheckOutput(stdout) {
  const result = { errors: [], warnings: [], status: 'pass' };

  const lines = stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const errMatch = trimmed.match(/^ERROR:\s*(.+)/);
    if (errMatch) {
      result.errors.push(errMatch[1]);
    }
    const warnMatch = trimmed.match(/^WARN:\s*(.+)/);
    if (warnMatch) {
      result.warnings.push(warnMatch[1]);
    }
  }

  if (result.errors.length > 0) {
    result.status = 'fail';
  }

  return result;
}

/**
 * Parse generate-pdf.mjs stdout into structured data.
 *
 * Looks for:
 *   "✅ PDF generated: <path>"
 *   "📊 Pages: N"
 *   "📦 Size: N.N KB"
 *
 * @param {string} stdout
 * @returns {{ outputPath: string, pages: number, sizeKb: number }}
 */
export function parsePdfOutput(stdout) {
  const result = { outputPath: '', pages: 0, sizeKb: 0 };

  const pathMatch = stdout.match(/PDF generated:\s*(.+)/);
  if (pathMatch) result.outputPath = pathMatch[1].trim();

  const pagesMatch = stdout.match(/Pages:\s*(\d+)/);
  if (pagesMatch) result.pages = parseInt(pagesMatch[1], 10);

  const sizeMatch = stdout.match(/Size:\s*([\d.]+)\s*KB/i);
  if (sizeMatch) result.sizeKb = parseFloat(sizeMatch[1]);

  return result;
}
