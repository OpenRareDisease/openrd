

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Image, RefreshControl, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';

interface PostData {
  id: string;
  authorName: string;
  authorAvatar: string;
  timeAgo: string;
  category: string;
  categoryColor: string;
  content: string;
  likes: number;
  comments: number;
  shares: number;
  tags?: string[];
}

interface ForumSection {
  id: string;
  title: string;
  description: string;
  icon: string;
  iconColor: string;
  iconBgColor: string;
  onlineCount: number;
  postCount: number;
}

const CommunityScreen = () => {
  const router = useRouter();
  const [isPublishModalVisible, setIsPublishModalVisible] = useState(false);
  const [isPostDetailModalVisible, setIsPostDetailModalVisible] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const forumSections: ForumSection[] = [
    {
      id: 'newbie',
      title: '新手村',
      description: '初诊1年内患者交流区',
      icon: 'seedling',
      iconColor: '#60A5FA',
      iconBgColor: 'rgba(96, 165, 250, 0.2)',
      onlineCount: 23,
      postCount: 156,
    },
    {
      id: 'rehab',
      title: '肌力加油站',
      description: '康复训练经验分享',
      icon: 'dumbbell',
      iconColor: '#4ADE80',
      iconBgColor: 'rgba(74, 222, 128, 0.2)',
      onlineCount: 45,
      postCount: 328,
    },
    {
      id: 'trial',
      title: '临床试验广场',
      description: '试验信息与入组交流',
      icon: 'flask',
      iconColor: '#A78BFA',
      iconBgColor: 'rgba(167, 139, 250, 0.2)',
      onlineCount: 18,
      postCount: 89,
    },
  ];

  const hotPosts: PostData[] = [
    {
      id: 'post-1',
      authorName: '李患者',
      authorAvatar: 'https://s.coze.cn/image/RIH2imuygWw/',
      timeAgo: '2小时前',
      category: '新手村',
      categoryColor: '#60A5FA',
      content: '刚确诊FSHD，心情很复杂，想问问大家都是怎么调整心态的？',
      likes: 12,
      comments: 8,
      shares: 2,
    },
    {
      id: 'post-2',
      authorName: '王康复师',
      authorAvatar: 'https://s.coze.cn/image/E6aqkM__vV0/',
      timeAgo: '4小时前',
      category: '肌力加油站',
      categoryColor: '#4ADE80',
      content: '分享一个简单有效的肩部训练方法，亲测对FSHD患者很有帮助',
      likes: 25,
      comments: 15,
      shares: 6,
      tags: ['认证康复师'],
    },
    {
      id: 'post-3',
      authorName: '张患者',
      authorAvatar: 'https://s.coze.cn/image/P4QZGW_USfY/',
      timeAgo: '6小时前',
      category: '临床试验广场',
      categoryColor: '#A78BFA',
      content: '有人参加过基因治疗的临床试验吗？想了解一下具体情况',
      likes: 18,
      comments: 11,
      shares: 3,
    },
  ];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // 模拟刷新数据
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1000);
  };

  const handlePublishPress = () => {
    setIsPublishModalVisible(true);
  };

  const handleClosePublishModal = () => {
    setIsPublishModalVisible(false);
  };

  const handlePublishTextPost = () => {
    setIsPublishModalVisible(false);
    // TODO: 实现文字帖子发布功能
    console.log('发布文字帖子');
  };

  const handlePublishVideoPost = () => {
    setIsPublishModalVisible(false);
    router.push('/p-rehab_share');
  };

  const handleForumSectionPress = (sectionId: string) => {
    if (sectionId === 'trial') {
      router.push('/p-trial_square');
    } else {
      console.log('进入专区:', sectionId);
      // TODO: 实现其他专区的导航
    }
  };

  const handleQuickAccessPress = (type: string) => {
    if (type === 'expert') {
      router.push('/p-expert_consult');
    } else if (type === 'resource') {
      router.push('/p-resource_map');
    }
  };

  const handlePostPress = (postId: string) => {
    setSelectedPostId(postId);
    setIsPostDetailModalVisible(true);
  };

  const handleClosePostDetail = () => {
    setIsPostDetailModalVisible(false);
    setSelectedPostId('');
  };

  const handleViewAllPosts = () => {
    console.log('查看全部帖子');
    // TODO: 实现查看全部帖子功能
  };

  const getSelectedPost = (): PostData | undefined => {
    return hotPosts.find(post => post.id === selectedPostId);
  };

  const renderForumSection = (section: ForumSection) => (
    <TouchableOpacity
      key={section.id}
      style={styles.forumCard}
      onPress={() => handleForumSectionPress(section.id)}
      activeOpacity={0.7}
    >
      <View style={styles.forumCardContent}>
        <View style={styles.forumCardLeft}>
          <View style={[styles.forumIconContainer, { backgroundColor: section.iconBgColor }]}>
            <FontAwesome6 name={section.icon} size={14} color={section.iconColor} />
          </View>
          <View style={styles.forumTextContainer}>
            <Text style={styles.forumTitle}>{section.title}</Text>
            <Text style={styles.forumDescription}>{section.description}</Text>
            <View style={styles.forumStatsContainer}>
              <View style={styles.onlineIndicator}>
                <View style={styles.onlineDot} />
                <Text style={styles.onlineText}>{section.onlineCount}人在线</Text>
              </View>
              <Text style={styles.statsSeparator}>·</Text>
              <Text style={styles.postCountText}>{section.postCount}个帖子</Text>
            </View>
          </View>
        </View>
        <FontAwesome6 name="chevron-right" size={12} color="rgba(255, 255, 255, 0.5)" />
      </View>
    </TouchableOpacity>
  );

  const renderPost = (post: PostData) => (
    <TouchableOpacity
      key={post.id}
      style={styles.postCard}
      onPress={() => handlePostPress(post.id)}
      activeOpacity={0.7}
    >
      <View style={styles.postContent}>
        <Image source={{ uri: post.authorAvatar }} style={styles.postAvatar} />
        <View style={styles.postTextContainer}>
          <View style={styles.postHeader}>
            <Text style={styles.postAuthor}>{post.authorName}</Text>
            <Text style={styles.postTime}>{post.timeAgo}</Text>
            <View style={[styles.postCategoryTag, { backgroundColor: `${post.categoryColor}33` }]}>
              <Text style={[styles.postCategoryText, { color: post.categoryColor }]}>
                {post.category}
              </Text>
            </View>
            {post.tags?.map((tag, index) => (
              <View key={index} style={styles.postSpecialTag}>
                <Text style={styles.postSpecialTagText}>{tag}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.postContentText}>{post.content}</Text>
          <View style={styles.postStats}>
            <View style={styles.postStatItem}>
              <FontAwesome6 name="heart" size={12} color="rgba(255, 255, 255, 0.5)" />
              <Text style={styles.postStatText}>{post.likes}</Text>
            </View>
            <View style={styles.postStatItem}>
              <FontAwesome6 name="comment" size={12} color="rgba(255, 255, 255, 0.5)" />
              <Text style={styles.postStatText}>{post.comments}</Text>
            </View>
            <View style={styles.postStatItem}>
              <FontAwesome6 name="share" size={12} color="rgba(255, 255, 255, 0.5)" />
              <Text style={styles.postStatText}>{post.shares}</Text>
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderPostDetail = () => {
    const post = getSelectedPost();
    if (!post) return null;

    return (
      <View style={styles.postDetailContent}>
        <View style={styles.postDetailHeader}>
          <Image source={{ uri: post.authorAvatar }} style={styles.postDetailAvatar} />
          <View style={styles.postDetailHeaderText}>
            <View style={styles.postDetailHeaderTop}>
              <Text style={styles.postDetailAuthor}>{post.authorName}</Text>
              <Text style={styles.postDetailTime}>{post.timeAgo}</Text>
              <View style={[styles.postDetailCategoryTag, { backgroundColor: `${post.categoryColor}33` }]}>
                <Text style={[styles.postDetailCategoryText, { color: post.categoryColor }]}>
                  {post.category}
                </Text>
              </View>
            </View>
            <Text style={styles.postDetailContentText}>
              {post.id === 'post-1' && '刚确诊FSHD，心情很复杂，想问问大家都是怎么调整心态的？最近总是担心病情会越来越严重，影响工作和生活。希望能得到一些建议和鼓励。'}
              {post.id === 'post-2' && '分享一个简单有效的肩部训练方法：\n\n1. 站立位，双臂自然下垂\n2. 缓慢将双臂向前抬起至肩膀高度\n3. 保持2秒后缓慢放下\n4. 每组10次，每天3组\n\n这个动作对FSHD患者的肩部肌力提升很有帮助，大家可以试试。'}
              {post.id === 'post-3' && '有人参加过基因治疗的临床试验吗？想了解一下具体情况，比如治疗效果、副作用、入组条件等。我的基因检测结果是FSHD1型，不知道是否符合条件。'}
            </Text>
          </View>
        </View>
        
        {post.id === 'post-1' && (
          <View style={styles.postDetailReplies}>
            <Text style={styles.postDetailRepliesTitle}>8条回复</Text>
            <View style={styles.postDetailReply}>
              <Image 
                source={{ uri: 'https://s.coze.cn/image/V9zp9IxDjus/' }} 
                style={styles.postDetailReplyAvatar} 
              />
              <View style={styles.postDetailReplyContent}>
                <View style={styles.postDetailReplyHeader}>
                  <Text style={styles.postDetailReplyAuthor}>王患者</Text>
                  <Text style={styles.postDetailReplyTime}>1小时前</Text>
                </View>
                <Text style={styles.postDetailReplyText}>
                  我刚确诊的时候也很焦虑，建议多了解疾病知识，和医生保持沟通，积极进行康复训练。
                </Text>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <LinearGradient colors={['#0F0F23', '#1A1A3A', '#0F0F23']} style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
          }
        >
          {/* 顶部导航栏 */}
          <View style={styles.header}>
            <Text style={styles.pageTitle}>患者社区</Text>
            <TouchableOpacity
              style={styles.publishButton}
              onPress={handlePublishPress}
              activeOpacity={0.7}
            >
              <FontAwesome6 name="plus" size={18} color="rgba(255, 255, 255, 0.7)" />
            </TouchableOpacity>
          </View>

          {/* 社区专区 */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>交流专区</Text>
            <View style={styles.sectionsContainer}>
              {forumSections.map(renderForumSection)}
            </View>
          </View>

          {/* 快捷入口 */}
          <View style={styles.section}>
            <View style={styles.quickAccessGrid}>
              <TouchableOpacity
                style={styles.quickAccessCard}
                onPress={() => handleQuickAccessPress('expert')}
                activeOpacity={0.7}
              >
                <View style={styles.quickAccessIconContainer}>
                  <FontAwesome6 name="user-doctor" size={12} color="#FBBF24" />
                </View>
                <Text style={styles.quickAccessTitle}>专家咨询</Text>
                <Text style={styles.quickAccessDescription}>在线咨询专科医生</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.quickAccessCard}
                onPress={() => handleQuickAccessPress('resource')}
                activeOpacity={0.7}
              >
                <View style={styles.quickAccessIconContainer}>
                  <FontAwesome6 name="location-dot" size={12} color="#F59E0B" />
                </View>
                <Text style={styles.quickAccessTitle}>资源地图</Text>
                <Text style={styles.quickAccessDescription}>查找医疗资源</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 热门帖子 */}
          <View style={styles.section}>
            <View style={styles.postsHeader}>
              <Text style={styles.sectionTitle}>热门话题</Text>
              <TouchableOpacity onPress={handleViewAllPosts} activeOpacity={0.7}>
                <Text style={styles.viewAllText}>查看全部</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.postsContainer}>
              {hotPosts.map(renderPost)}
            </View>
          </View>
        </ScrollView>

        {/* 发布内容弹窗 */}
        <Modal
          visible={isPublishModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={handleClosePublishModal}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.publishModalContainer}>
              <View style={styles.publishModalContent}>
                <Text style={styles.publishModalTitle}>选择发布类型</Text>
                <View style={styles.publishOptionsContainer}>
                  <TouchableOpacity
                    style={styles.publishOption}
                    onPress={handlePublishTextPost}
                    activeOpacity={0.7}
                  >
                    <View style={styles.publishOptionContent}>
                      <View style={styles.publishOptionIconContainer}>
                        <FontAwesome6 name="pen-to-square" size={14} color="#60A5FA" />
                      </View>
                      <View style={styles.publishOptionTextContainer}>
                        <Text style={styles.publishOptionTitle}>文字帖子</Text>
                        <Text style={styles.publishOptionDescription}>分享经验、提问或讨论</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={styles.publishOption}
                    onPress={handlePublishVideoPost}
                    activeOpacity={0.7}
                  >
                    <View style={styles.publishOptionContent}>
                      <View style={styles.publishOptionIconContainer}>
                        <FontAwesome6 name="video" size={14} color="#4ADE80" />
                      </View>
                      <View style={styles.publishOptionTextContainer}>
                        <Text style={styles.publishOptionTitle}>康复视频</Text>
                        <Text style={styles.publishOptionDescription}>分享训练视频和经验</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={handleClosePublishModal}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelButtonText}>取消</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* 帖子详情弹窗 */}
        <Modal
          visible={isPostDetailModalVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={handleClosePostDetail}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.postDetailModalContainer}>
              <View style={styles.postDetailModalContent}>
                <View style={styles.postDetailModalHeader}>
                  <Text style={styles.postDetailModalTitle}>帖子详情</Text>
                  <TouchableOpacity
                    onPress={handleClosePostDetail}
                    activeOpacity={0.7}
                  >
                    <FontAwesome6 name="xmark" size={16} color="rgba(255, 255, 255, 0.5)" />
                  </TouchableOpacity>
                </View>
                {renderPostDetail()}
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
};

export default CommunityScreen;

