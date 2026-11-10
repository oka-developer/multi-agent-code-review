import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/index.js';

/**
 * Test Coverage Analyzer
 * Estimates coverage by comparing a source file with its test files (no test execution)
 * and proposes specific, actionable test cases.
 */
export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Use this agent to evaluate test completeness for a single source file. It locates related test files, ' +
    'identifies untested functions, branches, and edge cases, estimates coverage, and suggests concrete test ' +
    'cases. Invoke once per changed file in a pull request.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'mcp__github__get_file_contents'],
  model: 'inherit'
};
