# Contributing Guidelines

## Regression-Test Discipline

> **Every bug fix must include at least one new test that would have caught the bug before the fix.** No exceptions. The PR description should link the new test to the bug it covers.

This rule applies to:
- Unit tests in `tests/test_*.py`
- Integration tests in `tests/test_smoke.py`
- E2E tests in `tests/e2e/`

If a bug can only be reproduced in the browser, add a Playwright E2E test. If it is a backend calculation error, add a pytest unit or integration test. The goal is that the same class of bug never regresses silently.
