#!/usr/bin/env node
/**
 * cli.mjs — Main CLI entry point for career-ops
 *
 * Zero-dependency CLI wrapper using Node.js native parseArgs.
 * Routes subcommands to individual scripts via child_process.execFile.
 * Supports --json mode for machine-readable output.
 *
 * Usage: node cli.mjs <command> [options]
 */

import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

// ── Path resolution ─────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Argument parsing ────────────────────────────────────────────

// Extract the subcommand (first positional arg) before parseArgs runs,
// since parseArgs in strict mode chokes on unknown subcommand tokens.
const rawArgs = process.argv.slice(2);
let subcommand = null;
const filteredArgs = [];

for (const arg of rawArgs) {
  if (!subcommand && !arg.startsWith('-')) {
    subcommand = arg;
  } else {
    filteredArgs.push(arg);
  }
}

const { values: flags } = parseArgs({
  args: filteredArgs,
  options: {
    help:             { type: 'boolean', short: 'h', default: false },
    json:             { type: 'boolean', short: 'j', default: false },
    version:          { type: 'boolean', short: 'v', default: false },
    'career-ops-path': { type: 'string',  short: 'p' },
    'dry-run':        { type: 'boolean', default: false },
    metrics:          { type: 'boolean', default: false },
    pretty:           { type: 'boolean', default: false },
    format:           { type: 'string' },
    verify:           { type: 'boolean', default: false },
  },
  strict: false,
  allowPositionals: true,
});

const careerOpsPath = flags['career-ops-path'] || __dirname;

// ── Subcommand definitions ──────────────────────────────────────

const COMMANDS = {
  evaluate: {
    description: 'Evaluate a job description (A-F scoring via claude -p)',
    script: 'evaluate.mjs',
  },
  pdf: {
    description: 'Generate ATS-optimized CV PDF',
    script: 'generate-pdf.mjs',
  },
  merge: {
    description: 'Merge tracker additions into applications.md',
    script: 'merge-tracker.mjs',
  },
  dedup: {
    description: 'Remove duplicate tracker entries',
    script: 'dedup-tracker.mjs',
  },
  normalize: {
    description: 'Normalize statuses to canonical values',
    script: 'normalize-statuses.mjs',
  },
  verify: {
    description: 'Run pipeline integrity checks',
    script: 'verify-pipeline.mjs',
  },
  'sync-check': {
    description: 'Validate setup consistency',
    script: 'cv-sync-check.mjs',
  },
  tracker: {
    description: 'Output tracker data as JSON',
    script: 'lib/tracker-json.mjs',
  },
  dashboard: {
    description: 'Launch TUI dashboard',
    binary: true,
  },
  update: {
    description: 'Check/apply system updates',
    script: 'update-system.mjs',
  },
};

// ── Help text ───────────────────────────────────────────────────

function showHelp() {
  const lines = [
    'career-ops-cli \u2014 AI job search pipeline CLI',
    '',
    'Usage: node cli.mjs <command> [options]',
    '',
    'Commands:',
  ];

  const maxLen = Math.max(...Object.keys(COMMANDS).map(k => k.length));
  for (const [name, def] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.padEnd(maxLen + 2)}${def.description}`);
  }

  lines.push(
    '',
    'Global Options:',
    '  --json, -j              JSON output mode',
    '  --career-ops-path, -p   Path to career-ops root (default: script directory)',
    '  --help, -h              Show help',
    '  --version, -v           Show version',
    '',
    'Subcommand Options:',
    '  --dry-run               Run without writing changes (merge, dedup, normalize)',
    '  --metrics               Include aggregate metrics (tracker)',
    '  --pretty                Pretty-print JSON output (tracker)',
    '  --format=<a4|letter>    PDF page format (pdf)',
    '  --verify                Run verification after merge (merge)',
  );

  console.log(lines.join('\n'));
}

// ── Version ─────────────────────────────────────────────────────

function showVersion() {
  const versionFile = join(careerOpsPath, 'VERSION');
  if (existsSync(versionFile)) {
    const version = readFileSync(versionFile, 'utf-8').trim();
    console.log(`career-ops v${version}`);
  } else {
    console.log('career-ops (version unknown)');
  }
}

// ── Script runner ───────────────────────────────────────────────

/**
 * Run a script via child_process.execFile and return a promise with
 * stdout, stderr, exitCode, and duration.
 */
function runScript(scriptPath, args = []) {
  return new Promise((resolve) => {
    const start = Date.now();
    execFile('node', [scriptPath, ...args], {
      cwd: careerOpsPath,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const durationMs = Date.now() - start;
      const exitCode = error ? (error.code ?? 1) : 0;
      resolve({ stdout: stdout || '', stderr: stderr || '', exitCode, durationMs });
    });
  });
}

/**
 * Run the Go dashboard binary.
 */
function runDashboard(args = []) {
  return new Promise((resolve) => {
    const isWindows = platform() === 'win32';
    const binaryName = isWindows ? 'career-dashboard.exe' : 'career-dashboard';
    const binaryPath = join(careerOpsPath, 'dashboard', binaryName);

    if (!existsSync(binaryPath)) {
      resolve({
        stdout: '',
        stderr: `Dashboard binary not found: ${binaryPath}`,
        exitCode: 1,
        durationMs: 0,
      });
      return;
    }

    const start = Date.now();
    const dashArgs = [`--path=${careerOpsPath}`, ...args];
    execFile(binaryPath, dashArgs, {
      cwd: careerOpsPath,
      timeout: 0, // No timeout for TUI
    }, (error, stdout, stderr) => {
      const durationMs = Date.now() - start;
      const exitCode = error ? (error.code ?? 1) : 0;
      resolve({ stdout: stdout || '', stderr: stderr || '', exitCode, durationMs });
    });
  });
}

// ── JSON output wrapper ─────────────────────────────────────────

function jsonWrap(success, exitCode, stdout, stderr, durationMs) {
  return JSON.stringify({
    success,
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    duration_ms: durationMs,
  });
}

// ── Build subcommand args ───────────────────────────────────────

function buildSubcommandArgs(cmd) {
  const args = [];

  // Pass --dry-run through to scripts that support it
  if (flags['dry-run'] && ['merge', 'dedup', 'normalize'].includes(cmd)) {
    args.push('--dry-run');
  }

  // Pass --verify through to merge
  if (flags.verify && cmd === 'merge') {
    args.push('--verify');
  }

  // Pass --metrics and --pretty to tracker
  if (cmd === 'tracker') {
    args.push(`--path=${careerOpsPath}`);
    if (flags.metrics) args.push('--metrics');
    if (flags.pretty) args.push('--pretty');
  }

  // Pass format to pdf
  if (cmd === 'pdf' && flags.format) {
    args.push(`--format=${flags.format}`);
  }

  // Pass remaining positional args through (e.g., file paths for pdf,
  // subcommand for update like "check", "apply", "rollback", "dismiss")
  const { positionals } = parseArgs({
    args: filteredArgs,
    options: {
      help:             { type: 'boolean', short: 'h', default: false },
      json:             { type: 'boolean', short: 'j', default: false },
      version:          { type: 'boolean', short: 'v', default: false },
      'career-ops-path': { type: 'string',  short: 'p' },
      'dry-run':        { type: 'boolean', default: false },
      metrics:          { type: 'boolean', default: false },
      pretty:           { type: 'boolean', default: false },
      format:           { type: 'string' },
      verify:           { type: 'boolean', default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  // For update, the first positional is the action (check/apply/rollback/dismiss)
  if (cmd === 'update' && positionals.length > 0) {
    args.push(...positionals);
  }

  // For pdf, positionals are input/output paths
  if (cmd === 'pdf' && positionals.length > 0) {
    args.push(...positionals);
  }

  // For evaluate, pass through ALL remaining raw args after the subcommand
  // since evaluate.mjs has its own parseArgs (--jd, --url, --jd-file, --dry-run, --mode, etc.)
  if (cmd === 'evaluate') {
    // Find the index of 'evaluate' in rawArgs and pass everything after it
    const evalIdx = rawArgs.indexOf('evaluate');
    if (evalIdx >= 0) {
      const evalArgs = rawArgs.slice(evalIdx + 1).filter(a => a !== '--json' && a !== '-j');
      args.push(...evalArgs);
    }
    // Pass career-ops-path if specified
    args.push(`--career-ops-path=${careerOpsPath}`);
    // If --json was set globally, pass it to evaluate too
    if (flags.json) args.push('--json');
  }

  return args;
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  // Handle global flags first
  if (flags.help || (!subcommand && !flags.version)) {
    showHelp();
    process.exit(0);
  }

  if (flags.version) {
    showVersion();
    process.exit(0);
  }

  // Validate subcommand
  const cmdDef = COMMANDS[subcommand];
  if (!cmdDef) {
    console.error(`Unknown command: ${subcommand}`);
    console.error('Run with --help to see available commands.');
    process.exit(1);
  }

  // Special case: evaluate — not yet built
  if (subcommand === 'evaluate') {
    const scriptPath = join(careerOpsPath, 'evaluate.mjs');
    if (!existsSync(scriptPath)) {
      if (flags.json) {
        console.log(jsonWrap(false, 1, '', 'evaluate command not yet built', 0));
      } else {
        console.error('evaluate command not yet built');
      }
      process.exit(1);
    }
  }

  // Special case: dashboard — runs Go binary, not Node script
  if (subcommand === 'dashboard') {
    const args = buildSubcommandArgs('dashboard');
    const result = await runDashboard(args);

    if (flags.json) {
      console.log(jsonWrap(result.exitCode === 0, result.exitCode, result.stdout, result.stderr, result.durationMs));
    } else {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    process.exit(result.exitCode);
  }

  // Standard script execution
  const scriptPath = join(careerOpsPath, cmdDef.script);
  if (!existsSync(scriptPath)) {
    const msg = `Script not found: ${cmdDef.script}`;
    if (flags.json) {
      console.log(jsonWrap(false, 1, '', msg, 0));
    } else {
      console.error(msg);
    }
    process.exit(1);
  }

  const args = buildSubcommandArgs(subcommand);
  const result = await runScript(scriptPath, args);

  if (flags.json) {
    console.log(jsonWrap(
      result.exitCode === 0,
      result.exitCode,
      result.stdout,
      result.stderr,
      result.durationMs,
    ));
    process.exit(result.exitCode);
  } else {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.exitCode);
  }
}

main().catch((err) => {
  if (flags.json) {
    console.log(jsonWrap(false, 1, '', err.message, 0));
  } else {
    console.error(`Fatal: ${err.message}`);
  }
  process.exit(1);
});
