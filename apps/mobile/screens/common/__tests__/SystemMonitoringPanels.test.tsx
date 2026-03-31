import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import SystemMonitoringPanels from '../SystemMonitoringPanels';
import type { SystemInsightPanel } from '../../../lib/report-insights';

jest.mock('@expo/vector-icons', () => ({
  FontAwesome6: 'FontAwesome6',
}));

const flattenText = (value: React.ReactNode): string => {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => flattenText(item)).join('');
  }
  return '';
};

const buildBloodPanel = (sections: SystemInsightPanel['sections']): SystemInsightPanel => ({
  key: 'blood',
  title: '实验室检查',
  summary: 'summary',
  latestDate: '2026-03-31',
  metrics: sections.flatMap((section) => section.metrics),
  state: 'updated',
  stateLabel: '已覆盖',
  coverage: ['肌酶'],
  sourceCount: 1,
  sections,
});

describe('SystemMonitoringPanels', () => {
  it('keeps the FSHD subcategory chip visible and avoids repeating hero metrics below', () => {
    const panel = buildBloodPanel([
      {
        key: 'fshd_core',
        title: '肌损伤',
        priority: 'core',
        groupKey: 'fshd_related',
        metrics: [{ label: 'Mb', value: '158.81' }],
      },
      {
        key: 'blood_routine',
        title: '血常规',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [{ label: 'WBC', value: '5.2' }],
      },
    ]);

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<SystemMonitoringPanels panels={[panel]} emptyText="empty" />);
    });

    const pressables = renderer!.root.findAllByType(TouchableOpacity);
    const fshdTab = pressables.find((node) =>
      node
        .findAllByType(Text)
        .some((textNode) => flattenText(textNode.props.children) === 'FSHD相关'),
    );

    expect(fshdTab).toBeDefined();

    act(() => {
      fshdTab?.props.onPress();
    });

    const textValues = renderer!.root
      .findAllByType(Text)
      .map((node) => flattenText(node.props.children))
      .filter(Boolean);

    const muscleChip = renderer!.root
      .findAllByType(TouchableOpacity)
      .find((node) =>
        node
          .findAllByType(Text)
          .some((textNode) => flattenText(textNode.props.children) === '肌损伤'),
      );

    expect(muscleChip).toBeDefined();
    expect(textValues.filter((value) => value === '肌损伤')).toHaveLength(1);
    expect(textValues.filter((value) => value === '158.81')).toHaveLength(1);
  });

  it('shows section titles instead of a hero strip when viewing all secondary lab groups', () => {
    const panel = buildBloodPanel([
      {
        key: 'fshd_core',
        title: '肌损伤',
        priority: 'core',
        groupKey: 'fshd_related',
        metrics: [{ label: 'Mb', value: '158.81' }],
      },
      {
        key: 'blood_routine',
        title: '血常规',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [
          { label: 'WBC', value: '6.69' },
          { label: 'HGB', value: '155' },
        ],
      },
      {
        key: 'thyroid_function',
        title: '甲功',
        priority: 'secondary',
        groupKey: 'other',
        metrics: [
          { label: 'FT3', value: '6' },
          { label: 'TSH', value: '1.995' },
        ],
      },
    ]);

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<SystemMonitoringPanels panels={[panel]} emptyText="empty" />);
    });

    const otherTab = renderer!.root
      .findAllByType(TouchableOpacity)
      .find((node) =>
        node
          .findAllByType(Text)
          .some((textNode) => flattenText(textNode.props.children) === '其他'),
      );

    expect(otherTab).toBeDefined();

    act(() => {
      otherTab?.props.onPress();
    });

    const textValues = renderer!.root
      .findAllByType(Text)
      .map((node) => flattenText(node.props.children))
      .filter(Boolean);

    expect(textValues.filter((value) => value === '全部').length).toBeGreaterThanOrEqual(2);
    expect(textValues.filter((value) => value === '血常规').length).toBeGreaterThanOrEqual(2);
    expect(textValues.filter((value) => value === '甲功').length).toBeGreaterThanOrEqual(2);
    expect(textValues.filter((value) => value === '6.69')).toHaveLength(1);
    expect(textValues.filter((value) => value === '155')).toHaveLength(1);
    expect(textValues.filter((value) => value === '6')).toHaveLength(1);
  });
});
