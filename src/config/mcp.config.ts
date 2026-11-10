/**
 * Model Context Protocol (MCP) server configurations
 *
 * Required MCP Servers:
 * 1. GitHub - For PR/repo operations
 * 2. ESLint - For code linting and style analysis
 *
 * Documentation:
 * - MCP Protocol: https://modelcontextprotocol.io
 * - GitHub MCP: https://github.com/github/github-mcp-server
 * - ESLint MCP: https://eslint.org/docs/latest/use/mcp
 */

/**
 * Build the command/args pair used to run an npm package with npx.
 * On Windows, `npx` is a .cmd shim that cannot be spawned directly,
 * so it is launched through `cmd /c`.
 */
function npx(...args: string[]): { command: string; args: string[] } {
  return process.platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', ...args] }
    : { command: 'npx', args };
}

export const mcpServersConfig = {
  /**
   * GitHub MCP Server
   * Provides tools for GitHub API operations (PRs, files, repos).
   *
   * Note: GITHUB_TOKEN is optional (recommended for private repos and higher rate limits).
   * The GitHub MCP server expects GITHUB_PERSONAL_ACCESS_TOKEN as the env var name,
   * so we map our GITHUB_TOKEN from .env to that name. No secrets live in source.
   */
  github: {
    type: 'stdio' as const,
    ...npx('-y', '@modelcontextprotocol/server-github'),
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || ''
    }
  },

  /**
   * ESLint MCP Server
   * Provides tools for linting and code quality analysis. No authentication required.
   */
  eslint: {
    type: 'stdio' as const,
    ...npx('-y', '@eslint/mcp@latest'),
    env: {}
  }
};
