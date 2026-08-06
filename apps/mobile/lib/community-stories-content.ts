/**
 * 病友经验 — the peer-experience shelf, as data.
 *
 * Where this comes from
 * ---------------------
 * content/medical-kb/source/FSHD_知识库/11.病友经验/ holds 21 first-person
 * Chinese narratives published by the WeChat public account
 * 「FSHD青年路社区」, most of them under its《我们的故事》column. Every one
 * of them is already public and already bylined by its author. That is
 * the entire reason the community tab starts here rather than with a
 * forum: nothing on this shelf is user-generated, so there is no
 * moderation queue to staff, no posting surface to build, and no new
 * personal information collected from anyone — the PIPL exposure of
 * this feature is zero, because the only personal information involved
 * was published by its subject years ago under their own name.
 *
 * What is on the page and what is not
 * -----------------------------------
 * Excerpts, not full text. Each story carries a short verbatim passage,
 * its byline, its publication date, and where the original lives. We do
 * not host the narratives themselves. That is a permissions decision,
 * not a technical one — see READ_ORIGINAL_NOTE and the report for what
 * hosting the full text would require.
 *
 * Every `text` in `excerpts` is copied verbatim from the source PDF.
 * The only editing applied was deleting the stray spaces pdftotext
 * inserts inside Chinese runs when a line is justified (「小 罗」→
 * 「小罗」); no word, punctuation mark or clause was changed, added or
 * reordered. If you edit one of these strings, you are editing a
 * sentence a patient wrote about their own life. Don't. Re-quote a
 * different passage instead.
 *
 * `blurb` is ours; `excerpts[].text` is theirs. The two are kept in
 * separate fields and rendered in visibly different type so a reader
 * can always tell which words are the author's — the same rule the
 * clinical pages follow for evidence versus framing.
 *
 * What this shelf must never become
 * ---------------------------------
 * A prognosis. Twenty-one people is not a cohort, they did not enrol
 * in anything, and the shelf must not let a reader mistake「this is
 * what happened to 阿紫」for「this is what will happen to me」. The
 * corpus says so itself, in 小旸's words, and that sentence is quoted
 * on the page for exactly that reason:
 *
 *   FSHD是一个谜，病友们生着同样的病，可每一个人却又像生着不一样的病
 *
 * That is also why STORY_HOOKS below default to off. See story-hooks.ts
 * in screens/p-community for the argument.
 */

export type StoryThemeId = 'diagnosis' | 'work' | 'movement' | 'reproduction' | 'family' | 'youth';

export type StoryTheme = {
  id: StoryThemeId;
  title: string;
  /** What is actually in this theme, said plainly. Not a tagline. */
  blurb: string;
};

/**
 * The six themes are read off the 21 narratives, not off a template.
 * They are what these particular people wrote about, which is why
 * there is no「治疗进展」or「营养」shelf: nobody wrote one.
 */
export const STORY_THEMES: StoryTheme[] = [
  {
    id: 'diagnosis',
    title: '求医之路',
    blurb:
      '确诊之前的那些年。这一栏里的人平均走了七年到二十年才拿到病名，路上遇到过激素、干细胞、针灸、偏方和「你不够努力锻炼」。有几篇写到治疗本身让病情更重了。',
  },
  {
    id: 'work',
    title: '就业',
    blurb:
      '找工作、面试、被委婉拒绝，以及后来怎么办。这一栏里没有励志模板：有人在流水线上把脖子累坏，有人爬不上负一楼的台阶，也有人最后靠电脑和网络找到了活路。',
  },
  {
    id: 'movement',
    title: '运动与坚持',
    blurb:
      '这一栏里没有一篇是「坚持锻炼就会好」。跳了十五年广场舞的那位写的是「身体也不再适合去跳广场舞了」；疯狂锻炼半年的那位写的是脚开始下垂。放在这里是因为它们诚实，不是因为它们鼓劲。',
  },
  {
    id: 'reproduction',
    title: '生育抉择',
    blurb:
      '两位女性写了同一件事的两面：一位因为不生而结束了婚姻，一位生了之后病情加重。她们写的是自己的选择和代价，不是建议。要看数据和遗传咨询，去「遗传与生育」那一页。',
  },
  {
    id: 'family',
    title: '家人',
    blurb:
      '母亲、父亲、爷爷奶奶、孩子。一家三口同时确诊是什么样，母亲把报告单捏成一团又展平在背面记笔记是什么样。珍姐的四篇连载自传也在这里，按原来的顺序排。',
  },
  {
    id: 'youth',
    title: '青少年',
    blurb:
      '发病在上学的年纪。绰号、体育课、被说成懒、休学、中考，以及确诊那一刻反而松了一口气——因为终于不是自己的错。',
  },
];

export type StoryExcerpt = {
  id: string;
  /** Verbatim from the source. Do not paraphrase. */
  text: string;
};

export type StorySerial = {
  /** Serial title, without the part number. */
  name: string;
  /** 1-based. `storiesForTheme` keeps these in ascending order. */
  part: number;
  total: number;
};

export type StoryOrigin = {
  /** Where it was published. */
  platform: string;
  account: string;
  /** Exactly as printed on the article, so it can be searched for. */
  originalTitle: string;
  /** As printed on the article, e.g. 「黄小燕、小林」. */
  byline: string;
  /** ISO date of publication. */
  publishedOn: string;
  /**
   * The article's own permalink, once someone has one that has been
   * checked by opening it.
   *
   * Absent on every story today, and absent on purpose. The archived
   * PDFs do not carry their own canonical URL — they carry the
   * 推荐阅读 links to *other* articles, which is not the same thing.
   * Three of the serial's four parts can be inferred from those
   * cross-references, and an inference is not a URL: a mislinked
   * story sends a patient to a stranger's life under an author's
   * name. The UI renders the button only when this is filled in and
   * shows the locator below otherwise.
   */
  url?: string;
  /** Path under content/medical-kb/source/, so a claim is checkable. */
  sourceFile: string;
};

export type Story = {
  id: string;
  /** Display title — the original title minus the column prefix. */
  title: string;
  /** First = primary; the story is filed under all of them. */
  themes: StoryThemeId[];
  /** Ours. One line, no diagnosis, no moral. */
  blurb: string;
  excerpts: StoryExcerpt[];
  /** Which excerpt the shelf card shows. Must exist in `excerpts`. */
  pullQuoteId: string;
  serial?: StorySerial;
  /**
   * Shown under the excerpt when the story contains a claim a reader
   * could take as medical advice. Not a content warning about
   * distress — these are all distressing — but about a factual claim
   * that the shelf must not appear to endorse.
   */
  caution?: string;
  origin: StoryOrigin;
};

const CORPUS = 'FSHD_知识库/11.病友经验/第二批：2025年5月15日/';
const SERIAL_DIR = CORPUS + '我们的故事｜患友自传《不管如何，你得长大》连载1-4/';
const ACCOUNT = 'FSHD青年路社区';
const PLATFORM = '微信公众号';

export const STORIES: Story[] = [
  /* ---------------------------------------------------------------- */
  /* 求医之路                                                          */
  /* ---------------------------------------------------------------- */
  {
    id: 'twenty-years-of-failed-treatment',
    title: '20余年，一条屡遭挫败的求医之路',
    themes: ['diagnosis'],
    blurb: '从1998年幼儿园老师发现她跑不快，到2010年那位老中医在药里加了利尿剂和激素。',
    excerpts: [
      {
        id: 'defeat',
        text: '我的无助和无奈，不仅仅源于疾病的痛苦，更多的是源于治疗过程中的挫败感。',
      },
      {
        id: 'worse-each-time',
        text: '可这次的干细胞手术再次让人失望，我的病情还是和以前一样并没有得到改善或者稳定，反而让我感觉每去一个地方治疗，我的病情都会加重一次。',
      },
    ],
    pullQuoteId: 'defeat',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事丨20余年，一条屡遭挫败的求医之路',
      byline: '黄小燕、小林',
      publishedOn: '2023-11-30',
      sourceFile: CORPUS + '我们的故事丨20余年，一条屡遭挫败的求医之路.pdf',
    },
  },
  {
    id: 'alive-means-hope',
    title: '活着，一切就有希望',
    themes: ['diagnosis', 'family'],
    blurb: '十岁在北京儿童医院被贴上标签，被告知活不过十八岁。阿紫今天还在。',
    excerpts: [
      {
        id: 'not-past-eighteen',
        text: '说进行性肌营养不良是世界疑难杂症，就目前的医疗水平无法医治，而她可能活不过十八岁。',
      },
    ],
    pullQuoteId: 'not-past-eighteen',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事丨活着，一切就有希望',
      byline: 'FSHD青年路社区（阿紫）',
      publishedOn: '2023-08-10',
      sourceFile: CORPUS + '我们的故事丨活着，一切就有希望.pdf',
    },
  },
  {
    id: 'sea-and-sky',
    title: '让每一个日子都海阔天空',
    themes: ['diagnosis', 'family'],
    blurb: '心肌炎、马蹄内翻足、脊柱侧弯——七八年里换过三个错的病名，十九岁才拿到真的那个。',
    excerpts: [
      {
        id: 'boot-drops',
        text: '兜兜转转七八年，19岁时，盛华泱终于在上海一家医院得知了真相：进行性肌营养不良。靴子落地的刹那，过去遭遇的一切，全都解释得通了。',
      },
      {
        id: 'be-seen',
        text: '我觉得我们需要‘被看见’，需要社会关注和帮助，同时我们自己也要勇敢地站出来，勇于‘被看见’。',
      },
    ],
    pullQuoteId: 'boot-drops',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事丨让每一个日子都海阔天空',
      byline: '白杨（讲述：盛华泱）',
      publishedOn: '2023-06-24',
      sourceFile: CORPUS + '我们的故事丨让每一个日子都海阔天空.pdf',
    },
  },

  /* ---------------------------------------------------------------- */
  /* 就业                                                              */
  /* ---------------------------------------------------------------- */
  {
    id: 'job-hunt',
    title: 'FSHD女孩的坎坷求职路',
    themes: ['work'],
    blurb: '鞋厂流水线、文员、会计证、成人大专，以及一段没有扶手的台阶。',
    excerpts: [
      {
        id: 'politely-refused',
        text: '每次面试结束，小罗需要撑着腿起来，很多公司看到她不同常人的样子，都委婉的拒绝了她。',
      },
      {
        id: 'basement-stairs',
        text: '小罗到了超市后，看着又长又陡的楼梯，她心里不断在打退堂鼓，可为了生活，她还是鼓起勇气扶着栏杆走下负一楼。',
      },
      {
        id: 'found-a-way',
        text: '她很庆幸自己以前学会了电脑，也庆幸那时候网络发达，才能让她找到生存的空间，找到一份稳定的工作。',
      },
    ],
    pullQuoteId: 'politely-refused',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事丨FSHD女孩的坎坷求职路',
      byline: '黄小燕、小罗',
      publishedOn: '2023-11-09',
      sourceFile: CORPUS + '我们的故事丨FSHD女孩的坎坷求职路.pdf',
    },
  },
  {
    id: 'self-rescue',
    title: '人唯有自渡，才能治愈',
    themes: ['work', 'diagnosis'],
    blurb: '十八岁发病，二十多年后才确诊。中间站了八年讲台，一边讲课一边和它较劲。',
    excerpts: [
      {
        id: 'no-amount-of-effort',
        text: '当你的身体出现异常信号时，无论怎么努力练习，你的某些方面都无法达到常人的水平。我就是如此。',
      },
      {
        id: 'frog-jump',
        text: '你怎么上楼梯像青蛙跳似的。',
      },
    ],
    pullQuoteId: 'no-amount-of-effort',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事丨人唯有自渡，才能治愈',
      byline: '黄小燕、林胤岳',
      publishedOn: '2024-01-18',
      sourceFile: CORPUS + '我们的故事丨人唯有自渡，才能治愈.pdf',
    },
  },
  {
    id: 'slow-simmer',
    title: '被小火慢炖的人生',
    themes: ['work', 'diagnosis'],
    blurb: '高弓足、足踝积液、「是心理问题」——绕了一圈之后，她放下讲台的梦想，捡回了画笔。',
    excerpts: [
      {
        id: 'what-i-can-do',
        text: '人生也许有很多自己做不到的事情，我们只能把自己能够做到的事情做好。',
      },
    ],
    pullQuoteId: 'what-i-can-do',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事丨被小火慢炖的人生',
      byline: 'FSHD青年路社区（Candy）',
      publishedOn: '2023-08-01',
      sourceFile: CORPUS + '我们的故事丨被小火慢炖的人生.pdf',
    },
  },
  {
    id: 'pingping',
    title: '逆境中的坚韧：萍萍的励志人生',
    themes: ['work', 'youth'],
    blurb: '十七岁双腿失去支撑，靠一根手指打字；2016年进了县残联的电商班，开始在淘宝上卖五谷杂粮。',
    excerpts: [
      {
        id: 'not-past-twenty',
        text: '十三岁那年，爸爸带我去县医院，医生的话如同冰冷的刀割在我的心上，他说我活不过二十岁。',
      },
      {
        id: 'one-finger',
        text: '与此同时，由于长期的肌肉萎缩，我的行动变得更加艰难。我只能用一根手指艰难地打字，与外界的交流变得异常困难。',
      },
    ],
    pullQuoteId: 'not-past-twenty',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '逆境中的坚韧：萍萍的励志人生',
      byline: '萍萍、丽君、黄小燕',
      publishedOn: '2024-06-23',
      sourceFile: CORPUS + '逆境中的坚韧：萍萍的励志人生.pdf',
    },
  },

  /* ---------------------------------------------------------------- */
  /* 运动与坚持                                                        */
  /* ---------------------------------------------------------------- */
  {
    id: 'square-dancing',
    title: '生命在于运动：我与广场舞的十五年情缘',
    themes: ['movement'],
    blurb: '慢跑、哑铃、仰卧起坐都做不动之后，她站到了广场舞队伍的最后一排，跳了十五年。',
    excerpts: [
      {
        id: 'no-longer-suitable',
        text: '如今，已经过去十五年，病情也开始加重，身体也不再适合去跳广场舞了。',
      },
      {
        id: 'not-discomfort-but-weakness',
        text: '我摇摇头，心里明白，不是不舒服，而是无力。',
      },
    ],
    pullQuoteId: 'no-longer-suitable',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '生命在于运动：我与广场舞的十五年情缘',
      byline: '黄小燕',
      publishedOn: '2024-07-07',
      sourceFile: CORPUS + '生命在于运动：我与广场舞的十五年情缘.pdf',
    },
  },
  {
    id: 'new-dimension-2024',
    title: '走过2024，探索了生命新的维度',
    themes: ['movement', 'family'],
    blurb: '一份很具体的年度总结：夜里疼得睡不着怎么加垫子，肺炎和阑尾炎住院，请护工要多少钱。',
    excerpts: [
      {
        id: 'depends-on-parents',
        text: '我四肢无力，平日生活起居依赖年迈的双亲照顾。我每次“额外”生病，不仅自己痛苦，还会给老爸老妈增加负担，住院时雇护工也是笔不小的开销。',
      },
    ],
    pullQuoteId: 'depends-on-parents',
    caution:
      '这篇里写到保健品和营养素让作者受益。那是她的个人经验，不是研究结论——这一段不构成对任何产品的推荐，也不适合据此改动自己的用药。',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '病友说：走过2024，探索了生命新的维度',
      byline: '飞翔的蜗牛曲晶',
      publishedOn: '2025-01-28',
      sourceFile: CORPUS + '病友说：走过2024，探索了生命新的维度.pdf',
    },
  },

  /* ---------------------------------------------------------------- */
  /* 生育抉择                                                          */
  /* ---------------------------------------------------------------- */
  {
    id: 'reproductive-choice',
    title: '女罕见病患者面临的生育抉择',
    themes: ['reproduction', 'movement'],
    blurb: '两段感情，两次因为「要不要孩子」走到尽头。最后是她自己提的离婚。',
    excerpts: [
      {
        id: 'marriage-crisis',
        text: '因为孩子，让我的婚姻产生了危机，而这种危机不是改变了心态就能拯救的，你做出的选择会关系自己和下一代的人生。',
      },
      {
        id: 'foot-drop',
        text: '回去后的半年里，我疯狂地锻炼希望能够改变现状。然而其中一只脚却开始下垂，我害怕了，于是停止了锻炼。这段经历让我明白锻炼要适度不能过度否则可能会适得其反。',
      },
      {
        id: 'fake-stem-cells',
        text: '他们和我一样，做了干细胞移植都没有效果，这才知道这是一家打着虚假广告的骗人医院。',
      },
    ],
    pullQuoteId: 'marriage-crisis',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事 | 女罕见病患者面临的生育抉择',
      byline: '黄小燕、迪路兽',
      publishedOn: '2024-02-12',
      sourceFile: CORPUS + '我们的故事 _ 女罕见病患者面临的生育抉择.pdf',
    },
  },
  {
    id: 'free-and-open-hearted',
    title: '成为内心自由豁达的人',
    themes: ['reproduction', 'family'],
    blurb: '四十二岁，症状偏轻，最放不下的是怕自己以后成为丈夫和孩子的负担。',
    excerpts: [
      {
        id: 'after-the-c-section',
        text: '2011年，娜娜做了剖腹产手术，她没有想到生孩子会让她的病情加重。',
      },
    ],
    pullQuoteId: 'after-the-c-section',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事丨成为内心自由豁达的人',
      byline: 'FSHD青年路社区（娜娜）',
      publishedOn: '2023-07-25',
      sourceFile: CORPUS + '我们的故事丨成为内心自由豁达的人.pdf',
    },
  },

  /* ---------------------------------------------------------------- */
  /* 家人                                                              */
  /* ---------------------------------------------------------------- */
  {
    id: 'my-mother',
    title: '我的母亲',
    themes: ['family', 'diagnosis'],
    blurb: '2019年，他和母亲同一天确诊。这一篇写的是2003年母亲拿到那张报告单之后的十分钟。',
    excerpts: [
      {
        id: 'i-am-here',
        text: '母亲把散乱的头发拢了拢，从新扎好，把衣裤粗粗整理一番，拉着我走出医院，朝天骂了一句脏话后，对我说：“没事哈，有妈呢。”',
      },
      {
        id: 'wrote-it-down-again',
        text: '母亲简单的把泪痕擦了擦，平静的拉着我又走进医生办公室，询问今后的注意事项，把捏成一团的报告单又展平，在背面用笔仔细的记录着。',
      },
    ],
    pullQuoteId: 'i-am-here',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事 | 我的母亲',
      byline: '钱斌、黄小燕',
      publishedOn: '2024-04-08',
      sourceFile: CORPUS + '我们的故事 _ 我的母亲.pdf',
    },
  },
  {
    id: 'wait-for-daybreak',
    title: '坦然面对，等天亮',
    themes: ['family', 'youth'],
    blurb: '父亲、她、弟弟——一家三口先后确诊。写这篇的时候她在读职高，期中考了年级第六。',
    excerpts: [
      {
        id: 'three-in-one-family',
        text: '我知道，一家三口都确诊面肩肱型肌营养不良（FSHD），这是一个沉重的打击，如同一块巨石压在胸口，让人喘不过气来。',
      },
      {
        id: 'grandpa-legs',
        text: '既然你的腿不行了，那我就当你的腿。',
      },
    ],
    pullQuoteId: 'three-in-one-family',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事 | 坦然面对，等天亮',
      byline: '小雨、黄小燕',
      publishedOn: '2024-05-19',
      sourceFile: CORPUS + '我们的故事 _ 坦然面对，等天亮.pdf',
    },
  },
  {
    id: 'grow-up-anyway-1',
    title: '不管如何，你得长大（连载 1）',
    themes: ['family'],
    blurb: '珍姐2018年确诊，2020年因肩痛病退，然后开始写回忆录。第一篇从她出生那年写起。',
    excerpts: [
      {
        id: 'passed-around',
        text: '家中的状况如此，我又是个不懂时宜到来的倒霉丫头，到处寄养成自然。',
      },
    ],
    pullQuoteId: 'passed-around',
    serial: { name: '不管如何，你得长大', part: 1, total: 4 },
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事｜患友自传《不管如何，你得长大》连载1',
      byline: '珍姐',
      publishedOn: '2023-09-21',
      sourceFile: SERIAL_DIR + '我们的故事｜患友自传《不管如何，你得长大》连载1.pdf',
    },
  },
  {
    id: 'grow-up-anyway-2',
    title: '不管如何，你得长大（连载 2）',
    themes: ['family'],
    blurb: '上学、下田、挣工分。她比同龄人更早知道肩上的担子有多重。',
    excerpts: [
      {
        id: 'barefoot-to-school',
        text: '于是，家里解决了难题，我也开始了光着脚丫，风雨无阻、土里泥里上学的里程。',
      },
    ],
    pullQuoteId: 'barefoot-to-school',
    serial: { name: '不管如何，你得长大', part: 2, total: 4 },
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事｜患友自传《不管如何，你得长大》连载2',
      byline: '珍姐',
      publishedOn: '2023-09-28',
      sourceFile: SERIAL_DIR + '我们的故事｜患友自传《不管如何，你得长大》连载2.pdf',
    },
  },
  {
    id: 'grow-up-anyway-3',
    title: '不管如何，你得长大（连载 3）',
    themes: ['family'],
    blurb: '父亲病重的那几年。冬天去干了的鱼塘里捡湖脚，腊月里和母亲熬一整夜的麻糖。',
    excerpts: [
      {
        id: 'nothing-we-could-do',
        text: '父亲的病，母亲的痛，家庭的难。无论我们几个孩子怎么努力，都不能改善家庭的状况。',
      },
    ],
    pullQuoteId: 'nothing-we-could-do',
    serial: { name: '不管如何，你得长大', part: 3, total: 4 },
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事｜患友自传《不管如何，你得长大》连载3',
      byline: '珍姐',
      publishedOn: '2023-10-10',
      sourceFile: SERIAL_DIR + '我们的故事｜患友自传《不管如何，你得长大》连载3.pdf',
    },
  },
  {
    id: 'grow-up-anyway-4',
    title: '不管如何，你得长大（连载 4）',
    themes: ['family'],
    blurb: '父亲去世那一天。也是在这一篇里，她第一次写到右手抬不高——那时没有人知道那是什么。',
    excerpts: [
      {
        id: 'right-arm',
        text: '不知道过了多长时间，终于是不疼了，可我的右手也不能正常的举高了。',
      },
    ],
    pullQuoteId: 'right-arm',
    serial: { name: '不管如何，你得长大', part: 4, total: 4 },
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事｜患友自传《不管如何，你得长大》连载4',
      byline: '珍姐',
      publishedOn: '2023-10-17',
      sourceFile: SERIAL_DIR + '我们的故事｜患友自传《不管如何，你得长大》连载4.pdf',
    },
  },

  /* ---------------------------------------------------------------- */
  /* 青少年                                                            */
  /* ---------------------------------------------------------------- */
  {
    id: 'they-owe-me-an-apology',
    title: '“他们欠我一个道歉”',
    themes: ['youth', 'diagnosis'],
    blurb: '留守儿童，四年级起被叫「歪嘴」。高二确诊那天下着雨，她说自己反而释怀了。',
    excerpts: [
      {
        id: 'told-i-was-lazy',
        text: '当我把自己身体的异常告诉在他乡打工的父母时，却也总是被他们以简单粗暴的“我太懒，不运动”的理由回应，让我也误以为真的是自身原因。',
      },
      {
        id: 'not-because-lazy',
        text: '我跑不了、跳不了、走不了、笑不了、手臂抬不起等等，都是因为我生病了，并且病情的发展也不能人为的控制，而并非是我懒惰不爱锻炼的原因。',
      },
    ],
    pullQuoteId: 'told-i-was-lazy',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事丨“他们欠我一个道歉”',
      byline: '白天鹅',
      publishedOn: '2023-11-16',
      sourceFile: CORPUS + '我们的故事丨“他们欠我一个道歉”.pdf',
    },
  },
  {
    id: 'focus-on-now',
    title: '专注眼前，珍惜每一个当下',
    themes: ['youth', 'work'],
    blurb: '十二岁开始频繁摔跤，医生说她活不过十八。她当时在意的不是这句，是同学给她起的绰号。',
    excerpts: [
      {
        id: 'nicknames',
        text: '孩子给孩子起绰号看起来是一件小事，但是对孩子来说这是自己人生中很重要的事，事情看起来影响不大，但是侮辱性却极强。',
      },
      {
        id: 'falling',
        text: '阿梅12岁时，走路经常摔跤。一颗小石子也会让她身体失去平衡而摔跤；有时候走着走着，膝盖会突然发软，双腿支撑不住身体的重心而摔跤。',
      },
    ],
    pullQuoteId: 'nicknames',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事丨专注眼前，珍惜每一个当下',
      byline: 'FSHD青年路社区（阿梅）',
      publishedOn: '2023-08-15',
      sourceFile: CORPUS + '我们的故事丨专注眼前，珍惜每一个当下.pdf',
    },
  },
  {
    id: 'rubiks-cube',
    title: '当少年的魔方梦想被病魔摧毁，他的未来何去何从',
    themes: ['youth', 'movement'],
    blurb: '两届单手魔方冠军，破过中国记录。2023年5月左手大拇指抬不起来，他连告别都来不及说。',
    excerpts: [
      {
        id: 'fshd-is-a-riddle',
        text: 'FSHD是一个谜，病友们生着同样的病，可每一个人却又像生着不一样的病，明明是同年龄发病，症状又很相似，可有的病友发展很快，有的病友又发展很慢。',
      },
      {
        id: 'a-blind-box',
        text: '可fshd像一个盲盒，它不会按部就班地一步一步地发展，可能你一觉醒来，某块肌肉就失去了它应有的功能。',
      },
    ],
    pullQuoteId: 'fshd-is-a-riddle',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事丨当少年的魔方梦想被病魔摧毁，他的未来何去何从',
      byline: '黄小燕、阿旸',
      publishedOn: '2023-10-24',
      sourceFile: CORPUS + '我们的故事丨当少年的魔方梦想被病魔摧毁，他的未来何去何从.pdf',
    },
  },
  {
    id: 'turn-of-kindness',
    title: '确诊FSHD自传——心生善意的转念',
    themes: ['youth'],
    blurb: '初中毕业典礼上，他捧着纪念册，一个一个去问那些嘲笑过他的同学要联系方式。',
    excerpts: [
      {
        id: 'laughed-at',
        text: '没过多久，这些另类的动作就逐渐引来同学的不解和嘲笑，这让我的内心感到无比的尴尬，随之而来的是紧张和容易焦虑暴躁的情绪。',
      },
    ],
    pullQuoteId: 'laughed-at',
    origin: {
      platform: PLATFORM,
      account: ACCOUNT,
      originalTitle: '我们的故事丨确诊FSHD自传--心生善意的转念',
      byline: '朋友',
      publishedOn: '2023-08-24',
      sourceFile: CORPUS + '我们的故事丨确诊FSHD自传--心生善意的转念.pdf',
    },
  },
];

/* ------------------------------------------------------------------ */
/* Page copy                                                           */
/* ------------------------------------------------------------------ */

export const COMMUNITY_INTRO =
  '这里是 21 位 FSHD 病友自己写下的经历，来自公众号「FSHD青年路社区」的《我们的故事》栏目，都已公开发表并署名。本页只放出处和摘录，不转载全文。';

/**
 * The one sentence that keeps this shelf from becoming a prognosis.
 * Quoted from the corpus rather than asserted by us, because it is
 * more credible in 小旸's words than in ours.
 */
export const COMMUNITY_CAVEAT =
  '这些是个人经历，不是医学建议，也不能用来推测你自己会怎样。用一位病友自己的话说：「FSHD是一个谜，病友们生着同样的病，可每一个人却又像生着不一样的病。」';

export const READ_ORIGINAL_NOTE =
  '原文发表在微信公众号「FSHD青年路社区」。我们手上的存档没有带原文链接，所以这里给出可以直接搜索的完整标题、作者和发表日期，而不是一个可能点错人的链接。';

/* ------------------------------------------------------------------ */
/* Contextual hooks                                                    */
/* ------------------------------------------------------------------ */

export type StoryHookId = 'fall-logged' | 'stair-test-cannot' | 'first-afo';

export type StoryHook = {
  id: StoryHookId;
  /** What the patient just recorded. Stated as the action, never as
   *  an interpretation of the action. */
  trigger: string;
  /** Card heading. */
  title: string;
  /**
   * The sentence that has to do the real work.
   *
   * A story that appears the moment someone records a decline is a
   * progression alert wearing empathy, and it will be read as the app
   * saying「你在变差」. These ledes therefore say, explicitly, that the
   * card is not a judgement of what was just recorded — because a
   * patient cannot be expected to infer the absence of a judgement
   * from a card that appeared unbidden right after they made an entry.
   */
  lede: string;
  storyId: string;
  /** Must be an id in that story's `excerpts`. Asserted by tests. */
  excerptId: string;
};

/**
 * Off by default; see story-hooks.ts. These describe *what* would be
 * shown if a patient turns them on — the switch is a separate module
 * because the default matters more than the content.
 */
export const STORY_HOOKS: StoryHook[] = [
  {
    id: 'fall-logged',
    trigger: '记录了一次跌倒',
    title: '有人写过摔跤这件事',
    lede: '这不是对你刚才那条记录的判断，也不代表任何变化。只是有位病友写过同一件事，你想看就看，不想看就关掉。',
    storyId: 'focus-on-now',
    excerptId: 'falling',
  },
  {
    id: 'stair-test-cannot',
    trigger: '把爬楼测试标记为「今天做不了」',
    title: '有人写过楼梯这件事',
    lede: '这不是对你今天状态的判断。楼梯在这些故事里出现过很多次，其中一段是别人站在楼梯口的那几分钟。',
    storyId: 'job-hunt',
    excerptId: 'basement-stairs',
  },
  {
    id: 'first-afo',
    trigger: '第一次记录使用踝足矫形器（AFO）',
    title: '有人写过脚下垂这件事',
    // Honest about the gap: nobody in these 21 narratives describes
    // wearing an AFO. The nearest true match is the passage where
    // 迪路兽 describes the foot drop that an AFO is prescribed for.
    // If a bracing story is ever added to the corpus, move this hook
    // to it rather than stretching this one further.
    lede: '这 21 篇里没有人写过戴 AFO 的感受——这一段是其中一位病友写脚开始下垂的时候。放在这里是因为它最接近，不是因为它对得上。',
    storyId: 'reproductive-choice',
    excerptId: 'foot-drop',
  },
];

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export const getStory = (id: string): Story | undefined => STORIES.find((story) => story.id === id);

export const getExcerpt = (story: Story, excerptId: string): StoryExcerpt | undefined =>
  story.excerpts.find((excerpt) => excerpt.id === excerptId);

export const getPullQuote = (story: Story): StoryExcerpt | undefined =>
  getExcerpt(story, story.pullQuoteId);

export const getTheme = (id: StoryThemeId): StoryTheme | undefined =>
  STORY_THEMES.find((theme) => theme.id === id);

export const getHook = (id: StoryHookId): StoryHook | undefined =>
  STORY_HOOKS.find((hook) => hook.id === id);

/**
 * Stories filed under a theme, in reading order.
 *
 * The serial ordering is not incidental. 《不管如何，你得长大》is one
 * memoir cut into four instalments; part 3 opens on a father already
 * dying and part 4 on the morning he dies. Sorting the shelf by
 * publication date descending — the obvious default for anything that
 * looks like a feed — would present that memoir backwards. So: serial
 * parts always ascend by `part`, and a serial sits at the position of
 * its first instalment. Everything else is newest first.
 */
export const storiesForTheme = (themeId: StoryThemeId): Story[] => {
  const matching = STORIES.filter((story) => story.themes.includes(themeId));

  // Anchor date for a serial = its earliest part, so the whole serial
  // sorts as one unit rather than scattering across the theme.
  const anchorOf = (story: Story): string => {
    if (!story.serial) return story.origin.publishedOn;
    const parts = matching.filter((other) => other.serial?.name === story.serial?.name);
    return parts.reduce(
      (earliest, part) => (part.origin.publishedOn < earliest ? part.origin.publishedOn : earliest),
      story.origin.publishedOn,
    );
  };

  return [...matching].sort((a, b) => {
    const anchorA = anchorOf(a);
    const anchorB = anchorOf(b);
    if (anchorA !== anchorB) return anchorB.localeCompare(anchorA);

    // Same anchor: either the same serial, or a genuine same-day tie.
    if (a.serial && b.serial && a.serial.name === b.serial.name) {
      return a.serial.part - b.serial.part;
    }
    return a.origin.publishedOn.localeCompare(b.origin.publishedOn);
  });
};

/** Total across the shelf. Rendered on the page, so it can never drift
 *  from the array the way a hand-typed count does. */
export const STORY_COUNT = STORIES.length;
