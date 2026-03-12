# Archivist conventions

## Commit messages

Use conventional commits:

```text
type(scope): description
```

Types:

- `feat`
- `fix`
- `refactor`
- `chore`
- `docs`
- `test`
- `style`
- `perf`
- `ci`
- `build`
- `revert`

Rules:

- scope is optional but preferred
- description is lowercase
- use imperative mood
- no trailing period

Examples:

```text
feat(parser): add line range validation
fix(auth): handle expired token refresh
refactor: extract shared validation logic
chore(deps): bump zod to 3.24
```

## Branch naming

```text
<type>/<ticket>-<short-description>
<type>/<short-description>
```

Types:

- `feat`
- `fix`
- `refactor`
- `chore`
- `docs`
- `test`
- `release`
- `hotfix`

Examples:

```text
feat/PROJ-123-add-line-validation
fix/PROJ-456-token-refresh-race
refactor/extract-review-parser
chore/bump-dependencies
```

Rules:

- use lowercase where practical
- use hyphens between words
- when a ticket exists, include it after the type
- default base branch is `develop` unless the user explicitly chooses another
  base
