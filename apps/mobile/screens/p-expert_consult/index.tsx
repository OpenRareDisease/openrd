

import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Modal, Alert, RefreshControl, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';
import ExpertCard from './components/ExpertCard';
import ExpertDetailModal from './components/ExpertDetailModal';

interface ExpertData {
  id: string;
  name: string;
  title: string;
  hospital: string;
  rating: string;
  patients: string;
  online: boolean;
  busy: boolean;
  avatar: string;
  specialty: string;
  experience: string;
  availableTime: string;
}

type FilterType = 'all' | 'online' | 'hospital';

const ExpertConsultScreen: React.FC = () => {
  const router = useRouter();
  
  const [searchText, setSearchText] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [isModalVisible, setIsModalVisible] = useState<boolean>(false);
  const [selectedExpert, setSelectedExpert] = useState<ExpertData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const expertsData: ExpertData[] = [
    {
      id: 'expert1',
      name: '李教授',
      title: '主任医师 · 神经内科',
      hospital: '北京协和医院',
      rating: '4.9',
      patients: '1000+ 患者',
      online: true,
      busy: false,
      avatar: 'https://s.coze.cn/image/o-3sRbZCzt0/',
      specialty: 'FSHD诊断与治疗、神经肌肉疾病',
      experience: '20年临床经验，发表论文100余篇',
      availableTime: '周一至周五 8:00-17:00'
    },
    {
      id: 'expert2',
      name: '王医生',
      title: '副主任医师 · 康复医学科',
      hospital: '上海华山医院',
      rating: '4.8',
      patients: '800+ 患者',
      online: true,
      busy: true,
      avatar: 'https://s.coze.cn/image/KThNslHScpE/',
      specialty: 'FSHD康复治疗、运动康复',
      experience: '15年康复治疗经验，擅长神经肌肉疾病康复',
      availableTime: '周二、周四、周六 9:00-16:00'
    },
    {
      id: 'expert3',
      name: '张教授',
      title: '主任医师 · 神经肌肉病专科',
      hospital: '中山大学附属第一医院',
      rating: '4.9',
      patients: '1200+ 患者',
      online: true,
      busy: false,
      avatar: 'https://s.coze.cn/image/KfU3fVhCMfc/',
      specialty: 'FSHD基因诊断、罕见病诊疗',
      experience: '25年神经肌肉病诊疗经验，国际知名专家',
      availableTime: '周一、周三、周五 8:30-17:30'
    },
    {
      id: 'expert4',
      name: '刘医生',
      title: '副主任医师 · 遗传咨询科',
      hospital: '四川大学华西医院',
      rating: '4.7',
      patients: '600+ 患者',
      online: false,
      busy: false,
      avatar: 'https://s.coze.cn/image/17nO7PssNKQ/',
      specialty: 'FSHD遗传咨询、产前诊断',
      experience: '12年遗传咨询经验，专注于肌肉疾病遗传咨询',
      availableTime: '周一至周五 9:00-16:00'
    }
  ];

  const filteredExperts = expertsData.filter(expert => {
    const matchesSearch = expert.name.toLowerCase().includes(searchText.toLowerCase()) ||
                        expert.title.toLowerCase().includes(searchText.toLowerCase()) ||
                        expert.hospital.toLowerCase().includes(searchText.toLowerCase());
    
    let matchesFilter = true;
    switch (activeFilter) {
      case 'online':
        matchesFilter = expert.online && !expert.busy;
        break;
      case 'hospital':
        matchesFilter = expert.hospital.includes('协和') || 
                       expert.hospital.includes('华山') || 
                       expert.hospital.includes('华西');
        break;
      case 'all':
      default:
        matchesFilter = true;
        break;
    }
    
    return matchesSearch && matchesFilter;
  });

  const handleBackPress = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    }
  }, [router]);

  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
  }, []);

  const handleFilterPress = useCallback((filter: FilterType) => {
    setActiveFilter(filter);
  }, []);

  const handleExpertPress = useCallback((expert: ExpertData) => {
    setSelectedExpert(expert);
    setIsModalVisible(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalVisible(false);
    setSelectedExpert(null);
  }, []);

  const handleTextConsult = useCallback((expert: ExpertData) => {
    if (expert.online) {
      Alert.alert('咨询提示', `正在为您连接${expert.name}进行图文咨询...`);
    } else {
      Alert.alert('提示', '专家当前不在线，请稍后再试');
    }
  }, []);

  const handlePhoneConsult = useCallback((expert: ExpertData) => {
    if (expert.online) {
      Alert.alert('咨询提示', `正在为您连接${expert.name}进行电话咨询...`);
    } else {
      Alert.alert('提示', '专家当前不在线，请稍后再试');
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    // 模拟刷新延迟
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1000);
  }, []);

  const renderExpertItem = useCallback(({ item }: { item: ExpertData }) => (
    <ExpertCard
      expert={item}
      onPress={() => handleExpertPress(item)}
      onTextConsult={() => handleTextConsult(item)}
      onPhoneConsult={() => handlePhoneConsult(item)}
    />
  ), [handleExpertPress, handleTextConsult, handlePhoneConsult]);

  const renderHeader = useCallback(() => (
    <View style={styles.headerContainer}>
      {/* 搜索和筛选区域 */}
      <View style={styles.searchFilterSection}>
        <View style={styles.searchFilterCard}>
          {/* 搜索框 */}
          <View style={styles.searchContainer}>
            <View style={styles.searchInputWrapper}>
              <FontAwesome6 name="magnifying-glass" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="搜索专家姓名、医院或科室"
                placeholderTextColor="rgba(255, 255, 255, 0.5)"
                value={searchText}
                onChangeText={handleSearchChange}
              />
            </View>
          </View>
          
          {/* 筛选标签 */}
          <View style={styles.filterTags}>
            <TouchableOpacity
              style={[
                styles.filterTag,
                activeFilter === 'all' && styles.filterTagActive
              ]}
              onPress={() => handleFilterPress('all')}
            >
              <Text style={[
                styles.filterTagText,
                activeFilter === 'all' && styles.filterTagTextActive
              ]}>
                全部
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.filterTag,
                activeFilter === 'online' && styles.filterTagActive
              ]}
              onPress={() => handleFilterPress('online')}
            >
              <Text style={[
                styles.filterTagText,
                activeFilter === 'online' && styles.filterTagTextActive
              ]}>
                在线
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.filterTag,
                activeFilter === 'hospital' && styles.filterTagActive
              ]}
              onPress={() => handleFilterPress('hospital')}
            >
              <Text style={[
                styles.filterTagText,
                activeFilter === 'hospital' && styles.filterTagTextActive
              ]}>
                三甲医院
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  ), [searchText, activeFilter, handleSearchChange, handleFilterPress]);

  return (
    <LinearGradient
      colors={['#0F0F23', '#1A1A3A', '#0F0F23']}
      style={styles.container}
    >
      <SafeAreaView style={styles.safeArea}>
        {/* 顶部标题栏 */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
            <FontAwesome6 name="arrow-left" style={styles.backIcon} />
          </TouchableOpacity>
          <Text style={styles.pageTitle}>专家咨询</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* 专家列表 */}
        <FlatList
          data={filteredExperts}
          renderItem={renderExpertItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={styles.listContainer}
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

        {/* 专家详情弹窗 */}
        <ExpertDetailModal
          visible={isModalVisible}
          expert={selectedExpert}
          onClose={handleCloseModal}
        />
      </SafeAreaView>
    </LinearGradient>
  );
};

export default ExpertConsultScreen;

