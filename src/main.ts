// Must be the first import: loads .env before other modules (mcp.config, logger)
// read process.env at import time.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CodeReviewOrchestrator } from './orchestrator.js';
import {
  ReportGenerator,
  ReviewError,
  ErrorCodes,
  withRetry,
  formatError,
  isReviewError,
  logger
} from './utils/index.js';

const REPORTS_DIR = 'reports';

/** Print a message to stderr and exit with failure. */
function fail(...lines: string[]): never {
  for (const line of lines) console.error(line);
  process.exit(1);
}

/**
 * Validate command-line arguments.
 * process.argv = ['node', 'main.ts', owner, repo, prNumber]
 */
function parseArgs(argv: string[]): { owner: string; repo: string; prNumber: number } {
  const [owner, repo, prStr] = argv;

  if (!owner || !repo || !prStr) {
    fail(
      '❌ Missing arguments.',
      'Usage: npm run dev -- <owner> <repo> <pr-number>',
      'Example: npm run dev -- octocat Hello-World 1'
    );
  }

  // parseInt alone would accept "12abc" as 12, so check the whole string
  const prNumber = /^\d+$/.test(prStr) ? parseInt(prStr, 10) : NaN;
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    fail(`❌ Invalid PR number "${prStr}". It must be a positive integer (e.g. 1).`);
  }

  return { owner, repo, prNumber };
}

/** Validate that exactly one supported authentication method is configured. */
function validateAuth(): void {
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasAwsKeys = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

  if (hasAnthropicKey) {
    console.log('🔐 Using Anthropic API authentication');
    return;
  }

  if (hasAwsKeys) {
    if (!process.env.AWS_REGION) {
      fail(
        '❌ AWS credentials found but AWS_REGION is not set.',
        '   Set AWS_REGION (e.g. us-east-1) in your .env file.'
      );
    }
    // Tell the Claude Agent SDK to route requests through AWS Bedrock
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    console.log('🔐 Using AWS Bedrock authentication');
    return;
  }

  fail(
    '❌ No authentication configured. Set ONE of the following in your .env file:',
    '   Option 1 (Anthropic API):  ANTHROPIC_API_KEY=sk-ant-...',
    '   Option 2 (AWS Bedrock):    AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...  AWS_REGION=us-east-1'
  );
}

/** ANTHROPIC_MODEL is required for both authentication methods. */
function validateModel(): void {
  if (!process.env.ANTHROPIC_MODEL) {
    fail(
      '❌ ANTHROPIC_MODEL is not set. Add it to your .env file:',
      '   Anthropic API:  ANTHROPIC_MODEL=claude-sonnet-4-5-20250929',
      '   AWS Bedrock:    ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0'
    );
  }
}

/** Only retry failures that a second attempt can plausibly fix. */
function isRetryable(error: unknown): boolean {
  return (
    isReviewError(error) &&
    (
      [
        ErrorCodes.VALIDATION_FAILED,
        ErrorCodes.STRUCTURED_OUTPUT_FAILED,
        ErrorCodes.AGENT_TIMEOUT,
        ErrorCodes.GITHUB_API_ERROR,
        ErrorCodes.RATE_LIMITED
      ] as string[]
    ).includes(error.code)
  );
}

/** Short, actionable hint for common failure codes. */
function hintFor(error: unknown): string | undefined {
  if (!isReviewError(error)) return undefined;
  switch (error.code) {
    case ErrorCodes.MISSING_API_KEY:
      return 'Check that ANTHROPIC_API_KEY in .env is valid (and ANTHROPIC_BASE_URL is unset unless you use a proxy).';
    case ErrorCodes.INVALID_CONFIG:
      return 'Check the values in your .env file.';
    case ErrorCodes.AGENT_TIMEOUT:
      return 'The review took too long. Try again, or review a smaller PR.';
    case ErrorCodes.RETRY_EXHAUSTED:
    case ErrorCodes.VALIDATION_FAILED:
    case ErrorCodes.STRUCTURED_OUTPUT_FAILED:
      return 'The model did not return a valid report. Run again with LOG_LEVEL=debug for details.';
    default:
      return undefined;
  }
}

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev -- <owner> <repo> <pr-number>
 */
async function main(): Promise<void> {
  const { owner, repo, prNumber } = parseArgs(process.argv.slice(2));
  validateAuth();
  validateModel();

  console.log(`🔍 Reviewing ${owner}/${repo}#${prNumber} (this can take several minutes)...`);

  const orchestrator = new CodeReviewOrchestrator();
  const report = await withRetry(
    () => orchestrator.reviewPullRequest(owner, repo, prNumber),
    3,
    2000,
    isRetryable
  );

  // Generate all three report formats
  const generator = new ReportGenerator();
  const baseName = `${owner}_${repo}_${prNumber}`;
  const outputs: Array<[string, string]> = [
    ['json', generator.generateJSONReport(report)],
    ['md', generator.generateMarkdownReport(report)],
    ['html', generator.generateHTMLReport(report)]
  ];

  mkdirSync(REPORTS_DIR, { recursive: true });
  for (const [ext, content] of outputs) {
    const filePath = path.join(REPORTS_DIR, `${baseName}.${ext}`);
    writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Saved ${ext.toUpperCase()} report: ${filePath}`);
  }

  const { summary } = report;
  console.log(
    `📊 Score ${summary.overallScore}/100 · ${summary.totalFiles} file(s) · ` +
      `${summary.criticalIssues} critical issue(s) · ` +
      `${summary.highPriorityTests} high-priority test gap(s) · ` +
      `${summary.refactoringOpportunities} refactoring suggestion(s)`
  );
}

main().catch((error: unknown) => {
  // User-facing message only; full details (incl. stack) go to the log file
  logger.error('Review failed', {
    error: formatError(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  console.error(`\n❌ ${formatError(error)}`);
  const hint = hintFor(error);
  if (hint) console.error(`   ${hint}`);
  if (error instanceof ReviewError && process.env.LOG_LEVEL === 'debug' && error.metadata) {
    console.error('   Details:', JSON.stringify(error.metadata, null, 2));
  }
  process.exit(1);
});
