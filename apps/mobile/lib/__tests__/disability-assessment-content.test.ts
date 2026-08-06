import {
  ADL_ANSWER_SCORE,
  ADL_INTRO,
  ADL_ITEMS,
  ADL_SCORE_DISCLAIMER,
  ADL_SOURCE,
  ASSESSMENT_MATERIALS,
  DISABILITY_CONTENT_AS_OF,
  DISABILITY_DISCLAIMER,
  DISABILITY_INTRO,
  DISABILITY_LOCALITY_NOTE,
  DISABILITY_SECTIONS,
  GRADE_CRITERIA_SOURCE,
  LIMB_GRADE_CRITERIA,
  MATERIALS_SOURCE,
  buildAdlNarrative,
  tallyAdl,
  type AdlAnswers,
} from '../disability-assessment-content';

/**
 * This page is read by someone deciding whether it is worth applying for
 * a 残疾人证 at all, and then read again by someone preparing for the
 * appointment. Two things have to survive every future edit:
 *
 *  1. The functional-impairment clauses stay quoted exactly and stay
 *     lifted out. They are what make the standard apply to FSHD, and
 *     they sit last in every grade.
 *  2. Nothing on the page ever predicts a grade. That is a physician's
 *     judgement, the standard gives no numeric definition of「重度障碍」
 *     to predict from, and being wrong costs a patient a journey they
 *     may not physically find easy.
 */

const allSectionText = DISABILITY_SECTIONS.flatMap((section) => [
  section.title,
  section.lede ?? '',
  ...section.points,
]).join('\n');

const allGradeText = LIMB_GRADE_CRITERIA.flatMap((grade) => [
  grade.grade,
  grade.headline,
  ...grade.items.map((item) => item.text),
]).join('\n');

const wholePage = [
  DISABILITY_INTRO,
  DISABILITY_LOCALITY_NOTE,
  DISABILITY_DISCLAIMER,
  ADL_INTRO,
  ADL_SCORE_DISCLAIMER,
  allSectionText,
  allGradeText,
  ASSESSMENT_MATERIALS.map((m) => `${m.label}${m.detail}`).join('\n'),
].join('\n');

describe('这一页永远不预测等级', () => {
  it('没有任何一句在说患者能评上几级', () => {
    // The exact sentence the lane forbids, and its nearest neighbours.
    // A future edit that "helpfully" summarises the criteria into an
    // outcome has to trip one of these.
    expect(wholePage).not.toMatch(/你(应该|大概|多半|很可能)能评/);
    expect(wholePage).not.toMatch(/可以评上|能评上|够得上(三|四|二|一)级/);
    expect(wholePage).not.toMatch(/符合(三|四)级(的)?条件$/m);
    expect(wholePage).not.toMatch(/(建议|推荐)你去评/);
  });

  it('免责声明明说不预测，并把判断权归给评定医师', () => {
    expect(DISABILITY_DISCLAIMER).toContain('不预测');
    expect(DISABILITY_DISCLAIMER).toContain('评定机构');
    expect(DISABILITY_DISCLAIMER).toMatch(/医师/);
  });
});

describe('每一节都带出处', () => {
  it('每一节都有引文，没有例外', () => {
    DISABILITY_SECTIONS.forEach((section) => {
      expect(section.source.length).toBeGreaterThan(10);
    });
  });

  it('引文是具体文号，不是「据规定」', () => {
    const sources = DISABILITY_SECTIONS.map((s) => s.source).join(' ');
    expect(sources).toContain('GB/T 26341—2010');
    expect(sources).toContain('残疾人证管理办法');
    expect(GRADE_CRITERIA_SOURCE).toContain('GB/T 26341—2010');
    expect(ADL_SOURCE).toContain('中国残疾人实用评定标准');
  });

  it('本页自己写的句子被标成本页写的，不冒充条文', () => {
    // The failure this pins: a helpful example sentence acquiring a
    // citation it does not have. Three sections mix quotation with this
    // page's own wording, and each says which is which.
    const ownWording = DISABILITY_SECTIONS.filter((s) => s.source.includes('本页'));
    expect(ownWording.length).toBeGreaterThanOrEqual(2);
    expect(ADL_SOURCE).toContain('本页编写');
    expect(MATERIALS_SOURCE).toContain('本页建议');
  });
});

describe('功能障碍条款既在原文里，也被拎了出来', () => {
  const functionalClauses = LIMB_GRADE_CRITERIA.flatMap((grade) =>
    grade.items.filter((item) => item.functional).map((item) => item.text),
  );

  it('四级里每一级都标出了功能障碍条款', () => {
    LIMB_GRADE_CRITERIA.forEach((grade) => {
      expect(grade.items.some((item) => item.functional)).toBe(true);
    });
  });

  it('三级那一条是逐字的，一个字没改', () => {
    const grade3 = LIMB_GRADE_CRITERIA.find((g) => g.id === 'grade-3');
    const clause = grade3?.items.find((item) => item.functional);
    // GB/T 26341—2010 5.5.4 f). The clause this whole page exists for.
    expect(clause?.text).toBe('一肢功能重度障碍或二肢功能中度障碍。');
    expect(clause?.marker).toBe('f)');
    expect(grade3?.headline).toBe('能部分独立实现日常生活活动，并具备下列状况之一：');
  });

  it('四级那两条也在', () => {
    const grade4 = LIMB_GRADE_CRITERIA.find((g) => g.id === 'grade-4');
    const texts = grade4?.items.filter((i) => i.functional).map((i) => i.text) ?? [];
    expect(texts).toContain('一肢功能中度障碍或两肢功能轻度障碍；');
    expect(texts).toContain('类似上述的其他肢体功能障碍。');
  });

  it('功能障碍条款在原文里确实排在最后 —— 这就是它被漏读的原因', () => {
    LIMB_GRADE_CRITERIA.forEach((grade) => {
      const firstFunctional = grade.items.findIndex((item) => item.functional);
      // Every grade buries it: at best second-to-last (四级), at worst
      // ninth of nine (一级). If a future revision of the standard moves
      // it, this test should be updated with the standard — not deleted.
      expect(firstFunctional).toBeGreaterThanOrEqual(grade.items.length - 2);
    });
    expect(functionalClauses.length).toBe(5);
  });

  it('缺失类条款没有被删掉，四级全文都在', () => {
    // Showing only the flattering subset would be a different lie.
    expect(LIMB_GRADE_CRITERIA).toHaveLength(4);
    expect(allGradeText).toContain('双小腿缺失');
    expect(allGradeText).toContain('四肢瘫：四肢运动功能重度丧失');
    expect(allGradeText).toContain('侏儒症');
  });
});

describe('标准没有定义「重度障碍」这件事必须写出来', () => {
  const section = DISABILITY_SECTIONS.find((s) => s.id === 'no-degree-definition');
  const text = [section?.lede ?? '', ...(section?.points ?? [])].join('\n');

  it('明说标准里没有肢体功能障碍程度的判定尺度', () => {
    expect(text).toContain('术语和定义');
    expect(text).toMatch(/没有一条定义|没有给功能障碍的判定尺度/);
    expect(text).toContain('评定医师');
  });

  it('用智力和听力残疾有量表来做对照，说明这不是我们查漏了', () => {
    expect(text).toContain('WHO-DAS');
    expect(text).toMatch(/分贝/);
  });

  it('不发明一个换算表', () => {
    expect(text).toContain('换算表并不存在');
  });
});

describe('不戴辅具这一条', () => {
  const section = DISABILITY_SECTIONS.find((s) => s.id === 'no-devices');
  const text = (section?.points ?? []).join('\n');

  it('引了标准原话', () => {
    // 5.5.1. Missed by an AFO user who walks in wearing it and is
    // assessed on a gait the standard did not ask to see.
    expect(text).toContain('不配戴假肢、矫形器及其他辅助器具');
  });

  it('说到 AFO，因为 FSHD 用它的人不少', () => {
    expect(text).toContain('AFO');
  });
});

describe('办证流程里那些没人主动说的条款', () => {
  it('写了上门评定是「应」', () => {
    expect(allSectionText).toContain('上门开展残疾评定');
    expect(allSectionText).toContain('第十一条');
  });

  it('写了费用怎么算、困难怎么减免', () => {
    expect(allSectionText).toContain('不收取工本费');
    expect(allSectionText).toContain('减免');
  });

  it('写了进展性疾病可以申请重新评定', () => {
    expect(allSectionText).toContain('第二十二条');
    expect(allSectionText).toMatch(/重新进行残疾评定/);
  });

  it('写了异议的路径和那个十个工作日的时限', () => {
    expect(allSectionText).toContain('第二十五条');
    expect(allSectionText).toContain('十个工作日');
    expect(allSectionText).toContain('省级残疾评定专家委员会');
  });

  it('写明评定用的就是 GB/T 26341—2010，所以上面引的条文是当天在用的那份', () => {
    expect(allSectionText).toContain('第二条');
    expect(allSectionText).toContain('GB/T 26341—2010');
  });
});

describe('八项日常生活活动', () => {
  it('八项就是标准列的那八项，顺序也一样', () => {
    expect(ADL_ITEMS.map((item) => item.label)).toEqual([
      '端坐',
      '站立',
      '行走',
      '穿衣',
      '洗漱',
      '进餐',
      '入厕',
      '写字',
    ]);
  });

  it('计分是 1 / 0.5 / 0', () => {
    expect(ADL_ANSWER_SCORE.able).toBe(1);
    expect(ADL_ANSWER_SCORE.difficult).toBe(0.5);
    expect(ADL_ANSWER_SCORE.unable).toBe(0);
  });

  it('每一项都有把动作说具体的提示', () => {
    ADL_ITEMS.forEach((item) => {
      expect(item.prompts.length).toBeGreaterThan(0);
    });
  });
});

describe('合计分数不能看起来像个结果', () => {
  const answerAll = (value: 'able' | 'difficult' | 'unable'): AdlAnswers =>
    Object.fromEntries(ADL_ITEMS.map((item) => [item.id, value]));

  it('八项没填完就不出合计', () => {
    // A running subtotal is a number that looks like a result on a page
    // whose whole discipline is that no number here is a result.
    const partial: AdlAnswers = { sit: 'able', stand: 'difficult' };
    const tally = tallyAdl(partial);
    expect(tally.total).toBeNull();
    expect(tally.answeredCount).toBe(2);
    expect(tally.itemCount).toBe(8);
  });

  it('全部填完才给合计，且算得对', () => {
    expect(tallyAdl(answerAll('able')).total).toBe(8);
    expect(tallyAdl(answerAll('difficult')).total).toBe(4);
    expect(tallyAdl(answerAll('unable')).total).toBe(0);
    expect(tallyAdl({ ...answerAll('able'), wash: 'difficult', eat: 'unable' }).total).toBe(6.5);
  });

  it('分数旁边必须说清楚它换算不出等级，以及为什么', () => {
    // 6.5 reads as「轻度（三级）」under the older standard's own bands.
    // The certificate is graded under GB/T 26341—2010, which has four
    // grades and no such score. Anyone adding up 6.5 has computed
    // nothing about the certificate they are applying for.
    expect(ADL_SCORE_DISCLAIMER).toContain('不能换算成残疾等级');
    expect(ADL_SCORE_DISCLAIMER).toContain('中国残疾人实用评定标准');
    expect(ADL_SCORE_DISCLAIMER).toContain('GB/T 26341—2010');
    expect(ADL_SCORE_DISCLAIMER).toMatch(/三级/);
    expect(ADL_SCORE_DISCLAIMER).toMatch(/四级/);
  });

  it('页面上没有任何地方给出分数到等级的对照带', () => {
    // The older standard's bands (0–4 / 4.5–6 / 6.5–7.5) must not appear
    // anywhere a reader could take them for this page's answer.
    expect(wholePage).not.toContain('6.5—7.5');
    expect(wholePage).not.toContain('4.5—6');
    expect(wholePage).not.toMatch(/0[—-]4\s*分/);
  });
});

describe('自述文字是给人念的，不是评定结论', () => {
  it('八项都出现，未填的标成未填', () => {
    const lines = buildAdlNarrative({ sit: 'able', wash: 'unable' });
    const joined = lines.join('\n');
    ADL_ITEMS.forEach((item) => {
      expect(joined).toContain(item.label);
    });
    expect(joined).toContain('端坐：能实现');
    expect(joined).toContain('洗漱：不能实现');
    expect(joined).toContain('行走：（未填）');
  });

  it('开头写明不用辅具，结尾写明这不是结论', () => {
    const joined = buildAdlNarrative({}).join('\n');
    expect(joined).toContain('不使用辅助器具');
    expect(joined).toContain('不是评定结论');
  });

  it('自述里不含分数', () => {
    // The artefact handed over at the desk is a description, not a
    // score. A number in it invites the reader to treat it as one.
    const joined = buildAdlNarrative({ sit: 'able', stand: 'difficult' }).join('\n');
    expect(joined).not.toMatch(/\d+(\.\d)?\s*分/);
  });
});

describe('材料清单分得清规定和建议', () => {
  it('规定项和建议项都有，并且各自标了出来', () => {
    const required = ASSESSMENT_MATERIALS.filter((m) => m.required);
    const suggested = ASSESSMENT_MATERIALS.filter((m) => !m.required);
    expect(required.length).toBeGreaterThan(0);
    expect(suggested.length).toBeGreaterThan(0);
  });

  it('规定项就是办法第九条列的那几样', () => {
    const labels = ASSESSMENT_MATERIALS.filter((m) => m.required).map((m) => m.label);
    expect(labels.join(' ')).toContain('居民身份证');
    expect(labels.join(' ')).toContain('户口本');
    expect(labels.join(' ')).toContain('两寸');
    ASSESSMENT_MATERIALS.filter((m) => m.required).forEach((material) => {
      expect(material.detail).toContain('办法');
    });
  });

  it('建议项明说是建议，不冒充规定', () => {
    // A patient turned away for lacking something we invented, or
    // hauling paperwork nobody asked for, is this list failing.
    ASSESSMENT_MATERIALS.filter((m) => !m.required).forEach((material) => {
      expect(material.detail).toContain('本页建议');
    });
  });
});

describe('资料截至日期与地方差异', () => {
  it('带日期，且是 ISO 形式', () => {
    expect(DISABILITY_CONTENT_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('明说各地不同，要先打电话问', () => {
    expect(DISABILITY_LOCALITY_NOTE).toMatch(/各省各市不同|各地/);
    expect(DISABILITY_LOCALITY_NOTE).toContain('残联');
  });
});
