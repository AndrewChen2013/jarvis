#!/bin/bash

# This script wraps a command to automatically stage files that were modified by pre-commit.
# Usage: pre-commit-auto-stage.sh <command>

# Q: For partially staged files, might this add changes not intended to be committed?
# A: No, since pre-commit stashes all unstaged changes before running.

set -e

"$@"

# Get the git repository root directory dynamically
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
GIT_INDEX_LOCK="$GIT_ROOT/.git/index.lock"

# Simple retry loop for git add (macOS compatible, no flock needed)
# pre-commit already handles most concurrency, this is just a safety net
max_attempts=10
attempt=0

while [ $attempt -lt $max_attempts ]; do
    # Check if .git/index.lock exists and wait for it to be released
    if [ -f "$GIT_INDEX_LOCK" ]; then
        sleep 0.2
        attempt=$((attempt + 1))
        continue
    fi

    # Try to run git add
    if git add -u 2>/dev/null; then
        exit 0
    fi

    sleep 0.2
    attempt=$((attempt + 1))
done

echo "Failed to run git add after $max_attempts attempts" >&2
exit 1
