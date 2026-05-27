# GitHub App reviewer

This repo includes small helper scripts for submitting PR reviews as a GitHub App
instead of as a personal GitHub account. This lets an automated reviewer request
changes on PRs opened by maintainers.

## Create the GitHub App

Create a GitHub App in GitHub organization or personal settings.

Recommended settings:

- Name: `OpenRD Codex Reviewer`
- Homepage URL: this repository URL
- Webhook: disabled, unless you later add automation
- Repository permissions:
  - Contents: read-only
  - Pull requests: read and write
  - Metadata: read-only, granted automatically

Install the app on `OpenRareDisease/openrd`.

## Local credentials

Generate a private key for the app and keep it outside the repository.
A standard place is `~/.config/openrd/review-bot.pem` with `chmod 600`.

The recommended setup is to put the three configuration values in your
local `.env` (already gitignored) so every shell session picks them up
automatically — the npm scripts launch Node with
`--env-file-if-exists=.env`:

```dotenv
# .env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=/Users/you/.config/openrd/review-bot.pem
GITHUB_REPOSITORY=OpenRareDisease/openrd
```

If you prefer plain shell exports (e.g. for CI), the same names work:

```bash
export GITHUB_APP_ID="123456"
export GITHUB_APP_PRIVATE_KEY_PATH="$HOME/.config/openrd/review-bot.pem"
export GITHUB_REPOSITORY="OpenRareDisease/openrd"
```

Alternative ways to supply the private key:

```bash
export GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
export GITHUB_APP_PRIVATE_KEY_BASE64="base64-encoded-private-key"
```

`GITHUB_APP_INSTALLATION_ID` is optional. If omitted, the scripts resolve
it from the repository installation.

## Check the token

```bash
npm run github:app-token
```

Default output is a pretty-printed JSON object containing the token,
expiry, and granted permissions. Extract the bearer value with `jq`
when scripting:

```bash
TOKEN=$(npm run --silent github:app-token | jq -r .token)
```

If you really need the raw token on stdout (e.g. for one-off interactive
use), pass `--print-token`. The script writes a stderr warning in that
mode reminding you that the value will land in shell history and tmux
scrollback.

The token expires within an hour. Do not commit it or paste it into
issue comments.

## Submit a PR review as the app

```bash
npm run github:app-pr-review -- 23 \
  --event REQUEST_CHANGES \
  --body-file /tmp/review.md
```

Valid events:

- `COMMENT`
- `APPROVE`
- `REQUEST_CHANGES`

The command prints the GitHub review URL on success.

## How Codex should use it

For future reviews, write the review body to a temporary file and run:

```bash
npm run github:app-pr-review -- <pr-number> --event REQUEST_CHANGES --body-file /tmp/review.md
```

Use `COMMENT` when the finding is non-blocking, and `APPROVE` only after the PR
has no blocking findings and the requested verification passed.
