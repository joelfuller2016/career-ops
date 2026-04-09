# career-ops CLI Reference

> Unified command-line interface for the career-ops job search pipeline.
> Zero API cost — uses `claude -p` (free with Claude Max subscription).

## Installation

```bash
# career-ops must be cloned and npm installed
cd career-ops
npm install
npx playwright install chromium  # for PDF generation

# Verify CLI works
node cli.mjs --help
node cli.mjs --version
```

No additional dependencies required. The CLI uses only Node.js built-ins.

## Quick Start

```bash
# Check your setup
node cli.mjs sync-check

# View your tracker as JSON
node cli.mjs tracker --json --pretty

# Evaluate a job (dry-run first to see what would happen)
node cli.mjs evaluate --dry-run --jd "Senior AI Engineer at Anthropic..."

# Actually evaluate (calls claude -p, takes ~1-5 minutes)
node cli.mjs evaluate --jd "Senior AI Engineer at Anthropic..."

# Generate a PDF
node cli.mjs pdf output/test.html output/cv-anthropic.pdf --format=letter

# Run pipeline health check
node cli.mjs verify

# Merge tracker additions
node cli.mjs merge --verify
```

## Architecture

```
node cli.mjs <command> [options]
      │
      ├── evaluate  → evaluate.mjs → claude -p (assembles mode prompts)
      ├── pdf       → generate-pdf.mjs → Playwright Chromium
      ├── merge     → merge-tracker.mjs
      ├── dedup     → dedup-tracker.mjs
      ├── normalize → normalize-statuses.mjs
      ├── verify    → verify-pipeline.mjs
      ├── sync-check → cv-sync-check.mjs
      ├── tracker   → lib/tracker-json.mjs
      ├── dashboard → dashboard/career-dashboard(.exe)
      └── update    → update-system.mjs
```

Each subcommand spawns the corresponding script as a child process. The CLI adds:
- **Unified entry point** — one command for everything
- **JSON output mode** (`--json`) — machine-readable output for every subcommand
- **Path override** (`--career-ops-path`) — run against any career-ops directory

## Global Options

| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show help text |
| `--version` | `-v` | Print version from VERSION file |
| `--json` | `-j` | Force JSON output for all subcommands |
| `--career-ops-path <path>` | `-p` | Override career-ops root directory |

## Commands

### `evaluate` — AI Job Evaluation

Assembles career-ops mode files into a system prompt, sends the job description to Claude via `claude -p`, and returns a structured A-F evaluation.

**Cost: $0** — uses `claude -p` which is included in the Claude Max subscription.

```bash
# Evaluate from inline text
node cli.mjs evaluate --jd "Full job description text here..."

# Evaluate from a file
node cli.mjs evaluate --jd-file jds/anthropic-senior-ai.md

# Evaluate from a URL (Claude extracts the JD)
node cli.mjs evaluate --url https://jobs.greenhouse.io/anthropic/12345

# Dry run — see the assembled prompt without calling Claude
node cli.mjs evaluate --dry-run --jd "test"

# JSON output
node cli.mjs evaluate --json --jd "..."

# Use a different evaluation mode
node cli.mjs evaluate --mode training --jd "AWS ML Specialty certification..."

# Custom timeout (default: 300 seconds)
node cli.mjs evaluate --timeout 600 --jd "..."

# Skip saving report/tracker
node cli.mjs evaluate --skip-report --skip-tracker --jd "..."
```

**Options:**

| Flag | Description |
|------|-------------|
| `--jd <text>` | Job description text (inline) |
| `--jd-file <path>` | Path to JD file |
| `--url <url>` | Job posting URL |
| `--mode <mode>` | Evaluation mode (default: `oferta`) |
| `--dry-run` | Show assembled prompt, don't call Claude |
| `--timeout <seconds>` | Claude timeout (default: 300) |
| `--skip-report` | Don't save report to reports/ |
| `--skip-tracker` | Don't write tracker TSV |
| `--json` | JSON output |

**How it works:**

1. Reads and concatenates: `modes/_shared.md` + `modes/_profile.md` + `modes/{mode}.md` + `cv.md` + `config/profile.yml`
2. Writes combined prompt to a temp file
3. Calls: `claude -p --dangerously-skip-permissions --append-system-prompt-file <prompt> "<jd>"`
4. Parses Claude's output for score, company, role, archetype
5. Saves report to `reports/{NNN}-{company}-{date}.md`
6. Writes tracker TSV to `batch/tracker-additions/{NNN}-{company}.tsv`

**Available modes:** oferta (default), ofertas, pdf, scan, batch, apply, pipeline, contacto, deep, training, project, tracker, auto-pipeline

**Dry-run JSON output:**
```json
{
  "dryRun": true,
  "systemPromptPath": "/tmp/career-ops-prompt-123456.md",
  "systemPromptBytes": 19239,
  "filesAssembled": ["modes/_shared.md", "modes/_profile.md", "modes/oferta.md", "cv.md", "config/profile.yml"],
  "userMessageChars": 354,
  "command": "claude -p --dangerously-skip-permissions --append-system-prompt-file ..."
}
```

**Evaluation JSON output:**
```json
{
  "success": true,
  "company": "Anthropic",
  "role": "Senior AI Engineer",
  "archetype": "AI Platform / LLMOps",
  "score": 4.5,
  "recommendation": "apply",
  "reportPath": "reports/015-anthropic-2026-04-09.md",
  "trackerTsvPath": "batch/tracker-additions/015-anthropic.tsv",
  "duration_ms": 45000
}
```

### `pdf` — Generate ATS-Optimized CV

```bash
node cli.mjs pdf <input.html> <output.pdf> [--format=letter|a4]
```

Calls `generate-pdf.mjs` which uses Playwright Chromium to render HTML to PDF.

**Options:**

| Flag | Description |
|------|-------------|
| `--format=letter` | US Letter (8.5x11") — default for US/Canada |
| `--format=a4` | A4 (210x297mm) — default for rest of world |

**JSON output:**
```json
{"success": true, "exitCode": 0, "stdout": "✅ PDF generated: output.pdf\n📊 Pages: 2\n📦 Size: 107.6 KB", ...}
```

### `merge` — Merge Tracker Additions

```bash
node cli.mjs merge [--dry-run] [--verify]
```

Merges TSV files from `batch/tracker-additions/` into `data/applications.md`. Handles deduplication, score comparison, and column order normalization.

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be merged without writing |
| `--verify` | Run verify-pipeline after merge |

### `dedup` — Remove Duplicate Entries

```bash
node cli.mjs dedup [--dry-run]
```

Groups entries by normalized company name + fuzzy role match. Keeps the entry with the highest score. Creates a `.bak` backup before modifying.

### `normalize` — Normalize Statuses

```bash
node cli.mjs normalize [--dry-run]
```

Maps non-canonical statuses to canonical values (e.g., `cerrada` → `Discarded`, `**Evaluada**` → `Evaluated`). Strips markdown bold, dates from status fields, moves DUPLICADO info to notes.

### `verify` — Pipeline Health Check

```bash
node cli.mjs verify
```

Checks: canonical statuses, duplicate entries, report file existence, score format, row format, pending TSVs.

Exit code 0 = healthy, exit code 1 = errors found.

### `sync-check` — Setup Validation

```bash
node cli.mjs sync-check
```

Validates: cv.md exists, profile.yml has required fields, no hardcoded metrics in prompt files, article-digest.md freshness.

### `tracker` — Tracker Data as JSON

```bash
node cli.mjs tracker [--json] [--metrics] [--pretty]
```

Reads `data/applications.md` and outputs structured JSON.

| Flag | Description |
|------|-------------|
| `--json` | JSON output (default when called as subcommand) |
| `--metrics` | Include aggregate metrics (total, avg score, by-status counts) |
| `--pretty` | Pretty-print JSON with indentation |

**Output:**
```json
[
  {
    "number": 1,
    "date": "2026-04-01",
    "company": "Anthropic",
    "role": "Senior AI Engineer",
    "score": 4.5,
    "scoreRaw": "4.5/5",
    "status": "Evaluated",
    "hasPdf": true,
    "reportPath": "reports/001-anthropic-2026-04-01.md",
    "reportNumber": "001",
    "notes": "Strong match"
  }
]
```

### `dashboard` — TUI Pipeline Viewer

```bash
node cli.mjs dashboard
```

Launches the Go-based terminal UI dashboard. Requires the Go binary to be built:
```bash
cd dashboard && go build -o career-dashboard.exe . && cd ..
node cli.mjs dashboard
```

### `update` — System Updates

```bash
node cli.mjs update check    # Check for updates (returns JSON)
node cli.mjs update apply    # Apply available update
node cli.mjs update rollback # Rollback last update
node cli.mjs update dismiss  # Dismiss update notification
```

## JSON Output Mode

Every subcommand supports `--json` for machine consumption. The envelope format:

```json
{
  "success": true,
  "exitCode": 0,
  "stdout": "...",
  "stderr": "",
  "duration_ms": 123
}
```

For `tracker` and `evaluate`, the stdout contains structured JSON (not raw script output).

## Integration with ToolGateway

The CLI is designed to be called by ToolGateway's CareerOps plugin:

```
ToolGateway (port 5234)
└── CareerOps Plugin
    POST /api/career-ops/evaluate  → node cli.mjs evaluate --json --jd "..."
    POST /api/career-ops/pdf       → node cli.mjs pdf --json ...
    POST /api/career-ops/merge     → node cli.mjs merge --json
    GET  /api/career-ops/tracker   → node cli.mjs tracker --json --metrics
    GET  /api/career-ops/verify    → node cli.mjs verify --json
    GET  /api/career-ops/health    → node cli.mjs sync-check --json
```

The `--json` flag ensures all output is machine-parseable for the .NET plugin to consume via `CliWrap`.

## Pipeline Workflow

```
1. node cli.mjs evaluate --jd "..."     → A-F evaluation + report + tracker TSV
2. node cli.mjs merge                   → Merge TSV into applications.md
3. node cli.mjs pdf input.html out.pdf  → Generate tailored CV
4. node cli.mjs verify                  → Check pipeline integrity
5. node cli.mjs tracker --json          → View current state
6. node cli.mjs dashboard               → Visual pipeline browser
```

## Cost Model

| Command | Cost | How |
|---------|------|-----|
| `evaluate` | **$0** | Uses `claude -p` (free with Claude Max subscription) |
| `pdf` | **$0** | Local Playwright rendering |
| All others | **$0** | Local Node.js scripts |

The evaluate command uses `claude -p --dangerously-skip-permissions` which runs Claude in pipe mode using your existing Claude Max subscription. No API key or per-token billing required.

## File Listing

```
career-ops/
├── cli.mjs                  # Main CLI entry point (this tool)
├── evaluate.mjs             # Evaluate command (assembles prompts + claude -p)
├── lib/
│   ├── tracker-json.mjs     # Tracker parser (markdown → JSON)
│   └── json-output.mjs      # JSON output formatting utilities
├── generate-pdf.mjs         # PDF generation (Playwright)
├── merge-tracker.mjs        # Tracker merge
├── dedup-tracker.mjs        # Deduplication
├── normalize-statuses.mjs   # Status normalization
├── verify-pipeline.mjs      # Pipeline health check
├── cv-sync-check.mjs        # Setup validation
├── update-system.mjs        # System updates
└── dashboard/
    └── career-dashboard*    # Go TUI binary
```

## Troubleshooting

**"claude: command not found"** — Install Claude Code CLI: `npm install -g @anthropic-ai/claude-code`

**"evaluate.mjs not found"** — You're running an older version. Pull latest: `git pull origin main`

**PDF generation fails** — Install Chromium: `npx playwright install chromium`

**Dashboard doesn't launch** — Build the Go binary: `cd dashboard && go build -o career-dashboard.exe .`

**Windows path errors in merge/dedup/normalize/verify** — Scripts use `fileURLToPath` for cross-platform path resolution. If you hit path errors, ensure you're on version 1.1.0+.
