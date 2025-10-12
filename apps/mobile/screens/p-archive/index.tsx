

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';

interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  description: string;
  status: 'warning' | 'stable' | 'info';
  statusText: string;
  details?: Record<string, string>;
}

interface AlertItem {
  id: string;
  type: 'warning' | 'info' | 'success';
  title: string;
  description: string;
  actionText?: string;
}

const ArchiveScreen = () => {
  const router = useRouter();
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const timelineEvents: TimelineEvent[] = [
    {
      id: '1',
      title: 'MRI影像分析',
      date: '2024-01-15',
      description: '前锯肌脂肪化等级：2级',
      status: 'warning',
      statusText: '建议关注'
    },
    {
      id: '2',
      title: '肌力评估',
      date: '2024-01-10',
      description: '',
      status: 'stable',
      statusText: '整体稳定',
      details: {
        '三角肌': '3.5',
        '肱二头肌': '4.0', 
        '股四头肌': '4.2'
      }
    },
    {
      id: '3',
      title: '血检报告',
      date: '2024-01-05',
      description: '肝功能：正常 | 肌酸激酶：轻度升高',
      status: 'info',
      statusText: '定期复查'
    },
    {
      id: '4',
      title: '楼梯测试',
      date: '2024-01-01',
      description: '完成时间：12秒 | 较上次提升1秒',
      status: 'stable',
      statusText: '表现良好'
    }
  ];

  const alertItems: AlertItem[] = [
    {
      id: '1',
      type: 'warning',
      title: '肌力下降预警',
      description: '三角肌肌力从4.0降至3.5，建议加强针对性训练',
      actionText: '查看干预计划 →'
    },
    {
      id: '2',
      type: 'info',
      title: '定期复查提醒',
      description: '建议3个月后进行MRI复查'
    },
    {
      id: '3',
      type: 'success',
      title: '康复训练坚持良好',
      description: '本周已完成80%的训练计划'
    }
  ];

  const handleClinicalPassportPress = () => {
    router.push('/p-clinical_passport');
  };

  const handleDataEntryPress = () => {
    router.push('/p-data_entry');
  };

  const handleTimelineFilterPress = () => {
    Alert.alert('筛选', '时间轴筛选功能');
  };

  const handleEventPress = (eventId: string) => {
    setExpandedEventId(expandedEventId === eventId ? null : eventId);
  };

  const handleInterventionPlanPress = () => {
    router.push('/p-manage');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'warning':
        return '#FF9F43';
      case 'stable':
        return '#4CAF50';
      case 'info':
        return '#2196F3';
      default:
        return '#FF9F43';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'warning':
        return 'triangle-exclamation';
      case 'stable':
        return 'check';
      case 'info':
        return 'info';
      default:
        return 'triangle-exclamation';
    }
  };

  const renderTimelineEvent = (event: TimelineEvent, index: number) => {
    const isLast = index === timelineEvents.length - 1;
    const isExpanded = expandedEventId === event.id;

    return (
      <TouchableOpacity
        key={event.id}
        style={styles.eventCard}
        onPress={() => handleEventPress(event.id)}
        activeOpacity={0.7}
      >
        <View style={styles.timelineLeft}>
          <LinearGradient
            colors={['#969FFF', '#5147FF']}
            style={styles.timelineDot}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          {!isLast && (
            <LinearGradient
              colors={['#969FFF', '#5147FF']}
              style={styles.timelineLine}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
            />
          )}
        </View>
        
        <View style={styles.eventContent}>
          <View style={styles.eventHeader}>
            <Text style={styles.eventTitle}>{event.title}</Text>
            <Text style={styles.eventDate}>{event.date}</Text>
          </View>
          
          {event.description ? (
            <Text style={styles.eventDescription}>{event.description}</Text>
          ) : null}
          
          {event.details && (
            <View style={styles.eventDetails}>
              {Object.entries(event.details).map(([muscle, strength]) => (
                <View key={muscle} style={styles.muscleDetail}>
                  <Text style={styles.muscleName}>{muscle}</Text>
                  <Text style={styles.muscleStrength}>{strength}</Text>
                </View>
              ))}
            </View>
          )}
          
          <View style={styles.eventStatus}>
            <View style={[styles.statusDot, { backgroundColor: getStatusColor(event.status) }]} />
            <Text style={[styles.statusText, { color: getStatusColor(event.status) }]}>
              {event.statusText}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderAlertItem = (item: AlertItem, index: number) => {
    const isMainAlert = index === 0;
    
    if (isMainAlert) {
      return (
        <View key={item.id} style={styles.mainAlertCard}>
          <View style={styles.alertHeader}>
            <View style={styles.alertIconContainer}>
              <FontAwesome6 
                name={getStatusIcon(item.type)} 
                size={12} 
                color={getStatusColor(item.type)} 
              />
            </View>
            <View style={styles.alertContent}>
              <View style={styles.alertTitleRow}>
                <Text style={styles.alertTitle}>{item.title}</Text>
                <Text style={[styles.alertLevel, { color: getStatusColor(item.type) }]}>
                  中等风险
                </Text>
              </View>
              <Text style={styles.alertDescription}>{item.description}</Text>
              {item.actionText && (
                <TouchableOpacity onPress={handleInterventionPlanPress}>
                  <Text style={[styles.alertAction, { color: getStatusColor(item.type) }]}>
                    {item.actionText}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      );
    }

    return (
      <View key={item.id} style={[styles.secondaryAlertCard, { borderLeftColor: getStatusColor(item.type) }]}>
        <View style={styles.secondaryAlertContent}>
          <View style={[styles.secondaryAlertIcon, { backgroundColor: `${getStatusColor(item.type)}20` }]}>
            <FontAwesome6 
              name={getStatusIcon(item.type)} 
              size={10} 
              color={getStatusColor(item.type)} 
            />
          </View>
          <View style={styles.secondaryAlertText}>
            <Text style={styles.secondaryAlertTitle}>{item.title}</Text>
            <Text style={styles.secondaryAlertDescription}>{item.description}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#0F0F23', '#1A1A3A', '#0F0F23']}
        style={styles.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 顶部标题栏 */}
          <View style={styles.header}>
            <Text style={styles.pageTitle}>动态档案</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity 
                style={styles.clinicalPassportButton}
                onPress={handleClinicalPassportPress}
                activeOpacity={0.7}
              >
                <FontAwesome6 name="id-card" size={12} color="#969FFF" />
                <Text style={styles.clinicalPassportText}>临床护照</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.dataEntryButton}
                onPress={handleDataEntryPress}
                activeOpacity={0.7}
              >
                <FontAwesome6 name="plus" size={12} color="#FFFFFF" />
                <Text style={styles.dataEntryText}>录入数据</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* FSHD临床护照概览卡片 */}
          <View style={styles.passportSection}>
            <LinearGradient
              colors={['rgba(150, 159, 255, 0.1)', 'rgba(81, 71, 255, 0.05)']}
              style={styles.passportCard}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={styles.passportHeader}>
                <Text style={styles.passportTitle}>FSHD临床护照</Text>
                <Text style={styles.passportId}>ID: FSHD-2024-001</Text>
              </View>
              
              <View style={styles.passportGrid}>
                <View style={styles.passportItem}>
                  <Text style={styles.passportLabel}>基因类型</Text>
                  <Text style={styles.passportValue}>FSHD1</Text>
                </View>
                <View style={styles.passportItem}>
                  <Text style={styles.passportLabel}>D4Z4重复数</Text>
                  <Text style={styles.passportValue}>8</Text>
                </View>
                <View style={styles.passportItem}>
                  <Text style={styles.passportLabel}>甲基化值</Text>
                  <Text style={styles.passportValue}>0.35</Text>
                </View>
                <View style={styles.passportItem}>
                  <Text style={styles.passportLabel}>初诊时间</Text>
                  <Text style={styles.passportValue}>2023-05-15</Text>
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* 可视化时间轴 */}
          <View style={styles.timelineSection}>
            <View style={styles.timelineHeader}>
              <Text style={styles.timelineTitle}>病程时间轴</Text>
              <TouchableOpacity onPress={handleTimelineFilterPress} activeOpacity={0.7}>
                <View style={styles.filterButton}>
                  <FontAwesome6 name="filter" size={10} color="#969FFF" />
                  <Text style={styles.filterText}>筛选</Text>
                </View>
              </TouchableOpacity>
            </View>
            
            <View style={styles.timelineContainer}>
              {timelineEvents.map((event, index) => renderTimelineEvent(event, index))}
            </View>
          </View>

          {/* 风险预警看板 */}
          <View style={styles.riskAlertSection}>
            <Text style={styles.riskAlertTitle}>风险预警</Text>
            
            <View style={styles.alertsContainer}>
              {alertItems.map((item, index) => renderAlertItem(item, index))}
            </View>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
};

export default ArchiveScreen;

