/**
 * 病种身份码 — the content.
 *
 * These tests live under the screen rather than beside the lib file
 * because this change owns `screens/p-referral/**` and does not own
 * `lib/__tests__`. The subject is `lib/disease-identity-content.ts`.
 *
 * What they are for: this page's entire value is that a patient can
 * read a line off it and say it at a counter. Two ways to destroy that,
 * and both are one careless edit away —
 *
 *   1. a code rendered without the system it belongs to. G71.02 and
 *      G71.0 differ by one character and by a continent.
 *   2. a code nobody checked. A fabricated code on a page built for
 *      quotability is worse than a missing one, so every entry carries
 *      a `source` and this file refuses an empty one.
 */

import {
  DISEASE_IDENTITY_CODES,
  DISEASE_IDENTITY_UNVERIFIED,
  scopeLabel,
  type DiseaseIdentityCode,
} from '../../../lib/disease-identity-content';

const byId = (id: string): DiseaseIdentityCode => {
  const entry = DISEASE_IDENTITY_CODES.find((code) => code.id === id);
  if (!entry) throw new Error(`missing identity code: ${id}`);
  return entry;
};

describe('每一条都带着自己的编码体系', () => {
  it('quotable 里一定同时有体系和码，绝不只有码', () => {
    // Either the string names the system (「ICD-11 8C70.3」) or the code
    // itself is self-prefixed with it (「ORPHA:269」, 「MONDO:0008030」).
    // What is forbidden is a naked number a patient could read out with
    // no way for the listener to know which registry it belongs to.
    const SYSTEM_TOKEN = /(ICD-11|ICD-10-CM|ICD-10|ORPHA|MONDO|OMIM|目录)/;
    for (const entry of DISEASE_IDENTITY_CODES) {
      expect(entry.quotable).toContain(entry.code);
      expect(entry.quotable).toMatch(SYSTEM_TOKEN);
      expect(entry.system.trim().length).toBeGreaterThan(0);
    }
  });

  it('每条都有出处，没有一条是凭印象写的', () => {
    for (const entry of DISEASE_IDENTITY_CODES) {
      expect(entry.source.trim().length).toBeGreaterThan(10);
    }
  });

  it('每条都有中英文名称和用途说明', () => {
    for (const entry of DISEASE_IDENTITY_CODES) {
      expect(entry.labelEn.trim().length).toBeGreaterThan(0);
      expect(entry.labelZh.trim().length).toBeGreaterThan(0);
      expect(entry.useZh.trim().length).toBeGreaterThan(0);
    }
  });

  it('id 不重复', () => {
    const ids = DISEASE_IDENTITY_CODES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('核对过的码，逐条', () => {
  it('ICD-11 MMS 8C70.3 是 FSHD 的专属码', () => {
    const entry = byId('icd11');
    expect(entry.code).toBe('8C70.3');
    expect(entry.system).toContain('ICD-11');
    expect(entry.labelEn).toBe('Facioscapulohumeral muscular dystrophy');
    expect(entry.scope).toBe('international');
  });

  it('ICD-10 G71.0 是「肌营养不良」整类，不是 FSHD 专属', () => {
    const entry = byId('icd10');
    expect(entry.code).toBe('G71.0');
    expect(entry.labelEn).toBe('Muscular dystrophy');
    // Without this caveat the page implies a G71.0 on a 病历 means
    // someone confirmed FSHD. It does not — Duchenne, Becker and
    // limb-girdle all sit under the same code.
    expect(entry.caveatZh).toContain('没有 FSHD 的专属编码');
  });

  it('ORPHA:269 与 OMIM / MONDO 的号都写在这里', () => {
    expect(byId('orpha').code).toBe('ORPHA:269');
    expect(byId('omim-fshd1').code).toBe('158900');
    expect(byId('omim-fshd2').code).toBe('158901');
    expect(byId('mondo-fshd1').code).toBe('MONDO:0008030');
    expect(byId('mondo-umbrella').code).toBe('MONDO:0001347');
  });

  it('FSHD1 专属的号说明自己只指 1 型', () => {
    // MONDO:0008030 and OMIM 158900 are both the FSHD1 entity, not the
    // umbrella. Presenting either as「FSHD 的编号」would tell a patient
    // whose report says SMCHD1 that they are looking at their own code.
    expect(byId('omim-fshd1').labelEn).toContain('1');
    expect(byId('omim-fshd1').caveatZh).toContain('158901');
    expect(byId('mondo-fshd1').labelEn).toBe('facioscapulohumeral muscular dystrophy 1');
    expect(byId('mondo-fshd1').caveatZh).toContain('MONDO:0001347');
    expect(byId('mondo-umbrella').labelEn).toBe('facioscapulohumeral muscular dystrophy');
  });

  it('《第二批罕见病目录》序号 25 与文号写全', () => {
    const entry = byId('catalogue');
    expect(entry.quotable).toContain('序号 25');
    expect(entry.quotable).toContain('国卫医政发〔2023〕26号');
  });
});

describe('G71.02 必须被标成美国专用', () => {
  it('scope 是 us_only，且 quotable 自带「美国专用」', () => {
    const entry = byId('icd10cm');
    expect(entry.code).toBe('G71.02');
    expect(entry.scope).toBe('us_only');
    // The scope has to survive into the string a patient reads aloud.
    // A patient quoting G71.02 at a Chinese 医保 window gets nowhere,
    // and this is the code Chinese-language write-ups most often
    // reprint as「FSHD 的 ICD-10 编码」.
    expect(entry.quotable).toContain('美国专用');
    expect(entry.system).toContain('只在美国使用');
    expect(entry.caveatZh).toContain('国内医保或病案窗口没有用');
  });

  it('它是唯一一条 us_only', () => {
    const usOnly = DISEASE_IDENTITY_CODES.filter((entry) => entry.scope === 'us_only');
    expect(usOnly.map((entry) => entry.id)).toEqual(['icd10cm']);
  });

  it('scopeLabel 把 us_only 说成「仅限美国」', () => {
    expect(scopeLabel('us_only')).toBe('仅限美国');
  });
});

describe('没核实到的东西，写出来', () => {
  it('明说没有写国内扩展码，并告诉患者去哪问', () => {
    expect(DISEASE_IDENTITY_UNVERIFIED).toContain('没有核实到');
    expect(DISEASE_IDENTITY_UNVERIFIED).toContain('病案室');
  });

  it('没有任何一条码带着未核实的扩展位', () => {
    // A 国临版 extension would look like G71.000 / G71.002. Nothing on
    // this page may carry one, because none could be verified.
    for (const entry of DISEASE_IDENTITY_CODES) {
      expect(entry.code).not.toMatch(/^G71\.\d{3}/);
    }
  });
});
