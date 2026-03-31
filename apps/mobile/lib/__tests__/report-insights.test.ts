import {
  getSystemPanelHeroMetrics,
  getSystemPanelSectionTabs,
  type SystemInsightPanel,
} from '../report-insights';

const buildBloodPanel = (sections: SystemInsightPanel['sections']): SystemInsightPanel => ({
  key: 'blood',
  title: '实验室检查',
  summary: 'summary',
  latestDate: '2026-03-31',
  metrics: sections.flatMap((section) => section.metrics),
  state: 'updated',
  stateLabel: '已覆盖',
  coverage: ['肌酶', '血常规'],
  sourceCount: 2,
  sections,
});

describe('report insights blood section tabs', () => {
  it('keeps an all subtab when multiple blood sections are visible so users can return to the combined view', () => {
    const panel = buildBloodPanel([
      {
        key: 'fshd_core',
        title: '肌损伤',
        priority: 'core',
        groupKey: 'fshd_related',
        metrics: [{ label: 'CK', value: '100' }],
      },
      {
        key: 'blood_routine',
        title: '血常规',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [{ label: 'WBC', value: '5.2' }],
      },
    ]);

    expect(getSystemPanelSectionTabs(panel, 'all')).toEqual([
      { key: 'all', label: '全部' },
      { key: 'fshd_core', label: '肌损伤' },
      { key: 'blood_routine', label: '血常规' },
    ]);
  });

  it('keeps FSHD subcategory chips visible even when only one child section has data', () => {
    const panel = buildBloodPanel([
      {
        key: 'fshd_core',
        title: '肌损伤',
        priority: 'core',
        groupKey: 'fshd_related',
        metrics: [{ label: 'CK', value: '100' }],
      },
      {
        key: 'metabolic',
        title: '代谢/肾功能',
        priority: 'secondary',
        groupKey: 'fshd_related',
        metrics: [],
      },
      {
        key: 'blood_routine',
        title: '血常规',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [{ label: 'WBC', value: '5.2' }],
      },
    ]);

    expect(getSystemPanelSectionTabs(panel, 'group:fshd_related')).toEqual([
      { key: 'fshd_core', label: '肌损伤' },
    ]);
  });

  it('limits hero metrics to the selected FSHD subcategory', () => {
    const panel = buildBloodPanel([
      {
        key: 'fshd_core',
        title: '肌损伤',
        priority: 'core',
        groupKey: 'fshd_related',
        metrics: [
          { label: 'CK', value: '100' },
          { label: 'Mb', value: '80' },
        ],
      },
      {
        key: 'blood_routine',
        title: '血常规',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [{ label: 'WBC', value: '5.2' }],
      },
    ]);

    expect(getSystemPanelHeroMetrics(panel, 'all', 'fshd_core')).toEqual([
      { label: 'CK', value: '100' },
      { label: 'Mb', value: '80' },
    ]);
  });

  it('does not promote non-FSHD metrics into the all-view hero area when no core section exists', () => {
    const panel = buildBloodPanel([
      {
        key: 'blood_routine',
        title: '血常规',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [{ label: 'WBC', value: '5.2' }],
      },
      {
        key: 'thyroid_function',
        title: '甲功',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [{ label: 'FT3', value: '6' }],
      },
    ]);

    expect(getSystemPanelHeroMetrics(panel, 'all', 'all')).toEqual([]);
  });
});
