import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_VERSIONS,
  LEGAL_EFFECTIVE_DATE,
  type LegalDocumentId,
} from '../legal-content';
import { LEGAL_VERSION_NOTES, buildConsentAsks } from '../legal-updates';

/**
 * The re-consent ask.
 *
 * What this file pins is the difference between 「隐私政策更新了，请重新
 * 同意」 and telling a patient WHAT changed. §9 promises the second one.
 */

describe('每一个改过版本的文件都要说出改了什么', () => {
  it.each(Object.entries(LEGAL_DOCUMENT_VERSIONS))(
    '%s 的当前版本有对应的说明，或者它本来就没改过',
    (document, version) => {
      const notes = LEGAL_VERSION_NOTES[document as LegalDocumentId];
      if (version === LEGAL_EFFECTIVE_DATE) {
        // Never revised — nothing to summarise, and inventing copy for
        // an unchanged document would put a note on screen that says
        // nothing.
        expect(notes).toEqual([]);
        return;
      }
      // Revised. A bump with no note leaves the patient with a version
      // number and a button, which is the formality this screen exists
      // to not be.
      expect(notes.map((note) => note.version)).toContain(version);
    },
  );

  it('说明里的每一条都不是空话', () => {
    for (const notes of Object.values(LEGAL_VERSION_NOTES)) {
      for (const note of notes) {
        expect(note.headline.length).toBeGreaterThan(10);
        expect(note.changes.length).toBeGreaterThan(0);
        for (const line of note.changes) expect(line.length).toBeGreaterThan(10);
      }
    }
  });

  it('这一版说出的是后台这件事，不是一句「条款有更新」', () => {
    const note = LEGAL_VERSION_NOTES[LEGAL_DOCUMENTS.privacyPolicy].find(
      (item) => item.version === '2026-08-13',
    );
    expect(note).toBeDefined();
    const text = [note?.headline, ...(note?.changes ?? [])].join('\n');
    expect(text).toContain('管理员');
    expect(text).toContain('管理员代填');
    expect(text).toContain('180 天');
    // 十二项 by name — the same allowlist ADMIN_WRITABLE_BASELINE_FIELDS
    // enforces server-side.
    expect(text).toContain('D4Z4');
    // The thing a patient would most want to be told is refused.
    expect(text).toContain('服务端会拒绝代填');
  });
});

describe('buildConsentAsks', () => {
  const summary = (overrides: Partial<Parameters<typeof buildConsentAsks>[0]> = {}) => ({
    acceptances: [
      { document: LEGAL_DOCUMENTS.userAgreement, version: '2026-08-02', acceptedAt: '2026-08-02' },
      { document: LEGAL_DOCUMENTS.privacyPolicy, version: '2026-08-02', acceptedAt: '2026-08-02' },
    ],
    outstanding: [LEGAL_DOCUMENTS.privacyPolicy],
    ...overrides,
  });

  it('asks about the revised privacy policy and carries the note that explains it', () => {
    const asks = buildConsentAsks(summary());
    expect(asks).toHaveLength(1);
    expect(asks[0].document).toBe(LEGAL_DOCUMENTS.privacyPolicy);
    expect(asks[0].acceptedVersion).toBe('2026-08-02');
    expect(asks[0].currentVersion).toBe('2026-08-13');
    expect(asks[0].notes.map((note) => note.version)).toEqual(['2026-08-13']);
    // The full text travels with the ask, so the screen shows the
    // authority under the summary rather than a second copy of it.
    expect(asks[0].sections.length).toBeGreaterThan(0);
  });

  it('says nothing about a version the patient already accepted', () => {
    const asks = buildConsentAsks(
      summary({
        acceptances: [
          {
            document: LEGAL_DOCUMENTS.privacyPolicy,
            version: '2026-08-13',
            acceptedAt: '2026-08-13',
          },
        ],
      }),
    );
    // THE LOOP THIS PREVENTS: the web export ships separately from the
    // API (legal.constants.ts says so), so the server can call a
    // version current that this bundle cannot display. Asking would
    // record the same version the ledger already holds, the server
    // would still report it outstanding, and the screen would come
    // straight back — with no way out for the patient.
    expect(asks).toEqual([]);
  });

  it('still asks when the ledger holds nothing at all, and admits it has nothing to diff', () => {
    // The registration write that never landed — the case
    // p-login_register documents as self-healing into a re-ask.
    const asks = buildConsentAsks(summary({ acceptances: [] }));
    expect(asks).toHaveLength(1);
    expect(asks[0].acceptedVersion).toBeNull();
    expect(asks[0].notes).toEqual([]);
  });

  it('skips a document this build does not carry the text of', () => {
    const asks = buildConsentAsks(summary({ outstanding: ['research_consent_v2'] }));
    expect(asks).toEqual([]);
  });

  it('asks about the guardian rules in the guardian words', () => {
    const asks = buildConsentAsks({
      acceptances: [
        {
          document: LEGAL_DOCUMENTS.guardianConsent,
          version: '2026-08-02',
          acceptedAt: '2026-08-02',
        },
      ],
      outstanding: [LEGAL_DOCUMENTS.guardianConsent],
    });
    expect(asks).toHaveLength(1);
    expect(asks[0].acceptLabel).toContain('监护人');
    expect(asks[0].notes[0].headline).toContain('患儿');
  });

  it('keeps two outstanding documents in a fixed order', () => {
    const asks = buildConsentAsks({
      acceptances: [
        {
          document: LEGAL_DOCUMENTS.guardianConsent,
          version: '2026-08-02',
          acceptedAt: '2026-08-02',
        },
        {
          document: LEGAL_DOCUMENTS.privacyPolicy,
          version: '2026-08-02',
          acceptedAt: '2026-08-02',
        },
      ],
      outstanding: [LEGAL_DOCUMENTS.guardianConsent, LEGAL_DOCUMENTS.privacyPolicy],
    });
    expect(asks.map((ask) => ask.document)).toEqual([
      LEGAL_DOCUMENTS.privacyPolicy,
      LEGAL_DOCUMENTS.guardianConsent,
    ]);
  });

  it('reads nothing into a missing response', () => {
    expect(buildConsentAsks(null)).toEqual([]);
    expect(buildConsentAsks({})).toEqual([]);
  });
});
