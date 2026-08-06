import {
  RARE_DISEASE_CONTENT_AS_OF,
  RARE_DISEASE_DISCLAIMER,
  RARE_DISEASE_INTRO,
  RARE_DISEASE_LOCALITY_NOTE,
  RARE_DISEASE_SECTIONS,
  buildRareDiseaseCard,
} from '../rare-disease-status-content';

/**
 * This card gets held up at a window by someone asking for something.
 * Two failures are possible and only one of them is visible:
 *
 *  - Claiming an entitlement that does not exist here or does not exist
 *    yet. The patient makes a journey and is told no by a clerk who then
 *    has to explain it.
 *  - Quietly omitting that the catalogue currently buys FSHD no drug.
 *    That one reads as a finished, encouraging page and costs the same
 *    journey.
 *
 * The tests below pin both halves.
 */

const allText = RARE_DISEASE_SECTIONS.flatMap((section) => [
  section.title,
  section.lede ?? '',
  ...section.points,
]).join('\n');

describe('目录身份', () => {
  it('说出序号 25 和目录的官方病种名', () => {
    // Read out of the .doc attachment on nhc.gov.cn, where 序号 25 is
    // 面肩肱型肌营养不良症 / Facioscapulohumeral muscular dystrophy —
    // 24 is 上皮样肉瘤 and 26 is 家族性噬血细胞淋巴组织细胞增生症.
    expect(allText).toContain('序号 25');
    expect(allText).toContain('面肩肱型肌营养不良症');
  });

  it('说出文号，因为文号才是窗口能用的东西', () => {
    expect(allText).toContain('国卫医政发〔2023〕26号');
    expect(allText).toContain('2023 年 9 月 18 日');
  });
});

describe('协作网欠患者什么', () => {
  const section = RARE_DISEASE_SECTIONS.find((s) => s.id === 'network');
  const text = (section?.points ?? []).join('\n');

  it('引 2019 年通知的文号', () => {
    expect(text).toContain('国卫办医函〔2019〕157号');
    expect(section?.source).toContain('国卫办医函〔2019〕157号');
  });

  it('三项义务都在：双向转诊、远程会诊、病例登记', () => {
    expect(text).toContain('双向转诊');
    expect(text).toContain('远程会诊');
    expect(text).toContain('录入登记系统');
  });

  it('说清楚转回本地随访是成员医院的活', () => {
    // The half patients are never told: the referral is two-way, so
    // follow-up does not have to mean travelling to the provincial
    // 牵头医院 every time — which for someone with FSHD is the whole
    // question.
    expect(text).toContain('接续管理');
  });

  it('医院名单标了会调整，不把家数说成永久事实', () => {
    expect(text).toContain('419');
    expect(text).toMatch(/会调整|最新公布的名单为准/);
  });
});

describe('医疗援助工程写成当期公告，不写成长期承诺', () => {
  const section = RARE_DISEASE_SECTIONS.find((s) => s.id === 'assistance');
  const text = (section?.points ?? []).join('\n');

  it('说明是哪一期的条件', () => {
    expect(text).toContain('七期');
    expect(text).toContain('2024');
  });

  it('条件和额度都写出来了', () => {
    expect(text).toContain('40%');
    expect(text).toContain('10 000 元');
    expect(text).toContain('罕见病诊疗协作网医院明确诊断');
  });

  it('明说条件会变，并给出核对渠道', () => {
    // The failure this pins: a stale 期次 quoted as current, sending
    // someone to apply against terms that closed two years ago.
    expect(text).toMatch(/都会变|以基金会当期公告为准/);
    expect(text).toContain('chinaicf.org');
    expect(section?.source).toContain('非长期承诺');
  });
});

describe('目录 ≠ 门诊慢特病', () => {
  const section = RARE_DISEASE_SECTIONS.find((s) => s.id === 'not-chronic-benefit');
  const text = (section?.points ?? []).join('\n');

  it('引国家医保局的原话说明病种范围是地方定的', () => {
    expect(text).toContain('全国各地还不尽统一');
    expect(text).toContain('参保所在统筹地区');
  });

  it('明说本应用查不了，只能问当地医保', () => {
    expect(text).toMatch(/只能问当地医保局|谁都替不了你查/);
  });

  it('说明跨省结算不会多出一个病种', () => {
    expect(text).toContain('不改变参保地原有的门诊慢特病病种范围');
  });

  it('出处是医保局的文件，不是卫健委的目录', () => {
    expect(section?.source).toContain('国家医疗保障局');
  });
});

describe('诚实的那一节 —— 目录目前给不了什么', () => {
  const section = RARE_DISEASE_SECTIONS.find((s) => s.id === 'what-it-does-not-get-you');
  const text = (section?.points ?? []).join('\n');

  it('这一节存在', () => {
    // Deleting it would leave four encouraging sections and a page that
    // reads as finished. That is the version this test exists to stop.
    expect(section).toBeDefined();
  });

  it('说明药品通道加速的是审批，不是给药', () => {
    expect(text).toContain('优先审评审批');
    expect(text).toContain('一百三十日');
    expect(text).toContain('七十日');
  });

  it('说明 FSHD 目前没有能改变病程的药，并说出是哪一次试验', () => {
    expect(text).toContain('没有能改变病程的药');
    expect(text).toContain('losmapimod');
    expect(text).toContain('REACH');
    expect(text).toContain('未达主要终点');
  });

  it('把「不等于」三件事一次说清', () => {
    expect(text).toContain('不等于有药');
    expect(text).toContain('不等于有报销');
  });

  it('说完之后仍然说出目录真正给了什么，不把这一节写成劝退', () => {
    // The point is accuracy, not discouragement. A section that only
    // took things away would be its own distortion.
    expect(text).toMatch(/诊疗协作义务|国家文号/);
  });
});

describe('每一节都带出处', () => {
  it('每一节的 source 都是具体文件', () => {
    RARE_DISEASE_SECTIONS.forEach((section) => {
      expect(section.source.length).toBeGreaterThan(10);
      expect(section.source).toMatch(/〔|号|公告|《/);
    });
  });
});

describe('资料截至与地方差异', () => {
  it('带 ISO 日期', () => {
    expect(RARE_DISEASE_CONTENT_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('明说地方规定不同、会变，要先核一遍', () => {
    expect(RARE_DISEASE_LOCALITY_NOTE).toMatch(/按省市|各省|当地/);
    expect(RARE_DISEASE_LOCALITY_NOTE).toMatch(/核|为准/);
  });

  it('免责声明不承诺任何待遇', () => {
    expect(RARE_DISEASE_DISCLAIMER).toContain('不能代替');
    expect(RARE_DISEASE_INTRO).toContain('第 25 项');
  });
});

describe('可以举给窗口看的那张卡', () => {
  const card = buildRareDiseaseCard('2026-08-05');

  it('卡上有文号、序号和资料截至日期', () => {
    const flat = [
      card.title,
      card.patientName,
      ...card.patientLines,
      ...card.sections.flatMap((s) => [s.title, ...s.lines]),
      card.disclaimer,
      ...card.sources,
    ].join('\n');
    expect(flat).toContain('序号 25');
    expect(flat).toContain('国卫医政发〔2023〕26号');
    expect(flat).toContain('国卫办医函〔2019〕157号');
    expect(flat).toContain('资料截至：2026-08-05');
  });

  it('日期来自参数，不是渲染当天', () => {
    // A card that stamps「today」regardless of when the sources were last
    // re-read lies more convincingly the longer it sits unmaintained.
    expect(buildRareDiseaseCard('2020-01-01').patientLines.join('\n')).toContain(
      '资料截至：2020-01-01',
    );
  });

  it('卡上不含任何个人信息', () => {
    // It is generated with no passport and shown to a stranger at a
    // counter, so there must be nothing on it that identifies the holder.
    const flat = [card.patientName, ...card.patientLines].join('\n');
    expect(flat).not.toMatch(/姓名|身份证|手机|出生/);
  });

  it('卡上也印了「没有药」和「不等于门诊慢特病」这两条', () => {
    const lines = card.sections.flatMap((s) => s.lines).join('\n');
    expect(lines).toContain('无改变病程的治疗药物');
    expect(lines).toContain('不等于列入门诊慢特病');
    expect(lines).toContain('不因列入目录而自动获得');
  });

  it('卡不印基金会申请条件 —— 那是会随期次过期的东西', () => {
    const flat = [
      card.patientName,
      ...card.patientLines,
      ...card.sections.flatMap((s) => [s.title, ...s.lines]),
    ].join('\n');
    // A printed card outliving its 期次 is exactly the stale-entitlement
    // failure this module is built to avoid; the terms stay on-screen
    // where they can be corrected.
    expect(flat).not.toContain('10 000 元');
    expect(flat).not.toContain('七期');
  });

  it('卡上有免责声明，且它不承诺权益', () => {
    expect(card.disclaimer).toContain('不构成任何权益承诺');
  });
});
