import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Claude Agent SDK so no real API/MCP calls are made
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { CodeReviewOrchestrator } from '../src/orchestrator.js';
import { ErrorCodes } from '../src/utils/error-handler.js';
import { validReport } from './fixtures.js';

const mockedQuery = vi.mocked(query);

/** Build a fake SDK message stream (async generator) from a list of messages. */
function fakeStream(messages: unknown[]) {
  return (async function* () {
    for (const message of messages) yield message;
  })() as unknown as ReturnType<typeof query>;
}

const initMessage = {
  type: 'system',
  subtype: 'init',
  mcp_servers: [
    { name: 'github', status: 'connected' },
    { name: 'eslint', status: 'connected' }
  ],
  skills: ['javascript-best-practices'],
  agents: ['code-quality-analyzer', 'test-coverage-analyzer', 'refactoring-suggester']
};

const taskCall = (subagent: string) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: {
    content: [{ type: 'tool_use', name: 'Task', input: { subagent_type: subagent } }]
  }
});

const successResult = (structured_output: unknown) => ({
  type: 'result',
  subtype: 'success',
  structured_output
});

/** Options object the orchestrator passed to the mocked query() on its first call. */
const queryOptions = () => mockedQuery.mock.calls[0]![0].options!;

describe('CodeReviewOrchestrator', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  describe('Configuration', () => {
    it('should initialize with default options', () => {
      expect(() => new CodeReviewOrchestrator({ model: 'test-model' })).not.toThrow();
    });

    it('should accept custom rate limit configuration', () => {
      const orchestrator = new CodeReviewOrchestrator({
        model: 'test-model',
        rateLimit: { maxRequestsPerMinute: 7 }
      });
      const limiter = (orchestrator as unknown as {
        rateLimiter: { getStatus(): { availableRequests: number } };
      }).rateLimiter;
      expect(limiter.getStatus().availableRequests).toBe(7);
    });

    it('should fail clearly when no model is configured', async () => {
      const saved = process.env.ANTHROPIC_MODEL;
      delete process.env.ANTHROPIC_MODEL;
      try {
        const orchestrator = new CodeReviewOrchestrator();
        await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toMatchObject({
          code: ErrorCodes.INVALID_CONFIG
        });
        expect(mockedQuery).not.toHaveBeenCalled();
      } finally {
        if (saved !== undefined) process.env.ANTHROPIC_MODEL = saved;
      }
    });
  });

  describe('reviewPullRequest', () => {
    it('should fetch PR files from GitHub MCP', async () => {
      mockedQuery.mockReturnValue(fakeStream([initMessage, successResult(validReport())]));
      await new CodeReviewOrchestrator({ model: 'test-model' }).reviewPullRequest(
        'octocat',
        'Hello-World',
        1
      );

      const options = queryOptions();
      expect(options.mcpServers).toHaveProperty('github');
      expect(options.mcpServers).toHaveProperty('eslint');
      expect(options.allowedTools).toContain('mcp__github__*');
      // The prompt tells the orchestrator which PR to fetch
      expect(mockedQuery.mock.calls[0]![0].prompt).toContain('octocat/Hello-World');
      expect(mockedQuery.mock.calls[0]![0].prompt).toContain('#1');
    });

    it('should spawn all 3 subagents in parallel', async () => {
      mockedQuery.mockReturnValue(
        fakeStream([
          initMessage,
          taskCall('code-quality-analyzer'),
          taskCall('test-coverage-analyzer'),
          taskCall('refactoring-suggester'),
          successResult(validReport())
        ])
      );
      await new CodeReviewOrchestrator({ model: 'test-model' }).reviewPullRequest('o', 'r', 1);

      const options = queryOptions();
      // All three subagents registered, and Task is allowed so they can be spawned
      expect(Object.keys(options.agents!)).toEqual([
        'code-quality-analyzer',
        'test-coverage-analyzer',
        'refactoring-suggester'
      ]);
      expect(options.allowedTools).toContain('Task');
      // The prompt explicitly asks for parallel invocation of each agent
      const prompt = mockedQuery.mock.calls[0]![0].prompt as string;
      expect(prompt).toMatch(/Use the code-quality-analyzer agent/);
      expect(prompt).toMatch(/Use the test-coverage-analyzer agent/);
      expect(prompt).toMatch(/Use the refactoring-suggester agent/);
      expect(prompt).toMatch(/PARALLEL/i);
    });

    it('should aggregate results into ReviewReport', async () => {
      mockedQuery.mockReturnValue(fakeStream([initMessage, successResult(validReport())]));
      const report = await new CodeReviewOrchestrator({ model: 'test-model' }).reviewPullRequest(
        'octocat',
        'Hello-World',
        1
      );

      expect(report.pullRequest).toEqual({ owner: 'octocat', repo: 'Hello-World', number: 1 });
      expect(report.fileReviews).toHaveLength(1);
      expect(report.summary.totalFiles).toBe(1);
    });

    it('should replace model-generated timing metadata with real values', async () => {
      mockedQuery.mockReturnValue(fakeStream([initMessage, successResult(validReport())]));
      const before = Date.now();
      const report = await new CodeReviewOrchestrator({ model: 'test-model' }).reviewPullRequest(
        'o',
        'r',
        1
      );

      // Fixture says 2000-01-01 / 3s; the orchestrator must overwrite both
      expect(new Date(report.metadata.analyzedAt).getTime()).toBeGreaterThanOrEqual(before);
      expect(report.metadata.duration).toBeLessThan(5);
      expect(report.metadata.agentVersions).toHaveProperty('code-quality-analyzer');
    });

    it('should use the configured model and request structured JSON output', async () => {
      mockedQuery.mockReturnValue(fakeStream([initMessage, successResult(validReport())]));
      await new CodeReviewOrchestrator({ model: 'my-model' }).reviewPullRequest('o', 'r', 1);

      const options = queryOptions();
      expect(options.model).toBe('my-model');
      expect(options.outputFormat).toMatchObject({ type: 'json_schema' });
      expect(options.settingSources).toEqual(['project']);
    });

    it('should validate output with Zod schema', async () => {
      mockedQuery.mockReturnValue(
        fakeStream([initMessage, successResult({ not: 'a report' })])
      );
      await expect(
        new CodeReviewOrchestrator({ model: 'test-model' }).reviewPullRequest('o', 'r', 1)
      ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
    });

    it('should fail when the agent returns no structured output', async () => {
      mockedQuery.mockReturnValue(
        fakeStream([initMessage, { type: 'result', subtype: 'success' }])
      );
      await expect(
        new CodeReviewOrchestrator({ model: 'test-model' }).reviewPullRequest('o', 'r', 1)
      ).rejects.toMatchObject({ code: ErrorCodes.STRUCTURED_OUTPUT_FAILED });
    });

    it('should fail when the agent runs out of turns', async () => {
      mockedQuery.mockReturnValue(
        fakeStream([initMessage, { type: 'result', subtype: 'error_max_turns', errors: [] }])
      );
      await expect(
        new CodeReviewOrchestrator({ model: 'test-model' }).reviewPullRequest('o', 'r', 1)
      ).rejects.toMatchObject({ code: ErrorCodes.AGENT_FAILED });
    });

    it('should fail fast on an API error (e.g. invalid key)', async () => {
      mockedQuery.mockReturnValue(
        fakeStream([
          initMessage,
          {
            type: 'assistant',
            parent_tool_use_id: null,
            message: {
              content: [{ type: 'text', text: 'API Error: 400 This key was not found.' }]
            }
          }
        ])
      );
      await expect(
        new CodeReviewOrchestrator({ model: 'test-model' }).reviewPullRequest('o', 'r', 1)
      ).rejects.toMatchObject({ code: ErrorCodes.MISSING_API_KEY });
    });

    it('should fail fast when the GitHub MCP server is not connected', async () => {
      mockedQuery.mockReturnValue(
        fakeStream([
          {
            ...initMessage,
            mcp_servers: [
              { name: 'github', status: 'failed' },
              { name: 'eslint', status: 'connected' }
            ]
          },
          // Would be accepted if the init check did not stop the run first
          successResult(validReport())
        ])
      );
      await expect(
        new CodeReviewOrchestrator({ model: 'test-model' }).reviewPullRequest('o', 'r', 1)
      ).rejects.toMatchObject({ code: ErrorCodes.GITHUB_API_ERROR });
    });

    it('should reject a report that reviewed no files', async () => {
      const empty = {
        ...validReport(),
        fileReviews: [],
        summary: {
          totalFiles: 0,
          overallScore: 0,
          criticalIssues: 0,
          highPriorityTests: 0,
          refactoringOpportunities: 0
        }
      };
      mockedQuery.mockReturnValue(fakeStream([initMessage, successResult(empty)]));
      await expect(
        new CodeReviewOrchestrator({ model: 'test-model' }).reviewPullRequest('o', 'r', 1)
      ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
    });

    it('should restrict built-in tools to the read-only set', async () => {
      mockedQuery.mockReturnValue(fakeStream([initMessage, successResult(validReport())]));
      await new CodeReviewOrchestrator({ model: 'test-model' }).reviewPullRequest('o', 'r', 1);

      const tools = queryOptions().tools as string[];
      expect(tools).toEqual(expect.arrayContaining(['Task', 'Skill', 'Read', 'Grep', 'Glob']));
      for (const forbidden of ['Bash', 'Write', 'Edit', 'WebFetch']) {
        expect(tools).not.toContain(forbidden);
      }
    });

    it('should release the rate limiter slot even when the review fails', async () => {
      mockedQuery.mockReturnValue(
        fakeStream([initMessage, { type: 'result', subtype: 'error_max_turns', errors: [] }])
      );
      const orchestrator = new CodeReviewOrchestrator({ model: 'test-model' });
      await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toThrow();

      const limiter = (orchestrator as unknown as {
        rateLimiter: { getStatus(): { activeRequests: number } };
      }).rateLimiter;
      expect(limiter.getStatus().activeRequests).toBe(0);
    });

    it('should time out a review that takes too long', async () => {
      mockedQuery.mockReturnValue(
        (async function* () {
          yield initMessage;
          await new Promise(resolve => setTimeout(resolve, 1000)); // never finishes in time
        })() as unknown as ReturnType<typeof query>
      );
      await expect(
        new CodeReviewOrchestrator({ model: 'test-model', timeoutMs: 20 }).reviewPullRequest(
          'o',
          'r',
          1
        )
      ).rejects.toMatchObject({ code: ErrorCodes.AGENT_TIMEOUT });
    });
  });

  describe('Integration', () => {
    // These tests require actual API keys and should be skipped in CI
    it.skip('should review a real small PR', async () => {
      // Run manually with a valid key: npm run dev -- octocat Hello-World 1
    });
  });
});
