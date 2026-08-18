// The card reads `readPassportValueOrigins` out of api.ts, which pulls
// in AsyncStorage through session-storage, and that has no native module
// under jest. Same stub api-transport.test.ts uses.
jest.mock('../session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

import { buildAnesthesiaCard } from '../anesthesia-card';
import { wrapText } from '../anesthesia-card-image';
import type { ClinicalPassportSummary } from '../api';

/**
 * This card is handed to an anesthetist before surgery. Two things it
 * must never do: overstate how the diagnosis is backed, and present a
 * literature summary as an instruction.
 */

/** One `PassportValueOrigin`, worded the way the API words it. */
const valueOrigin = (kind: string, labelZh: string) => ({
  kind,
  labelZh,
  documentId: null,
  adminUserId: null,
  at: null,
  detail: null,
});

/** The whole map. `readPassportValueOrigins` is all-or-nothing, so a
 *  fixture that names one key still has to carry the other three. */
const origins = (over: Record<string, ReturnType<typeof valueOrigin>>) => ({
  geneticType: valueOrigin('absent', '未填'),
  d4z4Repeats: valueOrigin('absent', '未填'),
  methylationValue: valueOrigin('absent', '未填'),
  diagnosisDate: valueOrigin('absent', '未填'),
  ...over,
});

const summary = (over: Record<string, unknown> = {}) =>
  ({
    patientName: '张三',
    diagnosis: {
      confirmation: 'genetic',
      d4z4Repeats: '4',
      laboratoryRepeatCount: '4',
      geneticType: 'FSHD1',
      valueOrigins: origins({
        geneticType: valueOrigin('patient', '本人填写'),
        d4z4Repeats: valueOrigin('report', '报告读取'),
      }),
    },
    monitoring: {
      items: [
        {
          key: 'respiratory',
          available: true,
          summary: 'FVC 78%',
          latestDate: '2026-03-02T12:00:00.000Z',
        },
        { key: 'cardiac', available: false, summary: '暂无心脏检查数据', latestDate: null },
      ],
    },
    ...over,
  }) as unknown as ClinicalPassportSummary;

// 一个固定时刻，不是本地分量。以前这里写成 new Date(2026, 7, 5, ...) 是为了
// 绕开「生成日期」在 UTC 以西退一天；那个 bug 已经修好（formatDate 走
// clinical-visuals 的 formatProductDate，按 Asia/Shanghai 结算），本地分量
// 反而让这个输入本身跟着运行机器的时区跑。跨时区的断言在
// __tests__/date-only-timezone.test.ts。
const TODAY = new Date('2026-08-05T04:00:00.000Z');
const allText = (s: ClinicalPassportSummary) => {
  const card = buildAnesthesiaCard(s, TODAY);
  return [
    card.title,
    card.patientName,
    ...card.patientLines,
    ...card.sections.flatMap((section) => [section.title, ...section.lines]),
    ...card.sources,
    card.disclaimer,
  ].join('\n');
};

describe('诊断依据不能在卡上被抬高', () => {
  it('基因确诊时写明并带上重复数', () => {
    const card = buildAnesthesiaCard(summary(), TODAY);
    expect(card.patientLines[0]).toContain('基因确诊');
    expect(card.patientLines[0]).toContain('4');
  });

  it('未确诊时说的是这张卡上没有什么，不是说没收到报告', () => {
    // An anesthetist who reads 「FSHD」 will plan around FSHD. If nobody
    // has confirmed it, they are entitled to know that before they pick
    // an airway plan on the strength of it — but 「本人填报，本平台尚未
    // 收到基因报告」 is false in both halves on this very fixture: the
    // 分型 is read off an uploaded report, so nobody filed it and a
    // report IS on file.
    //
    // NOR DOES IT NAME THE THREE TESTS. The line used to end
    // 「（D4Z4 重复数、4q 单倍型或 EcoRI 片段）」, which is the API's
    // confirmation rule copied onto a card that gets folded into a
    // wallet: a report stating a non-permissive 4qB haplotype is not a
    // confirmation and does have a 4q 单倍型 on it, so that parenthesis
    // tells the anesthetist a report they can see was never read. What
    // is true of every state is what is on the card.
    const card = buildAnesthesiaCard(
      summary({
        diagnosis: {
          confirmation: 'self_reported',
          d4z4Repeats: '—',
          geneticType: 'FSHD1',
          valueOrigins: origins({ geneticType: valueOrigin('report', '报告读取') }),
        },
      }),
      TODAY,
    );
    expect(card.patientLines[0]).toContain('未经基因确诊');
    expect(card.patientLines[0]).toContain('这张卡上没有可作确诊依据的基因结果');
    expect(card.patientLines[0]).not.toContain('EcoRI 片段');
    expect(card.patientLines[0]).not.toContain('4q 单倍型');
    expect(card.patientLines[0]).not.toContain('本人填报');
    expect(card.patientLines[0]).not.toContain('尚未收到');
    expect(card.patientLines[0]).not.toContain('基因确诊（');
  });

  /**
   * THE STATE THE PARENTHESIS WAS WRONG IN, ASSERTED AT THE WIRE.
   *
   * `genetic_non_permissive` is what the API sends for a laboratory
   * report that determined the 4q haplotype and got 4qB. It is not a
   * confirmation, so this card must take the unconfirmed branch — but a
   * laboratory did read this patient's sample, and a card claiming no
   * 4q 单倍型 was found is contradicting the report in the anesthetist's
   * other hand.
   */
  it('单倍型非允许型时按未确诊印，且不声称没读到单倍型', () => {
    const card = buildAnesthesiaCard(
      summary({
        diagnosis: {
          confirmation: 'genetic_non_permissive',
          d4z4Repeats: '3',
          geneticType: 'FSHD1',
          valueOrigins: origins({
            geneticType: valueOrigin('report', '报告读取'),
            d4z4Repeats: valueOrigin('report', '报告读取'),
          }),
        },
      }),
      TODAY,
    );
    expect(card.patientLines[0]).toContain('未经基因确诊');
    expect(card.patientLines[0]).not.toContain('4q 单倍型');
    // And the repeat count stays off the airway line: this branch prints
    // no number, which is what keeps 「这张卡上没有」 true.
    expect(card.patientLines[0]).not.toContain('3');
  });

  it('分型是谁给的，跟着分型一起写出来', () => {
    // 「患者说自己是 FSHD1」 and 「我们从他的报告里读到 FSHD1」 are
    // different things to plan from, so the card prints whichever one
    // the server named and asserts neither on its own.
    const line = (kind: string, label: string) =>
      buildAnesthesiaCard(
        summary({
          diagnosis: {
            confirmation: 'self_reported',
            d4z4Repeats: '—',
            geneticType: 'FSHD1',
            valueOrigins: origins({ geneticType: valueOrigin(kind, label) }),
          },
        }),
        TODAY,
      ).patientLines[0];
    expect(line('report', '报告读取')).toContain('档案里的分型为 FSHD1（报告读取）');
    expect(line('patient', '本人填写')).toContain('档案里的分型为 FSHD1（本人填写）');
    expect(line('indeterminate', '来源无法确定')).toContain('档案里的分型为 FSHD1（来源无法确定）');
  });

  it('服务端没给来源时不替它编一个 —— 那一句整个不出现', () => {
    const card = buildAnesthesiaCard(
      summary({
        diagnosis: { confirmation: 'self_reported', d4z4Repeats: '—', geneticType: 'FSHD1' },
      }),
      TODAY,
    );
    expect(card.patientLines[0]).toContain('未经基因确诊');
    expect(card.patientLines[0]).not.toContain('档案里的分型');
  });

  /**
   * `confirmation` 是证据分级，不回答「这一行是谁写上去的」，而印在
   * 「D4Z4 重复数」上的那个数还可能来自基线 —— 后台照着电话里念的报告
   * 代填的，或患者自己填的。把它接在 「基因确诊（」 后面，就等于把实验室
   * 的分量借给了一个没人见过报告的数字，而看这张卡的麻醉医生手边没有
   * 任何东西可以核对。
   */
  it('确诊时括号里只写报告读出来的重复数', () => {
    const fromBaseline = buildAnesthesiaCard(
      summary({
        diagnosis: {
          confirmation: 'genetic',
          d4z4Repeats: '6',
          laboratoryRepeatCount: null,
          geneticType: '—',
          valueOrigins: origins({ d4z4Repeats: valueOrigin('admin_entered', '管理员代填') }),
        },
      }),
      TODAY,
    );

    expect(fromBaseline.patientLines[0]).toBe('诊断：FSHD，基因确诊');
    expect(fromBaseline.patientLines[0]).not.toContain('6');
  });

  /**
   * 这一句问的是那一格写着什么，不是这一行是从哪来的。
   *
   * 这张卡问的曾经是 `valueOrigins.d4z4Repeats.kind === 'report'` ——
   * 那只说明这一行是从某份文件里读出来的，没读那一格写的是什么。报告
   * 那一格写着区间的时候，麻醉医生手上这张卡印出来的是「诊断：FSHD，
   * 基因确诊（D4Z4 重复数 1-10）」。现在那一格由服务端读，卡只印服务端
   * 读出来的那个数。
   */
  it('那一格是区间时，即使标着「报告读取」也不印进括号', () => {
    const card = buildAnesthesiaCard(
      summary({
        diagnosis: {
          confirmation: 'genetic',
          d4z4Repeats: '1-10',
          laboratoryRepeatCount: null,
          geneticType: '—',
          valueOrigins: origins({ d4z4Repeats: valueOrigin('report', '报告读取') }),
        },
      }),
      TODAY,
    );

    expect(card.patientLines[0]).toBe('诊断：FSHD，基因确诊');
    expect(card.patientLines[0]).not.toContain('1-10');
  });

  it('报告读出来的重复数照常印在括号里', () => {
    const fromReport = buildAnesthesiaCard(summary(), TODAY);
    expect(fromReport.patientLines[0]).toBe('诊断：FSHD，基因确诊（D4Z4 重复数 4）');
  });

  /** 缓存在微信里的旧包会碰上不发这个字段的服务端。答不上来就不印。 */
  it('服务端没发这个字段时，不把印出来的那一行当成报告的读数', () => {
    const card = buildAnesthesiaCard(
      summary({
        diagnosis: {
          confirmation: 'genetic',
          d4z4Repeats: '6',
          geneticType: '—',
          valueOrigins: origins({ d4z4Repeats: valueOrigin('report', '报告读取') }),
        },
      }),
      TODAY,
    );

    expect(card.patientLines[0]).toBe('诊断：FSHD，基因确诊');
    expect(card.patientLines[0]).not.toContain('6');
  });

  /** 未确诊那一支上这张卡本来就不印重复数，所以「这张卡上没有」是真的。 */
  it('未确诊时卡上确实没有重复数', () => {
    const card = buildAnesthesiaCard(
      summary({
        diagnosis: {
          confirmation: 'admin_entered',
          d4z4Repeats: '6',
          geneticType: '—',
          valueOrigins: origins({ d4z4Repeats: valueOrigin('admin_entered', '管理员代填') }),
        },
      }),
      TODAY,
    );

    expect(card.patientLines[0]).toContain('这张卡上没有可作确诊依据的基因结果');
    expect(card.patientLines[0]).not.toContain('6');
  });

  it('什么依据都没有时也不留白', () => {
    const card = buildAnesthesiaCard(
      summary({
        diagnosis: {
          confirmation: 'none',
          d4z4Repeats: '—',
          geneticType: '—',
          valueOrigins: origins({}),
        },
      }),
      TODAY,
    );
    expect(card.patientLines[0]).toContain('未经基因确诊');
    expect(card.patientLines[0]).not.toContain('档案里的分型');
  });
});

describe('缺数据要说出来，不能省略成一行不存在', () => {
  it('没有肺功能时明说未做过或未上传', () => {
    const card = buildAnesthesiaCard(summary({ monitoring: { items: [] } }), TODAY);
    const joined = card.patientLines.join('\n');
    expect(joined).toContain('最近肺功能：未做过或未上传');
    expect(joined).toContain('最近心脏检查：未做过或未上传');
  });

  it('有肺功能时带上数值和日期', () => {
    expect(buildAnesthesiaCard(summary(), TODAY).patientLines.join('\n')).toContain(
      '最近肺功能：FVC 78%（2026-03-02）',
    );
  });
});

describe('临床内容的关键几条', () => {
  const text = allText(summary());

  it('恶性高热的说法不能被抬成「FSHD 有 MH 风险」', () => {
    // 「studies show that MH is not more common in the FSHD population,
    // it is advised to err on the side of caution」——两半都得在，
    // 少了前半是吓人，少了后半是危险。
    expect(text).toContain('并不比一般人群多见');
    expect(text).toContain('MH 预案');
  });

  it('琥珀胆碱要给出原因而不只是「避免」', () => {
    expect(text).toContain('琥珀胆碱');
    expect(text).toContain('高钾血症');
  });

  it('椎管内麻醉写明可行，同时写明不可预测', () => {
    expect(text).toContain('椎管内麻醉');
    expect(text).toContain('57 小时');
  });

  it('术前心脏检查在卡上，和护照里「日常不需要常规筛查」不打架', () => {
    expect(text).toContain('术前评估应包含这两项');
  });

  it('带出处，且写明不替代麻醉医师判断', () => {
    expect(text).toContain('AANA Journal');
    expect(text).toContain('Neurology. 2015');
    expect(text).toContain('不替代麻醉医师');
  });
});

describe('换行不能把术语拆开', () => {
  // 等宽假测量：每个 ASCII 字符 1，每个中文字符 2。
  const measure = (chunk: string) =>
    [...chunk].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);

  it('中文可以任意断开', () => {
    const lines = wrapText('丙泊酚瑞芬太尼靶控输注', 8, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('丙泊酚瑞芬太尼靶控输注');
  });

  it('TOF 不会被拆成两行', () => {
    const lines = wrapText('全程 TOF 监测给药与拮抗', 10, measure);
    expect(lines.some((line) => /T$|^OF/.test(line))).toBe(false);
    expect(lines.join('').replace(/\s/g, '')).toContain('TOF');
  });

  it('数字不会被拆开 —— 5/7 小时和 57 小时是两回事', () => {
    const lines = wrapText('运动阻滞 57 小时后完全恢复', 8, measure);
    expect(lines.some((line) => /(^|[^5])7\s*小时/.test(line) && !line.includes('57'))).toBe(false);
    expect(lines.join('').replace(/\s/g, '')).toContain('57');
  });

  it('换行后的行不以空格开头', () => {
    const lines = wrapText('丙泊酚 瑞芬太尼 靶控输注', 8, measure);
    expect(lines.every((line) => !line.startsWith(' '))).toBe(true);
  });

  it('空串也返回一行，不返回空数组', () => {
    expect(wrapText('', 100, measure)).toEqual(['']);
  });
});

describe('「上传了但读不出」不能塌成「没上传」', () => {
  /**
   * The passport and the PDF say 「暂无可自动读取的肺功能结果」. The card
   * said 「未做过或未上传」 for the same patient — a false statement about
   * their own care, made to the one reader who is not them, on the line
   * that exists to stop an unassessed patient reaching general
   * anesthesia. An anesthetist told the test was never done orders one;
   * an anesthetist told a report exists but could not be parsed asks the
   * patient to show it.
   */
  const withState = (state: 'unreadable' | 'absent', latestDate: string | null) =>
    summary({
      monitoring: {
        items: [
          {
            key: 'respiratory',
            available: false,
            summary: '暂无可自动读取的肺功能结果',
            latestDate,
            state,
          },
        ],
      },
    });

  const respiratoryLine = (s: ClinicalPassportSummary) =>
    buildAnesthesiaCard(s, TODAY).patientLines.find((l) => l.startsWith('最近肺功能')) ?? '';

  it('有报告但没解析出字段时，不说患者没上传', () => {
    const line = respiratoryLine(withState('unreadable', '2026-03-02T12:00:00.000Z'));
    expect(line).not.toContain('未做过或未上传');
    expect(line).toContain('已上传报告');
    expect(line).toContain('索取原件');
    expect(line).toContain('2026-03-02');
  });

  it('确实没有报告时仍然说未做过或未上传', () => {
    expect(respiratoryLine(withState('absent', null))).toContain('未做过或未上传');
  });

  it('槽位整个缺失时按「没有」处理，不假装有报告', () => {
    expect(
      buildAnesthesiaCard(summary({ monitoring: { items: [] } }), TODAY).patientLines.join('\n'),
    ).toContain('未做过或未上传');
  });
});
