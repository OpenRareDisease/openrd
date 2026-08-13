/**
 * 病种身份码 — every code that names this disease, with the coding
 * system it belongs to spelled out next to it.
 *
 * WHY A BARE CODE IS A DEFECT
 * ---------------------------
 * A patient quoting 「G71.02」 at a Chinese 医保 window gets nowhere:
 * that code exists only in ICD-10-CM, the United States' clinical
 * modification, and it is not in the classification Chinese hospitals
 * and 医保 actually run on. Meanwhile 「8C70.3」 is the only code in the
 * world that means FSHD and nothing else — and most Chinese 病案 systems
 * are still on ICD-10, which has no FSHD code at all and files the
 * disease under G71.0 肌营养不良 with every other dystrophy.
 *
 * So the unit on this page is never a code. It is (system, code, the
 * system's own name for the disease, where that system is used). A page
 * whose entire value is quotability cannot afford a code that is right
 * somewhere else.
 *
 * VERIFICATION
 * ------------
 * Every code below was looked up before it was written here, and the
 * `source` field on each says where. Nothing on this page was recalled.
 * Cross-checks that agreed:
 *
 *  - Orphanet's own record for ORPHA:269 lists ICD-10 G71.0 and ICD-11
 *    8C70.3 as its cross-references.
 *  - The MONDO umbrella term MONDO:0001347 carries xrefs Orphanet:269,
 *    ICD-10-CM:G71.02 (labelled as ICD-10-**CM**, which is the
 *    US-specific point this page makes) and the OMIM phenotypic series
 *    PS158900.
 *  - MONDO:0008030 xrefs OMIM:158900, confirming both are the FSHD**1**
 *    entity rather than the umbrella.
 *
 * WHAT COULD NOT BE VERIFIED — see DISEASE_IDENTITY_UNVERIFIED below.
 * It is stated rather than guessed at. A fabricated 国临版 extension
 * code would be the single worst thing this file could contain.
 */

/** When the codes below were last checked, by hand, against their
 *  registries. Edited only when someone actually re-checks them. */
export const DISEASE_IDENTITY_AS_OF = '2026-08-05';

/**
 * Where a code is usable.
 *
 * 'china'         — this is the one that shows up on a Chinese 病案首页,
 *                   医保结算单 or 认定表.
 * 'international' — the international classification; correct anywhere,
 *                   but not necessarily what the counter in front of you
 *                   is running.
 * 'research'      — for finding literature, matching a gene report, or
 *                   reading a trial's inclusion criteria. Not a billing
 *                   or administrative code anywhere.
 * 'us_only'       — valid in the United States and nowhere else.
 */
export type DiseaseIdentityScope = 'china' | 'international' | 'research' | 'us_only';

export interface DiseaseIdentityCode {
  id: string;
  /** The coding system, written out. Half of every quotable string. */
  system: string;
  /** The code itself. Never rendered without `system`. */
  code: string;
  /** The exact string to say or write. system + code, pre-joined so no
   *  render site can accidentally show one without the other. */
  quotable: string;
  /** The name that system itself gives the disease, verbatim. */
  labelEn: string;
  /** The Chinese name in ordinary use. Where the system publishes an
   *  official Chinese title, that is what this is; otherwise it is the
   *  standard Chinese name of the disease. */
  labelZh: string;
  scope: DiseaseIdentityScope;
  /** What this code is actually good for, in one line. */
  useZh: string;
  /** Where it stops being good for that. Present only when there is a
   *  real way to misuse the code. */
  caveatZh?: string;
  /** Required. Where this was checked. */
  source: string;
}

const SCOPE_LABELS: Record<DiseaseIdentityScope, string> = {
  china: '国内窗口可用',
  international: '国际通用',
  research: '查资料 / 对报告用',
  us_only: '仅限美国',
};

export const scopeLabel = (scope: DiseaseIdentityScope): string => SCOPE_LABELS[scope];

export const DISEASE_IDENTITY_CODES: DiseaseIdentityCode[] = [
  {
    id: 'catalogue',
    system: '《第二批罕见病目录》',
    code: '序号 25',
    quotable: '《第二批罕见病目录》序号 25（国卫医政发〔2023〕26号）',
    labelEn: 'Facioscapulohumeral muscular dystrophy',
    labelZh: '面肩肱型肌营养不良症',
    scope: 'china',
    useZh:
      '在国内最有用的一句。对方说「没听过这个病」时，报文号和序号比解释病理管用；罕见病诊疗协作网的义务、救助项目的病种门槛，都挂在这份目录上。',
    caveatZh:
      '进目录不等于进门诊慢特病。门诊慢特病病种由参保所在统筹地区规定，全国不统一 —— 详见本应用「罕见病身份与权益」那一页。',
    source:
      '《第二批罕见病目录》国卫医政发〔2023〕26号（2023-09-18），序号 25。与 apps/mobile/lib/rare-disease-status-content.ts 同源，该文件记录了原始 .doc 的出处。',
  },
  {
    id: 'icd10',
    system: 'ICD-10（世界卫生组织版；国内病案与医保沿用这一体系）',
    code: 'G71.0',
    quotable: 'ICD-10 G71.0',
    labelEn: 'Muscular dystrophy',
    labelZh: '肌营养不良',
    scope: 'china',
    useZh:
      '你在病案首页、出院小结或医保结算单上最可能看到的编码。Orphanet 对本病（ORPHA:269）给出的 ICD-10 对应就是 G71.0。',
    caveatZh:
      'ICD-10 里没有 FSHD 的专属编码。G71.0 是「肌营养不良」这一整类，杜氏、贝氏、肢带型都在里面。所以病历上写着 G71.0 并不说明医生认定了哪一型 —— 分型要看基因报告，不要从这个码上读。',
    source:
      'Orphanet 疾病条目 ORPHA:269 的交叉引用（ICD-10: G71.0），2026-08 核对；MONDO:0001347 亦以 Orphanet:269 为交叉引用。',
  },
  {
    id: 'icd11',
    system: 'ICD-11 MMS（世界卫生组织，国际疾病分类第十一版）',
    code: '8C70.3',
    quotable: 'ICD-11 8C70.3',
    labelEn: 'Facioscapulohumeral muscular dystrophy',
    labelZh: '面肩肱型肌营养不良',
    scope: 'international',
    useZh:
      '目前唯一一个「只指这个病、不指别的」的官方编码，属于 8C70 Muscular dystrophy（肌营养不良）之下。写病历、写转诊单、跟国外医生或研究者对接时，这个码最不容易被误解。',
    caveatZh:
      '国内多数病案与医保系统仍在用 ICD-10，窗口可能查不到这个码。把它作为补充写在病历里可以，用它去要待遇不行。',
    source:
      'ICD-11 MMS 条目 8C70.3 Facioscapulohumeral muscular dystrophy（2026-08 核对）；Orphanet ORPHA:269 的 ICD-11 交叉引用同为 8C70.3。',
  },
  {
    id: 'orpha',
    system: 'Orphanet（欧盟支持的罕见病数据库）',
    code: 'ORPHA:269',
    quotable: 'ORPHA:269',
    labelEn: 'Facioscapulohumeral dystrophy',
    labelZh: '面肩肱型肌营养不良',
    scope: 'international',
    useZh:
      '国际上引用罕见病最常用的一个号。找 Orphanet 上的疾病资料、专家中心和欧洲注册与试验信息时，用这个号搜最准。',
    source: 'Orphanet 疾病条目 ORPHA:269 Facioscapulohumeral dystrophy（2026-08 核对）。',
  },
  {
    id: 'omim-fshd1',
    system: 'OMIM（人类孟德尔遗传在线，约翰斯·霍普金斯大学）',
    code: '158900',
    quotable: 'OMIM 158900',
    labelEn: 'Facioscapulohumeral muscular dystrophy 1 (FSHD1)',
    labelZh: '面肩肱型肌营养不良 1 型',
    scope: 'research',
    useZh:
      '对应 4 号染色体 4q35 上 D4Z4 重复序列收缩的那一型，也就是绝大多数 FSHD。看文献、看基因报告、看临床试验入组标准时用这个号。',
    caveatZh:
      '这个号特指 1 型。如果你的基因报告写的是 SMCHD1 变异而不是 D4Z4 收缩，对应的是 2 型（OMIM 158901），别把两个号混着报。',
    source:
      'OMIM 158900，标题 Facioscapulohumeral muscular dystrophy 1；经 NCBI MedGen 按 MIM 号核对（2026-08）。',
  },
  {
    id: 'omim-fshd2',
    system: 'OMIM（人类孟德尔遗传在线）',
    code: '158901',
    quotable: 'OMIM 158901',
    labelEn: 'Facioscapulohumeral muscular dystrophy 2 (FSHD2)',
    labelZh: '面肩肱型肌营养不良 2 型',
    scope: 'research',
    useZh: '2 型，与 18 号染色体上的 SMCHD1 基因相关。基因报告里出现 SMCHD1 时用这个号。',
    caveatZh:
      '列在这里是为了让报告上写着 SMCHD1 的人也能对上号，不是说你一定属于哪一型。分型以你的基因报告和医生的判断为准，本应用不做分型。',
    source:
      'OMIM 158901，标题 Facioscapulohumeral muscular dystrophy 2，相关基因 SMCHD1（18p11.32）；经 NCBI MedGen 按 MIM 号核对（2026-08）。',
  },
  {
    id: 'mondo-fshd1',
    system: 'MONDO（Monarch Disease Ontology，疾病本体）',
    code: 'MONDO:0008030',
    quotable: 'MONDO:0008030',
    labelEn: 'facioscapulohumeral muscular dystrophy 1',
    labelZh: '面肩肱型肌营养不良 1 型',
    scope: 'research',
    useZh:
      '生物信息数据库和一部分注册平台用 MONDO 号来对齐疾病名称。这个号同样特指 1 型，交叉引用的正是 OMIM 158900。',
    caveatZh: '如果你要的是「FSHD 这个病」而不是 1 型，用下面那个总称号 MONDO:0001347。',
    source:
      'EBI OLS4 中的 MONDO:0008030，标签 facioscapulohumeral muscular dystrophy 1，交叉引用 OMIM:158900（2026-08 核对）。',
  },
  {
    id: 'mondo-umbrella',
    system: 'MONDO（Monarch Disease Ontology，疾病本体）',
    code: 'MONDO:0001347',
    quotable: 'MONDO:0001347',
    labelEn: 'facioscapulohumeral muscular dystrophy',
    labelZh: '面肩肱型肌营养不良（不分型）',
    scope: 'research',
    useZh: '不分型的总称，是 1 型和 2 型共同的上位条目。不确定自己是哪一型时，用这个。',
    source:
      'EBI OLS4 中的 MONDO:0001347，交叉引用包括 Orphanet:269、ICD-10-CM:G71.02、OMIM 表型系列 PS158900（2026-08 核对）。',
  },
  {
    id: 'icd10cm',
    system: 'ICD-10-CM（美国临床修订版 —— 只在美国使用）',
    code: 'G71.02',
    quotable: 'ICD-10-CM G71.02（美国专用）',
    labelEn: 'Facioscapulohumeral muscular dystrophy',
    labelZh: '面肩肱型肌营养不良',
    scope: 'us_only',
    useZh:
      '在美国就医或跟美国的保险、患者组织打交道时用得上。列在这里，是因为不少中文资料把它当成「FSHD 的 ICD-10 编码」直接转载。',
    caveatZh:
      '它不是国际 ICD-10 的编码，是美国自己的临床修订版加出来的。拿这个码去国内医保或病案窗口没有用，对方系统里查不到 —— 在国内请用上面的 G71.0，并说明分型。',
    source:
      'FSHD Society 的 ICD-10 说明页明确 G71.02 为美国用码，并指出美国以外用 ICD-11 8C70.3；MONDO:0001347 亦将该码标注为 ICD-10-CM（2026-08 核对）。',
  },
];

/**
 * The thing this page could not check, said out loud.
 *
 * Chinese hospitals code on ICD-10, and local 病案室 and 医保 systems
 * commonly work from an extended national edition rather than the bare
 * WHO code. Whether there is a stable extension digit under G71.0 that
 * means FSHD specifically could not be verified from a primary source
 * while writing this file, so no such code is printed here. If a patient
 * needs the exact string their hospital uses, the 病案室 is the only
 * place that can answer it — and that is a shorter errand than being
 * sent home over a code this app invented.
 */
export const DISEASE_IDENTITY_UNVERIFIED =
  '国内各地病案与医保系统可能在 G71.0 之下再加扩展位。本页没有核实到统一、可公开引用的扩展码，所以一个也没有写。需要精确到扩展位时，请直接问就诊医院的病案室或当地医保经办机构。';

export const DISEASE_IDENTITY_INTRO =
  '一个编码只有连着它所属的编码体系一起报，才有意义。下面每一条都写清了「哪个体系 + 什么码 + 这个体系怎么称呼这个病 + 在哪儿能用」，长按可以复制。';

export const DISEASE_IDENTITY_HOW_TO_USE =
  '国内窗口先报《第二批罕见病目录》序号 25 和文号；病历和转诊单上写 ICD-10 G71.0，可以另注 ICD-11 8C70.3；查文献和对基因报告用 OMIM / ORPHA / MONDO。G71.02 只在美国有效，在国内不要报。';

export const DISEASE_IDENTITY_DISCLAIMER =
  '本页只做一件事：把这个病在各个编码体系里的名字和编号列准。它不做诊断，也不判断你属于哪一型 —— 分型以你的基因报告和医生的判断为准。';
