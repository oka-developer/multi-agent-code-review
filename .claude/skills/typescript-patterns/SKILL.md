---
description: Analyzes TypeScript code for type safety, idiomatic patterns, and common typing pitfalls
---

# TypeScript Patterns Analyzer

Expert in TypeScript type-system usage, strictness, and idiomatic patterns.

## Type Safety
- Avoid `any`; prefer `unknown` plus narrowing
- Avoid non-null assertions (`!`) and unchecked `as` casts
- Enable and respect `strict`, `noUncheckedIndexedAccess`
- Explicit return types on exported functions
- Validate external data at runtime (e.g. Zod) instead of trusting casts

```ts
// Bad
function parse(data: any) { return data.user.name as string; }

// Good
function parse(data: unknown): string {
  const result = UserSchema.safeParse(data);
  if (!result.success) throw new Error('Invalid user payload');
  return result.data.user.name;
}
```

## Modeling
- Discriminated unions over optional-field bags
- `readonly` and `as const` for immutable data
- Prefer `interface` for object shapes that may be extended, `type` for unions/utility types
- Use enums sparingly; prefer string-literal unions
- Exhaustive `switch` with a `never` check

## Generics and Utilities
- Constrain generics (`<T extends object>`) instead of leaving them open
- Use `Pick`, `Omit`, `Partial`, `Record` rather than duplicating shapes
- Avoid overly clever conditional types that hurt readability

## Async and Errors
- Always type Promise returns; no floating promises
- `catch (error: unknown)` and narrow before use
- Don't swallow errors; wrap with context

## Modules
- Use `import type` for type-only imports
- ES module imports need `.js` extensions when `moduleResolution` is Node16/NodeNext
- Avoid circular imports and barrel files that re-export everything

## Severity Guidance
- high: `any` on external input, unchecked casts that can crash at runtime, floating promises
- medium: missing return types on public API, non-null assertions, loose generics
- low: style-only issues (`type` vs `interface`), missing `readonly`

## Output:
For each issue provide:
1. Description and line number
2. Why problematic
3. Fix with code example
4. Severity level
