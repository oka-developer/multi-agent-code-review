# 🔍 Code Review Report

## Summary

| Metric | Value |
|--------|-------|
| **Overall Score** | 25/100 |
| **Files Reviewed** | 1 |
| **Critical Issues** | 3 |
| **High Priority Tests** | 14 |
| **Refactoring Opportunities** | 8 |

## 🎯 Top Recommendations

1. 🚨 **security**: Fix SQL injection vulnerabilities in searchTodos(), searchTodosByStatus(), and getTodosByUser() by replacing string concatenation/interpolation with parameterized queries. These vulnerabilities allow attackers to execute arbitrary SQL commands and compromise the entire database.
   - Files: src/todo.ts

2. 🚨 **testing**: Add comprehensive security tests for the three new search functions with malicious inputs (e.g., SQL injection payloads like "'; DROP TABLE todos; --") to verify parameterized queries are used and injection attacks are prevented.
   - Files: src/todo.ts

3. ⚠️ **security**: Replace weak ID generation using Math.random() and Date.now() with cryptographically secure alternatives (e.g., crypto.randomUUID() or crypto.randomBytes()) to prevent IDOR vulnerabilities through ID prediction.
   - Files: src/todo.ts

4. ⚠️ **testing**: Create unit tests for all core business logic functions (validateTodoInput, sanitizeInput, createTodo, getAllTodos, getTodoById, updateTodoStatus, deleteTodo) covering happy paths, edge cases, and error conditions. Current test coverage is 0%.
   - Files: src/todo.ts

5. ⚠️ **maintainability**: Refactor database operations into a TodoRepository class and business logic into a TodoService class to enable dependency injection, improve testability, and follow separation of concerns principles.
   - Files: src/todo.ts

## 📁 File Details

### 📄 `src/todo.ts`

**Quality Score:** 25/100 | **Coverage:** ~0%

#### Issues (13)
  - Line 119: `critical` SQL injection vulnerability: User-supplied 'keyword' is directly interpolated into the SQL query using template literals. An attacker can inject malicious SQL by providing input like "' OR '1'='1" or "'; DROP TABLE todos; --" to execute arbitrary SQL commands, potentially reading, modifying, or deleting all database data.
  - Line 129: `critical` SQL injection vulnerability: User-supplied 'completed' parameter is concatenated directly into SQL without validation or parameterization. An attacker can inject SQL by passing input like "true; DROP TABLE todos; --" to execute arbitrary database commands and compromise the entire database.
  - Line 138: `critical` SQL injection vulnerability: The 'userId' parameter is embedded directly in the SQL query using template literals without any sanitization. An attacker can provide input like "1' OR '1'='1" to bypass access controls and retrieve all todos, or use "1'; DELETE FROM todos; --" to delete data.

  *...and 10 more*

#### Test Gaps (20)
  - `searchTodos (line 123)` (critical priority)
  - `searchTodosByStatus (line 132)` (critical priority)

  *...and 18 more*

#### Refactoring Opportunities (8)
  - **extract-function**: Extract individual validation rules into separate, reusable validator functions that can be composed and unit-tested independently.
  - **modernize**: Replace early-return pattern with a single expression using logical operators, making validation more declarative and easier to extend.

  *...and 6 more*

---

*Generated at 2026-11-10T09:00:35.549Z • Duration: 414.12ms*
