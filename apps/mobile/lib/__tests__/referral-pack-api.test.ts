import {
  REFERRAL_PACK_SHAPE_ERROR,
  fetchMyReferralPack,
  isGeneticallyConfirmed,
  parseReferralPack,
} from '../referral-pack-api';

jest.mock('../api', () => ({ apiRequest: jest.fn() }));

const { apiRequest } = require('../api') as { apiRequest: jest.Mock };

/**
 * REAL_BODY below is not a hand-written fixture. It was dumped from
 * `buildReferralPack` in apps/api — a self-reported diagnosis plus one
 * uploaded pulmonary-function report OCR could not read — and every
 * field name, enum value and sentence in it is that dump verbatim. The
 * one exception is `markdown`, cut to its first lines: the assertions
 * only read its head, and six kilobytes of document pasted here would
 * bury the rest of this file.
 *
 * A fixture invented on this side would prove only that this side
 * agrees with itself, and that is the failure `apiRequest` has already
 * caused once: its type parameter is an unchecked assertion, so a
 * client can be green against its own idea of the response and wrong
 * against the server's. See the header of passport-share-api.ts for
 * what that cost.
 */
const REAL_BODY = {
  documentTitle: '张三 罕见病诊疗协作网转诊资料',
  fileName: '张三-referral-pack.md',
  contentType: 'text/markdown',
  generatedAt: '2026-08-05T12:00:00.000Z',
  patientName: '张三',
  passportId: 'FSHD-P1',
  latestUpdatedAt: '2026-02-10T12:00:00.000Z',
  diagnosis: {
    confirmation: 'self_reported',
    statement: '面肩肱型肌营养不良症（FSHD）—— 本人填报，本平台未收到基因报告，请勿按已确诊处理',
    geneticType: 'FSHD1',
    d4z4Repeats: '—',
    methylationValue: '—',
    diagnosisDate: '—',
    geneEvidence: 'FSHD1',
    latestSourceDate: null,
  },
  functionTests: [],
  devices: { state: 'not_recorded', devices: [], startEvents: [] },
  respiratory: { nivStartedAt: null, breathingSymptomsRecorded: null },
  monitoring: [
    {
      key: 'blood',
      title: '血检指标',
      state: 'absent',
      statement: '本平台没有该类报告的记录 —— 不等于没有做过，请当面询问',
      latestDate: null,
      freshnessLabel: '缺失',
      note: 'CK 等指标常用于诊断阶段。目前没有指南建议靠定期抽血来追踪 FSHD 的进展 —— 这一栏展示的是你已上传的结果。',
    },
    {
      key: 'respiratory',
      title: '肺功能',
      state: 'unreadable',
      statement: '已上传该类报告（2026-02-10），但本平台未能自动读出数值 —— 请向患者索取原件',
      latestDate: '2026-02-10',
      freshnessLabel: '待更新',
      note: '指南建议每位 FSHD 患者都做一次肺功能基线。另外，如果要做全身麻醉的手术，术前应先查一次 —— 呼吸肌受累可能没有任何症状。',
    },
    {
      key: 'cardiac',
      title: '心脏检查',
      state: 'absent',
      statement: '本平台没有该类报告的记录 —— 不等于没有做过，请当面询问',
      latestDate: null,
      freshnessLabel: '缺失',
      note: '没有症状的 FSHD 患者不需要常规做心电图或心脏超声 —— 这一点和 DMD 等其他肌营养不良不同。两种情况例外：出现胸痛、心悸或不寻常的气短时应该去做心脏评估；以及手术前 —— FSHD 的术前评估应当包括心电图和心脏超声。',
    },
  ],
  questions: [],
  markdown:
    '# 张三 罕见病诊疗协作网转诊资料\n\n- 病种：面肩肱型肌营养不良症（Facioscapulohumeral muscular dystrophy，FSHD）\n- 目录依据：《第二批罕见病目录》序号 25，国卫医政发〔2023〕26号（2023-09-18）\n',
};

beforeEach(() => apiRequest.mockReset());

describe('拆信封 —— 泛型断言不算数', () => {
  it('裸响应体（profile.routes.ts 现在的写法）能解析', async () => {
    apiRequest.mockResolvedValue(REAL_BODY);
    const pack = await fetchMyReferralPack();
    expect(pack.markdown).toContain('罕见病诊疗协作网转诊资料');
    expect(pack.monitoring).toHaveLength(3);
  });

  it('{ data: ... } 信封（passport-share.routes.ts 的写法）也能解析', async () => {
    // Both conventions are live in this codebase. A client that
    // depends on which one it is talking to breaks the day a route is
    // brought in line with the other.
    apiRequest.mockResolvedValue({ data: REAL_BODY });
    expect((await fetchMyReferralPack()).monitoring).toHaveLength(3);
  });

  it('打的是 /profiles/me/referral-pack', async () => {
    apiRequest.mockResolvedValue(REAL_BODY);
    await fetchMyReferralPack();
    expect(apiRequest).toHaveBeenCalledWith('/profiles/me/referral-pack');
  });
});

describe('三种状态必须活着到屏幕上', () => {
  it('unreadable 不会变成 absent', () => {
    const pack = parseReferralPack(REAL_BODY);
    const respiratory = pack.monitoring.find((slot) => slot.key === 'respiratory');
    expect(respiratory?.state).toBe('unreadable');
    expect(respiratory?.statement).toContain('请向患者索取原件');
  });

  it('absent 带着「不等于没有做过」一起过来', () => {
    const pack = parseReferralPack(REAL_BODY);
    const cardiac = pack.monitoring.find((slot) => slot.key === 'cardiac');
    expect(cardiac?.state).toBe('absent');
    expect(cardiac?.statement).toContain('不等于没有做过');
  });

  it('认不出的 state 直接报错，而不是当成 absent', () => {
    // Defaulting here would print 「这项没做过」 for a report the
    // patient has in their bag, and nothing on screen would show that
    // a default had been taken.
    const body = {
      ...REAL_BODY,
      monitoring: [{ ...REAL_BODY.monitoring[0], state: 'pending' }],
    };
    expect(() => parseReferralPack(body)).toThrow(REFERRAL_PACK_SHAPE_ERROR);
  });

  it('缺了 state 字段也报错', () => {
    const slot = { ...REAL_BODY.monitoring[0] } as Record<string, unknown>;
    delete slot.state;
    expect(() => parseReferralPack({ ...REAL_BODY, monitoring: [slot] })).toThrow(
      REFERRAL_PACK_SHAPE_ERROR,
    );
  });

  it('保留「这项到底要不要做」的说明', () => {
    const pack = parseReferralPack(REAL_BODY);
    expect(pack.monitoring.every((slot) => slot.note !== null)).toBe(true);
  });
});

describe('少了要命的东西就整份不显示', () => {
  it('没有 markdown —— 那就是这份资料本身', () => {
    const body = { ...REAL_BODY, markdown: '' };
    expect(() => parseReferralPack(body)).toThrow(REFERRAL_PACK_SHAPE_ERROR);
  });

  it('没有诊断结论那句话', () => {
    // 「请勿按已确诊处理」 lives in that sentence. A pack that lost it
    // is a pack that upgrades a guess to a diagnosis by omission.
    const body = { ...REAL_BODY, diagnosis: { confirmation: 'self_reported' } };
    expect(() => parseReferralPack(body)).toThrow(REFERRAL_PACK_SHAPE_ERROR);
  });

  it('monitoring 不是数组', () => {
    expect(() => parseReferralPack({ ...REAL_BODY, monitoring: null })).toThrow(
      REFERRAL_PACK_SHAPE_ERROR,
    );
  });

  it('响应根本不是对象', () => {
    expect(() => parseReferralPack(null)).toThrow(REFERRAL_PACK_SHAPE_ERROR);
    expect(() => parseReferralPack('nope')).toThrow(REFERRAL_PACK_SHAPE_ERROR);
  });

  it('报错的话里说清楚「记录没丢」，并给出另一条路', () => {
    expect(REFERRAL_PACK_SHAPE_ERROR).toContain('没有丢失');
    expect(REFERRAL_PACK_SHAPE_ERROR).toContain('临床护照');
  });
});

describe('可以缺、但不能猜错的字段', () => {
  it('generatedAt 缺失时是 null，不编一个日期出来', () => {
    const body = { ...REAL_BODY } as Record<string, unknown>;
    delete body.generatedAt;
    expect(parseReferralPack(body).generatedAt).toBeNull();
  });

  it('documentTitle 缺失时退回一个不带姓名的通用标题', () => {
    const body = { ...REAL_BODY } as Record<string, unknown>;
    delete body.documentTitle;
    expect(parseReferralPack(body).documentTitle).toBe('罕见病诊疗协作网转诊资料');
  });
});

describe('确诊与否', () => {
  it('self_reported 不算确诊', () => {
    expect(isGeneticallyConfirmed(parseReferralPack(REAL_BODY))).toBe(false);
  });

  it('genetic 才算', () => {
    const body = { ...REAL_BODY, diagnosis: { ...REAL_BODY.diagnosis, confirmation: 'genetic' } };
    expect(isGeneticallyConfirmed(parseReferralPack(body))).toBe(true);
  });

  it('没见过的取值一律按未确诊处理', () => {
    // The safe direction: an unknown value keeps the caution on screen
    // rather than removing it.
    const body = { ...REAL_BODY, diagnosis: { ...REAL_BODY.diagnosis, confirmation: 'probable' } };
    expect(isGeneticallyConfirmed(parseReferralPack(body))).toBe(false);
  });
});
