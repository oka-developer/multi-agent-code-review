# Multi-Agent Code Review Orchestrator

A command-line tool that reviews GitHub pull requests with a team of specialized AI agents, built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk). Give it a repository and a PR number; it produces a structured review in JSON, Markdown, and HTML.

```bash
npm run dev -- octocat Hello-World 1
```

## How it works

```
                        ┌─────────────────────────────┐
  npm run dev -- ...    │        Orchestrator         │
  owner repo pr  ─────▶ │  (src/orchestrator.ts)      │
                        └──────┬───────────────┬──────┘
                 GitHub MCP    │               │   Task tool (one call per agent, per file)
        (PR + changed files)   │               ▼
                               │   ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
                               │   │ code-quality-analyzer│  │test-coverage-analyzer│  │ refactoring-suggester│
                               │   │ security, perf,      │  │ finds tests, gaps,   │  │ structure, clarity,  │
                               │   │ maintainability      │  │ suggests test cases  │  │ modernization        │
                               │   │ (Skills + ESLint MCP)│  │                      │  │                      │
                               │   └──────────┬───────────┘  └──────────┬───────────┘  └──────────┬───────────┘
                               ▼              └──────────────┬──────────┴─────────────────────────┘
                     Structured output (JSON Schema from Zod) ▼
                        ┌─────────────────────────────┐
                        │  ReviewReport  (validated   │ ─▶ reports/<owner>_<repo>_<pr>.{json,md,html}
                        │  with Zod safeParse)        │
                        └─────────────────────────────┘
```

1. **Fetch** – the orchestrator uses the GitHub MCP server to read the PR and its changed files.
2. **Delegate** – for every changed file it explicitly invokes three subagents through the SDK's `Task` tool, asking for them to run in parallel.
3. **Aggregate** – results are combined into a `ReviewReport` (per-file findings, summary counts, prioritized recommendations, metadata).
4. **Validate** – the SDK is asked for structured output using a JSON Schema generated from the Zod schema, and the result is checked again with `safeParse`. Timing metadata (`analyzedAt`, `duration`) is measured by the code, not by the model.
5. **Report** – the CLI writes JSON, Markdown, and HTML files to `reports/`.

### The subagents

| Agent | Looks for | Tools (least privilege) |
|---|---|---|
| `code-quality-analyzer` | Security issues, performance problems, bug risks, maintainability | `Read`, `Grep`, `Glob`, `Skill`, GitHub file contents, ESLint MCP |
| `test-coverage-analyzer` | Related test files, untested functions/branches/edge cases, concrete test suggestions (estimates coverage without running tests) | `Read`, `Grep`, `Glob`, GitHub file contents |
| `refactoring-suggester` | Extract-function, rename, modernize, simplify, design-pattern improvements, with before/after code | `Read`, `Grep`, `Glob`, GitHub file contents |

The code-quality agent invokes Claude Skills from `.claude/skills/` by file type: `typescript-patterns` for `.ts/.tsx`, `javascript-best-practices` for `.js/.jsx`, and `security-analysis` for every file.

### MCP servers

| Server | Package | Auth |
|---|---|---|
| GitHub | `@modelcontextprotocol/server-github` | `GITHUB_TOKEN` (mapped to `GITHUB_PERSONAL_ACCESS_TOKEN`), optional for public repos |
| ESLint | `@eslint/mcp` | none |

Both are launched on demand with `npx`; on Windows the command is wrapped in `cmd /c`.

### Production features

- **Retry with exponential backoff and jitter** (`withRetry`) – used by the CLI for transient failures such as invalid structured output or a timeout. Credential and configuration errors are not retried.
- **Timeout** (`withTimeout`, `Promise.race`) – each review is limited to 15 minutes, and the SDK session is aborted when it expires.
- **Rate limiter** – sliding 60-second window tracking requests and tokens plus a concurrency limit; the orchestrator acquires a slot before every review and always releases it.
- **Fail-fast API errors** – an invalid key or similar API error stops the run immediately instead of burning every agent turn.
- **Structured logging** (Winston) – to the console and to `logs/`.
- **Read-only by design** – the orchestrator only allows read tools (`Task`, `Skill`, `Read`, `Grep`, `Glob`, GitHub and ESLint MCP) and runs with `permissionMode: 'dontAsk'`, so anything not on the allow-list is denied rather than prompted.

## Project structure

```
src/
├── agents/          Three subagent definitions (AgentDefinition) + index
├── prompts/         Orchestrator and subagent prompts + index
├── config/          mcp.config.ts – GitHub and ESLint MCP servers
├── types/           Zod schemas and JSON Schemas for all result types
├── utils/           error-handler, rate-limiter, logger, report-generator
├── orchestrator.ts  CodeReviewOrchestrator – runs the review
└── main.ts          CLI entry point (validation, retry, report output)
tests/               Vitest unit tests (schemas, utilities, orchestrator)
.claude/skills/      typescript-patterns, javascript-best-practices, security-analysis
reports/             Generated PR reports
```

## Setup

**Prerequisites:** Node.js 18+, and either an [Anthropic API key](https://console.anthropic.com/) or AWS Bedrock credentials. A [GitHub token](https://github.com/settings/tokens) is optional for public repositories but gives higher rate limits.

```bash
git clone https://github.com/udacity/cd14715-claude-code-classroom.git
cd cd14715-claude-code-classroom/project/starter
npm install
cp .env.example .env     # then edit .env (see below)
```

### Configuration (`.env`)

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | one auth method | Your Anthropic API key |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | one auth method | Alternative: AWS Bedrock (all three required) |
| `ANTHROPIC_MODEL` | yes | `claude-sonnet-4-5-20250929` (Anthropic API) or `us.anthropic.claude-sonnet-4-5-20250929-v1:0` (Bedrock) |
| `PROJECT_ROOT` | yes | Absolute path to this `project/starter` directory; it must contain `.claude/skills/` |
| `GITHUB_TOKEN` | no | Higher GitHub rate limits, private repos |
| `ANTHROPIC_BASE_URL` | no | Only for a proxy. **Leave unset when using your own Anthropic key** |
| `LOG_LEVEL` | no | `error`, `warn`, `info` (default), `debug` |

Never commit `.env`; it is git-ignored.

**In the Vocareum workspace:** `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` are already set in the environment, so don't add them to `.env`. Set `PROJECT_ROOT=/voc/work/cd14715-claude-code-classroom/project/starter`. Vocareum keys may only be accepted from inside the workspace; when running on your own machine use your own Anthropic key and leave `ANTHROPIC_BASE_URL` unset.

## Usage

```bash
# Development (runs TypeScript directly)
npm run dev -- <owner> <repo> <pr-number>

# Production build
npm run build
npm start <owner> <repo> <pr-number>
```

Example – the three pull requests used for the project deliverables:

```bash
npm run dev -- udacity cd14715-simple-todo-app 1
npm run dev -- udacity cd14715-simple-todo-app 2
npm run dev -- udacity cd14715-simple-todo-app 3
```

A review takes several minutes (real model calls through the orchestrator and three subagents per file) and uses API credits. Run one PR at a time.

### Output

Each run writes three files to `reports/`:

```
reports/udacity_cd14715-simple-todo-app_1.json   machine-readable ReviewReport
reports/udacity_cd14715-simple-todo-app_1.md     readable summary, e.g. for a PR comment
reports/udacity_cd14715-simple-todo-app_1.html   open in a browser
```

The report contains, per file: code-quality issues (line, severity, category, description, suggestion) with a 0–100 score; test-coverage gaps with concrete suggested tests and a coverage estimate; and refactoring suggestions with before/after code. It also has summary counts, prioritized recommendations, and run metadata.

### Errors

Problems are reported as a short message with a hint instead of a stack trace, for example a missing argument, a PR number that is not a positive integer, no credentials configured, or a missing `ANTHROPIC_MODEL`. Full details are written to `logs/`; run with `LOG_LEVEL=debug` to see more on screen.

## Testing

```bash
npm test                          # all unit tests
npm test -- --reporter=verbose    # per-test output
npm test -- schemas.test.ts       # one file
npm run build                     # type-check and compile
```

| File | Covers |
|---|---|
| `tests/schemas.test.ts` | Zod schemas: valid and invalid data, boundary scores, JSON Schema export |
| `tests/utils.test.ts` | `withRetry`, `withTimeout`, rate limiter sliding window and queueing |
| `tests/orchestrator.test.ts` | Orchestrator with a mocked SDK: options, validation, failure paths, timeout, rate-limiter release |

The tests mock the Claude Agent SDK, so they need no API key and make no network calls. A real end-to-end review is run manually with `npm run dev`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `API Error: 400 ... This key was not found` | Invalid or expired key, or a Vocareum key used outside Vocareum. Use your own key and unset `ANTHROPIC_BASE_URL`. |
| An MCP server shows `failed` on the first run | `npx` was still downloading the package. Run again. |
| Subagents never run | `Task` must be in `allowedTools`, and agent names must match between the prompt and the `agents` map. |
| `Review failed: error_max_turns` | The PR has many files. Raise `maxTurns` in `OrchestratorOptions` (default 100). |
| Skills not found | `PROJECT_ROOT` must point at the directory that contains `.claude/skills/`. |

## Key technologies

Claude Agent SDK · Model Context Protocol · Zod · TypeScript · Vitest · Winston
