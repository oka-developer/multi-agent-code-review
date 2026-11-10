import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema,
  ReviewReportSchema,
  CodeQualityResultJSONSchema,
  TestCoverageResultJSONSchema,
  RefactoringSuggestionJSONSchema,
  ReviewReportJSONSchema
} from '../src/types/index.js';
import {
  validCodeQuality,
  validTestCoverage,
  validRefactoring,
  validReport
} from './fixtures.js';

describe('CodeQualityResultSchema', () => {
  it('accepts valid data', () => {
    expect(() => CodeQualityResultSchema.parse(validCodeQuality())).not.toThrow();
  });

  it('accepts an empty issues array', () => {
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality(), issues: [] })).not.toThrow();
  });

  it.each([0, 100])('accepts boundary score %i', score => {
    expect(() =>
      CodeQualityResultSchema.parse({ ...validCodeQuality(), overallScore: score })
    ).not.toThrow();
  });

  it.each([-1, 101])('rejects out-of-range score %i', score => {
    expect(() =>
      CodeQualityResultSchema.parse({ ...validCodeQuality(), overallScore: score })
    ).toThrow(ZodError);
  });

  it('rejects an invalid severity', () => {
    const data = validCodeQuality();
    (data.issues[0] as unknown as { severity: string }).severity = 'catastrophic';
    expect(() => CodeQualityResultSchema.parse(data)).toThrow(ZodError);
  });

  it('rejects an invalid category', () => {
    const data = validCodeQuality();
    (data.issues[0] as unknown as { category: string }).category = 'vibes';
    expect(() => CodeQualityResultSchema.parse(data)).toThrow(ZodError);
  });

  it('rejects a wrong field type', () => {
    expect(() =>
      CodeQualityResultSchema.parse({ ...validCodeQuality(), overallScore: '72' })
    ).toThrow(ZodError);
  });

  it('rejects a missing required field', () => {
    const { summary: _summary, ...withoutSummary } = validCodeQuality();
    expect(() => CodeQualityResultSchema.parse(withoutSummary)).toThrow(ZodError);
  });
});

describe('TestCoverageResultSchema', () => {
  it('accepts valid data', () => {
    expect(() => TestCoverageResultSchema.parse(validTestCoverage())).not.toThrow();
  });

  it('accepts no tests (empty arrays, 0% coverage)', () => {
    expect(() =>
      TestCoverageResultSchema.parse({
        ...validTestCoverage(),
        hasTests: false,
        testFiles: [],
        untestedPaths: [],
        coverageEstimate: 0
      })
    ).not.toThrow();
  });

  it('rejects coverage above 100', () => {
    expect(() =>
      TestCoverageResultSchema.parse({ ...validTestCoverage(), coverageEstimate: 101 })
    ).toThrow(ZodError);
  });

  it('rejects an invalid untested path type', () => {
    const data = validTestCoverage();
    (data.untestedPaths[0] as unknown as { type: string }).type = 'module';
    expect(() => TestCoverageResultSchema.parse(data)).toThrow(ZodError);
  });

  it('rejects an invalid priority', () => {
    const data = validTestCoverage();
    (data.untestedPaths[0] as unknown as { priority: string }).priority = 'info';
    expect(() => TestCoverageResultSchema.parse(data)).toThrow(ZodError);
  });

  it('rejects hasTests that is not a boolean', () => {
    expect(() =>
      TestCoverageResultSchema.parse({ ...validTestCoverage(), hasTests: 'yes' })
    ).toThrow(ZodError);
  });
});

describe('RefactoringSuggestionSchema', () => {
  it('accepts valid data', () => {
    expect(() => RefactoringSuggestionSchema.parse(validRefactoring())).not.toThrow();
  });

  it('accepts an empty suggestions array', () => {
    expect(() =>
      RefactoringSuggestionSchema.parse({ ...validRefactoring(), suggestions: [] })
    ).not.toThrow();
  });

  it('rejects an invalid refactoring type', () => {
    const data = validRefactoring();
    (data.suggestions[0] as unknown as { type: string }).type = 'rewrite-in-rust';
    expect(() => RefactoringSuggestionSchema.parse(data)).toThrow(ZodError);
  });

  it('rejects an invalid impact', () => {
    const data = validRefactoring();
    (data.suggestions[0] as unknown as { impact: string }).impact = 'critical';
    expect(() => RefactoringSuggestionSchema.parse(data)).toThrow(ZodError);
  });

  it('rejects a suggestion missing before/after', () => {
    const data = validRefactoring();
    delete (data.suggestions[0] as unknown as { before?: string }).before;
    expect(() => RefactoringSuggestionSchema.parse(data)).toThrow(ZodError);
  });
});

describe('ReviewReportSchema', () => {
  it('accepts a valid report', () => {
    expect(() => ReviewReportSchema.parse(validReport())).not.toThrow();
  });

  it('accepts a report with no file reviews or recommendations', () => {
    expect(() =>
      ReviewReportSchema.parse({ ...validReport(), fileReviews: [], recommendations: [] })
    ).not.toThrow();
  });

  it('accepts an empty agentVersions record', () => {
    const report = validReport();
    report.metadata.agentVersions = {};
    expect(() => ReviewReportSchema.parse(report)).not.toThrow();
  });

  it('rejects a report missing pullRequest', () => {
    const { pullRequest: _pr, ...rest } = validReport();
    expect(() => ReviewReportSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects a non-numeric PR number', () => {
    const report = validReport() as unknown as { pullRequest: { number: unknown } };
    report.pullRequest.number = '1';
    expect(() => ReviewReportSchema.parse(report)).toThrow(ZodError);
  });

  it('rejects an invalid nested file review', () => {
    const report = validReport();
    (report.fileReviews[0]!.codeQuality as unknown as { overallScore: number }).overallScore = 500;
    expect(() => ReviewReportSchema.parse(report)).toThrow(ZodError);
  });

  it('rejects an invalid recommendation priority', () => {
    const report = validReport();
    (report.recommendations[0] as unknown as { priority: string }).priority = 'urgent';
    expect(() => ReviewReportSchema.parse(report)).toThrow(ZodError);
  });

  it('safeParse reports failure instead of throwing', () => {
    const result = ReviewReportSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('JSON Schema export', () => {
  it('produces object schemas for every result type', () => {
    for (const schema of [
      CodeQualityResultJSONSchema,
      TestCoverageResultJSONSchema,
      RefactoringSuggestionJSONSchema,
      ReviewReportJSONSchema
    ]) {
      expect((schema as { type?: string }).type).toBe('object');
      expect((schema as { properties?: object }).properties).toBeDefined();
    }
  });

  it('marks the report properties as required', () => {
    const required = (ReviewReportJSONSchema as { required?: string[] }).required ?? [];
    expect(required).toEqual(
      expect.arrayContaining(['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata'])
    );
  });

  it('marks code-quality properties as required', () => {
    const required = (CodeQualityResultJSONSchema as { required?: string[] }).required ?? [];
    expect(required).toEqual(
      expect.arrayContaining(['file', 'issues', 'overallScore', 'summary'])
    );
  });

  it('exports plain JSON-serializable schemas', () => {
    expect(() => JSON.parse(JSON.stringify(ReviewReportJSONSchema))).not.toThrow();
  });
});
