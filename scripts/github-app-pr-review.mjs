#!/usr/bin/env node
/**
 * Submit a pull request review using a GitHub App installation token.
 */

import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_API_URL,
  createInstallationToken,
  normaliseApiUrl,
  resolveRepository,
  splitRepository,
} from './github-app-token.mjs';

const USER_AGENT = 'openrd-github-app-reviewer';
const VALID_EVENTS = new Set(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);
/** GitHub silently truncates review bodies past ~65KB; cap a little
 *  higher than that so a borderline Markdown render still surfaces a
 *  clear error rather than silently corrupting the body. Anything
 *  larger almost certainly means the caller pointed --body-file at
 *  the wrong file (a build log, a binary, /dev/zero, etc.). */
const MAX_BODY_BYTES = 96 * 1024;

const usage = `Usage:
  node scripts/github-app-pr-review.mjs <pr-number> --event REQUEST_CHANGES --body-file review.md
  node scripts/github-app-pr-review.mjs <pr-number> --event COMMENT --body "Review text"

Options:
  --repo owner/repo          defaults to GITHUB_REPOSITORY or origin remote
  --installation-id id       optional; otherwise resolved from the repository
  --event EVENT              COMMENT, APPROVE, or REQUEST_CHANGES (default: COMMENT)
  --body TEXT                review body (mutually exclusive with --body-file)
  --body-file PATH           review body file; use "-" to read piped stdin
`;

/** Consume the next argv element as a value, refusing to swallow
 *  another flag silently. Mirrors the helper in github-app-token.mjs. */
const takeValue = (flag, argv, i) => {
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('-')) {
    throw new Error(`${flag} requires a value`);
  }
  return next;
};

const readStdin = async () => {
  if (process.stdin.isTTY) {
    throw new Error(
      '--body-file - reads from stdin, but stdin is a TTY. Pipe content in ' +
        "(e.g. 'cat review.md | npm run github:app-pr-review -- 23 --event COMMENT --body-file -') " +
        'or pass --body-file PATH instead.',
    );
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error(`Piped review body exceeds ${MAX_BODY_BYTES} bytes; aborting.`);
    }
    chunks.push(chunk);
  }
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
    if (!arg.startsWith('-') && args.prNumber === null) {
      args.prNumber = arg;
    } else if (arg === '--repo') {
      args.repo = takeValue('--repo', argv, i);
      i += 1;
    } else if (arg === '--installation-id') {
      args.installationId = takeValue('--installation-id', argv, i);
      i += 1;
    } else if (arg === '--event') {
      args.event = takeValue('--event', argv, i).toUpperCase();
      i += 1;
    } else if (arg === '--body') {
      args.body = takeValue('--body', argv, i);
      i += 1;
    } else if (arg === '--body-file') {
      args.bodyFile = takeValue('--body-file', argv, i);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage}`);
    }
  }

  if (!args.prNumber || !/^\d+$/.test(args.prNumber)) {
    throw new Error(`Missing or invalid PR number.\n\n${usage}`);
  }
  if (!VALID_EVENTS.has(args.event)) {
    throw new Error(
      `Invalid --event "${args.event}". Expected COMMENT, APPROVE, or REQUEST_CHANGES.`,
    );
  }
  if (args.body && args.bodyFile) {
    throw new Error('--body and --body-file are mutually exclusive; pass only one.');
  }
  if (!args.body && !args.bodyFile) {
    throw new Error(`Missing review body. Pass --body or --body-file.\n\n${usage}`);
  }
  return args;
};

const readBody = async (args) => {
  if (args.bodyFile === '-') return readStdin();
  if (args.bodyFile) {
    let size;
    try {
      const info = await stat(args.bodyFile);
      if (!info.isFile()) {
        throw new Error(`--body-file ${args.bodyFile} is not a regular file.`);
      }
      size = info.size;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(`--body-file ${args.bodyFile} does not exist.`);
      }
      throw error;
    }
    if (size > MAX_BODY_BYTES) {
      throw new Error(
        `--body-file ${args.bodyFile} is ${size} bytes; GitHub review bodies are limited ` +
          `to ~65KB. Refusing to send more than ${MAX_BODY_BYTES} bytes.`,
      );
    }
    return readFile(args.bodyFile, 'utf8');
  }
  return args.body;
};

const submitReview = async ({ repo, prNumber, event, body, token, apiUrl }) => {
  const { owner, repo: repoName } = splitRepository(repo);
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/pulls/${encodeURIComponent(
    prNumber,
  )}/reviews`;

  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
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
  } catch (error) {
    const cause = error?.cause;
    const detail = cause?.code ?? cause?.message ?? error?.message ?? String(error);
    throw new Error(`GitHub API POST ${path} network failure: ${detail}`);
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

  const apiUrl = normaliseApiUrl(process.env.GITHUB_API_URL ?? DEFAULT_API_URL);

  const tokenInfo = await createInstallationToken({
    repo,
    installationId: args.installationId,
    apiUrl,
  });

  const review = await submitReview({
    repo,
    prNumber: args.prNumber,
    event: args.event,
    body,
    token: tokenInfo.token,
    apiUrl,
  });

  process.stdout.write(`${review.html_url ?? review.url ?? 'Review submitted'}\n`);
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
