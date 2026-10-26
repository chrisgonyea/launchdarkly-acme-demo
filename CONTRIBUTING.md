# Working on this repo

## Branches and pull requests
- `main` always holds the latest reviewed, working version. Nothing is committed to `main` directly.
- Each piece of work gets its own branch cut from `main`: `feat/<short-name>`, `fix/<short-name>` or `docs/<short-name>`.
- Commit small, working steps as you go and push them. Each commit message says what changed and why.
- Every change lands through a pull request. The description says what changed, how it was tested, and anything the reviewer must set up.
- CI (`.github/workflows/ci.yml`) must pass, and the PR gets a review before merge.
- Merge with a regular merge commit (no squash or rebase) so every commit stays in history, then delete the branch.
- Never force-push `main` or rewrite published history.

## Releases
- A release is a tag on `main` after the merge, for example `v1.0.0`, with a GitHub release that lists what is included.
- Versions follow [Semantic Versioning](https://semver.org/). `version` in `package.json` matches the tag.
- A published tag is never moved. Fixes ship as a new patch version.

## Checks before opening a PR
```bash
npm ci
npm test     # builds the SDK bundle, starts the server, and checks it responds
```
Then run the app against a real LaunchDarkly environment (see the README) and step through the demo.
