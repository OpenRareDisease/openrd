import { useState, type ComponentProps } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../lib/clinical-visuals';
import {
  getSystemPanelHeroMetrics,
  getSystemPanelScopedSections,
  getSystemPanelSectionTabs,
  getSystemPanelTabs,
  type SystemInsightPanel,
} from '../../lib/report-insights';

type SystemMonitoringPanelsProps = {
  panels: SystemInsightPanel[];
  emptyText: string;
};

const cardShadow =
  Platform.select({
    ios: {
      shadowColor: '#182B36',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.1,
      shadowRadius: 24,
    },
    android: {
      elevation: 5,
    },
    default: {},
  }) ?? {};

const PREVIEW_LIMIT = 2;

const systemPanelMeta: Record<
  SystemInsightPanel['key'],
  { icon: ComponentProps<typeof FontAwesome6>['name']; accentColor: string; accentBg: string }
> = {
  blood: {
    icon: 'flask',
    accentColor: '#C2410C',
    accentBg: 'rgba(194, 65, 12, 0.12)',
  },
  respiratory: {
    icon: 'lungs',
    accentColor: '#0EA5A4',
    accentBg: 'rgba(14, 165, 164, 0.12)',
  },
  cardiac: {
    icon: 'heart-pulse',
    accentColor: '#DC2626',
    accentBg: 'rgba(220, 38, 38, 0.12)',
  },
};

const systemStateMeta: Record<
  SystemInsightPanel['state'],
  { textColor: string; backgroundColor: string; borderColor: string }
> = {
  updated: {
    textColor: CLINICAL_COLORS.success,
    backgroundColor: CLINICAL_TINTS.successSoft,
    borderColor: CLINICAL_TINTS.successBorder,
  },
  partial: {
    textColor: CLINICAL_COLORS.warning,
    backgroundColor: CLINICAL_TINTS.warningSoft,
    borderColor: CLINICAL_TINTS.warningBorder,
  },
  missing: {
    textColor: CLINICAL_COLORS.textMuted,
    backgroundColor: CLINICAL_TINTS.neutralSoft,
    borderColor: CLINICAL_TINTS.borderSubtle,
  },
};

export default function SystemMonitoringPanels({ panels, emptyText }: SystemMonitoringPanelsProps) {
  const [selectedTabs, setSelectedTabs] = useState<
    Partial<Record<SystemInsightPanel['key'], string>>
  >({});
  const [selectedSubtabs, setSelectedSubtabs] = useState<Record<string, string>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  if (!panels.length) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }

  return (
    <View style={styles.systemStack}>
      {panels.map((panel) => {
        const tabs = getSystemPanelTabs(panel);
        const defaultTab = tabs[0]?.key ?? 'all';
        const selectedTab = tabs.some((tab) => tab.key === selectedTabs[panel.key])
          ? (selectedTabs[panel.key] ?? defaultTab)
          : defaultTab;
        const scopedSections = getSystemPanelScopedSections(panel, selectedTab);
        const sectionTabs = getSystemPanelSectionTabs(panel, selectedTab);
        const subtabStateKey = `${panel.key}:${selectedTab}`;
        const hasAllSubtab = sectionTabs.some((tab) => tab.key === 'all');
        const defaultSubtab = hasAllSubtab ? 'all' : (sectionTabs[0]?.key ?? 'all');
        const requestedSubtab = selectedSubtabs[subtabStateKey];
        const selectedSubtab =
          requestedSubtab &&
          (requestedSubtab === 'all'
            ? hasAllSubtab || defaultSubtab === 'all'
            : sectionTabs.some((tab) => tab.key === requestedSubtab))
            ? requestedSubtab
            : defaultSubtab;
        const filteredSections =
          selectedSubtab === 'all'
            ? scopedSections
            : scopedSections.filter((section) => section.key === selectedSubtab);
        const heroMetrics = getSystemPanelHeroMetrics(panel, selectedTab, selectedSubtab);
        const showHeroMetrics =
          panel.key !== 'blood'
            ? heroMetrics.length > 0
            : selectedSubtab !== 'all' && heroMetrics.length > 0;
        const useAccentHeroStyle = selectedSubtab !== 'all';
        const heroLabels = new Set(
          showHeroMetrics ? heroMetrics.map((metric) => metric.label) : [],
        );
        const visibleSections = filteredSections
          .map((section) => ({
            ...section,
            metrics: section.metrics.filter((metric) => !heroLabels.has(metric.label)),
          }))
          .filter((section) => section.metrics.length > 0);

        return (
          <View key={panel.key} style={styles.systemCard}>
            <View style={styles.systemCardTop}>
              <View
                style={[
                  styles.systemIconWrap,
                  { backgroundColor: systemPanelMeta[panel.key].accentBg },
                ]}
              >
                <FontAwesome6
                  name={systemPanelMeta[panel.key].icon}
                  size={15}
                  color={systemPanelMeta[panel.key].accentColor}
                />
              </View>

              <View style={styles.systemCardCopy}>
                <View style={styles.systemBadgeRow}>
                  <View
                    style={[
                      styles.systemStateBadge,
                      {
                        backgroundColor: systemStateMeta[panel.state].backgroundColor,
                        borderColor: systemStateMeta[panel.state].borderColor,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.systemStateBadgeText,
                        { color: systemStateMeta[panel.state].textColor },
                      ]}
                    >
                      {panel.stateLabel}
                    </Text>
                  </View>

                  {panel.coverage.map((item) => (
                    <View key={`${panel.key}-${item}`} style={styles.systemCoverageChip}>
                      <Text style={styles.systemCoverageChipText}>{item}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.systemTitleRow}>
                  <Text style={styles.systemTitle}>{panel.title}</Text>
                  <Text style={styles.systemDate}>{panel.latestDate}</Text>
                </View>
                <Text style={styles.systemSummary}>{panel.summary}</Text>
              </View>
            </View>

            <View style={styles.systemMetaGrid}>
              <View style={styles.systemMetaCard}>
                <Text style={styles.systemMetaLabel}>最近日期</Text>
                <Text style={styles.systemMetaValue}>{panel.latestDate}</Text>
              </View>
              <View style={styles.systemMetaCard}>
                <Text style={styles.systemMetaLabel}>已覆盖报告</Text>
                <Text style={styles.systemMetaValue}>
                  {panel.sourceCount > 0 ? `${panel.sourceCount} 类` : '0 类'}
                </Text>
              </View>
            </View>

            {tabs.length > 1 ? (
              <View style={styles.tabRow}>
                {tabs.map((tab) => {
                  const isActive = selectedTab === tab.key;
                  return (
                    <TouchableOpacity
                      key={`${panel.key}-${tab.key}`}
                      style={[
                        styles.tabChip,
                        isActive && {
                          backgroundColor: systemPanelMeta[panel.key].accentBg,
                          borderColor: systemPanelMeta[panel.key].accentColor,
                        },
                      ]}
                      activeOpacity={0.88}
                      onPress={() =>
                        setSelectedTabs((prev) => ({
                          ...prev,
                          [panel.key]: tab.key,
                        }))
                      }
                    >
                      <Text
                        style={[
                          styles.tabChipText,
                          isActive && { color: systemPanelMeta[panel.key].accentColor },
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            {sectionTabs.length > 0 ? (
              <View style={styles.subtabRow}>
                {sectionTabs.map((tab) => {
                  const isActive = selectedSubtab === tab.key;
                  return (
                    <TouchableOpacity
                      key={`${panel.key}-${selectedTab}-${tab.key}`}
                      style={[
                        styles.subtabChip,
                        isActive && {
                          backgroundColor: systemPanelMeta[panel.key].accentBg,
                          borderColor: systemPanelMeta[panel.key].accentColor,
                        },
                      ]}
                      activeOpacity={0.88}
                      onPress={() =>
                        setSelectedSubtabs((prev) => ({
                          ...prev,
                          [subtabStateKey]: tab.key,
                        }))
                      }
                    >
                      <Text
                        style={[
                          styles.subtabChipText,
                          isActive && { color: systemPanelMeta[panel.key].accentColor },
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            {showHeroMetrics ? (
              <View style={styles.systemMetricHeroGrid}>
                {heroMetrics.map((metric) => (
                  <View
                    key={`${panel.key}-${selectedTab}-${selectedSubtab}-hero-${metric.label}`}
                    style={[
                      styles.systemMetricHeroCard,
                      useAccentHeroStyle
                        ? {
                            backgroundColor: systemPanelMeta[panel.key].accentBg,
                            borderColor: systemPanelMeta[panel.key].accentColor + '22',
                          }
                        : styles.systemMetricHeroCardNeutral,
                    ]}
                  >
                    <Text style={styles.systemMetricHeroLabel}>{metric.label}</Text>
                    <Text style={styles.systemMetricHeroValue}>{metric.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {visibleSections.length > 0 ? (
              <View style={styles.systemSectionStack}>
                {visibleSections.map((section) => {
                  const sectionStateKey = `${panel.key}:${section.key}`;
                  const isCore = section.priority === 'core';
                  const isFshdRelatedSection =
                    panel.key === 'blood' && section.groupKey === 'fshd_related';
                  const forceExpanded =
                    panel.key !== 'blood'
                      ? isCore || selectedTab === section.key
                      : selectedSubtab === section.key ||
                        selectedTab === section.key ||
                        isFshdRelatedSection ||
                        (selectedTab === 'group:fshd_related' && isFshdRelatedSection);
                  const expanded = forceExpanded || Boolean(expandedSections[sectionStateKey]);
                  const hiddenCount = Math.max(section.metrics.length - PREVIEW_LIMIT, 0);
                  const visibleMetrics =
                    expanded || hiddenCount === 0
                      ? section.metrics
                      : section.metrics.slice(0, PREVIEW_LIMIT);

                  return (
                    <View key={`${panel.key}-${section.key}`} style={styles.systemSectionBlock}>
                      <View style={styles.systemSectionHeader}>
                        <View style={styles.systemSectionHeaderCopy}>
                          <Text style={styles.systemSectionTitle}>{section.title}</Text>
                          {isCore ? (
                            <View
                              style={[
                                styles.systemSectionBadge,
                                {
                                  backgroundColor: systemPanelMeta[panel.key].accentBg,
                                  borderColor: systemPanelMeta[panel.key].accentColor + '22',
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.systemSectionBadgeText,
                                  { color: systemPanelMeta[panel.key].accentColor },
                                ]}
                              >
                                重点
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        {!forceExpanded && hiddenCount > 0 ? (
                          <TouchableOpacity
                            style={styles.sectionToggle}
                            activeOpacity={0.88}
                            onPress={() =>
                              setExpandedSections((prev) => ({
                                ...prev,
                                [sectionStateKey]: !prev[sectionStateKey],
                              }))
                            }
                          >
                            <Text style={styles.sectionToggleText}>
                              {expanded ? '收起' : `查看全部 ${hiddenCount} 项`}
                            </Text>
                            <FontAwesome6
                              name={expanded ? 'chevron-up' : 'chevron-down'}
                              size={11}
                              color={CLINICAL_COLORS.textSoft}
                            />
                          </TouchableOpacity>
                        ) : null}
                      </View>

                      <View style={styles.systemMetricGrid}>
                        {visibleMetrics.map((metric) => (
                          <View
                            key={`${panel.key}-${section.key}-${metric.label}`}
                            style={styles.systemMetricCard}
                          >
                            <Text style={styles.systemMetricLabel}>{metric.label}</Text>
                            <Text style={styles.systemMetricValue}>{metric.value}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : heroMetrics.length === 0 ? (
              <Text style={styles.emptyText}>当前筛选下还没有结构化指标。</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  systemStack: {
    gap: 12,
  },
  systemCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    ...cardShadow,
  },
  systemCardTop: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  systemIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CLINICAL_TINTS.accentSoft,
  },
  systemCardCopy: {
    flex: 1,
  },
  systemBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  systemStateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  systemStateBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  systemCoverageChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: CLINICAL_TINTS.neutralSoft,
  },
  systemCoverageChipText: {
    color: CLINICAL_COLORS.textSoft,
    fontSize: 11,
    fontWeight: '700',
  },
  systemTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  systemTitle: {
    flex: 1,
    color: CLINICAL_COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },
  systemDate: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  systemSummary: {
    marginTop: 8,
    color: CLINICAL_COLORS.textSoft,
    fontSize: 13,
    lineHeight: 20,
  },
  systemMetaGrid: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  systemMetaCard: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    backgroundColor: 'rgba(248, 242, 234, 0.78)',
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
  },
  systemMetaLabel: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  systemMetaValue: {
    marginTop: 8,
    color: CLINICAL_COLORS.text,
    fontSize: 16,
    fontWeight: '800',
  },
  tabRow: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  subtabRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tabChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    backgroundColor: CLINICAL_COLORS.backgroundRaised,
    outlineWidth: 0,
  },
  tabChipText: {
    color: CLINICAL_COLORS.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  subtabChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    backgroundColor: 'rgba(248, 242, 234, 0.78)',
    outlineWidth: 0,
  },
  subtabChipText: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  systemMetricHeroGrid: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  systemMetricHeroCard: {
    width: '47%',
    minHeight: 84,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  systemMetricHeroCardNeutral: {
    backgroundColor: CLINICAL_COLORS.panelMuted,
    borderColor: 'transparent',
  },
  systemMetricHeroLabel: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  systemMetricHeroValue: {
    marginTop: 10,
    color: CLINICAL_COLORS.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  systemSectionStack: {
    marginTop: 16,
    gap: 14,
  },
  systemSectionBlock: {
    borderTopWidth: 1,
    borderTopColor: CLINICAL_COLORS.border,
    paddingTop: 14,
  },
  systemSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  systemSectionHeaderCopy: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  systemSectionTitle: {
    color: CLINICAL_COLORS.text,
    fontSize: 13,
    fontWeight: '800',
  },
  systemSectionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  systemSectionBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  sectionToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: CLINICAL_TINTS.neutralSoft,
  },
  sectionToggleText: {
    color: CLINICAL_COLORS.textSoft,
    fontSize: 11,
    fontWeight: '700',
  },
  systemMetricGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  systemMetricCard: {
    width: '47%',
    minHeight: 74,
    padding: 12,
    borderRadius: 16,
    backgroundColor: CLINICAL_COLORS.panelMuted,
  },
  systemMetricLabel: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  systemMetricValue: {
    marginTop: 8,
    color: CLINICAL_COLORS.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  emptyText: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
});
