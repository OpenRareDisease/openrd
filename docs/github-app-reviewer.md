# GitHub App reviewer

Automated PR reviews on this repository are submitted as the GitHub App
`agent-pr-review-bot`, so they appear as `agent-pr-review-bot[bot]` rather than
as a maintainer's personal account. GitHub does not let a PR author approve or request
changes on their own PR; a separate identity lets an automated reviewer do both on
PRs that maintainers open.

The command-line tool that submits these reviews, `agent-review-bot`, is
installed only on maintainers' own machines. It is not part of this repository, CI, or any
deployment, and contributors need nothing from this page.

## What the App can do here

- Installed on `OpenRareDisease/openrd` only.
- Repository permissions: **Pull requests: Read and write**, plus the mandatory
  **Metadata: Read-only**. No contents, issues, workflow, or organization
  permissions.
- No webhook. It only acts when a maintainer runs the tool.
- Each run mints an installation token that expires within an hour and is scoped
  to this one repository.

## Maintainer setup

The tool is a zero-dependency Node 22+ CLI that also ships as a skill for Claude
Code and Codex. Its README covers installation, creating the App, and the full
command reference. In short:

1. Install it: clone the tool's repository and run `./install.sh`, which puts
   `agent-review-bot` in `~/.local/bin` and the skill in `~/.claude/skills` and
   `~/.codex/skills`.
2. Put the App's private key at `~/.config/agent-review-bot/app.pem`
   (`chmod 600`) and the App ID in `~/.config/agent-review-bot/config.json`:

   ```json
   { "appId": 123456, "privateKeyPath": "~/.config/agent-review-bot/app.pem" }
   ```

3. Check it:

   ```bash
   agent-review-bot doctor --repo OpenRareDisease/openrd
   ```

   `doctor` verifies the config, that the key file is owner-only, that the App
   authenticates with `pull_requests: write`, and that it is installed here. When
   it is not installed it prints the install link.

Configuration lives outside this repository. Nothing is read from `.env`.

## Submit a review

From a checkout of this repository:

```bash
npm run github:app-pr-review -- 23 --event REQUEST_CHANGES --body-file /tmp/review.md
```

which is shorthand for:

```bash
agent-review-bot review --repo OpenRareDisease/openrd 23 --event REQUEST_CHANGES --body-file /tmp/review.md
```

- `--event`: `COMMENT`, `APPROVE`, or `REQUEST_CHANGES`.
- `--body-file -` reads the body from piped stdin; `--body TEXT` passes it inline.
- `--dry-run` checks everything, including minting a token, without posting.
- The command prints the review URL on success.

Use `REQUEST_CHANGES` when a blocking finding exists, `APPROVE` only when there
are none and the requested verification passed, and `COMMENT` otherwise.

## Check the token

```bash
npm run github:app-token
```

prints the installation token's expiry, permissions, and installation id. It does
not print the token itself; `agent-review-bot token --print-token` does, with a
warning, for the rare case that needs the raw value. The token expires within an
hour. Do not commit it or paste it into issues or PRs.

## Migrating from the in-repo scripts

Earlier versions of this repository shipped `scripts/github-app-token.mjs` and
`scripts/github-app-pr-review.mjs`, configured through `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_APP_INSTALLATION_ID`, and
`GITHUB_REPOSITORY` in `.env`. Those scripts are gone and nothing reads those
variables any more; delete them from your local `.env`. The `npm run` commands
above keep their names and arguments.
