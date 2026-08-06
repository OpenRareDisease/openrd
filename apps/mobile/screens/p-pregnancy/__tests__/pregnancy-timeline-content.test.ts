/**
 * 孕期时间线 的内容与日期算法。
 *
 * 这一页会被一个已经怀孕的 FSHD 女性读。里面每个数字必须是原文给的
 * 数字；每一条不舒服的事实必须挺过下一次编辑 —— 因为不舒服的那一半
 * 永远是看起来最像可以「稍微软化一下」的那一半。
 *
 * 日期那一部分测得比内容还紧：它是这个功能唯一可能主动伤到人的地方。
 */

import {
  PREGNANCY_CONSENT_BODY,
  PREGNANCY_DISCLAIMER,
  PREGNANCY_INTRO,
  PREGNANCY_STAGES,
  PREGNANCY_TRACKER_CLEARED_NOTICE,
  PREGNANCY_TRACKER_CLEAR_LABEL,
  TERM_DAYS,
  describeGestation,
  formatGestation,
  getStage,
  isPlausibleDueDate,
  stageForGestationalWeek,
  type PregnancyStageKey,
} from '../../../lib/pregnancy-timeline-content';
import { GENETICS_SECTIONS } from '../../../lib/genetics-family-content';

const allItems = PREGNANCY_STAGES.flatMap((stage) => stage.items);
const allText = PREGNANCY_STAGES.flatMap((stage) => [
  stage.title,
  stage.lede,
  ...stage.items.flatMap((item) => [item.title, item.detail]),
]).join('\n');

const stageText = (key: PregnancyStageKey): string => {
  const stage = getStage(key);
  if (!stage) return '';
  return [stage.lede, ...stage.items.flatMap((item) => [item.title, item.detail])].join('\n');
};

/** The days-until-due offset that produces a given gestational week. */
const dueDateForWeek = (weeks: number, today: Date): string => {
  const daysUntilDue = TERM_DAYS - weeks * 7;
  const due = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysUntilDue);
  const month = String(due.getMonth() + 1).padStart(2, '0');
  const day = String(due.getDate()).padStart(2, '0');
  return `${due.getFullYear()}-${month}-${day}`;
};

describe('每一条都带出处', () => {
  it('没有一条是无出处的', () => {
    allItems.forEach((item) => {
      expect(item.source.length).toBeGreaterThan(10);
    });
  });

  it('出处是具体文献，不是「据研究」', () => {
    const sources = allItems.map((item) => item.source).join(' ');
    expect(sources).toContain('FSHD and Pregnancy');
    expect(sources).toContain('Neurology 2006');
    expect(sources).toContain('AANA Journal');
    expect(sources).toContain('Clinical Genetics 2024');
  });

  it('每个阶段的 id 唯一 —— 它们是 React key', () => {
    const ids = allItems.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = PREGNANCY_STAGES.map((stage) => stage.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('临床锚点一条都不能少', () => {
  it('坐位和仰卧位肺活量都写了，并说明仰卧位是查膈肌的那一个', () => {
    // The whole reason both体位 are named: sitting can be normal while
    // supine is not, and supine is the one that gets skipped.
    expect(allText).toContain('仰卧位');
    expect(allText).toContain('坐位');
    expect(allText).toMatch(/膈肌/);
  });

  it('孕晚期专门点名仰卧位肺活量', () => {
    // Ciafaloni singles out the third trimester: weight gain affects
    // diaphragmatic function, especially supine.
    const third = stageText('third');
    expect(third).toContain('仰卧位');
    expect(third).toContain('膈肌');
  });

  it('孕晚期有一次四科联席会：产科、神经科、麻醉科、呼吸科', () => {
    const third = stageText('third');
    expect(third).toContain('产科');
    expect(third).toContain('神经科');
    expect(third).toContain('麻醉科');
    expect(third).toContain('呼吸科');
  });

  it('椎管内麻醉写成首选', () => {
    expect(stageText('third')).toMatch(/椎管内|硬膜外/);
    expect(stageText('third')).toContain('首选');
  });

  it('FSHD 本身不是剖宫产指征 —— 这句话必须在，且不能被削弱成「不一定」', () => {
    // The single sentence this page most needs to carry, and the one
    // an edit would most plausibly soften.
    const third = stageText('third');
    expect(third).toContain('FSHD 本身不是剖宫产指征');
    expect(third).toContain('产科指征');
  });

  it('同时说出剖宫产和产钳更常见，以及可能的原因是腹壁肌无力', () => {
    // Both halves. 「不是指征」 alone reads as 「不会发生」; 「更常见」
    // alone reads as 「所以要剖」.
    const delivery = stageText('delivery');
    expect(delivery).toContain('剖宫产');
    expect(delivery).toContain('产钳');
    expect(delivery).toContain('腹壁肌无力');
  });

  it('产后三条都在：延长住院、照护评估、产后抑郁筛查', () => {
    const postpartum = stageText('postpartum');
    expect(postpartum).toMatch(/延长住院|多住几天/);
    expect(postpartum).toMatch(/作业治疗|哺乳/);
    expect(postpartum).toContain('产后抑郁');
  });
});

describe('和「遗传与生育」「麻醉卡」不能各说各的', () => {
  const geneticsText = GENETICS_SECTIONS.flatMap((section) => [
    section.lede ?? '',
    ...section.points,
  ]).join('\n');

  it('1/4 加重和 90% 仍会选择，两边都在，且本页两句同段', () => {
    // Either half alone is a different page. genetics-family-content
    // has its own test for this; the point here is that the SECOND
    // artefact cannot drift away from the first.
    expect(geneticsText).toContain('90%');
    const progression = allItems.find((item) => item.id === 'progression');
    expect(progression?.detail).toMatch(/4 个人里有 1 个|四分之一|1\/4/);
    expect(progression?.detail).toContain('不会恢复');
    expect(progression?.detail).toContain('90%');
  });

  it('低出生体重的门槛两边都是 2500 克', () => {
    expect(geneticsText).toContain('2500');
    expect(allText).toContain('2500');
  });

  it('「结局整体是好的」那一组阴性结论没有被挑着写', () => {
    // Cherry-picking the reassuring subset is the easy way to make a
    // page feel kind and be wrong.
    const outcomes = allItems.find((item) => item.id === 'outcomes');
    const text = outcomes?.detail ?? '';
    ['流产', '早产', '子痫前期', '羊水过多', '胎膜早破', '妊娠糖尿病', '出生缺陷'].forEach(
      (term) => {
        expect(text).toContain(term);
      },
    );
  });

  it('全麻那句和麻醉卡不冲突 —— 明说两者说的不是同一件事', () => {
    // Ciafaloni: 「no data to suggest increased risk with general
    // anesthesia」. The card: 「避免吸入麻醉药、避免琥珀胆碱」. A reader
    // holding both must not conclude one of them is wrong.
    const anesthesia = allItems.find((item) => item.id === 'anesthesia');
    expect(anesthesia?.detail).toContain('全身麻醉');
    expect(anesthesia?.detail).toMatch(/并不矛盾/);
  });

  it('PGT 的 5% 误判率留在「遗传与生育」，本页不复述', () => {
    // Two pages quoting the same figure is two places for it to drift.
    // This page links out instead — assert it did not restate it.
    expect(geneticsText).toContain('5%');
    expect(allText).not.toContain('5%');
    expect(allText).toContain('遗传与生育');
  });
});

describe('这一页不劝，也不假装知道', () => {
  it('开头明说不劝生也不劝不生', () => {
    expect(PREGNANCY_INTRO).toMatch(/不劝你怀孕，也不劝你不怀/);
    expect(PREGNANCY_INTRO).toMatch(/不是一个应用该给意见的事/);
  });

  it('开头明说不记录、不推断怀孕状态', () => {
    expect(PREGNANCY_INTRO).toMatch(/不会记录/);
    expect(PREGNANCY_INTRO).toMatch(/不会从你填过的任何东西去推断|推断/);
  });

  it('正文里没有劝导性措辞', () => {
    expect(allText).not.toMatch(/建议(你|您)(不要|放弃|考虑不)/);
    expect(allText).not.toMatch(/最好不要生|不宜生育|应当避免生育|趁早生/);
  });

  it('没有祝贺、没有里程碑语气', () => {
    // A timeline is a shape that implies momentum. Nothing here may
    // treat reaching a later stage as an achievement — a reader may be
    // opening 产后 for reasons that are not a birth.
    expect(allText).not.toMatch(/恭喜|祝贺|好消息|加油|宝宝已经/);
  });

  it('不给「FVC 低于多少就该剖」这类阈值', () => {
    // No such FSHD-specific threshold exists in the sources. Inventing
    // one would be the worst defect this page could ship.
    expect(allText).not.toMatch(/FVC\s*(低于|<|小于)\s*\d+\s*%?\s*.{0,12}(剖宫产|剖)/);
  });

  it('每个阶段随时可读 —— 没有一个阶段依赖填过日期', () => {
    PREGNANCY_STAGES.forEach((stage) => {
      expect(stage.items.length).toBeGreaterThan(0);
      expect(stage.lede.length).toBeGreaterThan(0);
    });
  });

  it('免责声明说明本页没有按检查结果算过任何判断', () => {
    expect(PREGNANCY_DISCLAIMER).toMatch(/不能替代/);
    expect(PREGNANCY_DISCLAIMER).toMatch(/没有任何一条是按你的检查结果算出来的/);
  });
});

describe('单独同意的文案', () => {
  it('点名《个人信息保护法》第 28 条与敏感个人信息', () => {
    expect(PREGNANCY_CONSENT_BODY).toContain('个人信息保护法');
    expect(PREGNANCY_CONSENT_BODY).toContain('第 28 条');
    expect(PREGNANCY_CONSENT_BODY).toContain('敏感个人信息');
  });

  it('承诺不上传、不进档案、不进分享链接、不进 AI', () => {
    // Each of these is a real surface in this app that a leaked due
    // date could reach. The promise is only worth making if the code
    // keeps it — pregnancy-tracker.test.ts is the half that checks.
    expect(PREGNANCY_CONSENT_BODY).toContain('不会上传到服务器');
    expect(PREGNANCY_CONSENT_BODY).toContain('临床护照');
    expect(PREGNANCY_CONSENT_BODY).toContain('分享链接');
    expect(PREGNANCY_CONSENT_BODY).toContain('AI');
  });

  it('承诺随时可以一键删除，并说明不填也能看全部内容', () => {
    expect(PREGNANCY_CONSENT_BODY).toMatch(/一键删除/);
    expect(PREGNANCY_CONSENT_BODY).toMatch(/不填.*照样可以看/);
  });

  it('删除按钮的文案说的是删除，不是「暂停」', () => {
    expect(PREGNANCY_TRACKER_CLEAR_LABEL).toContain('删除');
    expect(PREGNANCY_TRACKER_CLEAR_LABEL).not.toMatch(/暂停|稍后|静音/);
  });

  it('删除后的提示不追问、不挽留', () => {
    expect(PREGNANCY_TRACKER_CLEARED_NOTICE).toContain('已删除');
    expect(PREGNANCY_TRACKER_CLEARED_NOTICE).not.toMatch(/确定|可惜|为什么|重新考虑/);
  });
});

describe('日期算法：过了预产期就不再回答', () => {
  const today = new Date(2026, 4, 20);

  it('孕周按 280 天推算', () => {
    const gestation = describeGestation(dueDateForWeek(22, today), today);
    expect(gestation).not.toBeNull();
    expect(gestation?.weeks).toBe(22);
    expect(gestation?.days).toBe(0);
  });

  it('零头的天数会算出来', () => {
    // 22 weeks + 3 days: three days further along than the 22w mark.
    const due = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (280 - 157));
    const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(
      due.getDate(),
    ).padStart(2, '0')}`;
    const gestation = describeGestation(iso, today);
    expect(gestation?.weeks).toBe(22);
    expect(gestation?.days).toBe(3);
    expect(formatGestation(gestation!)).toBe('孕 22 周 +3 天');
  });

  it('预产期当天仍然回答（孕 40 周）', () => {
    const gestation = describeGestation(dueDateForWeek(40, today), today);
    expect(gestation?.weeks).toBe(40);
    expect(gestation?.daysUntilDue).toBe(0);
  });

  it('过了预产期一天，就返回 null —— 不往上数', () => {
    // THE test. Past the due date the app knows exactly nothing: not
    // whether the baby was born, not whether the pregnancy ended at 19
    // weeks, not whether the date was ever right. Rendering 「孕 41 周」
    // to someone whose pregnancy ended is the single worst thing this
    // feature could do, and refusing here is what makes it unreachable
    // rather than merely unlikely.
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const iso = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(
      2,
      '0',
    )}-${String(yesterday.getDate()).padStart(2, '0')}`;
    expect(describeGestation(iso, today)).toBeNull();
    expect(isPlausibleDueDate(iso, today)).toBe(false);
  });

  it('超过 280 天以后的日期不接受', () => {
    const far = new Date(today.getFullYear(), today.getMonth(), today.getDate() + TERM_DAYS + 1);
    const iso = `${far.getFullYear()}-${String(far.getMonth() + 1).padStart(2, '0')}-${String(
      far.getDate(),
    ).padStart(2, '0')}`;
    expect(describeGestation(iso, today)).toBeNull();
    expect(isPlausibleDueDate(iso, today)).toBe(false);
  });

  it('格式不对、不存在的日期都拒绝', () => {
    ['', '  ', '2026/05/20', '20260520', 'abc', '2026-13-01', '2026-02-30'].forEach((value) => {
      expect(describeGestation(value, today)).toBeNull();
      expect(isPlausibleDueDate(value, today)).toBe(false);
    });
  });

  it('按本地时区解析 —— UTC+8 的患者不会差一天', () => {
    // `new Date('2026-05-20')` parses as UTC midnight, which is 08:00
    // local in China. Comparing that against a local-midnight "today"
    // shifts the answer by a day at the boundary, and the boundary is
    // exactly where 「今天是不是预产期」 gets decided.
    const dueToday = '2026-05-20';
    expect(isPlausibleDueDate(dueToday, new Date(2026, 4, 20, 23, 59))).toBe(true);
    expect(isPlausibleDueDate(dueToday, new Date(2026, 4, 21, 0, 1))).toBe(false);
  });
});

describe('阶段推断：只推断孕期内的三段', () => {
  it('周数映射到孕早/中/晚', () => {
    expect(stageForGestationalWeek(0)).toBe('first');
    expect(stageForGestationalWeek(13)).toBe('first');
    expect(stageForGestationalWeek(14)).toBe('second');
    expect(stageForGestationalWeek(27)).toBe('second');
    expect(stageForGestationalWeek(28)).toBe('third');
    expect(stageForGestationalWeek(40)).toBe('third');
  });

  it('永远不会自动跳到「分娩」或「产后」', () => {
    // A date cannot tell this app that a birth happened. Auto-opening
    // 产后 — which leads with 产后抑郁筛查 — on the strength of a
    // calendar would be the app announcing an outcome it has no
    // knowledge of.
    for (let week = 0; week <= 60; week += 1) {
      const stage = stageForGestationalWeek(week);
      expect(stage).not.toBe('delivery');
      expect(stage).not.toBe('postpartum');
      expect(stage).not.toBe('preconception');
    }
  });

  it('负数和非数字返回 null', () => {
    expect(stageForGestationalWeek(-1)).toBeNull();
    expect(stageForGestationalWeek(Number.NaN)).toBeNull();
    expect(stageForGestationalWeek(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('孕周区间首尾相接，没有缝也没有重叠', () => {
    const ranges = PREGNANCY_STAGES.filter((stage) => stage.weekRange).map(
      (stage) => stage.weekRange!,
    );
    ranges.forEach((range, index) => {
      if (index === 0) return;
      expect(range.from).toBe(ranges[index - 1].to);
    });
  });
});

describe('孕周读数不是倒计时', () => {
  it('只说现在在第几周，不说「还有多少天」', () => {
    // A countdown is a promise about an outcome.
    expect(formatGestation({ weeks: 30, days: 0, daysUntilDue: 70 })).toBe('孕 30 周');
    expect(formatGestation({ weeks: 30, days: 4, daysUntilDue: 66 })).toBe('孕 30 周 +4 天');
    expect(formatGestation({ weeks: 30, days: 4, daysUntilDue: 66 })).not.toContain('还有');
  });
});
