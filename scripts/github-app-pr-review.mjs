#!/usr/bin/env node
/**
 * Submit a pull request review using a GitHub App installation token.
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { createInstallationToken, resolveRepository } from './github-app-token.mjs';

const DEFAULT_API_URL = 'https://api.github.com';
const USER_AGENT = 'openrd-github-app-reviewer';
const VALID_EVENTS = new Set(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);

const usage = `Usage:
  node scripts/github-app-pr-review.mjs <pr-number> --event REQUEST_CHANGES --body-file review.md
  node scripts/github-app-pr-review.mjs <pr-number> --event COMMENT --body "Review text"

Options:
  --repo owner/repo          defaults to GITHUB_REPOSITORY or origin remote
  --installation-id id       optional; otherwise resolved from the repository
  --event EVENT              COMMENT, APPROVE, or REQUEST_CHANGES (default: COMMENT)
  --body TEXT                review body
  --body-file PATH           review body file; use "-" to read stdin
`;

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const parseArgs = (argv) => {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const args = {
    prNumber: null,
    repo: process.env.GITHUB_REPOSITORY ?? null,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID ?? null,
    event: 'COMMENT',
    body: null,
    bodyFile: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') && args.prNumber === null) {
      args.prNumber = arg;
    } else if (arg === '--repo') {
      args.repo = argv[++i] ?? null;
    } else if (arg === '--installation-id') {
      args.installationId = argv[++i] ?? null;
    } else if (arg === '--event') {
      args.event = (argv[++i] ?? '').toUpperCase();
    } else if (arg === '--body') {
      args.body = argv[++i] ?? null;
    } else if (arg === '--body-file') {
      args.bodyFile = argv[++i] ?? null;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage}`);
    }
  }

  if (!args.prNumber || !/^\d+$/.test(args.prNumber)) {
    throw new Error(`Missing or invalid PR number.\n\n${usage}`);
  }
  if (!VALID_EVENTS.has(args.event)) {
    throw new Error(`Invalid --event "${args.event}". Expected COMMENT, APPROVE, or REQUEST_CHANGES.`);
  }
  if (!args.body && !args.bodyFile) {
    throw new Error(`Missing review body. Pass --body or --body-file.\n\n${usage}`);
  }
  return args;
};

const splitRepository = (repo) => {
  const [owner, name] = repo.split('/');
  if (!owner || !name || repo.split('/').length !== 2) {
    throw new Error(`Invalid repository "${repo}". Expected owner/repo.`);
  }
  return { owner, repo: name };
};

const readBody = async (args) => {
  if (args.bodyFile === '-') return readStdin();
  if (args.bodyFile) return readFile(args.bodyFile, 'utf8');
  return args.body;
};

const submitReview = async ({ repo, prNumber, event, body, token, apiUrl }) => {
  const { owner, repo: repoName } = splitRepository(repo);
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/pulls/${encodeURIComponent(
    prNumber,
  )}/reviews`;

  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ event, body }),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data?.message ? `: ${data.message}` : '';
    throw new Error(`GitHub API POST ${path} failed with ${response.status}${message}`);
  }
  return data;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const repo = resolveRepository(args.repo);
  const body = (await readBody(args)).trim();
  if (!body) throw new Error('Review body is empty.');

  const tokenInfo = await createInstallationToken({
    repo,
    installationId: args.installationId,
  });

  const review = await submitReview({
    repo,
    prNumber: args.prNumber,
    event: args.event,
    body,
    token: tokenInfo.token,
    apiUrl: process.env.GITHUB_API_URL ?? DEFAULT_API_URL,
  });

  process.stdout.write(`${review.html_url ?? review.url ?? 'Review submitted'}\n`);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
