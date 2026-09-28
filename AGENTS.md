# Work directly in this folder — no worktrees, branches or commits

Edit files in this checkout (`/root/vibes-new/vibes-account-new`) directly. Do not create git worktrees or branches, and do not commit, stage, stash, reset, checkout or push. The owner reviews `git diff` and commits/pushes manually.

- Read-only git (`git status`, `git diff`, `git log`) is fine.
- Other changes may already be uncommitted here — read a file's `git diff` before editing it and never revert work you did not make.
- Leave your work uncommitted and summarise what you changed.
- The repo's `.env` points at the production database: never run migrations, seeds or scripts with it. Tests use `.env.test` (local `omnitenant_test`) and share one database, so run one vitest process at a time.
