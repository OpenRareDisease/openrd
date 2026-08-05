/**
 * 遗传与生育 — the content, as data.
 *
 * Separated from the screen so the claims can be tested. Every number
 * below comes from one of three documents in the corpus, and each
 * section carries its own source so a reader can check it:
 *
 *  [Giardina] Giardina E, et al. Best practice guidelines on genetic
 *             diagnostics of facioscapulohumeral muscular dystrophy.
 *             Clin Genet. 2024;106:13-26.
 *  [Ciafaloni] Ciafaloni E. FSHD and Pregnancy. (FSHD Society patient
 *             document; the underlying cohort is Ciafaloni et al.,
 *             Neurology 2006;67:887-889.)
 *  [中华] 中国遗传学会遗传咨询分会等. 胚胎植入前遗传学检测的遗传咨询
 *             专家共识. 中华妇产科杂志. 2024;59(12):899-909.
 *
 * This page exists because of what patients are otherwise told. 「50%
 * 遗传给孩子」 is the one fact that does get repeated, and on its own
 * it is the most frightening possible summary of a disease whose
 * severity is unpredictable and often mild. The parts that would
 * actually inform a decision — that a genotype does not predict how
 * severe it will be, that PGT for FSHD carries a ~5% misdiagnosis
 * risk, that a quarter of pregnancies leave permanent worsening and
 * that 90% of those women would do it again — are the parts nobody
 * hears.
 *
 * Nothing here recommends a course of action. Reproduction is not a
 * decision an app gets to weigh in on, and a rare-disease patient
 * being nudged about whether to have children is being nudged about
 * whether people like them should exist. The page's whole job is to
 * hand over what is known, including how much is not known, and name
 * the specialist who does this properly.
 */

export type GeneticsSection = {
  id: string;
  title: string;
  /** One-line framing shown under the heading. */
  lede?: string;
  points: string[];
  /** Shown in small type at the foot of the section. */
  source: string;
};

export const GENETICS_SECTIONS: GeneticsSection[] = [
  {
    id: 'inheritance',
    title: '会遗传给孩子吗',
    points: [
      'FSHD 绝大多数是常染色体显性遗传：每一次怀孕，孩子有 50% 的可能继承这个基因改变。这个概率对每一胎都重新计算，不会因为上一胎没有就变小，也不会因为上一胎有了就变大。',
      '但「继承了基因」和「会发病、病得多重」是两件事。FSHD 有不完全外显和很大的个体差异 —— 同一个家庭里，发病年龄、进展速度、严重程度都可能差得很远。',
      '这一点在 D4Z4 重复数 8–10 的情况下尤其明显：即使基因诊断完全可靠，也无法预测继承的孩子将来会不会出现症状。看家里其他人的情况来推断，参考价值有限。',
    ],
    source: 'Giardina 等, Clinical Genetics 2024;106:13-26',
  },
  {
    id: 'pgt',
    title: '三代试管（PGT）能不能避免',
    lede: '可以做，但它对 FSHD 有几个特别的限制，值得在决定之前知道。',
    points: [
      'FSHD1 可以做植入前单基因病检测（PGT-M）。做法不是直接测胚胎的 D4Z4 长度，而是用 D4Z4 附近的几个连锁标记（D4S2390、D4S1652、D4S2930、D4S1523）间接判断 —— 这些标记位于 D4Z4 的近端。',
      '正因为是间接判断，标记和 D4Z4 之间可能发生重组，也可能出现无法提供信息的结果。指南给出的估计是：FSHD 的 PGT 有约 5% 的误判风险。',
      '所以指南建议，即使 PGT 成功了，之后仍做一次产前诊断来确认。而产前诊断本身有很小的流产或早产风险 —— 对一对已经「成功」做完 PGT 的夫妇来说，这是个不容易做的决定。指南把这一点明确写了出来。',
      '做 PGT 的前提，是先在家里明确到底是哪一个基因型在传递。FSHD2 目前一般还做不到这一步。',
      '国内做 PGT 需要在有资质的辅助生殖机构进行，术前遗传咨询是必需环节。',
    ],
    source: 'Giardina 等, Clinical Genetics 2024;106:13-26；中华妇产科杂志 2024;59(12):899-909',
  },
  {
    id: 'prenatal',
    title: '怀孕之后再查（产前诊断）',
    points: [
      '可以取绒毛（CVS，约 10–13 周）或羊水（约 15–17 周）做检测。绒毛能更早出结果，对遗传风险高的夫妇通常更合适。',
      '羊水穿刺取到的细胞量少，需要先培养再检测，所以出结果更慢；绒毛如果取到的细胞够多，可以直接检测。',
      '无论结果如何，指南都要求做检测后的遗传咨询 —— 不是只有结果异常时才需要。',
    ],
    source: 'Giardina 等, Clinical Genetics 2024;106:13-26',
  },
  {
    id: 'pregnancy',
    title: '怀孕本身会怎么样',
    lede: '总体结局是好的。以下每一条都来自对 FSHD 女性妊娠结局的研究，不是推测。',
    points: [
      '生育能力：目前没有证据表明 FSHD 影响生育能力。',
      '流产和早产：没有增加。',
      '早产儿比例、胎儿窘迫、新生儿死亡：与普通人群没有差别。',
      '低出生体重（低于 2500 克）：FSHD 母亲的孩子中明显更常见。',
      '剖宫产和产钳助产：比普通人群多 —— 可能和腹壁肌无力有关。',
      '子痫前期、羊水过多、胎膜早破、妊娠糖尿病、出生缺陷：风险都没有增加。',
      '分娩用麻醉：没有数据提示 FSHD 会增加全身麻醉的风险。（具体的麻醉安排见「麻醉注意事项卡」。）',
    ],
    source: 'Ciafaloni, FSHD and Pregnancy；原始队列见 Neurology 2006;67:887-889',
  },
  {
    id: 'after',
    title: '怀孕会让我的病加重吗',
    lede: '这一条是最难的，两半都要看。',
    points: [
      '大约每 4 个人里有 1 个，怀孕会让 FSHD 症状加重，而且这种加重多数在生产之后不会恢复。',
      '最常见的是：整体无力加重、更容易跌倒、因为肩部或腿部无力而抱不动孩子、疼痛加重或新出现疼痛。',
      '同一份研究里，90% 的女性表示如果重来一次，她们仍然会选择怀孕。',
      '绝经对 FSHD 病程的影响，目前还不清楚。',
    ],
    source: 'Ciafaloni, FSHD and Pregnancy',
  },
  {
    id: 'counseling',
    title: '这件事该找谁',
    points: [
      '遗传咨询门诊。上面这些概率、限制和不确定性，需要结合你自己家里的具体情况来谈 —— 谁做过基因检测、结果是什么、重复数是多少，会直接改变可选项。',
      '如果在考虑 PGT，还需要生殖医学科；孕期管理需要产科，最好是能和神经科沟通的那种。',
      '把你的临床护照 PDF 带上，可以省掉重新讲一遍病史的时间。',
    ],
    // Not blank. The Q&A tab now tells patients this page is more
    // reliable than a generated answer 「因为每段都写了出处」, and a
    // section with no source made that sentence false — on the page
    // whose entire argument is that a claim without a source is worth
    // less. The referral itself is sourced: Giardina makes pre-test
    // counseling mandatory for PGT and prenatal testing and requires
    // post-test counseling in every case, whatever the result.
    source: 'Giardina 等, Clinical Genetics 2024;106:13-26（术前与检测后遗传咨询均为必需）',
  },
];

/**
 * The page's own framing. Kept next to the sections rather than in the
 * screen so it is covered by the same tests — this paragraph is the
 * one that has to survive an edit that is only trying to fix layout.
 */
export const GENETICS_INTRO =
  '下面是目前已知的事实和它们的出处。这一页不建议你做任何选择 —— 生不生、怎么生，是你和家人的决定，不是一个应用该给意见的事。它能做的是把已知的、以及还不知道的，一次说清楚。';

export const GENETICS_DISCLAIMER =
  '本页内容来自公开发表的指南与研究，供你了解和准备提问，不能替代遗传咨询医师针对你家庭情况的评估。';
