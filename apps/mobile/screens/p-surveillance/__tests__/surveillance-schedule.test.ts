/**
 * 我的随访计划 — the branches, and the two ways this page could lie.
 *
 * Lives beside the screen rather than in lib/__tests__ only because
 * the lane that built it owns screens/p-surveillance/**; it tests
 * lib/surveillance-schedule.ts.
 *
 * What is actually at stake, row by row:
 *
 *  - A conditional recommendation shown as unconditional sends a
 *    patient to pay out of pocket for a test the guideline does not
 *    ask of them (retina, repeat PFT).
 *  - A condition we could not evaluate shown as 「不适用」 tells them
 *    something about their own body that the app has no way of
 *    knowing (scoliosis, daytime somnolence — never collected).
 *  - The pre-anesthesia pulmonary line disagreeing with the
 *    anesthesia card would put two different sentences about the same
 *    test in front of the same patient, one of which they hand to an
 *    anesthetist.
 */

// The anesthesia card reads `readPassportValueOrigins` out of api.ts,
// which pulls in AsyncStorage through session-storage, and that has no
// native module under jest. Same stub api-transport.test.ts uses.
jest.mock('../../../lib/session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

import {
  ANESTHESIA_CARD_HREF,
  buildSurveillanceSchedule,
  isLargeD4Z4Deletion,
  readLaboratoryRepeatCount,
  type SurveillanceRow,
} from '../../../lib/surveillance-schedule';
import { buildAnesthesiaCard } from '../../../lib/anesthesia-card';
import type { ClinicalPassportSummary, PatientProfile } from '../../../lib/api';

// Local components, so a build run outside UTC does not shift a
// birthday or a 180-day window by a day.
const TODAY = new Date(2026, 7, 5, 12, 0, 0);
const daysAgo = (days: number) => new Date(TODAY.getTime() - days * 86_400_000).toISOString();

/** A `diagnosis.valueOrigins` map naming one source for every printed
 *  value — the shape a real API build sends. The retina row reads
 *  `d4z4Repeats` out of it to say WHERE the number it is showing came
 *  from; what it decides on is `diagnosis.laboratoryRepeatCount`, which
 *  is the server's own reading of the report's count cell. */
const valueOrigins = (d4z4: { kind: string; labelZh: string }) => ({
  geneticType: { kind: 'report', labelZh: '报告读取' },
  d4z4Repeats: d4z4,
  methylationValue: { kind: 'report', labelZh: '报告读取' },
  diagnosisDate: { kind: 'report', labelZh: '报告读取' },
});

/**
 * Every one of these is a `kind`/`labelZh` pair the API actually emits
 * — `VALUE_ORIGIN_LABEL_ZH` in apps/api's profile.passport.ts, member
 * for member. The labels matter now that a row prints one: a fixture
 * that invented its own phrase would assert this screen renders a
 * string no server sends.
 */
const REPORT_ORIGIN = { kind: 'report', labelZh: '报告读取' };
const ADMIN_ORIGIN = { kind: 'admin_entered', labelZh: '管理员代填' };
const PATIENT_ORIGIN = { kind: 'patient', labelZh: '本人填写' };
const INDETERMINATE_ORIGIN = { kind: 'indeterminate', labelZh: '来源无法确定' };
const UNREADABLE_ORIGIN = { kind: 'admin_unreadable', labelZh: '非本人填写，来源不明' };
/**
 * The 病历摘要 that quotes a repeat count.
 *
 * Transcribed here from a real passport: `buildClinicalPassportSummary`
 * was run on a profile whose only document is a 病历摘要 carrying
 * `d4z4Repeats: '3'`, and this is the origin it resolved for the value
 * it printed. `pickGeneticEvidenceDocument` takes that document on
 * purpose — for some patients it is the only copy of the number — and
 * this kind is how the API keeps taking it from becoming a claim that
 * a laboratory said it.
 */
const TRANSCRIBED_ORIGIN = { kind: 'transcribed', labelZh: '转录自非基因报告文件' };
/**
 * 报告上根本没有这一格时的来源，同样抄自真实护照：
 * `buildClinicalPassportSummary` 跑在一份只写了 4q 单倍型的基因报告上，
 * D4Z4 重复数那一行印「—」，来源就是这一对。
 */
const ABSENT_ORIGIN = { kind: 'absent', labelZh: '未填' };

const summary = (over: Record<string, unknown> = {}) =>
  ({
    patientName: '张三',
    diagnosis: {
      confirmation: 'genetic',
      d4z4Repeats: '7',
      laboratoryRepeatCount: '7',
      valueOrigins: valueOrigins(REPORT_ORIGIN),
    },
    monitoring: {
      items: [
        {
          key: 'respiratory',
          available: true,
          state: 'present',
          summary: 'FVC 78%',
          latestDate: '2026-03-02T12:00:00.000Z',
        },
        {
          key: 'cardiac',
          available: false,
          state: 'absent',
          summary: '暂无心脏检查数据',
          latestDate: null,
          note: '没有症状的 FSHD 患者不需要常规做心电图或心脏超声（来自护照）。',
        },
      ],
    },
    ...over,
  }) as unknown as ClinicalPassportSummary;

const profile = (over: Partial<PatientProfile> = {}) =>
  ({
    dateOfBirth: '1990-04-01',
    followupEvents: [],
    symptomScores: [],
    medications: [],
    ...over,
  }) as unknown as PatientProfile;

const allRows = (
  s: ClinicalPassportSummary = summary(),
  p: PatientProfile | null = profile(),
): SurveillanceRow[] => buildSurveillanceSchedule(s, p, TODAY).groups.flatMap((g) => g.rows);

const row = (id: string, s?: ClinicalPassportSummary, p?: PatientProfile | null) => {
  const found = allRows(s ?? summary(), p === undefined ? profile() : p).find(
    (entry) => entry.id === id,
  );
  if (!found) throw new Error(`no row ${id}`);
  return found;
};

describe('推荐强度不能被抹平', () => {
  it('每一条都带 AAN 的强度，且两种强度都真的出现了', () => {
    const levels = allRows().map((entry) => entry.level);
    expect(levels.every((level) => level === 'B' || level === 'C')).toBe(true);
    expect(levels).toContain('B');
    expect(levels).toContain('C');
  });

  it('眼底筛查是 B，肩胛固定手术是 C —— 弱推荐不能被抬成中等', () => {
    expect(row('retinal_screening').level).toBe('B');
    expect(row('scapular_fixation').level).toBe('C');
  });
});

describe('指南的否定推荐必须在页面上', () => {
  it('无症状不常规查心脏，标为 Level C 的「不建议」', () => {
    const cardiac = row('cardiac_routine');
    expect(cardiac.level).toBe('C');
    expect(cardiac.polarity).toBe('do_not');
  });

  it('心脏这一条直接引用护照上的同一句话，两个页面不能给出两种答案', () => {
    // The API's cardiac note is the sentence that was corrected
    // against the primary sources; if it is present we must show it,
    // not a second edit of it.
    const withNote = summary({
      monitoring: {
        items: [
          { key: 'respiratory', available: false, state: 'absent', summary: '—', latestDate: null },
          {
            key: 'cardiac',
            available: false,
            state: 'absent',
            summary: '—',
            latestDate: null,
            note: '这句话来自临床护照。',
          },
        ],
      },
    });
    expect(row('cardiac_routine', withNote).guideline).toBe('这句话来自临床护照。');
  });

  it('护照没给 note 时的兜底句仍然保留术前例外', () => {
    const noNote = summary({
      monitoring: {
        items: [
          { key: 'respiratory', available: false, state: 'absent', summary: '—', latestDate: null },
          { key: 'cardiac', available: false, state: 'absent', summary: '—', latestDate: null },
        ],
      },
    });
    const text = row('cardiac_routine', noNote).guideline;
    expect(text).toContain('不需要常规');
    // Without this clause the sentence is something a patient could
    // hand a pre-op clinic as grounds to skip the ECG.
    expect(text).toContain('手术前');
  });

  it('沙丁胺醇 / 激素 / 地尔硫䓬 三个药名都写出来了，标为 Level B 的「不要开」', () => {
    const drugs = row('no_strength_drugs');
    expect(drugs.level).toBe('B');
    expect(drugs.polarity).toBe('do_not');
    expect(drugs.guideline).toContain('沙丁胺醇');
    expect(drugs.guideline).toContain('糖皮质激素');
    expect(drugs.guideline).toContain('地尔硫䓬');
  });

  it('用药记录里有这三类药时点名，并且不叫人自己停药', () => {
    const withDrug = profile({
      medications: [{ id: 'm1', medicationName: '泼尼松片 5mg' }],
    } as Partial<PatientProfile>);
    const drugs = row('no_strength_drugs', undefined, withDrug);
    expect(drugs.applicability).toBe('matched');
    expect(drugs.evidence).toContain('糖皮质激素');
    expect(drugs.evidence).toContain('不要自己停药');
  });

  it('无关的药不会被误判成这三类', () => {
    const other = profile({
      medications: [{ id: 'm1', medicationName: '布洛芬' }],
    } as Partial<PatientProfile>);
    expect(row('no_strength_drugs', undefined, other).applicability).toBe('everyone');
  });
});

/**
 * 「不要为了增肌力吃这三类药」 is a Level B do-not-prescribe row, and the
 * sentence under it used to be the same for four different states: no
 * profile, no `medications` key on the wire, an empty list, and a list
 * that was read and matched nothing. All four printed 「你的用药记录里没
 * 有这三类药」 — a negative finding about a record this platform does not
 * have. `medications` is optional on the wire and the medication module
 * is one most patients never open, so the empty list is the ordinary
 * case: a patient taking prednisone who never typed it in was told
 * their own record is clear, on the one row that is about that drug.
 *
 * The file's header states the rule: 「not_matched never means 你不需要」
 * and every row has to say in its own words that what it holds is a gap
 * in the platform's records. These pin the three states apart.
 */
describe('用药那一条：说「没有这三类药」之前，得真的有一份用药记录', () => {
  const noRecordStates: Array<[string, PatientProfile | null]> = [
    ['一条用药都没填过', profile({ medications: [] } as Partial<PatientProfile>)],
    [
      '旧版 API 根本不发 medications 这个字段',
      profile({ medications: undefined } as Partial<PatientProfile>),
    ],
    [
      '有行但药名是空白，等于没读到',
      profile({ medications: [{ id: 'm1', medicationName: '   ' }] } as Partial<PatientProfile>),
    ],
    ['连档案都没有', null],
  ];

  it.each(noRecordStates)('%s：说的是平台没有记录，不是记录里没有这三类药', (_label, p) => {
    const drugs = row('no_strength_drugs', undefined, p);
    expect(drugs.evidence).toContain('本平台没有你的用药记录');
    // The exact sentence that was wrong. It may not come back in any
    // of these four states.
    expect(drugs.evidence).not.toContain('你的用药记录里没有这三类药');
    // A patient on a drug they never typed in must not read this as
    // 「你没在吃药」.
    expect(drugs.evidence).toContain('这不代表你没在吃药');
    // Still everyone's row — 不要为了增肌力开药 is addressed to every
    // FSHD patient, and a gap in our records is not a `not_matched`.
    expect(drugs.applicability).toBe('everyone');
  });

  it('读过一份真的用药记录、里面没有这三类药时，才可以说记录里没有', () => {
    const other = profile({
      medications: [{ id: 'm1', medicationName: '布洛芬' }],
    } as Partial<PatientProfile>);
    const drugs = row('no_strength_drugs', undefined, other);
    expect(drugs.evidence).toContain('你填在本平台的用药记录里没有这三类药');
    expect(drugs.evidence).not.toContain('本平台没有你的用药记录');
    // Even here the sentence stays inside what this platform can see.
    expect(drugs.evidence).toContain('只看得到你自己填的那些');
    expect(drugs.applicability).toBe('everyone');
  });

  it('三种状态各说各的话，没有两种共用同一句', () => {
    const evidence = [
      row('no_strength_drugs', undefined, profile({ medications: [] } as Partial<PatientProfile>))
        .evidence,
      row(
        'no_strength_drugs',
        undefined,
        profile({
          medications: [{ id: 'm1', medicationName: '布洛芬' }],
        } as Partial<PatientProfile>),
      ).evidence,
      row(
        'no_strength_drugs',
        undefined,
        profile({
          medications: [{ id: 'm1', medicationName: '泼尼松片 5mg' }],
        } as Partial<PatientProfile>),
      ).evidence,
    ];
    expect(new Set(evidence).size).toBe(3);
  });
});

/**
 * The same sweep found the same shape one row up. 「睡不好、白天困，问一
 * 次夜间通气」 has two halves in its guideline — a low FVC, or daytime
 * somnolence — and the evidence line asserted 「本平台没有你的 FVC 百分
 * 比」 for every patient with no sleep score, including the ones whose
 * uploaded pulmonary function report parsed. The passport's respiratory
 * summary is built from `fvcPredPct` among other cells, so one page told
 * the same patient 「你的档案里有肺功能结果：… FVC 58%」 and 「本平台…也没
 * 有 FVC 百分比」, and the patient it contradicted itself for is the one
 * under the guideline's own 60% example.
 */
describe('夜间通气那一条：FVC 这半边不能说「没有」，如果档案里其实有', () => {
  const withRespiratory = (state: string, text: string) =>
    summary({
      monitoring: {
        items: [
          {
            key: 'respiratory',
            available: true,
            state,
            summary: text,
            latestDate: '2026-03-02',
          },
        ],
      },
    });

  it('肺功能读出来了：不说没有，也不替医生判断那个数字', () => {
    const s = withRespiratory('present', '限制性通气功能障碍 / FVC 58%');
    const sleepRow = row('sleep_referral', s, profile({ symptomScores: [] }));
    expect(sleepRow.evidence).not.toContain('没有你的 FVC 百分比');
    expect(sleepRow.evidence).toContain('你的档案里有肺功能结果');
    // It must not grade the number: 58% versus the guideline's 60%
    // example is the doctor's read of the report, not this page's.
    expect(sleepRow.evidence).toContain('要医生看着报告原件读');
    expect(sleepRow.evidence).not.toContain('58');
    // Same page, same patient: the baseline row above says the result
    // is on file. These two may not disagree.
    expect(row('pulmonary_baseline', s, profile({ symptomScores: [] })).evidence).toContain(
      'FVC 58%',
    );
  });

  it('传了肺功能但没读出来：说的是没读出来，不是没有', () => {
    const s = withRespiratory('unreadable', '—');
    const sleepRow = row('sleep_referral', s, profile({ symptomScores: [] }));
    expect(sleepRow.evidence).toContain('你上传过肺功能报告');
    expect(sleepRow.evidence).toContain('没能自动读出数值');
    expect(sleepRow.evidence).not.toContain('本平台没有你的 FVC 百分比');
  });

  it('确实一份肺功能都没有时，才说没有', () => {
    const s = summary({ monitoring: { items: [] } });
    expect(row('sleep_referral', s, profile({ symptomScores: [] })).evidence).toContain(
      '本平台没有你的 FVC 百分比',
    );
  });
});

describe('大片段缺失分支', () => {
  /**
   * A passport as the API builds one for a genetics report whose
   * repeat-count cell reads `cell`.
   *
   * The `laboratoryRepeatCount` beside each cell is not invented here:
   * every pair used below was read off `buildClinicalPassportSummary`
   * run on a laboratory report carrying that cell. It is the server's
   * `determinateRepeatCount` — null for a length in kb, for a 0, for a
   * range and for a cell that names a count in order to say it was not
   * found, and the cell as printed otherwise. This app no longer holds
   * an opinion about any of those, which is what the table below pins.
   */
  const reportCell = (cell: string, laboratoryRepeatCount: string | null, confirmation = 'none') =>
    summary({
      diagnosis: {
        confirmation,
        d4z4Repeats: cell,
        laboratoryRepeatCount,
        valueOrigins: valueOrigins(REPORT_ORIGIN),
      },
    });

  /** The band, driven through the only expression that mints a count.
   *  There is no string overload left to call: the printed row cannot be
   *  handed to the predicate at all, whatever its origin says. */
  const laboratoryCount = (sent: string | null) => {
    const reading = readLaboratoryRepeatCount(reportCell(sent ?? '—', sent));
    return reading.state === 'count' ? reading.count : null;
  };

  it.each<[string | null, boolean]>([
    ['1', true],
    ['4', true],
    ['3个', true],
    ['5', false],
    ['10', false],
    ['—', false],
    ['', false],
    // 服务端说「这一格没有可判断的重复数」时，本页什么也不判。
    [null, false],
  ])('服务端给的重复数「%s」→ %s', (sent, expected) => {
    expect(isLargeD4Z4Deletion(laboratoryCount(sent))).toBe(expected);
  });

  /**
   * THE CELLS THE SERVER REFUSES TO CALL A COUNT, AND WHAT THIS ROW MAY
   * SAY ABOUT THEM.
   *
   * A kb length, a 0, a range and a negated cell are all printed on the
   * passport and all arrive here with `laboratoryRepeatCount: null`.
   * This file used to classify each of them itself, off a hand-kept copy
   * of the API's parser, and the copy is what drifted: 「0」 came out
   * 「按你的记录不适用」 on a row about vision loss, from a reading the
   * server calls one it cannot make sense of.
   */
  it.each<[string, string | null, SurveillanceRow['applicability']]>([
    ['3', '3', 'matched'],
    ['3个', '3个', 'matched'],
    ['3kb', null, 'unknown'],
    ['0', null, 'unknown'],
    ['30', '30', 'not_matched'],
    ['9', '9', 'not_matched'],
    ['未检出3个重复单元的缩短', null, 'unknown'],
    ['1-10', null, 'unknown'],
  ])('报告那一格是「%s」、服务端读出 %s 时 → %s', (cell, sent, expected) => {
    const retina = row('retinal_screening', reportCell(cell, sent));
    expect(retina.applicability).toBe(expected);
    if (expected !== 'matched') {
      expect(retina.evidence).not.toContain('落在指南说的大片段缺失范围');
    }
    if (expected === 'unknown') {
      // 判断不了 的每一句都要说出下一步，并且不能说成「不适用」。
      expect(retina.evidence).toContain('报告原件');
      expect(retina.evidence).not.toContain('不适用');
      // 页面上印着什么，这一句就说什么 —— 读者能对着报告核。
      expect(retina.evidence).toContain(cell);
    }
  });

  /**
   * 0 个重复单元：既不是确诊，也不是排除。
   *
   * The API reads that cell, says it cannot make sense of it and asks
   * for the original; this row said 「按你的记录不适用」 and cited the
   * guideline's band as the reason. The sentence is pinned whole because
   * every clause in it was wrong in the old one.
   */
  it('那一格写着 0 时不下判断，也不说成「不适用」', () => {
    const retina = row('retinal_screening', reportCell('0', null));
    expect(retina.applicability).toBe('unknown');
    expect(retina.evidence).toBe(
      '报告上那一格写的是「0」，本平台没有从它读出一个能用来判断这一条的重复单元数 —— 指南这一条的界限是按重复单元数（1–4）写的，读不出这样一个数我们就不猜。这一条要不要做，请医生看着报告原件判断。',
    );
  });

  /**
   * 同一个数写成 kb：印出来，不参与判断。
   *
   * 1–4 是重复单元数那一半的界；同一句指南里 kb 那一半写的是 10–20，两边
   * 不换算。旧文案还把它说成「可能是还没上传写着它的文件」—— 文件传了，
   * 数也读出来了，只是单位不是这一条用的那个。
   */
  it('同一个数写成 kb 时不参与判断，也不说成「还没上传」', () => {
    const retina = row('retinal_screening', reportCell('3kb', null));
    expect(retina.applicability).toBe('unknown');
    expect(retina.evidence).toContain('3kb');
    expect(retina.evidence).not.toContain('落在指南说的大片段缺失范围');
    expect(retina.evidence).not.toContain('还没上传');
  });

  /**
   * 4qB：数在范围内，但这一条限定的那一组人不包括这份报告说的情况。
   *
   * The passport's own step steps aside here and says why. Before this
   * the two surfaces disagreed on one profile: the passport declined the
   * recommendation, this page marked it 对得上.
   */
  it('重复数在范围内、同一份报告写的是 4qB 时，不把人归进那一组', () => {
    const retina = row('retinal_screening', reportCell('3', '3', 'genetic_non_permissive'));
    expect(retina.applicability).toBe('unknown');
    expect(retina.evidence).toContain('不是允许型 4qA');
    expect(retina.evidence).toContain('报告原件');
    expect(retina.evidence).not.toContain('值得在下次就诊时主动提出来');
  });

  /**
   * THE BARRIER, STATED AS BEHAVIOUR.
   *
   * The printed row reads 3 in every case below and no build has sent a
   * reading of the report's cell — the state a WeChat-cached bundle is in
   * against an API from before the field. Nothing on the page may stand
   * in for that reading, whatever its origin says, including the origin
   * that means a genetics report supplied it.
   */
  it('页面上印着的那个数，来源是什么都不能自己变成判断依据', () => {
    for (const origin of [
      ADMIN_ORIGIN,
      PATIENT_ORIGIN,
      INDETERMINATE_ORIGIN,
      TRANSCRIBED_ORIGIN,
      REPORT_ORIGIN,
    ]) {
      const noReading = summary({
        diagnosis: {
          confirmation: 'self_reported',
          d4z4Repeats: '3',
          valueOrigins: valueOrigins(origin),
        },
      });
      expect(readLaboratoryRepeatCount(noReading).state).toBe('unanswered');
      const retina = row('retinal_screening', noReading);
      expect(retina.applicability).toBe('unknown');
      expect(retina.evidence).not.toContain('落在指南说的大片段缺失范围');
      expect(retina.evidence).toContain('报告原件');
    }
  });

  /** 报告读的是这个数，但这一版 API 还不发那个读数 —— 说的是本平台没能
   *  确认，而不是报告没写。 */
  it('API 还没发这个读数时，不拿页面上的数替它判断', () => {
    const retina = row(
      'retinal_screening',
      summary({
        diagnosis: {
          confirmation: 'genetic',
          d4z4Repeats: '3',
          valueOrigins: valueOrigins(REPORT_ORIGIN),
        },
      }),
    );
    expect(retina.applicability).toBe('unknown');
    expect(retina.evidence).toContain('没能确认');
    expect(retina.evidence).toContain('报告原件');
  });

  /** 一格都没有的那种报告：护照印「—」，来源是「未填」。这时才是「手上
   *  没有」，也只有这时能这么说。 */
  it('完全没有读数时说「手上没有」，不说「不适用」', () => {
    const nothing = summary({
      diagnosis: {
        confirmation: 'none',
        d4z4Repeats: '—',
        laboratoryRepeatCount: null,
        valueOrigins: valueOrigins(ABSENT_ORIGIN),
      },
    });
    const retina = row('retinal_screening', nothing);
    expect(retina.applicability).toBe('unknown');
    expect(retina.evidence).toContain('本平台手上没有你的 D4Z4 重复数');
    expect(retina.evidence).not.toContain('不适用');
    expect(retina.evidence).toContain('报告原件');
  });

  /**
   * The number the passport prints can be an administrator's
   * transcription of a report read out over the phone, the patient's
   * own typing — `diseaseBackground.d4z4` is admin-writable and the
   * registration form posts it — or a count this platform read off a
   * 病历摘要 rather than off a laboratory's report. Deciding a guideline
   * about vision loss on any of them, and telling the patient 「你的基因
   * 报告里 D4Z4 重复数是 3」 when no laboratory report was ever opened,
   * are the two failures this pins.
   */
  it.each([
    ['管理员代填', ADMIN_ORIGIN],
    ['来源记录读不出来', UNREADABLE_ORIGIN],
    ['本人填写', PATIENT_ORIGIN],
    ['来源无法确定', INDETERMINATE_ORIGIN],
    ['转录自非基因报告文件', TRANSCRIBED_ORIGIN],
  ])('重复数不是从报告里读出来的（%s）时不下判断', (_label, origin) => {
    const typed = summary({
      diagnosis: {
        confirmation: 'self_reported',
        d4z4Repeats: '3',
        laboratoryRepeatCount: null,
        valueOrigins: valueOrigins(origin),
      },
    });
    const retina = row('retinal_screening', typed);
    expect(retina.applicability).toBe('unknown');
    // Shown, with its origin available beside it on the passport, and
    // never presented as something a report said.
    expect(retina.evidence).toContain('你的记录里 D4Z4 重复数是 3');
    expect(retina.evidence).not.toContain('你的基因报告里');
    // Named: what would change this row.
    expect(retina.evidence).toContain('报告原件');
  });

  /**
   * THE ROW MAY NOT NARRATE A MECHANISM THE ORIGIN DOES NOT NAME.
   *
   * `indeterminate` used to be printed as 「本平台分不清它是你自己填的，
   * 还是系统从你上传的报告里读来的 —— 读取档案时系统会拿报告里的值补上
   * 空着的栏位」. The API resolves that kind down two roads and only one
   * of them is the autofill; the other is 「the archive holds it and
   * nothing on file carries a repeat count at all」, which is the state
   * of a patient who typed a number into the registration form and has
   * uploaded nothing. The fixture below is exactly that patient — an
   * archived count and an empty document list — and the origin is the
   * one `buildClinicalPassportSummary` really resolves for it.
   */
  it('档案里有数、一份文件都没传时，不说系统从报告里读来的', () => {
    const retina = row(
      'retinal_screening',
      summary({
        diagnosis: {
          confirmation: 'self_reported',
          d4z4Repeats: '3',
          laboratoryRepeatCount: null,
          valueOrigins: valueOrigins(INDETERMINATE_ORIGIN),
        },
      }),
    );
    // The server's own phrase for the state, printed rather than
    // paraphrased into a story about reports.
    expect(retina.evidence).toContain('本平台给它标的来源是「来源无法确定」');
    expect(retina.evidence).not.toContain('从你上传的报告里读来的');
    expect(retina.evidence).not.toContain('补上空着的栏位');
    expect(retina.evidence).not.toContain('可能就是报告上写的那个');
  });

  /**
   * A 病历摘要 QUOTING THE COUNT: SHOWN, AND SAID TO BE WHAT IT IS.
   *
   * The picker takes such a document on purpose — for some patients it
   * is the only copy of the number — and the API brackets what it reads
   * off it as 「转录自非基因报告文件」. This row prints that bracket
   * rather than a second phrasing of it, and never the sentence that
   * would put the number in a laboratory's mouth.
   */
  it('病历摘要抄来的重复数：显示，带服务端给的那句来源，不下判断', () => {
    const retina = row(
      'retinal_screening',
      summary({
        diagnosis: {
          confirmation: 'self_reported',
          d4z4Repeats: '3',
          laboratoryRepeatCount: null,
          valueOrigins: valueOrigins(TRANSCRIBED_ORIGIN),
        },
      }),
    );
    expect(retina.applicability).toBe('unknown');
    expect(retina.evidence).toContain('本平台给它标的来源是「转录自非基因报告文件」');
    expect(retina.evidence).not.toContain('大片段缺失范围');
    // Not 「你档案里的」 either: this number was read off an uploaded
    // document, not taken out of the archive.
    expect(retina.evidence).not.toContain('你档案里的');
  });

  it('管理员代填时点名是管理员录的，并指向护照上的字段来源', () => {
    const retina = row(
      'retinal_screening',
      summary({
        diagnosis: {
          confirmation: 'admin_entered',
          d4z4Repeats: '3',
          laboratoryRepeatCount: null,
          valueOrigins: valueOrigins(ADMIN_ORIGIN),
        },
      }),
    );
    expect(retina.evidence).toContain('管理员代你录进来的');
    expect(retina.evidence).toContain('字段来源');
  });

  /** A marker that exists and cannot be parsed proves 「not the
   *  patient's」 and nothing more. Naming an administrator it does not
   *  name would be the same invention in the other direction. */
  it('来源记录读不出来时只说「不是你自己填的」，不点名是谁', () => {
    const retina = row(
      'retinal_screening',
      summary({
        diagnosis: {
          confirmation: 'admin_entered',
          d4z4Repeats: '3',
          laboratoryRepeatCount: null,
          valueOrigins: valueOrigins(UNREADABLE_ORIGIN),
        },
      }),
    );
    expect(retina.evidence).toContain('不是你自己填的');
    expect(retina.evidence).toContain('读不出来');
    expect(retina.evidence).not.toContain('管理员代你录进来的');
  });

  /** No `valueOrigins` on the wire cannot be read as 「a report said
   *  so」: an older API build sends none at all. And it cannot be read
   *  as 「a report did not say so」 either — the server said nothing. */
  it('API 没发来源时不拿这个数下判断，也不替服务端编一个来源', () => {
    const noOrigins = summary({
      diagnosis: { confirmation: 'genetic', d4z4Repeats: '3' },
    });
    const retina = row('retinal_screening', noOrigins);
    expect(retina.applicability).toBe('unknown');
    expect(retina.evidence).toContain('没有拿到这个数的来源');
    expect(retina.evidence).not.toContain('不是你自己填的');
    expect(retina.evidence).not.toContain('没有从你上传的文件里读出过它');
  });

  it('重复数是明确的大数时标为不适用，但不说「不用查眼睛」', () => {
    const retina = row('retinal_screening');
    expect(retina.applicability).toBe('not_matched');
    expect(retina.evidence).toContain('视力变化');
  });

  it('那一格写着「未检出」时是「判断不了」，且不说「可能还没上传」就完事', () => {
    const notDetected = summary({
      diagnosis: {
        confirmation: 'none',
        d4z4Repeats: '未检出3个重复单元的缩短',
        laboratoryRepeatCount: null,
        valueOrigins: valueOrigins(REPORT_ORIGIN),
      },
    });
    const retina = row('retinal_screening', notDetected);
    expect(retina.applicability).toBe('unknown');
    expect(retina.evidence).not.toContain('大片段缺失范围');
    expect(retina.evidence).toContain('未检出');
    expect(retina.evidence).toContain('报告原件');
  });

  it('读不出重复数时是「判断不了」，不是「不适用」 —— 范围我们不猜', () => {
    const ranged = summary({
      diagnosis: {
        confirmation: 'none',
        d4z4Repeats: '1-10',
        laboratoryRepeatCount: null,
        valueOrigins: valueOrigins(REPORT_ORIGIN),
      },
    });
    const retina = row('retinal_screening', ranged);
    expect(retina.applicability).toBe('unknown');
    expect(retina.evidence).toContain('报告原件');
  });

  /**
   * THE WAYS A REPEAT COUNT REACHES THIS PAGE, and what each of them
   * may say.
   *
   * The situations are the API's, and the origin beside each is the one
   * `resolveValueOrigin` actually resolves for it. `indeterminate`
   * covers two of them on purpose: an OCR autofill that filled an empty
   * baseline leaves no record, and a patient who typed the number into
   * the registration form with nothing on file leaves the same bytes
   * behind — the server cannot tell those apart and says so instead of
   * picking. That is why a flat 「它不是本平台从基因报告里读出来的」 was
   * false in one direction and 「系统从你上传的报告里读来的」 in the
   * other: this row is not the place either question is settled.
   *
   * All of them print 3, which is inside the range the guideline calls
   * a large deletion. Only the one the laboratory's report supplied
   * comes with the server's own reading of that cell, and that reading
   * is the only thing this row acts on.
   */
  describe('这个数是从哪来的，决定这一行能说什么', () => {
    /** 印的都是 3。除了报告那一份，其余每一份都带着服务端的答复「这张护照
     *  上没有可用来判断的重复数」—— 数不是从实验室报告那一格来的时候，API
     *  给的就是这个。`origin: null` 是更旧的一版 API：两个字段都不发。 */
    const retinaFor = (
      origin: { kind: string; labelZh: string } | null,
      sent: string | null = null,
    ) =>
      row(
        'retinal_screening',
        summary({
          diagnosis: {
            confirmation: 'self_reported',
            d4z4Repeats: '3',
            ...(origin ? { laboratoryRepeatCount: sent, valueOrigins: valueOrigins(origin) } : {}),
          },
        }),
      );

    it('管理员按电话转述录进来的：显示，说清不是本人填的，不下判断', () => {
      const retina = retinaFor(ADMIN_ORIGIN);
      expect(retina.applicability).toBe('unknown');
      expect(retina.evidence).toBe(
        '你的记录里 D4Z4 重复数是 3，它是本平台的管理员代你录进来的 —— 是谁、什么时候，护照的「字段来源」那一栏里有。这个数是从你的档案里取的，本平台没有从你上传的文件里读出过它。这一条要不要做，请医生看着报告原件判断。',
      );
    });

    /**
     * THE TWO ORIGINS THIS ROW HAS NO SENTENCE OF ITS OWN FOR.
     *
     * Both print the server's `labelZh` and stop. `indeterminate` is
     * two different states the API refuses to choose between, and
     * `transcribed` is a document this module cannot see; a sentence
     * written here for either would be this file guessing at a
     * mechanism, which is what it did and what was false.
     */
    it.each([
      ['来源无法确定', INDETERMINATE_ORIGIN],
      ['转录自非基因报告文件', TRANSCRIBED_ORIGIN],
    ])('%s：印服务端那句，不替它编一个机制', (label, origin) => {
      const retina = retinaFor(origin);
      expect(retina.applicability).toBe('unknown');
      expect(retina.evidence).toBe(
        `你的记录里 D4Z4 重复数是 3，本平台给它标的来源是「${label}」。这一条要不要做，请医生看着报告原件判断。`,
      );
    });

    /**
     * NO ARM NAMES THE REPORT THAT WAS READ.
     *
     * The row used to explain the API's picking rule to the patient —
     * that only the newest genetics report is opened, so a count
     * written on another one cannot be read. `pickGeneticEvidenceDocument`
     * ranks the laboratory's own report over a document quoting one,
     * a landed parse over an unlanded one and a richer report over a
     * thinner one before it ever looks at upload time, so both halves
     * of that explanation now describe something the server does not
     * do. This module is handed values and origins and no documents at
     * all, so the fix is silence rather than a corrected rule: the
     * strings below are checked for the absence of every claim it used
     * to make about which report was opened and what re-uploading one
     * would achieve — and for the report it may not invent either, the
     * one an 「上传的报告」 sentence gave a patient who has uploaded
     * nothing.
     */
    it('没有一种来源再说「只读最新一份」，也不承诺重传会改掉它', () => {
      for (const origin of [
        ADMIN_ORIGIN,
        UNREADABLE_ORIGIN,
        PATIENT_ORIGIN,
        INDETERMINATE_ORIGIN,
        TRANSCRIBED_ORIGIN,
        null,
      ]) {
        const retina = retinaFor(origin);
        expect(retina.evidence).not.toContain('最新');
        expect(retina.evidence).not.toContain('别的报告');
        expect(retina.evidence).not.toContain('就会跟着改');
        expect(retina.evidence).not.toContain('从你上传的报告里读来的');
      }
    });

    it('从基因报告里读出来的：这一行才对得上，也才引指南的范围', () => {
      const retina = retinaFor(REPORT_ORIGIN, '3');
      expect(retina.applicability).toBe('matched');
      expect(retina.evidence).toContain('本平台从你上传的文件里读到的 D4Z4 重复数是 3');
      expect(retina.evidence).toContain('大片段缺失范围（1–4）');
      // Even here, where the API says a genetics laboratory wrote the
      // page it was read off: a bundle this old can be talking to an
      // API build from before that line existed, and 「你的基因报告里」
      // would be this app speaking for a laboratory on its word.
      expect(retina.evidence).not.toContain('你的基因报告里');
    });

    it('其余几种都不引指南的范围，也都指得出下一步', () => {
      for (const origin of [
        ADMIN_ORIGIN,
        PATIENT_ORIGIN,
        INDETERMINATE_ORIGIN,
        TRANSCRIBED_ORIGIN,
        null,
      ]) {
        const retina = retinaFor(origin);
        expect(retina.applicability).toBe('unknown');
        expect(retina.evidence).not.toContain('大片段缺失范围');
        expect(retina.evidence).not.toContain('不适用');
        expect(retina.evidence).toContain('报告原件');
      }
    });
  });
});

describe('轮椅 / 无创通气 / 睡眠分支', () => {
  it('记录过开始使用轮椅时，定期复查肺功能这一条对得上', () => {
    const wheelchair = profile({
      followupEvents: [
        { id: 'e1', eventType: 'started_wheelchair', occurredAt: daysAgo(400) },
      ] as PatientProfile['followupEvents'],
    });
    const repeat = row('pulmonary_repeat', undefined, wheelchair);
    expect(repeat.applicability).toBe('matched');
    expect(repeat.evidence).toContain('轮椅');
  });

  it('没有轮椅记录时是「判断不了」，并说明哪些条件本平台根本没采集', () => {
    const repeat = row('pulmonary_repeat');
    expect(repeat.applicability).toBe('unknown');
    expect(repeat.evidence).toContain('脊柱侧弯');
  });

  it('已经在用无创通气时，这一条变成随访而不是转诊', () => {
    const niv = profile({
      followupEvents: [
        { id: 'e1', eventType: 'started_niv', occurredAt: daysAgo(30) },
      ] as PatientProfile['followupEvents'],
    });
    const sleep = row('sleep_referral', undefined, niv);
    expect(sleep.applicability).toBe('matched');
    expect(sleep.ask).toContain('参数');
  });

  it('最近睡眠评分偏低时对得上，并带上日常记录里的同一个档位名', () => {
    const poorSleep = profile({
      symptomScores: [
        {
          id: 's1',
          symptomKey: 'sleep_quality',
          score: 3,
          scaleMin: 0,
          scaleMax: 10,
          recordedAt: daysAgo(10),
        },
      ] as PatientProfile['symptomScores'],
    });
    const sleep = row('sleep_referral', undefined, poorSleep);
    expect(sleep.applicability).toBe('matched');
    expect(sleep.evidence).toContain('较差');
  });

  it('偏低的评分如果是一年前的，不算作「现在」的证据', () => {
    const oldSleep = profile({
      symptomScores: [
        {
          id: 's1',
          symptomKey: 'sleep_quality',
          score: 2,
          scaleMin: 0,
          scaleMax: 10,
          recordedAt: daysAgo(400),
        },
      ] as PatientProfile['symptomScores'],
    });
    const sleep = row('sleep_referral', undefined, oldSleep);
    expect(sleep.applicability).toBe('unknown');
    expect(sleep.evidence).toContain('半年以前');
  });

  it('气短评分按记录自带的量表换算，不假设 0–10', () => {
    const dyspnea = profile({
      symptomScores: [
        {
          id: 's1',
          symptomKey: 'dyspnea',
          score: 3,
          scaleMin: 0,
          scaleMax: 4,
          recordedAt: daysAgo(5),
        },
      ] as PatientProfile['symptomScores'],
    });
    const sleep = row('sleep_referral', undefined, dyspnea);
    expect(sleep.applicability).toBe('matched');
    expect(sleep.evidence).toContain('3/4');
  });
});

describe('术前肺功能这一条与麻醉卡同源', () => {
  it('引用的就是麻醉卡「术前评估」里的那一行，一字不差', () => {
    const s = summary();
    const card = buildAnesthesiaCard(s, TODAY);
    const cardLine = card.sections
      .find((section) => section.title === '术前评估')
      ?.lines.find((line) => line.startsWith('肺功能：'));
    expect(cardLine).toBeTruthy();
    expect(row('preop_pulmonary', s).guideline).toBe(cardLine);
    expect(buildSurveillanceSchedule(s, profile(), TODAY).anesthesiaLineLinked).toBe(true);
  });

  it('链接指向麻醉卡所在的页面', () => {
    expect(row('preop_pulmonary').link?.href).toBe(ANESTHESIA_CARD_HREF);
  });
});

describe('肺功能记录的三种状态各自说各自的话', () => {
  it('读得出数值时把数值和日期一起写出来', () => {
    expect(row('pulmonary_baseline').evidence).toContain('FVC 78%');
  });

  it('上传了但读不出，不能说成「没做过」', () => {
    const unreadable = summary({
      monitoring: {
        items: [
          {
            key: 'respiratory',
            available: false,
            state: 'unreadable',
            summary: '—',
            latestDate: '2026-01-05T00:00:00.000Z',
          },
          { key: 'cardiac', available: false, state: 'absent', summary: '—', latestDate: null },
        ],
      },
    });
    const evidence = row('pulmonary_baseline', unreadable).evidence;
    expect(evidence).toContain('读出数值');
    expect(evidence).not.toContain('没有收到');
  });

  it('没有记录时说明「没记录不等于没做过」', () => {
    const absent = summary({
      monitoring: {
        items: [
          { key: 'respiratory', available: false, state: 'absent', summary: '—', latestDate: null },
          { key: 'cardiac', available: false, state: 'absent', summary: '—', latestDate: null },
        ],
      },
    });
    expect(row('pulmonary_baseline', absent).evidence).toContain('不代表你没做过');
  });
});

describe('儿童听力筛查按出生日期分支', () => {
  it('学龄前儿童对得上，并说明界线其实是「上学」', () => {
    const child = profile({ dateOfBirth: '2022-01-01' });
    const hearing = row('hearing_child', undefined, child);
    expect(hearing.applicability).toBe('matched');
    expect(hearing.evidence).toContain('4 岁');
    expect(hearing.evidence).toContain('上学');
  });

  it('成人不适用，但仍然告诉他家里的孩子适用', () => {
    const hearing = row('hearing_child');
    expect(hearing.applicability).toBe('not_matched');
    expect(hearing.evidence).toContain('小孩');
  });

  it('没有出生日期时是「判断不了」而不是「不适用」', () => {
    const noDob = profile({ dateOfBirth: null });
    expect(row('hearing_child', undefined, noDob).applicability).toBe('unknown');
  });

  it('7 岁生日当天就离开这一条', () => {
    const justSeven = profile({ dateOfBirth: '2019-08-05' });
    expect(row('hearing_child', undefined, justSeven).applicability).toBe('not_matched');
    const dayBefore = profile({ dateOfBirth: '2019-08-06' });
    expect(row('hearing_child', undefined, dayBefore).applicability).toBe('matched');
  });
});

describe('语气：这是清单，不是处方', () => {
  it('每一条都以一句对医生说的话收尾', () => {
    allRows().forEach((entry) => {
      expect(entry.ask.length).toBeGreaterThan(0);
      expect(entry.ask).toMatch(/可以问|问：/);
    });
  });

  it('每一条都带出处', () => {
    allRows().forEach((entry) => {
      expect(entry.source).toContain('Neurology 2015;85:357-364');
    });
  });

  it('档案完全为空时也不会崩，而且不谎称任何一条对得上', () => {
    const empty = summary({
      diagnosis: { confirmation: 'none', d4z4Repeats: '—' },
      monitoring: {
        items: [
          { key: 'respiratory', available: false, state: 'absent', summary: '—', latestDate: null },
          { key: 'cardiac', available: false, state: 'absent', summary: '—', latestDate: null },
        ],
      },
    });
    const schedule = buildSurveillanceSchedule(empty, null, TODAY);
    const rows = schedule.groups.flatMap((g) => g.rows);
    expect(rows.length).toBeGreaterThan(0);
    // Nothing is matched, because `matched` means「a condition the
    // guideline names is present in this patient's own record」and this
    // record is empty. This test previously asserted 1 — carving out
    // the pre-op row as「the one exception」— which put the screen's
    //「其中 N 条和你记录里的情况直接对得上」 at 1 for a profile with
    // nothing in it at all, and contradicted this test's own name.
    expect(schedule.matchedCount).toBe(0);
    // The row is still there and still shown to everyone: a pre-op PFT
    // is recommended regardless of what is on file. It is just not a
    // statement about THIS patient's record.
    expect(rows.find((entry) => entry.id === 'preop_pulmonary')?.applicability).toBe('everyone');
  });
});
