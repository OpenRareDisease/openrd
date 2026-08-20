# ---------------------------------------------------------------------------
# Build stage.
#
# Split out because the image was single-stage: `npm ci` ran ten lines before
# `ENV NODE_ENV=production`, so typescript, vitest, supertest, eslint and tsx
# were installed, never pruned, and sat executable at runtime inside the
# container that holds patient records — alongside the full src tree and every
# compiled test module. None of that reaches the runtime stage now.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json

RUN npm ci

COPY apps/api ./apps/api

RUN npm run build --workspace @openrd/api

# A backstop, and expected to delete nothing: apps/api/tsconfig.json now
# excludes `src/**/*.test.ts`, so the build no longer emits them. It stays
# because the failure it guards against is silent — test modules import vitest
# and supertest, which the runtime stage deliberately does not install, so a
# widened `include` or a dropped `exclude` would put permanently-unloadable
# files in the container that holds patient records and nothing would say so.
RUN find apps/api/dist -name '*.test.js' -delete \
    && find apps/api/dist -name '*.test.js.map' -delete \
    && find apps/api/dist -name '*.test.d.ts' -delete

# ---------------------------------------------------------------------------
# Runtime stage.
#
# Node runtime + the Python/Tesseract toolchain the embedded OCR parser shells
# out to, and production dependencies only.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-chi-sim \
      tesseract-ocr-eng \
      libglib2.0-0 \
      libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/requirements-embedded-report.txt ./apps/api/requirements-embedded-report.txt

# --ignore-scripts is not optional alongside --omit=dev: the root package.json
# runs `husky install` on postinstall and husky is a devDependency, so without
# it npm exits 127 on a command whose only job is installing git hooks — which
# are meaningless in an image (.git is excluded from the build context). No
# dependency in apps/api has a native build step, so nothing else is skipped.
RUN npm ci --omit=dev --ignore-scripts
# Same PIP_INDEX_URL treatment Dockerfile.kb has had since it was
# written, and for the same reason — this image is built ON the
# deployment host, and the deployment host is in mainland China.
#
# Without it this line goes to the default PyPI, which from the Tencent
# Cloud box measures 20.0s to answer a simple-index request — right at
# pip's timeout. It does not fail cleanly either: the error is
#「Could not find a version that satisfies the requirement
# charset_normalizer<4,>=2 (from requests) (from versions: none)」,
# which reads like a dependency conflict and sends you off resolving
# version pins that were never the problem. Measured on the same host,
# the Tsinghua mirror answers in 0.13s.
#
# The host has /root/.pip/pip.conf pointing at a Tencent internal
# mirror already — but that file is on the HOST, and this runs inside
# the build container, which never sees it. That gap is why the image
# built fine six weeks ago and stopped: nothing changed here except
# how long the default index takes to answer.
#
# Override for a build outside mainland China:
#   docker build --build-arg PIP_INDEX_URL=https://pypi.org/simple ...
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
RUN pip3 install --break-system-packages --no-cache-dir \
      -i ${PIP_INDEX_URL} -r ./apps/api/requirements-embedded-report.txt

# The build output — this is what CMD runs.
COPY --from=builder /app/apps/api/dist ./apps/api/dist
# The OCR parser. routes/index.ts resolves it as
# ../report-manager/embedded_parser.py from the /app/apps/api cwd.
COPY apps/report-manager ./apps/report-manager
# The migrations. migrate.ts resolves ../../db/migrations from the same cwd,
# and the first half of CMD runs it.
COPY db ./db

# One script, not scripts/. Granting the first administrator has to
# happen on a running production stack, and the alternative to shipping
# this file is a runbook telling the operator to UPDATE app_users in
# psql — which skips the audit_logs row admin-role.mjs writes in the
# same transaction as the role change. In a back office whose whole
# design is that reads are audited, the one unaudited action would be
# the one that creates the reader.
#
# It grants no privilege that exec access does not already carry: a
# shell in this container can reach the same database with the same
# credentials. Its dependency (`pg`) is already here from npm ci.
#
# Deliberately not `COPY scripts ./scripts`: that directory also holds
# the KB ingest tooling and the GitHub App helper that reads a private
# key off the maintainer's disk. Neither belongs in an image that runs
# on a host serving patients.
COPY scripts/admin-role.mjs ./scripts/admin-role.mjs

WORKDIR /app/apps/api
ENV NODE_ENV=production
# BELT AND BRACES ONLY. node:20-bookworm-slim has no TZ set and runs UTC,
# and the patients this serves are at UTC+8 — so every date this image
# rendered was eight hours away from the date the handset rendered for
# the same instant, and the passport, the share page and the referral
# pack disagreed with the mobile PDF by a full day for any report filed
# between 16:00 and 24:00 UTC.
#
# Setting this line was NOT the fix, and nothing may be allowed to
# depend on it. It makes exactly this deployment agree, and the next one
# — another region, a maintainer's laptop, a CI box, a patient's phone
# set to another zone — goes back to disagreeing with no error anywhere.
# The calendar is declared in the code, as PRODUCT_TIME_ZONE in
# src/modules/patient-profile/profile.passport.ts and again, with the
# same value and the same arithmetic, in
# apps/mobile/lib/clinical-visuals.ts. Both sides compute the product
# day from an absolute instant and never read the ambient zone, which is
# what profile.passport.dates.test.ts pins by rendering all four
# documents under mismatched zones. Deleting this line must not change
# a single printed date; if it ever does, the code regressed.
ENV TZ=Asia/Shanghai
ENV OCR_PYTHON_BIN=python3
# Production OCR is Tesseract-only, and that is a decision rather than an
# accident: paddleocr is in neither requirements file this image installs, so
# unsetting this alone would only move the failure to ocr_service.py's lazy
# import. PaddleOCR has been measured peaking at 6.4 GB in one process, which
# is well past the api container's mem_limit in docker-compose.yml. If this is
# ever flipped, add paddleocr + numpy to requirements-embedded-report.txt,
# raise that limit, and re-check OCR_PARSER_TIMEOUT_MS first.
ENV OCR_DISABLE_PADDLE=true

EXPOSE 4000

# `exec` on the second command is load-bearing. Without it, whether the shell
# replaces itself with node — making node PID 1, the only process that can
# receive the container's SIGTERM — depends on the shell: dash execs the last
# command of an && list, bash does not. On this Debian base /bin/sh is dash, so
# it happens to work today, but a base-image change, a third command, a pipe or
# a trap would silently turn PID 1 back into the shell. A PID 1 with no handler
# for SIGTERM has it discarded by the kernel outright, which would make every
# line of the graceful-shutdown path in src/index.ts inert with no error
# anywhere: no readiness drain, no connection draining, no pool close, just a
# SIGKILL at the end of stop_grace_period.
CMD ["sh", "-c", "node --enable-source-maps dist/db/migrate.js && exec node --enable-source-maps dist/index.js"]
