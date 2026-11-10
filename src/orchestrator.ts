import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  ReviewReportSchema,
  ReviewReportJSONSchema,
  type ReviewReport
} from './types/report-types.js';
import {
  codeQualityAnalyzer,
  testCoverageAnalyzer,
  refactoringSuggester
} from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import { mcpServersConfig } from './config/mcp.config.js';
import { ReviewError, ErrorCodes, withTimeout } from './utils/error-handler.js';
import { RateLimiter, type RateLimiterConfig } from './utils/rate-limiter.js';
import {
  logger,
  logReviewStart,
  logReviewComplete,
  logReviewError
} from './utils/logger.js';

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  /** Model ID. Defaults to process.env.ANTHROPIC_MODEL (never hardcoded). */
  model?: string;
  /** Maximum agent turns for multi-agent coordination. Default: 100 */
  maxTurns?: number;
  /** Directory containing .claude/skills/. Defaults to process.env.PROJECT_ROOT. */
  projectRoot?: string;
  /** Custom rate limits (merged over DEFAULT_RATE_LIMITS). */
  rateLimit?: Partial<RateLimiterConfig>;
  /** Overall time limit for one review in milliseconds. Default: 15 minutes */
  timeoutMs?: number;
}

// Multi-file PRs need many turns: 3 subagents per file plus GitHub fetches
const DEFAULT_MAX_TURNS = 100;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Tools the orchestrator (and, via inheritance rules, its subagents) may use without prompting.
 * 'Task' is required for the orchestrator to spawn subagents.
 * Reviewer is read-only: no Write/Edit/Bash.
 */
const BUILTIN_TOOLS = ['Task', 'Skill', 'Read', 'Grep', 'Glob'];
const ALLOWED_TOOLS = [...BUILTIN_TOOLS, 'mcp__github__*', 'mcp__eslint__*'];

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private readonly model: string | undefined;
  private readonly maxTurns: number;
  private readonly projectRoot: string | undefined;
  private readonly timeoutMs: number;
  private readonly rateLimiter: RateLimiter;

  constructor(options: OrchestratorOptions = {}) {
    this.model = options.model ?? process.env.ANTHROPIC_MODEL;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.projectRoot = options.projectRoot ?? process.env.PROJECT_ROOT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.rateLimiter = new RateLimiter(options.rateLimit);
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    if (!this.model) {
      throw new ReviewError(
        'ANTHROPIC_MODEL is not set. Set it in .env (e.g. claude-sonnet-4-5-20250929).',
        ErrorCodes.INVALID_CONFIG
      );
    }

    const startedAt = Date.now();
    logReviewStart(owner, repo, prNumber);

    const abortController = new AbortController();
    await this.rateLimiter.acquire();

    try {
      const structuredOutput = await withTimeout(
        () => this.runQuery(owner, repo, prNumber, this.model as string, abortController),
        this.timeoutMs,
        `Review of ${owner}/${repo}#${prNumber} timed out after ${this.timeoutMs / 1000}s`
      );

      // Validate against the Zod schema (safeParse so we can report issues cleanly)
      const parsed = ReviewReportSchema.safeParse(structuredOutput);
      if (!parsed.success) {
        throw new ReviewError(
          'Structured output did not match ReviewReportSchema',
          ErrorCodes.VALIDATION_FAILED,
          { issues: parsed.error.issues }
        );
      }

      // A report with no reviewed files means the analysis did not really happen
      // (e.g. the PR could not be fetched). Treat it as a failure, not a result.
      if (parsed.data.fileReviews.length === 0) {
        throw new ReviewError(
          'The review contains no file reviews; the pull request files could not be analyzed',
          ErrorCodes.VALIDATION_FAILED,
          { recommendations: parsed.data.recommendations }
        );
      }

      // Timing metadata is measured here, not model-generated (the model can't know it)
      const duration = (Date.now() - startedAt) / 1000;
      const report: ReviewReport = {
        ...parsed.data,
        metadata: {
          ...parsed.data.metadata,
          analyzedAt: new Date().toISOString(),
          duration
        }
      };

      logReviewComplete(owner, repo, prNumber, report.summary.overallScore, duration);
      return report;
    } catch (error) {
      // Stop the SDK session if we're bailing out (timeout, validation failure, ...)
      abortController.abort();
      logReviewError(
        owner,
        repo,
        prNumber,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    } finally {
      this.rateLimiter.release();
    }
  }

  /**
   * Run the SDK query and return the raw structured output of the final result message.
   */
  private async runQuery(
    owner: string,
    repo: string,
    prNumber: number,
    model: string,
    abortController: AbortController
  ): Promise<unknown> {
    const result = query({
      prompt: buildOrchestratorPrompt(owner, repo, prNumber),
      options: {
        model,
        cwd: this.projectRoot,
        abortController,
        // Load .claude/skills/ from the project so the Skill tool can find them
        settingSources: ['project'],
        // Register the three subagents; keys must match the names used in the orchestrator prompt
        agents: {
          'code-quality-analyzer': codeQualityAnalyzer,
          'test-coverage-analyzer': testCoverageAnalyzer,
          'refactoring-suggester': refactoringSuggester
        },
        mcpServers: mcpServersConfig,
        // Restrict the built-in tools to the read-only set (allowedTools alone only
        // auto-approves; without this the model could still attempt Bash/Write/WebFetch)
        tools: BUILTIN_TOOLS,
        allowedTools: ALLOWED_TOOLS,
        // Non-interactive (CI-friendly): anything not in allowedTools is denied, never prompted
        permissionMode: 'dontAsk',
        maxTurns: this.maxTurns,
        // Structured output: JSON Schema derived from the Zod ReviewReportSchema
        outputFormat: {
          type: 'json_schema',
          schema: ReviewReportJSONSchema
        }
      }
    });

    let structuredOutput: unknown;

    for await (const message of result) {
      if (message.type === 'system' && message.subtype === 'init') {
        logger.info('Agent session initialized', {
          mcpServers: message.mcp_servers,
          skills: message.skills,
          agents: message.agents
        });

        // Without the GitHub server the model cannot fetch the PR and just flails until it
        // times out (it happens intermittently when an npx start-up is slow). Fail fast so
        // the caller can retry.
        const github = message.mcp_servers.find(server => server.name === 'github');
        if (!github || github.status !== 'connected') {
          throw new ReviewError(
            `GitHub MCP server is not connected (status: ${github?.status ?? 'missing'})`,
            ErrorCodes.GITHUB_API_ERROR,
            { mcpServers: message.mcp_servers }
          );
        }
        continue;
      }

      if (message.type === 'assistant') {
        // The SDK reports failed API calls (bad key, wrong model, ...) as synthetic
        // assistant messages and keeps retrying. Fail fast instead of burning all turns.
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text.startsWith('API Error')) {
            throw new ReviewError(
              block.text,
              /\b(401|403)\b|key|auth/i.test(block.text)
                ? ErrorCodes.MISSING_API_KEY
                : ErrorCodes.AGENT_FAILED
            );
          }
        }

        // Trace tool calls (shows subagent delegation and parallelism)
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            logger.info('Tool call', {
              tool: block.name,
              subagent: block.name === 'Task'
                ? (block.input as { subagent_type?: string }).subagent_type
                : undefined,
              insideSubagent: message.parent_tool_use_id !== null
            });
          }
        }
        continue;
      }

      if (message.type !== 'result') continue;

      if (message.subtype !== 'success') {
        throw new ReviewError(
          `Review failed: ${message.subtype}`,
          message.subtype === 'error_max_structured_output_retries'
            ? ErrorCodes.STRUCTURED_OUTPUT_FAILED
            : ErrorCodes.AGENT_FAILED,
          { subtype: message.subtype, errors: message.errors }
        );
      }

      structuredOutput = message.structured_output;
    }

    if (structuredOutput === undefined) {
      throw new ReviewError(
        'Agent finished without returning structured output',
        ErrorCodes.STRUCTURED_OUTPUT_FAILED
      );
    }

    return structuredOutput;
  }
}
