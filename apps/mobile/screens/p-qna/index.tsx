import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import styles from './styles';

interface HotQuestion {
  id: string;
  question: string;
  answer: string;
}

interface KnowledgeCategory {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
}

interface LocalResource {
  id: string;
  name: string;
  distance: string;
  description: string;
  rating: string;
  type: string;
  icon: string;
  color: string;
}

interface ClinicalPathway {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
}

type AIMessageRole = 'user' | 'assistant';

interface AIMessage {
  id: string;
  role: AIMessageRole;
  content: string;
}

// 可抽到 env / config，这里先写死
const API_BASE_URL = 'http://10.203.16.157:4000';

const P_QNA: React.FC = () => {
  const router = useRouter();
  const searchInputRef = useRef<TextInput | null>(null);

  // 搜索相关
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [showSearchResult, setShowSearchResult] = useState(false);
  const [searchResultAnswer, setSearchResultAnswer] = useState('');

  // AI 聊天相关
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);

  const hotQuestions: HotQuestion[] = [
    {
      id: '1',
      question: 'FSHD患者如何进行家庭康复训练？',
      answer:
        'FSHD患者的家庭康复训练应遵循个体化原则，重点包括：\n\n1. 肌力训练：使用弹力带进行抗阻训练，重点训练肩带肌、上臂肌和下肢肌群\n2. 关节活动度训练：每日进行关节的全范围活动，预防关节挛缩\n3. 呼吸训练：腹式呼吸和深呼吸练习，改善呼吸功能\n4. 平衡训练：单腿站立、足跟走等练习，预防跌倒\n\n建议在专业康复师指导下制定训练计划，避免过度疲劳。',
    },
    {
      id: '2',
      question: 'FSHD的遗传方式是什么？',
      answer:
        'FSHD主要有两种遗传方式：\n\n1. FSHD1型（占95%）：常染色体显性遗传，由4号染色体长臂（4q35）上的D4Z4重复序列缺失引起\n2. FSHD2型（占5%）：常染色体显性遗传，由SMCHD1基因突变引起\n\n患者子女有50%的概率遗传该疾病，但临床表现可能存在差异。建议进行遗传咨询和基因检测。',
    },
    {
      id: '3',
      question: 'FSHD患者可以参加哪些运动？',
      answer:
        'FSHD患者适合的运动包括：\n\n✅ 推荐：游泳、水中运动、太极拳、瑜伽、散步\n⚠️ 谨慎：慢跑、骑自行车（需注意安全）\n❌ 避免：高强度力量训练、剧烈运动、举重\n\n运动时应注意：\n• 避免过度疲劳和肌肉疼痛\n• 运动前后充分热身和拉伸\n• 如有不适立即停止\n• 最好在专业指导下进行',
    },
  ];

  const knowledgeCategories: KnowledgeCategory[] = [
    {
      id: '1',
      title: '分型鉴别',
      description: 'FSHD1型与2型的区别',
      icon: 'dna',
      color: '#969FFF',
    },
    {
      id: '2',
      title: '症状管理',
      description: '肌肉无力、疼痛处理',
      icon: 'stethoscope',
      color: '#5147FF',
    },
    {
      id: '3',
      title: '遗传咨询',
      description: '家族遗传风险评估',
      icon: 'users',
      color: '#3E3987',
    },
    {
      id: '4',
      title: '用药指导',
      description: '药物使用注意事项',
      icon: 'pills',
      color: '#10B981',
    },
  ];

  const localResources: LocalResource[] = [
    {
      id: '1',
      name: '华西医院FSHD诊疗中心',
      distance: '距离您 2.3 公里',
      description: '专业FSHD诊断与治疗',
      rating: '⭐ 4.8',
      type: '三甲医院',
      icon: 'hospital',
      color: '#969FFF',
    },
    {
      id: '2',
      name: '康复之家理疗中心',
      distance: '距离您 1.8 公里',
      description: '专业康复训练指导',
      rating: '⭐ 4.6',
      type: '医保定点',
      icon: 'heartbeat',
      color: '#5147FF',
    },
  ];

  const clinicalPathways: ClinicalPathway[] = [
    {
      id: '1',
      title: '初诊检查流程',
      description: '标准化诊断检查项目',
      icon: 'clipboard-list',
      color: '#3B82F6',
    },
    {
      id: '2',
      title: '随访管理计划',
      description: '定期复查与评估安排',
      icon: 'calendar-check',
      color: '#8B5CF6',
    },
    {
      id: '3',
      title: '康复治疗指南',
      description: '个性化康复训练方案',
      icon: 'dumbbell',
      color: '#F97316',
    },
  ];

  const handleSearchPress = async () => {
    if (!searchQuery.trim()) return;

    setIsSearchLoading(true);

    // 模拟 API 调用
    setTimeout(() => {
      setIsSearchLoading(false);
      setShowSearchResult(true);
      setSearchResultAnswer(
        `感谢您的问题："${searchQuery}"\n\n这是一个很好的问题。根据FSHD专业知识库，建议您：\n1. 咨询专业医生获取个性化建议\n2. 参考相关的临床路径和指南\n3. 可以在患者社区中寻求其他患者的经验分享`,
      );

      // 清空搜索框并失去焦点
      setSearchQuery('');
      searchInputRef.current?.blur();
    }, 1500);
  };

  const handleQuestionToggle = (questionId: string) => {
    setExpandedQuestionId((prev) => (prev === questionId ? null : questionId));
  };

  const handleKnowledgeCategoryPress = (category: KnowledgeCategory) => {
    Alert.alert('知识分类', `正在加载"${category.title}"相关知识...`);
  };

  const handleResourcePress = () => {
    router.push('/p-resource_map');
  };

  const handleViewAllResourcesPress = () => {
    router.push('/p-resource_map');
  };

  const handleClinicalPathwayPress = (pathway: ClinicalPathway) => {
    Alert.alert('临床路径', `正在加载"${pathway.title}"详细内容...`);
  };

  // AI 聊天发送函数
  const sendAIMessage = async () => {
    if (!aiInput.trim()) return;

    setAiLoading(true);

    const userMessage: AIMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: aiInput,
    };

    setAiMessages((prev) => [...prev, userMessage]);

    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: aiInput }),
      });

      const data = await response.json();

      if (data.success) {
        const aiMessage: AIMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.data.answer,
        };
        setAiMessages((prev) => [...prev, aiMessage]);
      } else {
        const errorMessage: AIMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '抱歉，AI 服务暂时不可用。',
        };
        setAiMessages((prev) => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error('AI 聊天错误:', error);
      const errorMessage: AIMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '抱歉，出现错误，请稍后重试。',
      };
      setAiMessages((prev) => [...prev, errorMessage]);
    } finally {
      setAiLoading(false);
      setAiInput('');
    }
  };

  const renderSearchResult = () => {
    if (!showSearchResult) return null;

    return (
      <View style={styles.searchResultContainer}>
        <View style={styles.searchResultCard}>
          <View style={styles.searchResultHeader}>
            <View style={styles.searchResultIcon}>
              <FontAwesome6 name="robot" size={12} color="#969FFF" />
            </View>
            <View style={styles.searchResultContent}>
              <Text style={styles.searchResultTitle}>智能回答</Text>
              <Text style={styles.searchResultAnswer}>{searchResultAnswer}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  const renderHotQuestions = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>热门问题</Text>
      <View style={styles.hotQuestionsList}>
        {hotQuestions.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.questionItem}
            onPress={() => handleQuestionToggle(item.id)}
            activeOpacity={0.7}
          >
            <View style={styles.questionHeader}>
              <Text style={styles.questionText}>{item.question}</Text>
              <FontAwesome6
                name="chevron-down"
                size={10}
                color="rgba(255, 255, 255, 0.5)"
                style={[
                  styles.chevronIcon,
                  expandedQuestionId === item.id && styles.chevronIconExpanded,
                ]}
              />
            </View>
            {expandedQuestionId === item.id && (
              <View style={styles.answerPanel}>
                <Text style={styles.answerText}>{item.answer}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderKnowledgeCategories = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>知识分类</Text>
      <View style={styles.knowledgeGrid}>
        {knowledgeCategories.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.knowledgeItem}
            onPress={() => handleKnowledgeCategoryPress(item)}
            activeOpacity={0.7}
          >
            <View style={styles.knowledgeHeader}>
              <View style={[styles.knowledgeIcon, { backgroundColor: `${item.color}20` }]}>
                <FontAwesome6 name={item.icon} size={12} color={item.color} />
              </View>
              <Text style={styles.knowledgeTitle}>{item.title}</Text>
            </View>
            <Text style={styles.knowledgeDescription}>{item.description}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderLocalResources = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>附近资源</Text>
        <TouchableOpacity onPress={handleViewAllResourcesPress} activeOpacity={0.7}>
          <Text style={styles.viewAllButton}>查看全部</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.resourcesList}>
        {localResources.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.resourceCard}
            onPress={handleResourcePress}
            activeOpacity={0.7}
          >
            <View style={styles.resourceContent}>
              <View style={[styles.resourceIcon, { backgroundColor: `${item.color}20` }]}>
                <FontAwesome6 name={item.icon} size={12} color={item.color} />
              </View>
              <View style={styles.resourceInfo}>
                <Text style={styles.resourceName}>{item.name}</Text>
                <Text style={styles.resourceDistance}>{item.distance}</Text>
                <Text style={styles.resourceDescription}>{item.description}</Text>
              </View>
              <View style={styles.resourceRating}>
                <Text style={styles.resourceRatingText}>{item.rating}</Text>
                <Text style={styles.resourceType}>{item.type}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderClinicalPathways = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>临床路径</Text>
      <View style={styles.pathwaysList}>
        {clinicalPathways.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.pathwayItem}
            onPress={() => handleClinicalPathwayPress(item)}
            activeOpacity={0.7}
          >
            <View style={styles.pathwayContent}>
              <View style={[styles.pathwayIcon, { backgroundColor: `${item.color}20` }]}>
                <FontAwesome6 name={item.icon} size={12} color={item.color} />
              </View>
              <View style={styles.pathwayInfo}>
                <Text style={styles.pathwayTitle}>{item.title}</Text>
                <Text style={styles.pathwayDescription}>{item.description}</Text>
              </View>
            </View>
            <FontAwesome6 name="chevron-right" size={10} color="rgba(255, 255, 255, 0.5)" />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* 顶部搜索区域 */}
        <View style={styles.header}>
          <View style={styles.searchContainer}>
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder="请输入您的问题..."
              placeholderTextColor="rgba(255, 255, 255, 0.5)"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearchPress}
              returnKeyType="search"
            />
            <TouchableOpacity
              style={styles.searchButton}
              onPress={handleSearchPress}
              activeOpacity={0.7}
              disabled={isSearchLoading}
            >
              <FontAwesome6
                name={isSearchLoading ? 'spinner' : 'magnifying-glass'}
                size={14}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 搜索结果 */}
          {renderSearchResult()}

          {/* AI 智能助手 */}
          <View style={styles.aiSection}>
            <View style={styles.aiHeader}>
              <Text style={styles.aiTitle}>FSHD AI 智能助手</Text>
              <TouchableOpacity
                onPress={() => setShowAIChat((prev) => !prev)}
                style={styles.aiToggleButton}
              >
                <FontAwesome6
                  name={showAIChat ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color="#969FFF"
                />
                <Text style={styles.aiToggleText}>{showAIChat ? '收起' : '展开'} AI 助手</Text>
              </TouchableOpacity>
            </View>

            {showAIChat && (
              <View style={styles.aiChatContainer}>
                {/* AI 聊天消息列表 */}
                <ScrollView style={styles.aiMessagesList}>
                  {aiMessages.length === 0 ? (
                    <View style={styles.aiWelcome}>
                      <Text style={styles.aiWelcomeText}>
                        👋 你好！我是FSHD医疗助手，可以解答关于面肩肱型肌营养不良症的任何问题。
                      </Text>
                    </View>
                  ) : (
                    aiMessages.map((message) => (
                      <View
                        key={message.id}
                        style={[
                          styles.aiMessageContainer,
                          message.role === 'user'
                            ? styles.aiUserMessage
                            : styles.aiAssistantMessage,
                        ]}
                      >
                        <View
                          style={[
                            styles.aiAvatar,
                            message.role === 'user'
                              ? styles.aiUserAvatar
                              : styles.aiAssistantAvatar,
                          ]}
                        >
                          <Text style={styles.aiAvatarText}>
                            {message.role === 'user' ? '👤' : '🤖'}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.aiMessageBubble,
                            message.role === 'user'
                              ? styles.aiUserBubble
                              : styles.aiAssistantBubble,
                          ]}
                        >
                          <Text
                            style={[
                              styles.aiMessageText,
                              message.role === 'user' ? styles.aiUserText : styles.aiAssistantText,
                            ]}
                          >
                            {message.content}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}
                  {aiLoading && (
                    <View style={[styles.aiMessageContainer, styles.aiAssistantMessage]}>
                      <View style={[styles.aiAvatar, styles.aiAssistantAvatar]}>
                        <Text style={styles.aiAvatarText}>🤖</Text>
                      </View>
                      <View style={[styles.aiMessageBubble, styles.aiAssistantBubble]}>
                        <Text style={styles.aiTypingText}>AI 正在思考...</Text>
                      </View>
                    </View>
                  )}
                </ScrollView>

                {/* AI 聊天输入框 */}
                <View style={styles.aiInputContainer}>
                  <TextInput
                    style={styles.aiTextInput}
                    value={aiInput}
                    onChangeText={setAiInput}
                    placeholder="输入关于FSHD的问题..."
                    placeholderTextColor="#999"
                    multiline
                    editable={!aiLoading}
                  />
                  <TouchableOpacity
                    style={[
                      styles.aiSendButton,
                      (aiLoading || !aiInput.trim()) && styles.aiSendButtonDisabled,
                    ]}
                    onPress={sendAIMessage}
                    disabled={aiLoading || !aiInput.trim()}
                  >
                    <FontAwesome6 name="paper-plane" size={14} color="white" />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* 热门问题 */}
          {renderHotQuestions()}

          {/* 知识分类 */}
          {renderKnowledgeCategories()}

          {/* 附近资源 */}
          {renderLocalResources()}

          {/* 临床路径 */}
          {renderClinicalPathways()}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default P_QNA;
