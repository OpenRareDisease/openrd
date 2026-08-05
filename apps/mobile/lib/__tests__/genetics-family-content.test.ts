import { GENETICS_DISCLAIMER, GENETICS_INTRO, GENETICS_SECTIONS } from '../genetics-family-content';

/**
 * This page is read by someone deciding whether to have children.
 * Every number on it has to be the number the source gives, and the
 * uncomfortable half of each pair has to survive whatever edit comes
 * next — because the uncomfortable half is always the one that reads
 * like it could be softened.
 */

const all = GENETICS_SECTIONS.flatMap((section) => [
  section.title,
  section.lede ?? '',
  ...section.points,
]).join('\n');

describe('每一节都带出处', () => {
  it('除了「该找谁」，其余每节都有引文', () => {
    GENETICS_SECTIONS.filter((section) => section.id !== 'counseling').forEach((section) => {
      expect(section.source.length).toBeGreaterThan(10);
    });
  });

  it('引文是具体文献，不是「据研究」', () => {
    const sources = GENETICS_SECTIONS.map((s) => s.source).join(' ');
    expect(sources).toContain('Clinical Genetics 2024');
    expect(sources).toContain('Neurology 2006');
    expect(sources).toContain('中华妇产科杂志');
  });
});

describe('50% 不能单独出现', () => {
  it('给了概率就必须同时说明它预测不了严重程度', () => {
    // 「50% 遗传给孩子」 on its own is the most frightening possible
    // summary of a disease whose severity is unpredictable and often
    // mild. It is also the one sentence patients do get told.
    const section = GENETICS_SECTIONS.find((s) => s.id === 'inheritance');
    const text = section?.points.join('\n') ?? '';
    expect(text).toContain('50%');
    expect(text).toContain('不完全外显');
    expect(text).toMatch(/无法预测|两件事/);
  });

  it('写明每一胎重新计算', () => {
    // The commonest misunderstanding of a 50% dominant risk.
    expect(all).toContain('每一次怀孕');
    expect(all).toMatch(/不会因为上一胎/);
  });
});

describe('PGT 的限制不能被略过', () => {
  const pgt = GENETICS_SECTIONS.find((s) => s.id === 'pgt');
  const text = pgt?.points.join('\n') ?? '';

  it('说出 5% 误判率', () => {
    // The number a couple weighing IVF against the alternative needs,
    // and the one least likely to come up unprompted.
    expect(text).toContain('5%');
    expect(text).toContain('误判');
  });

  it('说明为什么会误判 —— 是间接连锁标记，不是直接测 D4Z4', () => {
    expect(text).toContain('连锁标记');
    expect(text).toContain('重组');
  });

  it('说明 PGT 之后仍建议产前诊断，以及那一步本身有代价', () => {
    expect(text).toMatch(/仍做一次产前诊断|之后仍做/);
    expect(text).toMatch(/流产|早产/);
  });

  it('说明 FSHD2 一般还做不到', () => {
    expect(text).toContain('FSHD2');
  });
});

describe('怀孕这一节两半都在', () => {
  const after = GENETICS_SECTIONS.find((s) => s.id === 'after');
  const text = after?.points.join('\n') ?? '';

  it('说出四分之一会永久加重', () => {
    expect(text).toMatch(/4 个人里有 1 个|1\/4|四分之一/);
    expect(text).toContain('不会恢复');
  });

  it('也说出 90% 仍会选择怀孕', () => {
    // Either half alone is a different page. The first alone reads as
    // 「不要生」, the second alone as 「没什么事」.
    expect(text).toContain('90%');
  });

  it('低出生体重这条没有被略掉', () => {
    const pregnancy = GENETICS_SECTIONS.find((s) => s.id === 'pregnancy');
    expect(pregnancy?.points.join('\n')).toContain('2500');
  });
});

describe('这一页不替患者做决定', () => {
  it('开头明说不给建议', () => {
    expect(GENETICS_INTRO).toMatch(/不建议你做任何选择|不是一个应用该给意见/);
  });

  it('正文里没有劝导性措辞', () => {
    // A rare-disease patient being nudged about whether to have
    // children is being nudged about whether people like them should
    // exist. Not this app's call, in either direction.
    expect(all).not.toMatch(/建议(你|您)(不要|放弃|考虑不)/);
    expect(all).not.toMatch(/最好不要生|不宜生育|应当避免生育/);
  });

  it('指向遗传咨询门诊', () => {
    expect(all).toContain('遗传咨询');
    expect(GENETICS_DISCLAIMER).toContain('遗传咨询');
  });
});
