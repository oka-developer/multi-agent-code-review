import { describe, it, expect } from 'vitest';
import {
  codeQualityAnalyzer,
  testCoverageAnalyzer,
  refactoringSuggester
} from '../src/agents/index.js';

const agents = {
  'code-quality-analyzer': codeQualityAnalyzer,
  'test-coverage-analyzer': testCoverageAnalyzer,
  'refactoring-suggester': refactoringSuggester
};

describe('subagent definitions', () => {
  describe.each(Object.entries(agents))('%s', (_name, agent) => {
    it('has a description the orchestrator can use to delegate', () => {
      expect(agent.description.length).toBeGreaterThan(50);
    });

    it('has a prompt', () => {
      expect(agent.prompt.length).toBeGreaterThan(200);
    });

    it('inherits the orchestrator model', () => {
      expect(agent.model).toBe('inherit');
    });

    it('can invoke Claude Skills', () => {
      expect(agent.tools).toContain('Skill');
    });

    it('is read-only (no write or shell tools)', () => {
      for (const forbidden of ['Bash', 'Write', 'Edit', 'WebFetch']) {
        expect(agent.tools).not.toContain(forbidden);
      }
    });

    it('mentions the Skill tool in its prompt so it knows when to use it', () => {
      expect(agent.prompt).toMatch(/skill/i);
    });
  });

  it('only the code-quality agent is wired to the ESLint MCP server', () => {
    expect(codeQualityAnalyzer.tools).toContain('mcp__eslint__*');
    expect(testCoverageAnalyzer.tools).not.toContain('mcp__eslint__*');
    expect(refactoringSuggester.tools).not.toContain('mcp__eslint__*');
  });
});
