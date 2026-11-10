import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/index.js';

/**
 * Refactoring Suggester
 * Identifies structural and clarity improvements (modernization, extraction,
 * simplification, design patterns). Does not look for defects - that is the
 * code-quality-analyzer's job.
 */
export const refactoringSuggester: AgentDefinition = {
  description:
    'Use this agent to find refactoring opportunities in a single source file: modernizing syntax, extracting ' +
    'functions, renaming unclear identifiers, simplifying logic, and applying better design patterns. Returns ' +
    'before/after examples with impact ratings. Invoke once per changed file in a pull request.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'mcp__github__get_file_contents'],
  model: 'inherit'
};
