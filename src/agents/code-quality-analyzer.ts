import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/index.js';

/**
 * Code Quality Analyzer
 * Finds security, performance, and maintainability issues in a single file.
 * Includes the Skill tool so it can invoke javascript-best-practices,
 * typescript-patterns, and security-analysis.
 */
export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Use this agent to analyze a single source file for security vulnerabilities, performance problems, ' +
    'bug risks, and maintainability issues. Returns line-specific issues with severity, category, and fix ' +
    'suggestions, plus an overall quality score. Invoke once per changed file in a pull request.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: [
    'Read',
    'Grep',
    'Glob',
    'Skill',
    'mcp__github__get_file_contents',
    'mcp__eslint__*'
  ],
  model: 'inherit'
};
