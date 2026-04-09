#!/usr/bin/env node
/**
 * evaluate.mjs — Evaluate a job description using claude -p
 *
 * Reads mode files (_shared.md, _profile.md, oferta.md) and the user's cv.md,
 * assembles them into a combined system prompt, pipes the JD text to `claude -p`,
 * parses the output into a structured evaluation, saves report and tracker TSV.
 *
 * Zero dependencies — Node.js built-ins only.
 *
 * Usage: node evaluate.mjs [options]
 */

import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import {
  readFileSync, writeFileSync, readdirSync,
  existsSync, mkdirSync, statSync, unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// ── Path resolution ─────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Argument parsing ────────────────────────────────────────────

const { values: flags } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help:              { type: 'boolean', short: 'h', default: false },
    jd:                { type: 'string' },
    'jd-file':         { type: 'string' },
    url:               { type: 'string' },
    mode:              { type: 'string',  default: 'oferta' },
    'dry-run':         { type: 'boolean', default: false },
    json:              { type: 'boolean', short: 'j', default: false },
    timeout:           { type: 'string',  default: '300' },
    'skip-tracker':    { type: 'boolean', default: false },
    'skip-report':     { type: 'boolean', default: false },
    'career-ops-path': { type: 'string',  short: 'p' },
  },
  strict: false,
  allowPositionals: true,
});

const careerOpsPath = flags['career-ops-path'] || __dirname;
const timeoutSec = parseInt(flags.timeout, 10) || 300;

// ── Help ────────────────────────────────────────────────────────

function showHelp() {
  const text = `
evaluate — Evaluate a job description via claude -p (A-F scoring)

Usage: node evaluate.mjs [options]

Options:
  --jd <text>              Job description text (inline)
  --jd-file <path>         Path to JD file (markdown or text)
  --url <url>              Job posting URL (passed to claude for extraction)
  --mode <mode>            Evaluation mode (default: "oferta")
  --dry-run                Show assembled prompt WITHOUT calling claude -p
  --json, -j               Output JSON result
  --timeout <seconds>      Timeout for claude -p (default: 300)
  --skip-tracker           Don't write tracker TSV entry
  --skip-report            Don't save report file
  --career-ops-path, -p    Root path (default: script directory)
  --help, -h               Show this help

Examples:
  node evaluate.mjs --jd "Senior AI Engineer at Vercel..."
  node evaluate.mjs --jd-file jds/vercel-ai-eng.md
  node evaluate.mjs --url "https://boards.greenhouse.io/vercel/jobs/12345"
  node evaluate.mjs --dry-run --jd "test job description"
  node evaluate.mjs --dry-run --json --jd "test"
`.trim();
  console.log(text);
}

// ── Utility helpers ─────────────────────────────────────────────

function errExit(message, code = 1) {
  if (flags.json) {
    console.log(JSON.stringify({ success: false, error: message }));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(code);
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatBytes(n) {
  return n.toLocaleString('en-US');
}

// ── Step 1: Assemble the system prompt ──────────────────────────

function assembleSystemPrompt(mode) {
  const files = [];
  let combined = '';

  // 1. _shared.md (required)
  const sharedPath = join(careerOpsPath, 'modes', '_shared.md');
  if (!existsSync(sharedPath)) {
    errExit(`Required file not found: modes/_shared.md`);
  }
  const sharedContent = readFileSync(sharedPath, 'utf-8');
  combined += sharedContent + '\n\n';
  files.push('modes/_shared.md');

  // 2. _profile.md (optional, skip if missing)
  const profileModePath = join(careerOpsPath, 'modes', '_profile.md');
  if (existsSync(profileModePath)) {
    const profileModeContent = readFileSync(profileModePath, 'utf-8');
    combined += profileModeContent + '\n\n';
    files.push('modes/_profile.md');
  }

  // 3. {mode}.md (required) — validate mode name to prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(mode)) {
    errExit(`Invalid mode name: ${mode} (only alphanumeric, hyphens, underscores allowed)`);
  }
  const modePath = join(careerOpsPath, 'modes', `${mode}.md`);
  if (!existsSync(modePath)) {
    // List available modes for the error message
    const available = readdirSync(join(careerOpsPath, 'modes'))
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .map(f => f.replace('.md', ''));
    errExit(
      `Mode file not found: modes/${mode}.md\n` +
      `Available modes: ${available.join(', ')}`
    );
  }
  const modeContent = readFileSync(modePath, 'utf-8');
  combined += modeContent + '\n\n';
  files.push(`modes/${mode}.md`);

  // 4. Sources of Truth section
  combined += '---\n\n# Sources of Truth\n\n';

  // cv.md (required)
  const cvPath = join(careerOpsPath, 'cv.md');
  if (!existsSync(cvPath)) {
    errExit(
      'cv.md not found. Run the onboarding flow first:\n' +
      '  node cli.mjs evaluate --help\n' +
      'Or create cv.md with your CV in markdown format.'
    );
  }
  const cvContent = readFileSync(cvPath, 'utf-8');
  combined += `## CV\n\n${cvContent}\n\n`;
  files.push('cv.md');

  // config/profile.yml (required)
  const profileYmlPath = join(careerOpsPath, 'config', 'profile.yml');
  if (!existsSync(profileYmlPath)) {
    errExit(
      'config/profile.yml not found. Run the onboarding flow first:\n' +
      '  Copy config/profile.example.yml to config/profile.yml and fill it in.'
    );
  }
  const profileYmlContent = readFileSync(profileYmlPath, 'utf-8');
  combined += `## Profile\n\n${profileYmlContent}\n`;
  files.push('config/profile.yml');

  // Write to temp file
  const timestamp = Date.now();
  const tempPath = join(tmpdir(), `career-ops-prompt-${timestamp}.md`);
  writeFileSync(tempPath, combined, 'utf-8');

  return {
    path: tempPath,
    bytes: Buffer.byteLength(combined, 'utf-8'),
    files,
    content: combined,
  };
}

// ── Step 2: Build the user message ──────────────────────────────

function buildUserMessage() {
  let jdText = null;

  if (flags.jd) {
    jdText = flags.jd;
  } else if (flags['jd-file']) {
    const jdFilePath = flags['jd-file'];
    if (!existsSync(jdFilePath)) {
      errExit(`JD file not found: ${jdFilePath}`);
    }
    jdText = readFileSync(jdFilePath, 'utf-8');
  } else if (flags.url) {
    jdText = `Evaluate this job posting: ${flags.url}`;
  } else {
    errExit(
      'No job description provided. Use one of:\n' +
      '  --jd "Job description text..."\n' +
      '  --jd-file path/to/jd.md\n' +
      '  --url https://example.com/job/12345'
    );
  }

  const message = [
    'Evaluate this job offer. Produce all 6 blocks (A-F) with scoring.',
    'Output the complete evaluation in markdown format.',
    '',
    'At the END of your response, include a JSON summary block:',
    '```json',
    '{"company": "...", "role": "...", "archetype": "...", "score": X.X, "recommendation": "apply|skip|maybe"}',
    '```',
    '',
    'JD:',
    jdText,
  ].join('\n');

  return message;
}

// ── Step 3: Dry-run output ──────────────────────────────────────

function handleDryRun(prompt, userMessage) {
  const command = `claude -p --dangerously-skip-permissions --append-system-prompt-file ${prompt.path} "<user-message>"`;

  if (flags.json) {
    console.log(JSON.stringify({
      dryRun: true,
      systemPromptPath: prompt.path,
      systemPromptBytes: prompt.bytes,
      filesAssembled: prompt.files,
      userMessageChars: userMessage.length,
      command,
    }, null, 2));
  } else {
    console.log('=== DRY RUN ===');
    console.log(`System prompt: ${prompt.path} (${formatBytes(prompt.bytes)} bytes, ${prompt.files.length} files assembled)`);
    console.log(`User message: ${userMessage.length} chars`);
    console.log(`Command: ${command}`);
  }

  process.exit(0);
}

// ── Step 4: Execute claude -p ───────────────────────────────────

function executeClaude(promptPath, userMessage) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const child = execFile(
      'claude',
      [
        '-p',
        '--dangerously-skip-permissions',
        '--append-system-prompt-file', promptPath,
        userMessage,
      ],
      {
        cwd: careerOpsPath,
        timeout: timeoutSec * 1000,
        maxBuffer: 20 * 1024 * 1024,
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - start;

        if (error) {
          if (error.killed) {
            reject(new Error(`claude -p timed out after ${timeoutSec}s`));
          } else if (error.code === 'ENOENT') {
            reject(new Error(
              'claude CLI not found on PATH.\n' +
              'Install it with: npm install -g @anthropic-ai/claude-code\n' +
              'Then run: claude --version'
            ));
          } else {
            reject(new Error(
              `claude -p exited with code ${error.code || 1}\n` +
              `stderr: ${stderr || '(none)'}`
            ));
          }
          return;
        }

        resolve({ stdout: stdout || '', stderr: stderr || '', durationMs });
      }
    );
  });
}

// ── Step 5: Parse the output ────────────────────────────────────

function parseEvaluation(stdout) {
  const result = {
    company: 'Unknown',
    role: 'Unknown',
    archetype: 'None detected',
    score: null,
    recommendation: 'unknown',
  };

  // Try to extract JSON summary block from end of output
  const jsonMatch = stdout.match(/```json\s*\n({[\s\S]*?})\s*\n```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.company) result.company = parsed.company;
      if (parsed.role) result.role = parsed.role;
      if (parsed.archetype) result.archetype = parsed.archetype;
      if (parsed.score != null) result.score = parseFloat(parsed.score);
      if (parsed.recommendation) result.recommendation = parsed.recommendation;
    } catch {
      // JSON parse failed, fall through to regex extraction
    }
  }

  // Fallback: try to extract score from markdown patterns
  if (result.score == null) {
    const scorePatterns = [
      /\*\*Score:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /Score:\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /Global.*?(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /\*\*Global\*\*.*?(\d+(?:\.\d+)?)/i,
    ];
    for (const pattern of scorePatterns) {
      const match = stdout.match(pattern);
      if (match) {
        result.score = parseFloat(match[1]);
        break;
      }
    }
  }

  return result;
}

// ── Step 6: Save report ─────────────────────────────────────────

function saveReport(evaluation, companySlug, parsed) {
  const reportsDir = join(careerOpsPath, 'reports');
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }

  // Find next sequential number
  const reports = readdirSync(reportsDir).filter(f => f.endsWith('.md'));
  const maxNum = reports.reduce((max, f) => {
    const num = parseInt(f.split('-')[0], 10);
    return !isNaN(num) && num > max ? num : max;
  }, 0);
  const nextNum = maxNum + 1;
  const numStr = String(nextNum).padStart(3, '0');

  const date = todayISO();
  const slug = companySlug || slugify(parsed.company);
  const fileName = `${numStr}-${slug}-${date}.md`;
  const filePath = join(reportsDir, fileName);

  writeFileSync(filePath, evaluation, 'utf-8');

  return { num: nextNum, numStr, fileName, filePath };
}

// ── Step 7: Write tracker TSV ───────────────────────────────────

function writeTrackerTSV(report, parsed) {
  const additionsDir = join(careerOpsPath, 'batch', 'tracker-additions');
  if (!existsSync(additionsDir)) {
    mkdirSync(additionsDir, { recursive: true });
  }

  const slug = slugify(parsed.company);
  const tsvFileName = `${report.numStr}-${slug}.tsv`;
  const tsvPath = join(additionsDir, tsvFileName);

  const date = todayISO();
  const scoreStr = parsed.score != null ? `${parsed.score}/5` : 'N/A';
  const reportLink = `[${report.numStr}](reports/${report.fileName})`;

  // TSV columns: num, date, company, role, status, score, pdf, report, notes
  const line = [
    report.num,
    date,
    parsed.company,
    parsed.role,
    'Evaluada',
    scoreStr,
    '\u274C',       // ❌
    reportLink,
    parsed.recommendation,
  ].join('\t');

  writeFileSync(tsvPath, line + '\n', 'utf-8');

  return { tsvFileName, tsvPath };
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  // Handle --help
  if (flags.help) {
    showHelp();
    process.exit(0);
  }

  // Step 1: Assemble system prompt
  const mode = flags.mode || 'oferta';
  const prompt = assembleSystemPrompt(mode);

  // Step 2: Build user message
  const userMessage = buildUserMessage();

  // Step 3: Dry-run
  if (flags['dry-run']) {
    handleDryRun(prompt, userMessage);
    return; // handleDryRun calls process.exit
  }

  // Step 4: Execute claude -p
  let claudeResult;
  try {
    claudeResult = await executeClaude(prompt.path, userMessage);
  } catch (err) {
    errExit(err.message);
  } finally {
    // Clean up temp file containing CV + salary data
    try { unlinkSync(prompt.path); } catch { /* already removed */ }
  }

  const evaluation = claudeResult.stdout;

  // Step 5: Parse output
  const parsed = parseEvaluation(evaluation);
  const companySlug = slugify(parsed.company);

  // Step 6: Save report
  let report = null;
  if (!flags['skip-report']) {
    report = saveReport(evaluation, companySlug, parsed);
  }

  // Step 7: Write tracker TSV
  let tracker = null;
  if (!flags['skip-tracker'] && report) {
    tracker = writeTrackerTSV(report, parsed);
  }

  // Step 8: Output result
  if (flags.json) {
    console.log(JSON.stringify({
      success: true,
      company: parsed.company,
      role: parsed.role,
      archetype: parsed.archetype,
      score: parsed.score,
      recommendation: parsed.recommendation,
      reportPath: report ? report.filePath : null,
      trackerTsvPath: tracker ? tracker.tsvPath : null,
      duration_ms: claudeResult.durationMs,
      claudeTokensUsed: null,
    }, null, 2));
  } else {
    process.stdout.write(evaluation);
    if (report) {
      console.error(`\nReport saved: ${report.fileName}`);
    }
    if (tracker) {
      console.error(`Tracker TSV: ${tracker.tsvFileName}`);
    }
  }
}

main().catch((err) => {
  errExit(err.message);
});
