#!/usr/bin/env node
/**
 * tracker-json.mjs — Parse applications.md into structured JSON
 *
 * Works both as:
 *   1. Importable module:  import { parseTracker } from './lib/tracker-json.mjs'
 *   2. Standalone script:  node lib/tracker-json.mjs [--path <root>] [--metrics] [--pretty]
 *
 * Reads data/applications.md (or applications.md), parses the markdown table,
 * and outputs a JSON array of application entries. Translates Spanish statuses
 * to English.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'node:util';

// ── Status translation (Spanish → English) ─────────────────────

const STATUS_MAP = {
  'evaluada': 'Evaluated',
  'aplicado': 'Applied',
  'aplicada': 'Applied',
  'enviada': 'Applied',
  'applied': 'Applied',
  'sent': 'Applied',
  'respondido': 'Responded',
  'entrevista': 'Interview',
  'oferta': 'Offer',
  'rechazado': 'Rejected',
  'rechazada': 'Rejected',
  'descartado': 'Discarded',
  'descartada': 'Discarded',
  'cerrada': 'Discarded',
  'cancelada': 'Discarded',
  'no aplicar': 'Skip',
  'no_aplicar': 'Skip',
  'skip': 'Skip',
  'monitor': 'Skip',
  'condicional': 'Evaluated',
  'hold': 'Evaluated',
  'evaluar': 'Evaluated',
  'verificar': 'Evaluated',
};

/**
 * Translate a raw status string to its English canonical form.
 * Strips markdown bold and trailing dates before matching.
 *
 * @param {string} raw
 * @returns {string}
 */
function translateStatus(raw) {
  const clean = raw.replace(/\*\*/g, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  const lower = clean.toLowerCase();
  return STATUS_MAP[lower] || clean;
}

/**
 * Parse the score field. Handles "X.X/5", "N/A", "DUP", bold markdown.
 *
 * @param {string} raw - e.g. "4.5/5", "**3.2/5**", "N/A"
 * @returns {{ score: number|null, scoreRaw: string }}
 */
function parseScore(raw) {
  const cleaned = raw.replace(/\*\*/g, '').trim();
  const m = cleaned.match(/([\d.]+)\/5/);
  if (m) {
    return { score: parseFloat(m[1]), scoreRaw: cleaned };
  }
  return { score: null, scoreRaw: cleaned };
}

/**
 * Parse the report column. Extracts the report number and path from
 * a markdown link like "[001](reports/001-anthropic-2026-04-01.md)".
 *
 * @param {string} raw
 * @returns {{ reportPath: string, reportNumber: string }}
 */
function parseReport(raw) {
  const linkMatch = raw.match(/\[(\d+)\]\(([^)]+)\)/);
  if (linkMatch) {
    return {
      reportNumber: linkMatch[1].padStart(3, '0'),
      reportPath: linkMatch[2],
    };
  }
  return { reportNumber: '', reportPath: '' };
}

/**
 * Parse the PDF column. Checks for checkmark emoji.
 *
 * @param {string} raw
 * @returns {boolean}
 */
function parsePdf(raw) {
  return raw.includes('✅');
}

/**
 * Parse applications.md and return structured entries.
 *
 * @param {string} careerOpsPath - Root path of the career-ops project
 * @returns {Array<Object>} Parsed application entries
 */
export function parseTracker(careerOpsPath) {
  // Support both layouts: data/applications.md and applications.md
  const dataPath = join(careerOpsPath, 'data', 'applications.md');
  const rootPath = join(careerOpsPath, 'applications.md');
  const appsFile = existsSync(dataPath) ? dataPath : rootPath;

  if (!existsSync(appsFile)) {
    return [];
  }

  const content = readFileSync(appsFile, 'utf-8');
  const lines = content.split('\n');
  const entries = [];

  for (const line of lines) {
    if (!line.startsWith('|')) continue;

    const parts = line.split('|').map(s => s.trim());
    // parts[0] is empty (before first |), parts[1] is #, etc.
    if (parts.length < 9) continue;

    const num = parseInt(parts[1], 10);
    if (isNaN(num) || num === 0) continue;

    // Skip header/separator rows
    if (parts[1] === '#' || parts[1].includes('---')) continue;

    const { score, scoreRaw } = parseScore(parts[5]);
    const { reportNumber, reportPath } = parseReport(parts[8]);
    const hasPdf = parsePdf(parts[7]);
    const status = translateStatus(parts[6]);
    const notes = (parts[9] || '').trim();

    entries.push({
      number: num,
      date: parts[2],
      company: parts[3],
      role: parts[4],
      score,
      scoreRaw,
      status,
      hasPdf,
      reportPath,
      reportNumber,
      notes,
    });
  }

  return entries;
}

/**
 * Compute aggregate metrics from parsed entries.
 *
 * @param {Array<Object>} entries
 * @returns {Object} Metrics object
 */
export function computeMetrics(entries) {
  const scoredEntries = entries.filter(e => e.score !== null);
  const avgScore = scoredEntries.length > 0
    ? parseFloat((scoredEntries.reduce((sum, e) => sum + e.score, 0) / scoredEntries.length).toFixed(2))
    : 0;

  const byStatus = {};
  for (const e of entries) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  }

  // Top scoring: entries with score >= 4.0, sorted descending
  const topScoring = scoredEntries
    .filter(e => e.score >= 4.0)
    .sort((a, b) => b.score - a.score)
    .map(e => ({
      number: e.number,
      company: e.company,
      role: e.role,
      score: e.score,
    }));

  return {
    total: entries.length,
    avgScore,
    byStatus,
    topScoring,
  };
}

// ── Standalone execution ────────────────────────────────────────

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, '/') ===
  process.argv[1].replace(/\\/g, '/');

if (isMain) {
  const { values } = parseArgs({
    options: {
      path: { type: 'string', short: 'p' },
      metrics: { type: 'boolean', default: false },
      pretty: { type: 'boolean', default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  // Default path: parent of lib/ (i.e., the project root)
  const careerOpsPath = values.path || dirname(dirname(fileURLToPath(import.meta.url)));
  const entries = parseTracker(careerOpsPath);

  let output;
  if (values.metrics) {
    output = {
      entries,
      metrics: computeMetrics(entries),
    };
  } else {
    output = entries;
  }

  if (values.pretty) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(JSON.stringify(output));
  }
}
