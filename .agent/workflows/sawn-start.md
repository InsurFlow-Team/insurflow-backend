---
description: Update main and create the story branch. Run at Stage 0 of every implement prompt.
---
BRANCH comes from the prompt. Run every command from the repository root. Paste the raw output of every command.
1. git status --short. The only allowed line is "?? docs/pitch/". Any other line: stop and ask.
2. git checkout main
3. git pull --ff-only origin main. If it fails: stop and ask.
4. git branch --list BRANCH. If it prints anything: stop and ask.
5. git checkout -b BRANCH
6. git branch --show-current and git log --oneline -3
7. End with one Arabic line for Mohammed.
