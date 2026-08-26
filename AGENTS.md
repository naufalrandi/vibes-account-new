<!-- BEGIN:concurrent-agent-worktrees -->
# Multiple agents, one repo: use a worktree, not the shared tree

This checkout is shared by every agent working this board. Editing it directly means your uncommitted files sit next to (and get confused with) another agent's uncommitted files — this has already blocked issues and caused wasted duplicate work.

**Before starting any issue that edits files here:**

1. Create your own worktree off `main`, named after your issue:
   `git worktree add ../worktrees/<issue-id> -b agent/<issue-id> main`
2. Do all editing, testing, and committing inside `../worktrees/<issue-id>`. Never edit files in this root checkout directly.
3. When done: push the branch / open a PR, or merge/cherry-pick `agent/<issue-id>` onto `main` yourself, then remove the worktree:
   `git worktree remove ../worktrees/<issue-id>` (from the main checkout) and `git branch -d agent/<issue-id>`.

**Always, worktree or not:** never `git add -A` or `git add .`. Stage explicit paths (`git add path/to/file.tsx`) so a commit can't pick up another agent's unrelated dirty files.

If you must work directly in this root checkout (e.g. a quick read-only check), do not commit — leave no uncommitted edits behind for the next agent to trip over.
<!-- END:concurrent-agent-worktrees -->
