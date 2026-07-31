## 1. Reasoning Markdown Presentation

- [x] 1.1 Add a reasoning-only Markdown transform that removes complete and incomplete HTML comment nodes while preserving code literals.
- [x] 1.2 Wire the transform through both grouped and individual reasoning-detail render paths without mutating stored blocks.

## 2. Regression Coverage And Validation

- [x] 2.1 Add focused tests for completed comments, split-stream incomplete comments, historical input, and inline/fenced code preservation.
- [x] 2.2 Run the focused renderer tests, TypeScript validation, and diff hygiene checks.
