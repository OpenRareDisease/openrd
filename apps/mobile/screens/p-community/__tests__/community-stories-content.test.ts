/**
 * The shelf publishes twenty-one people's own sentences under their own
 * names. These tests guard the three things that, if they broke, would
 * break them in a way nobody would notice from a screenshot:
 *
 *  - a quotation losing its attribution or its source,
 *  - a four-part memoir being presented out of order,
 *  - a contextual hook pointing at a quotation that no longer exists,
 *    so the card renders a named patient saying nothing.
 *
 * The test file lives beside the screen rather than in lib/__tests__/
 * because this lane owns screens/p-community/** and one file in lib/.
 */

import {
  COMMUNITY_CAVEAT,
  COMMUNITY_INTRO,
  READ_ORIGINAL_NOTE,
  STORIES,
  STORY_COUNT,
  STORY_HOOKS,
  STORY_THEMES,
  getExcerpt,
  getPullQuote,
  getStory,
  storiesForTheme,
} from '../../../lib/community-stories-content';

describe('语料本身', () => {
  it('21 篇，和语料库里的篇数一致', () => {
    // content/medical-kb/source/FSHD_知识库/11.病友经验/ holds 17 loose
    // PDFs plus a 4-part serial in its own directory. If someone adds
    // the third batch, this number moves with the array rather than
    // with a hand-typed count on the page.
    expect(STORIES).toHaveLength(21);
    expect(STORY_COUNT).toBe(21);
  });

  it('每篇的 id 唯一', () => {
    const ids = STORIES.map((story) => story.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每篇都带作者署名、发表日期和原标题', () => {
    // The whole 「读原文」 surface is this locator. Without any one of
    // the three, an excerpt is an unattributed quotation from a person
    // who did not consent to being unattributed.
    STORIES.forEach((story) => {
      expect(story.origin.byline.length).toBeGreaterThan(0);
      expect(story.origin.originalTitle.length).toBeGreaterThan(0);
      expect(story.origin.publishedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(story.origin.account).toBe('FSHD青年路社区');
      expect(story.origin.sourceFile).toContain('11.病友经验/');
    });
  });

  it('每篇至少有一段摘录，且 pullQuoteId 指向真实存在的摘录', () => {
    STORIES.forEach((story) => {
      expect(story.excerpts.length).toBeGreaterThan(0);
      expect(getPullQuote(story)).toBeDefined();
    });
  });

  it('同一篇里的摘录 id 不重复', () => {
    STORIES.forEach((story) => {
      const ids = story.excerpts.map((excerpt) => excerpt.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it('没有编造的链接：url 要么没有，要么是 https', () => {
    // The archived PDFs do not carry their own permalink. Absent is the
    // honest state; a guessed one would send a patient to a stranger's
    // life under this author's name. When real URLs arrive they must
    // still be https — the app runs in mainland China inside WeChat's
    // in-app browser, where a http link is both insecure and likely to
    // be rewritten.
    STORIES.forEach((story) => {
      if (story.origin.url !== undefined) {
        expect(story.origin.url).toMatch(/^https:\/\//);
      }
    });
  });
});

describe('主题', () => {
  it('每篇至少归入一个主题，且主题都是已定义的', () => {
    const known = new Set(STORY_THEMES.map((theme) => theme.id));
    STORIES.forEach((story) => {
      expect(story.themes.length).toBeGreaterThan(0);
      story.themes.forEach((themeId) => expect(known.has(themeId)).toBe(true));
    });
  });

  it('六个主题每一个都至少有两篇，没有空架子', () => {
    // A theme tab that opens on one story (or none) is a shelf built
    // from a template rather than from the content — the exact failure
    // this feature was asked not to commit.
    STORY_THEMES.forEach((theme) => {
      expect(storiesForTheme(theme.id).length).toBeGreaterThanOrEqual(2);
    });
  });

  it('每篇都能在它自己的主题里被找到', () => {
    STORIES.forEach((story) => {
      story.themes.forEach((themeId) => {
        expect(storiesForTheme(themeId).map((s) => s.id)).toContain(story.id);
      });
    });
  });
});

describe('连载《不管如何，你得长大》必须按顺序', () => {
  const serialIds = [
    'grow-up-anyway-1',
    'grow-up-anyway-2',
    'grow-up-anyway-3',
    'grow-up-anyway-4',
  ];

  it('四篇都在，part 是 1..4', () => {
    const parts = serialIds.map((id) => getStory(id)?.serial?.part);
    expect(parts).toEqual([1, 2, 3, 4]);
    serialIds.forEach((id) => expect(getStory(id)?.serial?.total).toBe(4));
  });

  it('在「家人」这一栏里，四篇连着且升序', () => {
    // The shelf is newest-first everywhere else, and these four were
    // published a week apart in 2023 — so a plain date-descending sort
    // prints the memoir backwards, opening on the morning the author's
    // father dies. This assertion is the one that goes red if anyone
    // simplifies storiesForTheme into a sort by date.
    const ordered = storiesForTheme('family').map((story) => story.id);
    const positions = serialIds.map((id) => ordered.indexOf(id));

    positions.forEach((position) => expect(position).toBeGreaterThanOrEqual(0));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions[3] - positions[0]).toBe(3);
  });
});

describe('不能被当成预后', () => {
  it('页面顶部的提醒说明这不是医学建议，也不能用来推测自己', () => {
    expect(COMMUNITY_CAVEAT).toContain('不是医学建议');
    expect(COMMUNITY_CAVEAT).toContain('不能用来推测');
  });

  it('提醒里引用的是病友自己的话，而不是我们的断言', () => {
    // More credible in 小旸's words than in ours, and it is the line
    // that most directly refuses the「别人这样，我也会这样」reading.
    expect(COMMUNITY_CAVEAT).toContain('FSHD是一个谜');
    const source = getStory('rubiks-cube');
    const quoted = getExcerpt(source!, 'fshd-is-a-riddle');
    expect(quoted?.text).toContain('FSHD是一个谜');
  });

  it('开头就说清楚只放摘录、不转载全文', () => {
    expect(COMMUNITY_INTRO).toContain('不转载全文');
    expect(COMMUNITY_INTRO).toContain('FSHD青年路社区');
  });

  it('说明为什么没有直接链接，而不是假装有', () => {
    expect(READ_ORIGINAL_NOTE).toContain('没有带原文链接');
  });
});

describe('可能被当成医学建议的内容要带说明', () => {
  it('提到保健品的那篇标注了「不是研究结论」', () => {
    // 走过2024 recommends supplements from personal experience. The
    // shelf must not appear to endorse that, and「这是她的经验」has to
    // be on the card, not in a comment.
    const story = getStory('new-dimension-2024');
    expect(story?.caution).toBeDefined();
    expect(story?.caution).toContain('不是研究结论');
  });
});

describe('情境提示引用的内容必须真实存在', () => {
  it('每个 hook 指向的故事和摘录都存在', () => {
    // Without this, renaming an excerpt id leaves a card that quotes a
    // named patient saying nothing — and it would only be visible to
    // someone who had turned hooks on and then had a fall.
    STORY_HOOKS.forEach((hook) => {
      const story = getStory(hook.storyId);
      expect(story).toBeDefined();
      expect(getExcerpt(story!, hook.excerptId)).toBeDefined();
    });
  });

  it('hook id 唯一', () => {
    const ids = STORY_HOOKS.map((hook) => hook.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个 hook 的文案都明说「这不是对你的判断」', () => {
    // The single sentence standing between this feature and a
    // progression alert wearing empathy.
    STORY_HOOKS.forEach((hook) => {
      expect(hook.lede).toMatch(/不是对你|不是因为它对得上/);
    });
  });

  it('hook 文案里不出现任何进展性词汇', () => {
    // 加重 / 下降 / 变差 / 恶化 / 注意 in a card that appears right
    // after a fall entry is the app telling a patient they are getting
    // worse, whatever the surrounding sentence says.
    const forbidden = ['加重', '下降', '变差', '恶化', '退步', '警示', '注意'];
    STORY_HOOKS.forEach((hook) => {
      const copy = hook.title + hook.lede;
      forbidden.forEach((word) => expect(copy).not.toContain(word));
    });
  });

  it('AFO 那一条老实承认语料里没有人写过戴 AFO', () => {
    // The nearest true match is a foot-drop passage. Pretending
    // otherwise would put a fabricated relevance in front of someone
    // on the day they first braced their ankle.
    const hook = STORY_HOOKS.find((candidate) => candidate.id === 'first-afo');
    expect(hook?.lede).toContain('没有人写过戴 AFO');
  });
});
