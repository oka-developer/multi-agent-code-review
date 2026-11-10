import type {
  CodeQualityResult,
  TestCoverageResult,
  RefactoringSuggestion,
  ReviewReport
} from '../src/types/index.js';

/** Valid sample data shared by the test files. Each call returns a fresh copy. */
export const validCodeQuality = (): CodeQualityResult => ({
  file: 'src/app.ts',
  issues: [
    {
      line: 42,
      severity: 'high',
      category: 'security',
      description: 'User input is concatenated into a SQL string.',
      suggestion: 'Use a parameterized query.'
    }
  ],
  overallScore: 72,
  summary: 'One high-severity security issue.'
});

export const validTestCoverage = (): TestCoverageResult => ({
  file: 'src/app.ts',
  hasTests: true,
  testFiles: ['tests/app.test.ts'],
  untestedPaths: [
    {
      type: 'function',
      location: 'parseConfig (line 24)',
      priority: 'high',
      reasoning: 'Core configuration logic has no assertions.',
      suggestedTest: "Call parseConfig('') and expect it to throw ConfigError."
    }
  ],
  coverageEstimate: 60,
  summary: 'Moderate coverage; config parsing is untested.'
});

export const validRefactoring = (): RefactoringSuggestion => ({
  file: 'src/app.ts',
  suggestions: [
    {
      type: 'modernize',
      location: 'fetchData (lines 10-30)',
      impact: 'medium',
      description: 'Replace promise chains with async/await.',
      before: 'fetch(url).then(r => r.json())',
      after: 'const r = await fetch(url); return r.json();',
      benefits: 'Flatter control flow and simpler error handling.'
    }
  ],
  summary: 'One modernization opportunity.'
});

export const validReport = (): ReviewReport => ({
  pullRequest: { owner: 'octocat', repo: 'Hello-World', number: 1 },
  fileReviews: [
    {
      file: 'src/app.ts',
      codeQuality: validCodeQuality(),
      testCoverage: validTestCoverage(),
      refactorings: validRefactoring()
    }
  ],
  summary: {
    totalFiles: 1,
    overallScore: 72,
    criticalIssues: 0,
    highPriorityTests: 1,
    refactoringOpportunities: 1
  },
  recommendations: [
    {
      priority: 'high',
      category: 'security',
      description: 'Parameterize the SQL query in src/app.ts.',
      files: ['src/app.ts']
    }
  ],
  metadata: {
    analyzedAt: '2000-01-01T00:00:00.000Z',
    duration: 3,
    agentVersions: {
      'code-quality-analyzer': '1.0.0',
      'test-coverage-analyzer': '1.0.0',
      'refactoring-suggester': '1.0.0'
    }
  }
});
