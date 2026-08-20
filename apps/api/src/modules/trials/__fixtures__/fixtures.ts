/**
 * Real captures from the two registries, and where each came from.
 *
 * They are files rather than string literals in a .ts because two of
 * them are 47–56 KB of government HTML and one is a JSON page from an
 * API; pasting either into source would make the diff unreadable and
 * the provenance unverifiable. This module is where the provenance
 * lives instead.
 *
 * Everything below was captured on 2026-08-13.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const read = (name: string): string => readFileSync(path.join(HERE, name), 'utf8');

/**
 * clinicaltrials.gov, page 1 of 2 — 50 studies, `totalCount: 92`, a
 * `nextPageToken`.
 *
 *   FIELDS=protocolSection.identificationModule.nctId,protocolSection.identificationModule.briefTitle,protocolSection.identificationModule.officialTitle,protocolSection.statusModule.overallStatus,protocolSection.statusModule.lastUpdatePostDateStruct.date,protocolSection.sponsorCollaboratorsModule.leadSponsor.name,protocolSection.designModule.phases,protocolSection.designModule.studyType,protocolSection.contactsLocationsModule.locations.country
 *   curl -sS -A 'openrd-trials/1.0 (+https://github.com/OpenRareDisease/openrd)' \
 *     -G 'https://clinicaltrials.gov/api/v2/studies' \
 *     --data-urlencode 'query.cond=facioscapulohumeral muscular dystrophy' \
 *     --data-urlencode "fields=$FIELDS" \
 *     --data-urlencode 'pageSize=50' --data-urlencode 'countTotal=true'
 *
 * The bytes are the registry's values with the repo's whitespace: the
 * pre-commit hook runs `prettier --write` over every staged .json, so
 * these were formatted by it before landing rather than reformatted
 * under some later commit. No value was edited.
 */
export const ctgovPage1 = (): string => read('ctgov.page1.json');

/** Page 2 of the same query, reached with `pageToken=<nextPageToken>`:
 *  42 studies, no `totalCount` (the API answers it on the first page
 *  only, even with `countTotal=true`), no `nextPageToken`. */
export const ctgovPage2 = (): string => read('ctgov.page2.json');

/**
 * www.chinadrugtrials.org.cn, the anti-bot page every session gets
 * first: HTTP 202, 25,210 bytes, no results table, two `Set-Cookie`
 * headers. Captured with a cold cookie jar:
 *
 *   curl -sS -L -A 'Mozilla/5.0 …' -b jar -c jar \
 *     --data-urlencode 'keywords=面肩肱' \
 *     --data 'currentpage=1&rule=CTR&sort=desc&sort2=&secondLevel=0&id=&ckm_index=' \
 *     'https://www.chinadrugtrials.org.cn/clinicaltrials.searchlist.dhtml'
 */
export const cdtChallengePage = (): string => read('chinadrugtrials.challenge.html');

/**
 * The same request repeated with the cookies that response set: HTTP
 * 200, 47,181 bytes, the results table, one 暂无数据 row and
 * 「共 0 条记录」.
 *
 * This is the live answer for an FSHD keyword, and it is what
 * 「there is no domestic FSHD trial」 looks like as HTML — as opposed
 * to the challenge above, which is what a broken scrape looks like.
 * Telling those two apart is the whole job.
 */
export const cdtZeroResultsPage = (): string => read('chinadrugtrials.searchlist.zero.html');

/**
 * A results page WITH rows, for the row parser.
 *
 * `keywords=肌营养不良`, 9 records on one page. It is a different
 * keyword because the FSHD keywords return nothing to parse; all nine
 * records are DMD/BMD trials, which is exactly why that keyword is not
 * in CDT_KEYWORDS.
 */
export const cdtRowsPage = (): string => read('chinadrugtrials.searchlist.rows.html');

/**
 * A detail page: CTR20252821, reached by GET, which is how the fetcher
 * addresses it even though the site's own UI posts a form.
 *
 *   curl -sS -L -b jar -c jar \
 *     'https://www.chinadrugtrials.org.cn/clinicaltrials.searchlistdetail.dhtml?id=eebd483a55a146c2b7181ba84e8a7e51'
 *
 * REDACTED BEFORE COMMITTING. The live page names the applicant's
 * contact person and the principal investigator with their phone
 * numbers, email addresses and postal addresses. Those values were
 * overwritten with placeholders; nothing else in the file was touched,
 * and the parser reads none of them — which is a property this fixture
 * can demonstrate precisely because they are not there.
 */
export const cdtDetailPage = (): string => read('chinadrugtrials.detail.html');
