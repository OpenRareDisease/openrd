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

import {
  ANESTHESIA_CARD_HREF,
  buildSurveillanceSchedule,
  isLargeD4Z4Deletion,
  type SurveillanceRow,
} from '../../../lib/surveillance-schedule';
import { buildAnesthesiaCard } from '../../../lib/anesthesia-card';
import type { ClinicalPassportSummary, PatientProfile } from '../../../lib/api';

// Local components, so a build run outside UTC does not shift a
// birthday or a 180-day window by a day.
const TODAY = new Date(2026, 7, 5, 12, 0, 0);
const daysAgo = (days: number) => new Date(TODAY.getTime() - days * 86_400_000).toISOString();

const summary = (over: Record<string, unknown> = {}) =>
  ({
    patientName: '张三',
    diagnosis: { confirmation: 'genetic', d4z4Repeats: '7' },
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

describe('大片段缺失分支', () => {
  it.each<[string, boolean]>([
    ['1', true],
    ['4', true],
    ['3个', true],
    ['5', false],
    ['10', false],
    ['0', false],
    ['1-10', false],
    ['≤10', false],
    ['—', false],
    ['', false],
  ])('D4Z4「%s」→ %s', (raw, expected) => {
    expect(isLargeD4Z4Deletion(raw)).toBe(expected);
  });

  it('重复数在 1–4 时才把眼底检查标成对得上', () => {
    const large = summary({ diagnosis: { confirmation: 'genetic', d4z4Repeats: '3' } });
    expect(row('retinal_screening', large).applicability).toBe('matched');
  });

  it('重复数是明确的大数时标为不适用，但不说「不用查眼睛」', () => {
    const retina = row('retinal_screening');
    expect(retina.applicability).toBe('not_matched');
    expect(retina.evidence).toContain('视力变化');
  });

  it('读不出重复数时是「判断不了」，不是「不适用」 —— 范围我们不猜', () => {
    const ranged = summary({ diagnosis: { confirmation: 'genetic', d4z4Repeats: '1-10' } });
    const retina = row('retinal_screening', ranged);
    expect(retina.applicability).toBe('unknown');
    expect(retina.evidence).toContain('报告原件');
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
