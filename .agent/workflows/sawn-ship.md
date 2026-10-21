---
description: Commit, push and open the pull request after Claude approves. Never merge.
---
Mohammed pastes Claude's approval block after /sawn-ship. It holds STORY_ID, BRANCH, FILES (one path per line) and COMMIT_MESSAGE.
If any of the four is missing: stop and ask.
Run every command from the repository root. Paste the raw output of every command.
1. git branch --show-current must equal BRANCH. If it is main or differs: stop and ask.
2. git status --short. Every changed path must be in FILES, except "?? docs/pitch/". Every path in FILES must appear. Otherwise: stop and ask.
3. For each path in FILES: git add -- "<path>". Never git add . or git add -A.
4. git diff --cached --name-only must list exactly FILES. Otherwise: stop and ask.
5. git commit with COMMIT_MESSAGE. Use one -m per paragraph.
6. git push -u origin BRANCH. Never --force. Never push main.
7. gh pr create --base main --head BRANCH --title "<first line of COMMIT_MESSAGE>" --body "<rest of COMMIT_MESSAGE>"
8. Paste the raw output of: git log --oneline -3, git status --short, git rev-parse HEAD, and the pull request URL.
9. End with this Arabic line: ابعت لكلود: تم فتح الـ pull request
