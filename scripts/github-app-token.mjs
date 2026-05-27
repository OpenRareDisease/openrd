#!/usr/bin/env node
/**
 * Create a short-lived GitHub App installation token for this repository.
 *
 * Required environment:
 *   GITHUB_APP_ID
 *   GITHUB_APP_PRIVATE_KEY_PATH, GITHUB_APP_PRIVATE_KEY, or GITHUB_APP_PRIVATE_KEY_BASE64
 *
 * Optional environment:
 *   GITHUB_APP_INSTALLATION_ID
 *   GITHUB_REPOSITORY=owner/repo
 *   GITHUB_API_URL=https://api.github.com   (or your GHE host's /api/v3 base)
 */

import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_API_URL = 'https://api.github.com';
const USER_AGENT = 'openrd-github-app-reviewer';

const usage = `Usage:
  node scripts/github-app-token.mjs [--repo owner/repo] [--installation-id id] [--json | --print-token]

Output modes:
  default                pretty-printed JSON (token + expiry + permissions) on stdout
  --json                 same JSON on stdout
  --print-token          raw token only on stdout (writes a stderr warning about
                         shell history; intended for one-off interactive use)

Environment:
  GITHUB_APP_ID
  GITHUB_APP_PRIVATE_KEY_PATH, GITHUB_APP_PRIVATE_KEY, or GITHUB_APP_PRIVATE_KEY_BASE64
  GITHUB_APP_INSTALLATION_ID       optional when --repo can be resolved
  GITHUB_REPOSITORY=owner/repo     optional; otherwise origin remote is used
  GITHUB_API_URL                   defaults to https://api.github.com; must be https
`;

/** Consume the value for a `--flag value` style option, refusing values
 *  that look like another flag — so `--repo --json` errors out instead
 *  of silently making `args.repo === '--json'`.
 *
 *  The literal `-` is allowed through as a value: callers like
 *  `--body-file -` use it as the piped-stdin sentinel, and review
 *  bodies legitimately start with `-` (markdown bullets). The check is
 *  "starts with `-` AND is not just `-`". */
const takeValue = (flag, argv, i) => {
  const next = argv[i + 1];
  if (next === undefined || (next !== '-' && next.startsWith('--'))) {
    throw new Error(`${flag} requires a value`);
  }
  return next;
};

export const parseArgs = (argv) => {
  const args = {
    repo: process.env.GITHUB_REPOSITORY ?? null,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID ?? null,
    output: 'json',
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--repo') {
      args.repo = takeValue('--repo', argv, i);
      i += 1;
    } else if (arg === '--installation-id') {
      args.installationId = takeValue('--installation-id', argv, i);
      i += 1;
    } else if (arg === '--json') {
      args.output = 'json';
    } else if (arg === '--print-token') {
      args.output = 'token';
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage}`);
    }
  }

  return args;
};

const base64urlJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const PEM_BEGIN = '-----BEGIN';

/** Defensive PEM string normaliser.
 *
 *  Real-world sources of breakage:
 *    1. Shell-escaped keys with literal `\n` instead of newlines.
 *    2. Windows clipboards / vaults using CRLF line endings.
 *    3. Trailing whitespace.
 *  Cover all of them; do not assume mutually exclusive cases. */
const normalisePrivateKey = (raw) => {
  let key = raw.trim();
  if (key.includes('\\n')) {
    key = key.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  }
  // Real CRLF (e.g. from a Windows clipboard) — OpenSSL is fussy here.
  key = key.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return key;
};

export const loadPrivateKey = async (env = process.env) => {
  let raw;
  if (env.GITHUB_APP_PRIVATE_KEY_BASE64) {
    raw = Buffer.from(env.GITHUB_APP_PRIVATE_KEY_BASE64, 'base64').toString('utf8');
  } else if (env.GITHUB_APP_PRIVATE_KEY) {
    raw = env.GITHUB_APP_PRIVATE_KEY;
  } else if (env.GITHUB_APP_PRIVATE_KEY_PATH) {
    raw = await readFile(env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8');
  } else {
    throw new Error(
      'Missing GitHub App private key. Set GITHUB_APP_PRIVATE_KEY_PATH, GITHUB_APP_PRIVATE_KEY, or GITHUB_APP_PRIVATE_KEY_BASE64.',
    );
  }

  const key = normalisePrivateKey(raw);
  if (!key.includes(PEM_BEGIN)) {
    throw new Error(
      'Private key does not contain a "-----BEGIN" PEM header. ' +
        'Check that GITHUB_APP_PRIVATE_KEY_BASE64 is correctly base64-encoded and ' +
        'that the value has not been truncated.',
    );
  }
  if (
    key.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----') ||
    key.includes('Proc-Type: 4,ENCRYPTED')
  ) {
    throw new Error(
      'Encrypted private keys are not supported by this script. ' +
        'GitHub App keys are issued unencrypted; if you wrapped one with a passphrase, ' +
        'decrypt before use: `openssl rsa -in key.enc -out key.pem`.',
    );
  }
  return key;
};

export const createAppJwt = async ({ appId, privateKey }) => {
  if (!appId) throw new Error('Missing GITHUB_APP_ID.');

  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64urlJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: String(appId),
  });
  const body = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(body).sign(privateKey, 'base64url');
  return `${body}.${signature}`;
};

/** Pull `owner/repo` out of a git remote URL. Accepts SSH, https, and
 *  https-with-credentials forms; allows dots inside repo names and
 *  non-`github.com` hosts (for GitHub Enterprise).
 *
 *  Repo capture is `[^/]+?` (not `.+?`) so URLs with extra path
 *  segments — Gitea/GitLab groups (`group/sub/repo.git`), browser
 *  paths copied with `/issues` suffix, etc. — fail the match entirely
 *  rather than silently splitting `sub/repo` into the repo field.
 *  SSH `git@` is optional inside the ssh:// branch so configs that
 *  set the user via ~/.ssh/config also work. */
const parseRepoFromRemote = (remote) => {
  const trimmed = remote.trim();
  const ssh = trimmed.match(
    /^(?:ssh:\/\/)?(?:[^@/]+@)?([^:/]+)[:/](?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/,
  );
  if (ssh?.groups) return `${ssh.groups.owner}/${ssh.groups.repo}`;

  const https = trimmed.match(
    /^https?:\/\/(?:[^@/]+@)?[^/]+\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/,
  );
  if (https?.groups) return `${https.groups.owner}/${https.groups.repo}`;

  return null;
};

export const resolveRepository = (repoArg) => {
  if (repoArg) return repoArg;

  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const repo = parseRepoFromRemote(remote);
    if (repo) return repo;
  } catch {
    // Fall through to the explicit error below.
  }

  throw new Error('Could not resolve repository. Pass --repo owner/repo or set GITHUB_REPOSITORY.');
};

export const splitRepository = (repo) => {
  const [owner, name] = repo.split('/');
  if (!owner || !name || repo.split('/').length !== 2) {
    throw new Error(`Invalid repository "${repo}". Expected owner/repo.`);
  }
  return { owner, repo: name };
};

/** Strip a single trailing slash and require an http(s) scheme. */
export const normaliseApiUrl = (raw) => {
  const value = (raw ?? DEFAULT_API_URL).trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid GITHUB_API_URL "${value}". Expected an absolute http(s) URL.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(
      `Refusing to use GITHUB_API_URL "${value}": only http(s) is allowed.`,
    );
  }
  if (parsed.protocol === 'http:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error(
      `Refusing to use plaintext http:// for GITHUB_API_URL "${value}". ` +
        'GitHub App tokens must travel over TLS; switch to https.',
    );
  }
  return value.replace(/\/+$/, '');
};

/** Wrap fetch so DNS / TLS / connection errors surface error.cause and
 *  HTML or text error bodies don't crash JSON parsing. */
const apiFetch = async ({ apiUrl, path, token, method = 'GET', body }) => {
  const url = `${apiUrl}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    const cause = error?.cause;
    const detail = cause?.code ?? cause?.message ?? error?.message ?? String(error);
    throw new Error(`GitHub API ${method} ${path} network failure: ${detail}`);
  }

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 200) };
    }
  }
  if (!response.ok) {
    const message = data?.message ? `: ${data.message}` : '';
    throw new Error(`GitHub API ${method} ${path} failed with ${response.status}${message}`);
  }
  return data;
};

export const createInstallationToken = async ({
  appId = process.env.GITHUB_APP_ID,
  privateKey,
  repo,
  installationId = process.env.GITHUB_APP_INSTALLATION_ID,
  apiUrl,
} = {}) => {
  const resolvedApiUrl = normaliseApiUrl(apiUrl ?? process.env.GITHUB_API_URL);
  const key = privateKey ?? (await loadPrivateKey());
  const jwt = await createAppJwt({ appId, privateKey: key });

  let resolvedInstallationId = installationId;
  if (!resolvedInstallationId) {
    const { owner, repo: repoName } = splitRepository(resolveRepository(repo));
    const installation = await apiFetch({
      apiUrl: resolvedApiUrl,
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/installation`,
      token: jwt,
    });
    if (!installation?.id) {
      throw new Error(
        `GitHub returned no installation id for ${owner}/${repoName}. ` +
          'Confirm the GitHub App is installed on this repository.',
      );
    }
    resolvedInstallationId = String(installation.id);
  }

  const tokenInfo = await apiFetch({
    apiUrl: resolvedApiUrl,
    path: `/app/installations/${encodeURIComponent(resolvedInstallationId)}/access_tokens`,
    token: jwt,
    method: 'POST',
  });

  return {
    token: tokenInfo.token,
    expiresAt: tokenInfo.expires_at,
    permissions: tokenInfo.permissions,
    repositorySelection: tokenInfo.repository_selection,
    installationId: resolvedInstallationId,
  };
};

const writeOutput = (tokenInfo, output) => {
  if (output === 'token') {
    process.stderr.write(
      'WARNING: the bearer token is being printed to stdout. ' +
        'It will land in your shell history and any wrapping log. ' +
        "Don't paste it anywhere; let it expire instead.\n",
    );
    process.stdout.write(`${tokenInfo.token}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(tokenInfo, null, 2)}\n`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const tokenInfo = await createInstallationToken({
    repo: args.repo,
    installationId: args.installationId,
  });

  writeOutput(tokenInfo, args.output);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const cause = error?.cause;
    const detail = cause?.message ? ` (cause: ${cause.message})` : '';
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}${detail}\n`);
    process.exit(1);
  });
}
