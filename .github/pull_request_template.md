<!--
This template exists because of what merging looked like before CI: a
180-file change to a service holding FSHD patient records could be approved
by one person with nothing recorded about what had been verified. The three
jobs in .github/workflows/ci.yml now answer the "did the tests pass" half
automatically. The sections below are for the half a workflow cannot check.

Delete any section that genuinely does not apply — an empty heading is worse
than no heading.
-->

## What this changes

<!-- One paragraph: the behaviour before, the behaviour after. -->

## Why

<!-- The problem being solved. Link the issue if there is one. -->

## Patient data impact

<!--
Answer explicitly if this touches any of the paths in .github/CODEOWNERS:
apps/api/src/modules/{ai-agents,patient-profile,auth}, apps/api/src/services/otp,
apps/report-manager, apps/api/src/services/ocr, or db/migrations.

  - What patient-visible or patient-derived data does this read, write, delete
    or send to a model?
  - Does it change what reaches a prompt, a log line, or an API response?
  - If it adds a migration: is the matching _down.sql non-destructive, and if
    not, what is lost on rollback?

Write "none" if the change cannot touch patient data at all.
-->

## How this was verified

<!--
CI runs lint / format / typecheck / test for apps/api, lint / typecheck / test
for apps/mobile, and pytest for apps/report-manager + scripts/kb_parsers.
Record here only what CI cannot: manual steps, what was checked against a real
report or a real device, and anything that was deliberately not covered.
-->

## Deployment notes

<!--
New or renamed environment variables (add them to .env.example in this PR),
new migrations, anything that has to happen in a particular order on deploy
day, and anything docs/release-checklist.md or the runbook now needs to say.
Write "none" if the change deploys with no operator action.
-->
