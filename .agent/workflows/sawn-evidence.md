---
description: Sawn evidence step. Collect raw proof into files for Claude's review.
---

STORY_ID comes from the prompt. Run every command from the repository root. Never write evidence inside the repository.

1. $dir = "$env:TEMP\sawn-evidence\<STORY_ID>"; New-Item -ItemType Directory -Force -Path $dir | Out-Null
2. git status --short > "$dir\status.txt"
3. git diff > "$dir\diff.patch"
4. For every new file in git status (lines starting with ??), except docs/pitch/, append its full path and full content to "$dir\new-files.txt".
5. npm test 2>&1 | Tee-Object -FilePath "$dir\npm-test.txt"
   Wait for the final Test Suites block.
6. If the prompt says this is the feature close: git log --oneline -15 > "$dir\git-log.txt"
7. Run git status --short again. It must match status.txt. If not, stop and report.
8. Paste the final Test Suites block and the content of status.txt in the chat.
9. List the absolute path of every evidence file.
10. End with one Arabic line telling Mohammed to attach these files for Claude.
