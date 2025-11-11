

import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Alert, Linking, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome5, FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';

interface Resource {
  id: string;
  name: string;
  type: 'clinic' | 'rehab';
  address: string;
  phone: string;
  hours: string;
  services: string;
  registration: string;
  distance: string;
  icon: string;
  color: string;
  markerPosition: { top: string; left: string };
}

interface SearchResult {
  id: string;
  name: string;
  address: string;
}

const ResourceMapScreen = () => {
  const router = useRouter();
  
  // 状态管理
  const [isSearchOverlayVisible, setIsSearchOverlayVisible] = useState(false);
  const [isFilterOverlayVisible, setIsFilterOverlayVisible] = useState(false);
  const [isDetailModalVisible, setIsDetailModalVisible] = useState(false);
  const [isResourcesListExpanded, setIsResourcesListExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  
  // 筛选状态
  const [filterClinic, setFilterClinic] = useState(true);
  const [filterRehab, setFilterRehab] = useState(true);
  const [filterDistance, setFilterDistance] = useState('5');
  
  // 搜索输入引用
  const searchInputRef = useRef<TextInput>(null);

  // 模拟资源数据
  const resources: Resource[] = [
    {
      id: '1',
      name: '华西医院FSHD诊疗中心',
      type: 'clinic',
      address: '四川省成都市武侯区国学巷37号',
      phone: '028-85422114',
      hours: '周一至周五 8:00-17:30',
      services: 'FSHD专病门诊、基因检测、肌力评估、多学科会诊',
      registration: 'FSHD专病门诊每周三上午开放，可通过医院官网或微信公众号预约',
      distance: '2.3km',
      icon: 'hospital',
      color: '#969FFF',
      markerPosition: { top: '30%', left: '25%' }
    },
    {
      id: '2',
      name: '康复之家专业康复中心',
      type: 'rehab',
      address: '四川省成都市青羊区一环路西二段32号',
      phone: '028-87766555',
      hours: '周一至周日 9:00-18:00',
      services: '物理治疗、作业治疗、言语治疗、康复评估',
      registration: '可电话预约或现场咨询，首次评估免费',
      distance: '4.1km',
      icon: 'heartbeat',
      color: '#34D399',
      markerPosition: { top: '60%', left: '70%' }
    },
    {
      id: '3',
      name: '四川省人民医院神经肌肉病中心',
      type: 'clinic',
      address: '四川省成都市青羊区一环路西二段32号',
      phone: '028-87393999',
      hours: '周一至周五 8:30-17:00',
      services: '神经肌肉病诊断、基因检测、肌肉活检、康复指导',
      registration: '需提前预约，建议携带既往检查资料',
      distance: '5.2km',
      icon: 'hospital',
      color: '#969FFF',
      markerPosition: { top: '45%', left: '60%' }
    },
    {
      id: '4',
      name: '阳光康复理疗中心',
      type: 'rehab',
      address: '四川省成都市锦江区红星路二段126号',
      phone: '028-86668888',
      hours: '周一至周六 8:30-19:00',
      services: '运动康复、物理因子治疗、中医理疗、心理辅导',
      registration: '支持医保报销，可通过微信小程序预约',
      distance: '6.8km',
      icon: 'heartbeat',
      color: '#34D399',
      markerPosition: { top: '75%', left: '35%' }
    }
  ];

  // 处理返回按钮
  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/p-home');
    }
  };

  // 处理搜索
  const handleSearchPress = () => {
    setIsSearchOverlayVisible(true);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
  };

  const handleSearchClose = () => {
    setIsSearchOverlayVisible(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleSearchInputChange = (text: string) => {
    setSearchQuery(text);
    
    if (text.length < 2) {
      setSearchResults([]);
      return;
    }

    const matchedResources = resources.filter(resource => 
      resource.name.toLowerCase().includes(text.toLowerCase()) ||
      resource.address.toLowerCase().includes(text.toLowerCase())
    ).map(resource => ({
      id: resource.id,
      name: resource.name,
      address: resource.address
    }));

    setSearchResults(matchedResources);
  };

  const handleSearchResultPress = (resourceId: string) => {
    const resource = resources.find(r => r.id === resourceId);
    if (resource) {
      handleSearchClose();
      showResourceDetail(resource);
    }
  };

  // 处理筛选
  const handleFilterPress = () => {
    setIsFilterOverlayVisible(true);
  };

  const handleFilterClose = () => {
    setIsFilterOverlayVisible(false);
  };

  const handleFilterReset = () => {
    setFilterClinic(true);
    setFilterRehab(true);
    setFilterDistance('5');
  };

  const handleFilterApply = () => {
    // 应用筛选条件的逻辑
    console.log('应用筛选条件:', { filterClinic, filterRehab, filterDistance });
    setIsFilterOverlayVisible(false);
  };

  // 处理地图标记点击
  const handleMarkerPress = (resourceId: string) => {
    const resource = resources.find(r => r.id === resourceId);
    if (resource) {
      showResourceDetail(resource);
    }
  };

  // 处理资源卡片点击
  const handleResourceCardPress = (resourceId: string) => {
    const resource = resources.find(r => r.id === resourceId);
    if (resource) {
      showResourceDetail(resource);
    }
  };

  // 处理电话拨打
  const handlePhonePress = (phone: string) => {
    Alert.alert(
      '拨打电话',
      `是否拨打 ${phone}？`,
      [
        { text: '取消', style: 'cancel' },
        { 
          text: '拨打', 
          onPress: () => {
            Linking.openURL(`tel:${phone}`);
          }
        }
      ]
    );
  };

  // 处理导航
  const handleNavigatePress = (address: string) => {
    Alert.alert(
      '导航前往',
      `是否导航至 ${address}？`,
      [
        { text: '取消', style: 'cancel' },
        { 
          text: '导航', 
          onPress: () => {
            Linking.openURL(`maps:0,0?q=${encodeURIComponent(address)}`);
          }
        }
      ]
    );
  };

  // 显示资源详情
  const showResourceDetail = (resource: Resource) => {
    setSelectedResource(resource);
    setIsDetailModalVisible(true);
  };

  // 隐藏资源详情
  const hideResourceDetail = () => {
    setIsDetailModalVisible(false);
    setSelectedResource(null);
  };

  // 切换资源列表展开/收起
  const toggleResourcesList = () => {
    setIsResourcesListExpanded(!isResourcesListExpanded);
  };

  // 地图缩放控制
  const handleZoomIn = () => {
    console.log('地图放大');
  };

  const handleZoomOut = () => {
    console.log('地图缩小');
  };

  // 渲染地图标记
  const renderMapMarker = (resource: Resource) => (
    <TouchableOpacity
      key={resource.id}
      style={[
        styles.mapMarker,
        {
          top: resource.markerPosition.top,
          left: resource.markerPosition.left,
        }
      ]}
      onPress={() => handleMarkerPress(resource.id)}
      activeOpacity={0.7}
    >
      <View style={[
        styles.markerContainer,
        {
          backgroundColor: resource.type === 'clinic' ? 'rgba(150, 159, 255, 0.2)' : 'rgba(52, 211, 153, 0.2)',
          borderColor: resource.color,
        }
      ]}>
        <FontAwesome6 
          name={resource.icon as any} 
          size={14} 
          color={resource.color} 
        />
      </View>
    </TouchableOpacity>
  );

  // 渲染资源卡片
  const renderResourceCard = (resource: Resource) => (
    <TouchableOpacity
      key={resource.id}
      style={styles.resourceCard}
      onPress={() => handleResourceCardPress(resource.id)}
      activeOpacity={0.7}
    >
      <View style={styles.resourceCardContent}>
        <View style={[
          styles.resourceIcon,
          {
            backgroundColor: resource.type === 'clinic' ? 'rgba(150, 159, 255, 0.2)' : 'rgba(52, 211, 153, 0.2)',
          }
        ]}>
          <FontAwesome6 
            name={resource.icon as any} 
            size={16} 
            color={resource.color} 
          />
        </View>
        <View style={styles.resourceInfo}>
          <Text style={styles.resourceName} numberOfLines={1}>
            {resource.name}
          </Text>
          <Text style={styles.resourceAddress} numberOfLines={2}>
            {resource.address}
          </Text>
          <View style={styles.resourceDetails}>
            <View style={styles.resourceMeta}>
              <View style={styles.metaItem}>
                <FontAwesome5 name="map-marker-alt" size={10} color="rgba(255, 255, 255, 0.5)" />
                <Text style={styles.metaText}>{resource.distance}</Text>
              </View>
              <View style={styles.metaItem}>
                <FontAwesome6 name="phone" size={10} color="rgba(255, 255, 255, 0.5)" />
                <Text style={styles.metaText}>{resource.phone}</Text>
              </View>
            </View>
            <View style={styles.resourceActions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handlePhonePress(resource.phone)}
                activeOpacity={0.7}
              >
                <FontAwesome6 name="phone" size={12} color="#969FFF" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleNavigatePress(resource.address)}
                activeOpacity={0.7}
              >
                <FontAwesome5 name="directions" size={12} color="#5147FF" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  // 渲染搜索结果
  const renderSearchResult = (result: SearchResult) => (
    <TouchableOpacity
      key={result.id}
      style={styles.searchResultItem}
      onPress={() => handleSearchResultPress(result.id)}
      activeOpacity={0.7}
    >
      <Text style={styles.searchResultName}>{result.name}</Text>
      <Text style={styles.searchResultAddress}>{result.address}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#0F0F23', '#1A1A3A', '#0F0F23']}
        style={styles.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        {/* 顶部导航栏 */}
        <View style={styles.header}>
          <View style={styles.navBar}>
            <TouchableOpacity
              style={styles.navButton}
              onPress={handleBackPress}
              activeOpacity={0.7}
            >
              <FontAwesome6 name="arrow-left" size={16} color="rgba(255, 255, 255, 0.7)" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>医疗资源地图</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.navButton}
                onPress={handleSearchPress}
                activeOpacity={0.7}
              >
                <FontAwesome5 name="search" size={16} color="rgba(255, 255, 255, 0.7)" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.navButton}
                onPress={handleFilterPress}
                activeOpacity={0.7}
              >
                <FontAwesome6 name="filter" size={16} color="rgba(255, 255, 255, 0.7)" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* 地图区域 */}
          <View style={styles.mapSection}>
            <View style={styles.mapContainer}>
              {/* 地图背景装饰 */}
              <View style={styles.mapDecorations}>
                <View style={[styles.decorationDot, { top: 16, left: 16, width: 8, height: 8, backgroundColor: '#969FFF' }]} />
                <View style={[styles.decorationDot, { top: 32, right: 32, width: 4, height: 4, backgroundColor: '#5147FF' }]} />
                <View style={[styles.decorationDot, { bottom: 24, left: 32, width: 6, height: 6, backgroundColor: '#3E3987' }]} />
                <View style={[styles.decorationDot, { bottom: 48, right: 24, width: 4, height: 4, backgroundColor: '#969FFF' }]} />
                <View style={[styles.decorationDot, { top: 64, left: 48, width: 4, height: 4, backgroundColor: '#5147FF' }]} />
              </View>
              
              {/* 地图标记点 */}
              {resources.map(renderMapMarker)}
              
              {/* 地图控制按钮 */}
              <View style={styles.mapControls}>
                <TouchableOpacity
                  style={styles.mapControlButton}
                  onPress={handleZoomIn}
                  activeOpacity={0.7}
                >
                  <FontAwesome6 name="plus" size={12} color="rgba(255, 255, 255, 0.7)" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.mapControlButton}
                  onPress={handleZoomOut}
                  activeOpacity={0.7}
                >
                  <FontAwesome6 name="minus" size={12} color="rgba(255, 255, 255, 0.7)" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* 资源列表 */}
          <View style={styles.resourcesSection}>
            <View style={styles.resourcesHeader}>
              <Text style={styles.resourcesTitle}>附近资源</Text>
              <TouchableOpacity
                style={styles.listToggle}
                onPress={toggleResourcesList}
                activeOpacity={0.7}
              >
                <FontAwesome6 
                  name={isResourcesListExpanded ? "chevron-down" : "chevron-up"} 
                  size={12} 
                  color="rgba(255, 255, 255, 0.7)" 
                />
                <Text style={styles.listToggleText}>
                  {isResourcesListExpanded ? '收起' : '展开'}
                </Text>
              </TouchableOpacity>
            </View>
            
            {isResourcesListExpanded && (
              <View style={styles.resourcesList}>
                {resources.map(renderResourceCard)}
              </View>
            )}
          </View>
        </ScrollView>

        {/* 搜索覆盖层 */}
        <Modal
          visible={isSearchOverlayVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={handleSearchClose}
        >
          <View style={styles.searchOverlay}>
            <View style={styles.searchContent}>
              <View style={styles.searchHeader}>
                <TouchableOpacity
                  style={styles.searchCloseButton}
                  onPress={handleSearchClose}
                  activeOpacity={0.7}
                >
                  <FontAwesome5 name="times" size={14} color="rgba(255, 255, 255, 0.7)" />
                </TouchableOpacity>
                <TextInput
                  ref={searchInputRef}
                  style={styles.searchInput}
                  placeholder="搜索城市或机构名称"
                  placeholderTextColor="rgba(255, 255, 255, 0.5)"
                  value={searchQuery}
                  onChangeText={handleSearchInputChange}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.searchResults}>
                {searchResults.length > 0 ? (
                  searchResults.map(renderSearchResult)
                ) : searchQuery.length >= 2 ? (
                  <Text style={styles.noResultsText}>未找到相关资源</Text>
                ) : null}
              </View>
            </View>
          </View>
        </Modal>

        {/* 筛选覆盖层 */}
        <Modal
          visible={isFilterOverlayVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={handleFilterClose}
        >
          <View style={styles.filterOverlay}>
            <View style={styles.filterContent}>
              <View style={styles.filterHeader}>
                <TouchableOpacity
                  style={styles.filterCloseButton}
                  onPress={handleFilterClose}
                  activeOpacity={0.7}
                >
                  <FontAwesome5 name="times" size={14} color="rgba(255, 255, 255, 0.7)" />
                </TouchableOpacity>
                <Text style={styles.filterTitle}>筛选条件</Text>
              </View>
              
              {/* 资源类型筛选 */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>资源类型</Text>
                <View style={styles.filterOptions}>
                  <TouchableOpacity
                    style={styles.filterOption}
                    onPress={() => setFilterClinic(!filterClinic)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, filterClinic && styles.checkboxChecked]}>
                      {filterClinic && (
                        <FontAwesome6 name="check" size={10} color="#FFFFFF" />
                      )}
                    </View>
                    <Text style={styles.filterOptionText}>FSHD诊疗中心</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.filterOption}
                    onPress={() => setFilterRehab(!filterRehab)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, filterRehab && styles.checkboxChecked]}>
                      {filterRehab && (
                        <FontAwesome6 name="check" size={10} color="#FFFFFF" />
                      )}
                    </View>
                    <Text style={styles.filterOptionText}>康复机构</Text>
                  </TouchableOpacity>
                </View>
              </View>
              
              {/* 距离筛选 */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>距离范围</Text>
                <View style={styles.filterOptions}>
                  {['5', '10', '20', '50'].map((distance) => (
                    <TouchableOpacity
                      key={distance}
                      style={styles.filterOption}
                      onPress={() => setFilterDistance(distance)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.radio, filterDistance === distance && styles.radioChecked]}>
                        {filterDistance === distance && (
                          <View style={styles.radioInner} />
                        )}
                      </View>
                      <Text style={styles.filterOptionText}>{distance}公里内</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              
              <View style={styles.filterActions}>
                <TouchableOpacity
                  style={styles.filterResetButton}
                  onPress={handleFilterReset}
                  activeOpacity={0.7}
                >
                  <Text style={styles.filterResetText}>重置</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.filterApplyButton}
                  onPress={handleFilterApply}
                  activeOpacity={0.7}
                >
                  <Text style={styles.filterApplyText}>应用筛选</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* 资源详情弹窗 */}
        <Modal
          visible={isDetailModalVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={hideResourceDetail}
        >
          <View style={styles.detailModal}>
            <View style={styles.detailContent}>
              {/* 拖拽指示器 */}
              <View style={styles.dragIndicator} />
              
              {/* 详情内容 */}
              {selectedResource && (
                <View style={styles.detailBody}>
                  <View style={styles.detailHeader}>
                    <View style={[
                      styles.detailIcon,
                      {
                        backgroundColor: selectedResource.type === 'clinic' ? 'rgba(150, 159, 255, 0.2)' : 'rgba(52, 211, 153, 0.2)',
                      }
                    ]}>
                      <FontAwesome6 
                        name={selectedResource.icon as any} 
                        size={18} 
                        color={selectedResource.color} 
                      />
                    </View>
                    <View style={styles.detailTitleContainer}>
                      <Text style={styles.detailTitle}>{selectedResource.name}</Text>
                      <Text style={styles.detailType}>
                        {selectedResource.type === 'clinic' ? 'FSHD诊疗中心' : '康复机构'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.detailCloseButton}
                      onPress={hideResourceDetail}
                      activeOpacity={0.7}
                    >
                      <FontAwesome5 name="times" size={14} color="rgba(255, 255, 255, 0.7)" />
                    </TouchableOpacity>
                  </View>
                  
                  <View style={styles.detailInfo}>
                    <View style={styles.detailInfoItem}>
                      <FontAwesome5 name="map-marker-alt" size={14} color="rgba(255, 255, 255, 0.5)" style={styles.detailInfoIcon} />
                      <View style={styles.detailInfoContent}>
                        <Text style={styles.detailInfoLabel}>地址</Text>
                        <Text style={styles.detailInfoValue}>{selectedResource.address}</Text>
                      </View>
                    </View>
                    
                    <View style={styles.detailInfoItem}>
                      <FontAwesome6 name="phone" size={14} color="rgba(255, 255, 255, 0.5)" style={styles.detailInfoIcon} />
                      <View style={styles.detailInfoContent}>
                        <Text style={styles.detailInfoLabel}>联系电话</Text>
                        <Text style={styles.detailInfoValue}>{selectedResource.phone}</Text>
                      </View>
                    </View>
                    
                    <View style={styles.detailInfoItem}>
                      <FontAwesome6 name="clock" size={14} color="rgba(255, 255, 255, 0.5)" style={styles.detailInfoIcon} />
                      <View style={styles.detailInfoContent}>
                        <Text style={styles.detailInfoLabel}>门诊时间</Text>
                        <Text style={styles.detailInfoValue}>{selectedResource.hours}</Text>
                      </View>
                    </View>
                    
                    <View style={styles.detailInfoItem}>
                      <FontAwesome6 name="star" size={14} color="rgba(255, 255, 255, 0.5)" style={styles.detailInfoIcon} />
                      <View style={styles.detailInfoContent}>
                        <Text style={styles.detailInfoLabel}>特色服务</Text>
                        <Text style={styles.detailInfoValue}>{selectedResource.services}</Text>
                      </View>
                    </View>
                    
                    <View style={styles.detailInfoItem}>
                      <FontAwesome5 name="info-circle" size={14} color="rgba(255, 255, 255, 0.5)" style={styles.detailInfoIcon} />
                      <View style={styles.detailInfoContent}>
                        <Text style={styles.detailInfoLabel}>挂号信息</Text>
                        <Text style={styles.detailInfoValue}>{selectedResource.registration}</Text>
                      </View>
                    </View>
                  </View>
                  
                  <View style={styles.detailActions}>
                    <TouchableOpacity
                      style={styles.detailPhoneButton}
                      onPress={() => handlePhonePress(selectedResource.phone)}
                      activeOpacity={0.7}
                    >
                      <FontAwesome6 name="phone" size={16} color="#FFFFFF" />
                      <Text style={styles.detailActionText}>拨打电话</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.detailNavigateButton}
                      onPress={() => handleNavigatePress(selectedResource.address)}
                      activeOpacity={0.7}
                    >
                      <FontAwesome5 name="directions" size={16} color="#FFFFFF" />
                      <Text style={styles.detailActionText}>导航前往</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </View>
        </Modal>
      </LinearGradient>
    </SafeAreaView>
  );
};

export default ResourceMapScreen;

