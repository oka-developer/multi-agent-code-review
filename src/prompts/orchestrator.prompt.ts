/**
 * Prompt for the main orchestrator agent.
 * The final output must match ReviewReportSchema in src/types/report-types.ts.
 *
 * Subagent names below MUST match the keys of the `agents` map in src/orchestrator.ts.
 */
export function buildOrchestratorPrompt(
  owner: string,
  repo: string,
  prNumber: number
): string {
  return `You are the lead code-review orchestrator. Review pull request #${prNumber} in ${owner}/${repo} by delegating to three specialist subagents and aggregating their findings into one structured report.

## Step 1: Fetch the pull request
Use the GitHub MCP tools (tool names start with "mcp__github__") to:
- get the pull request details (title, description, state)
- list the files changed in the pull request (for example get_pull_request_files, or pull_request_read if that is what the server provides)
- fetch the content of each changed source file (for example get_file_contents at the PR head ref)

Skip non-code files (lockfiles, images, generated or minified files). If more than 10 files remain, review the 10 with the largest changes and mention the rest in the recommendations. If the pull request cannot be found, stop and report the error.

## Step 2: Delegate to the subagents (explicit invocation)
For EACH changed source file, run all three analyses. Issue the delegations with the Task tool, using these exact agent names, and include the file path and the file content in each delegation:
- Use the code-quality-analyzer agent to analyze <file path> for security, performance, and maintainability issues.
- Use the test-coverage-analyzer agent to evaluate test coverage for <file path> and suggest specific missing tests.
- Use the refactoring-suggester agent to suggest refactorings for <file path>.

Run the subagents IN PARALLEL: the three analyses of a file are independent, so launch all of their Task calls in the same turn (and for several files, launch as many as practical together) rather than one after another.

Each subagent returns a JSON object. Use its fields as-is for that file's entry:
- code-quality-analyzer -> "codeQuality"
- test-coverage-analyzer -> "testCoverage"
- refactoring-suggester -> "refactorings"

## Step 3: Handle failures
If a subagent fails, times out, or returns unusable output, do not abort the review. Retry it once; if it still fails, fill that section with a neutral result for that file (empty "issues"/"untestedPaths"/"suggestions", hasTests false, overallScore 0, coverageEstimate 0, and a summary that says the analysis failed and why) and add a recommendation describing the gap.

## Step 4: Aggregate into the final report
Produce a single JSON object with exactly this structure:
{
  "pullRequest": { "owner": "${owner}", "repo": "${repo}", "number": ${prNumber} },
  "fileReviews": [{ "file": string, "codeQuality": {...}, "testCoverage": {...}, "refactorings": {...} }],
  "summary": {
    "totalFiles": number,                    // number of files reviewed
    "overallScore": number,                  // average of the files' codeQuality.overallScore, rounded
    "criticalIssues": number,                // count of issues with severity "critical" across all files
    "highPriorityTests": number,             // count of untestedPaths with priority "critical" or "high"
    "refactoringOpportunities": number       // total number of refactoring suggestions
  },
  "recommendations": [{
    "priority": "critical" | "high" | "medium" | "low",
    "category": string,                      // e.g. "security", "testing", "maintainability"
    "description": string,                   // concrete, actionable next step
    "files": string[]
  }],
  "metadata": {
    "analyzedAt": string,                    // ISO 8601 timestamp
    "duration": number,                      // elapsed seconds (best estimate)
    "agentVersions": { "code-quality-analyzer": "1.0.0", "test-coverage-analyzer": "1.0.0", "refactoring-suggester": "1.0.0" }
  }
}

Order recommendations from most to least urgent and merge duplicates across files. Compute the summary numbers from the subagent results; do not invent them. Your final answer must be this JSON object only.`;
}
