# File ordering protocol

When reviewing multiple files, show the most important context first.

## Strategy

Use a **topological DFS from the core change outward**.

1. Identify the core change:
   - new files introducing the main abstraction
   - files with the most meaningful changes
   - files whose names match the feature or ticket
2. Build the dependency graph among the changed files:
   - imports
   - type references
   - re-exports
3. Topologically sort with the core change first.
4. Traverse outward through dependencies and dependents.
5. Put unrelated files last.
6. Unless the user asks otherwise, review source files before tests.

## If the graph is ambiguous

State the ordering rationale briefly before starting so the user can redirect
it.
