

import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, Modal, RefreshControl, Alert, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';
import TrialCard from './components/TrialCard';
import FilterDropdown from './components/FilterDropdown';
import SortDropdown from './components/SortDropdown';
import ApplyModal from './components/ApplyModal';
import SuccessModal from './components/SuccessModal';

interface TrialData {
  id: string;
  title: string;
  institution: string;
  department: string;
  phase: string;
  status: string;
  matchPercentage: number;
  inclusionCriteria: string[];
  location: string;
  duration: string;
}

const TrialSquareScreen: React.FC = () => {
  const [isFilterDropdownVisible, setIsFilterDropdownVisible] = useState(false);
  const [isSortDropdownVisible, setIsSortDropdownVisible] = useState(false);
  const [isApplyModalVisible, setIsApplyModalVisible] = useState(false);
  const [isSuccessModalVisible, setIsSuccessModalVisible] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTrialId, setSelectedTrialId] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState('');
  const [matchFilter, setMatchFilter] = useState('');
  const [sortOption, setSortOption] = useState('match');

  const [trialsData, setTrialsData] = useState<TrialData[]>([
    {
      id: 'trial-001',
      title: 'FSHD基因治疗临床试验',
      institution: '北京协和医院',
      department: '基因治疗研究中心',
      phase: 'III期',
      status: '招募中',
      matchPercentage: 83,
      inclusionCriteria: [
        'FSHD1型患者，D4Z4重复数≤8',
        '年龄18-65岁',
        '病程进展期'
      ],
      location: '北京',
      duration: '2024.01-2025.12'
    },
    {
      id: 'trial-002',
      title: 'FSHD肌肉保护药物试验',
      institution: '上海华山医院',
      department: '神经内科',
      phase: 'II期',
      status: '招募中',
      matchPercentage: 67,
      inclusionCriteria: [
        'FSHD患者，任何分型',
        '年龄18-70岁',
        '肌力评分3-4级'
      ],
      location: '上海',
      duration: '2024.03-2025.09'
    },
    {
      id: 'trial-003',
      title: 'FSHD康复评估研究',
      institution: '广州中山大学附属第一医院',
      department: '',
      phase: 'IV期',
      status: '招募中',
      matchPercentage: 91,
      inclusionCriteria: [
        'FSHD确诊患者',
        '年龄16-75岁',
        '能够配合康复评估'
      ],
      location: '广州',
      duration: '2024.02-2026.02'
    },
    {
      id: 'trial-004',
      title: 'FSHD生物标志物研究',
      institution: '成都华西医院',
      department: '罕见病中心',
      phase: 'I期',
      status: '即将开始',
      matchPercentage: 45,
      inclusionCriteria: [
        'FSHD1型患者',
        '年龄20-60岁',
        '近期未接受其他治疗'
      ],
      location: '成都',
      duration: '2024.06-2025.06'
    }
  ]);

  const handleFilterButtonPress = useCallback(() => {
    setIsFilterDropdownVisible(!isFilterDropdownVisible);
    setIsSortDropdownVisible(false);
  }, [isFilterDropdownVisible]);

  const handleSortButtonPress = useCallback(() => {
    setIsSortDropdownVisible(!isSortDropdownVisible);
    setIsFilterDropdownVisible(false);
  }, [isSortDropdownVisible]);

  const handleApplyFilter = useCallback(() => {
    setIsLoading(true);
    setIsFilterDropdownVisible(false);
    
    // 模拟筛选逻辑
    setTimeout(() => {
      setIsLoading(false);
    }, 1000);
  }, [phaseFilter, matchFilter]);

  const handleResetFilter = useCallback(() => {
    setPhaseFilter('');
    setMatchFilter('');
  }, []);

  const handleSortChange = useCallback((value: string) => {
    setSortOption(value);
    setIsSortDropdownVisible(false);
    setIsLoading(true);
    
    // 模拟排序逻辑
    setTimeout(() => {
      setIsLoading(false);
    }, 1000);
  }, []);

  const handleTrialCardPress = useCallback((trialId: string) => {
    console.log('查看试验详情:', trialId);
  }, []);

  const handleApplyTrialPress = useCallback((trialId: string) => {
    setSelectedTrialId(trialId);
    setIsApplyModalVisible(true);
  }, []);

  const handleConfirmApply = useCallback(() => {
    setIsApplyModalVisible(false);
    setIsLoading(true);
    
    // 模拟申请提交
    setTimeout(() => {
      setIsLoading(false);
      setIsSuccessModalVisible(true);
    }, 2000);
  }, []);

  const handleCancelApply = useCallback(() => {
    setIsApplyModalVisible(false);
    setSelectedTrialId(null);
  }, []);

  const handleCloseSuccess = useCallback(() => {
    setIsSuccessModalVisible(false);
    setSelectedTrialId(null);
  }, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    
    // 模拟刷新数据
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1500);
  }, []);

  const handleLoadMore = useCallback(() => {
    console.log('加载更多临床试验');
  }, []);

  const renderTrialItem = useCallback(({ item }: { item: TrialData }) => (
    <TrialCard
      trial={item}
      onPress={() => handleTrialCardPress(item.id)}
      onApplyPress={() => handleApplyTrialPress(item.id)}
    />
  ), [handleTrialCardPress, handleApplyTrialPress]);

  const renderListHeader = useCallback(() => (
    <View>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>临床试验广场</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleFilterButtonPress}
            activeOpacity={0.7}
          >
            <FontAwesome6 name="filter" size={14} color="rgba(255, 255, 255, 0.7)" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleSortButtonPress}
            activeOpacity={0.7}
          >
            <FontAwesome6 name="sort" size={14} color="rgba(255, 255, 255, 0.7)" />
          </TouchableOpacity>
        </View>
      </View>

      {isFilterDropdownVisible && (
        <FilterDropdown
          phaseFilter={phaseFilter}
          matchFilter={matchFilter}
          onPhaseFilterChange={setPhaseFilter}
          onMatchFilterChange={setMatchFilter}
          onApplyFilter={handleApplyFilter}
          onResetFilter={handleResetFilter}
        />
      )}

      {isSortDropdownVisible && (
        <SortDropdown
          sortOption={sortOption}
          onSortChange={handleSortChange}
        />
      )}
    </View>
  ), [
    isFilterDropdownVisible,
    isSortDropdownVisible,
    phaseFilter,
    matchFilter,
    sortOption,
    handleFilterButtonPress,
    handleSortButtonPress,
    handleApplyFilter,
    handleResetFilter,
    handleSortChange
  ]);

  const renderListFooter = useCallback(() => (
    <View style={styles.loadMoreContainer}>
      <TouchableOpacity
        style={styles.loadMoreButton}
        onPress={handleLoadMore}
        activeOpacity={0.7}
      >
        <Text style={styles.loadMoreText}>加载更多试验</Text>
      </TouchableOpacity>
    </View>
  ), [handleLoadMore]);

  return (
    <LinearGradient
      colors={['#0F0F23', '#1A1A3A', '#0F0F23']}
      locations={[0, 0.5, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <SafeAreaView style={styles.safeArea}>
        <FlatList
          data={trialsData}
          renderItem={renderTrialItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderListHeader}
          ListFooterComponent={renderListFooter}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#969FFF"
              colors={['#969FFF']}
            />
          }
        />

        <ApplyModal
          visible={isApplyModalVisible}
          onConfirm={handleConfirmApply}
          onCancel={handleCancelApply}
        />

        <SuccessModal
          visible={isSuccessModalVisible}
          onClose={handleCloseSuccess}
        />

        {isLoading && (
          <Modal
            visible={isLoading}
            transparent={true}
            animationType="fade"
          >
            <View style={styles.loadingOverlay}>
              <View style={styles.loadingContainer}>
                <View style={styles.loadingSpinner} />
                <Text style={styles.loadingText}>正在处理...</Text>
              </View>
            </View>
          </Modal>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
};

export default TrialSquareScreen;

