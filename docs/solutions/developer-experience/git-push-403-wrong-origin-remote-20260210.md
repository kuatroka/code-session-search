---
module: Development Workflow
date: 2026-02-10
problem_type: developer_experience
component: tooling
symptoms:
  - "git remote add origin https://github.com/kuatroka/code-session-search.git failed with: error: remote origin already exists"
  - "git push -u origin main returned 403 because origin still pointed to https://github.com/kamranahmedse/claude-run.git"
  - "User could not push to newly created personal repository"
root_cause: config_error
resolution_type: config_change
severity: medium
tags: [git, github, remote, origin, push, 403]
---

# Troubleshooting: Git push 403 due to wrong `origin` remote

## Problem
Pushing `main` to a newly created personal GitHub repo failed because the local `origin` remote already existed and still pointed to a repository the user did not have push access to.

## Environment
- Module: Development Workflow
- Affected Component: Git remote configuration
- Date: 2026-02-10

## Symptoms
- `git remote add origin ...` failed with `error: remote origin already exists.`
- `git push -u origin main` attempted to push to `kamranahmedse/claude-run.git`.
- GitHub rejected push with `403 Permission denied` for user `kuatroka`.

## What Didn't Work

**Attempted Solution 1:** Add the new repository URL as `origin` directly.
- **Why it failed:** `origin` was already defined, so Git refused to add a duplicate remote name.

**Attempted Solution 2:** Push to `origin` without correcting remotes.
- **Why it failed:** `origin` still referenced the old upstream repository where the user lacked write permissions.

## Solution
Repointed remotes so the personal repository became `origin`, then pushed successfully.

**Commands run:**
```bash
# 1) Preserve old origin under a different name (optional safety step)
git remote rename origin upstream

# 2) Add personal repository as the new origin
git remote add origin https://github.com/kuatroka/code-session-search.git

# 3) Verify remote URLs
git remote -v

# 4) Push and set upstream tracking
git push -u origin main

# 5) Remove old upstream if no longer needed
git remote remove upstream
```

## Why This Works
The failure was not an authentication bug in GitHub; it was a local remote configuration mismatch. Git always pushes to the URL configured for the chosen remote name. By correcting `origin` to point to the user-owned repository, `git push -u origin main` targeted the correct destination and succeeded.

## Prevention
- Run `git remote -v` before first push in a forked or repurposed repository.
- If `origin` is occupied, decide explicitly whether to:
  - rename existing `origin` to `upstream`, or
  - overwrite/remove and recreate `origin`.
- Use a quick first-push checklist:
  1. Correct branch name (`main`)
  2. Correct `origin` URL
  3. Write access on target repo

## Related Issues
No related issues documented yet.
