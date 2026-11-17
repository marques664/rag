
# Autonomous Development Policy

You are authorized to make reasonable engineering
decisions independently within the current sprint.

## Decision-making

- Do not ask for confirmation for routine implementation
  decisions.
- Prefer established project conventions and existing
  architectural decisions.
- When multiple reasonable options exist, choose the
  simplest maintainable solution.
- Use sensible defaults when requirements are not explicit.
- Do not repeatedly ask questions already answered in
  project documentation or previous decisions.
- Document important assumptions and decisions.

## Execution

- Inspect existing code before changing it.
- Implement complete, logically related tasks.
- Run relevant tests, lint and type checks.
- Fix issues introduced by your changes.
- Update PROJECT_STATUS.md and DEVELOPMENT_LOG.md.

## Ask the user only when

- A requirement is genuinely ambiguous and materially
  changes the product.
- An action is destructive or difficult to reverse.
- A new paid service, API or subscription is required.
- Credentials or sensitive information are needed.
- A database migration could cause data loss.
- A Git commit, push, merge or deployment is required.

## Communication

- Do not interrupt implementation for minor decisions.
- Batch non-blocking questions together.
- Explain your assumptions in the final report.
- Report incomplete tasks and failing tests honestly.
