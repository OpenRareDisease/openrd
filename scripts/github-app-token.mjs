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
 *   GITHUB_API_URL=https://api.github.com
 */

import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_API_URL = 'https://api.github.com';
const USER_AGENT = 'openrd-github-app-reviewer';

const usage = `Usage:
  node scripts/github-app-token.mjs [--repo owner/repo] [--installation-id id] [--json]

Environment:
  GITHUB_APP_ID
  GITHUB_APP_PRIVATE_KEY_PATH, GITHUB_APP_PRIVATE_KEY, or GITHUB_APP_PRIVATE_KEY_BASE64
  GITHUB_APP_INSTALLATION_ID       optional when --repo can be resolved
  GITHUB_REPOSITORY=owner/repo     optional; otherwise origin remote is used
`;

export const parseArgs = (argv) => {
  const args = {
    repo: process.env.GITHUB_REPOSITORY ?? null,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID ?? null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--repo') {
      args.repo = argv[++i] ?? null;
    } else if (arg === '--installation-id') {
      args.installationId = argv[++i] ?? null;
    } else if (arg === '--json') {
      args.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage}`);
    }
  }

  return args;
};

const base64urlJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const normalisePrivateKey = (raw) => {
  const trimmed = raw.trim();
  return trimmed.includes('\\n') ? trimmed.replace(/\\n/g, '\n') : trimmed;
};

export const loadPrivateKey = async (env = process.env) => {
  if (env.GITHUB_APP_PRIVATE_KEY_BASE64) {
    return Buffer.from(env.GITHUB_APP_PRIVATE_KEY_BASE64, 'base64').toString('utf8');
  }
  if (env.GITHUB_APP_PRIVATE_KEY) {
    return normalisePrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  }
  if (env.GITHUB_APP_PRIVATE_KEY_PATH) {
    return readFile(env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8');
  }
  throw new Error(
    'Missing GitHub App private key. Set GITHUB_APP_PRIVATE_KEY_PATH, GITHUB_APP_PRIVATE_KEY, or GITHUB_APP_PRIVATE_KEY_BASE64.',
  );
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

const parseRepoFromRemote = (remote) => {
  const trimmed = remote.trim();
  const sshMatch = trimmed.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/);
  if (sshMatch?.groups) return `${sshMatch.groups.owner}/${sshMatch.groups.repo}`;

  const httpsMatch = trimmed.match(
    /^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/,
  );
  if (httpsMatch?.groups) return `${httpsMatch.groups.owner}/${httpsMatch.groups.repo}`;

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

const splitRepository = (repo) => {
  const [owner, name] = repo.split('/');
  if (!owner || !name || repo.split('/').length !== 2) {
    throw new Error(`Invalid repository "${repo}". Expected owner/repo.`);
  }
  return { owner, repo: name };
};

const apiFetch = async ({ apiUrl, path, token, method = 'GET', body }) => {
  const response = await fetch(`${apiUrl}${path}`, {
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

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
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
  apiUrl = process.env.GITHUB_API_URL ?? DEFAULT_API_URL,
} = {}) => {
  const key = privateKey ?? (await loadPrivateKey());
  const jwt = await createAppJwt({ appId, privateKey: key });

  let resolvedInstallationId = installationId;
  if (!resolvedInstallationId) {
    const { owner, repo: repoName } = splitRepository(resolveRepository(repo));
    const installation = await apiFetch({
      apiUrl,
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/installation`,
      token: jwt,
    });
    resolvedInstallationId = String(installation.id);
  }

  const tokenInfo = await apiFetch({
    apiUrl,
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

  if (args.json) {
    process.stdout.write(`${JSON.stringify(tokenInfo, null, 2)}\n`);
  } else {
    process.stdout.write(`${tokenInfo.token}\n`);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
