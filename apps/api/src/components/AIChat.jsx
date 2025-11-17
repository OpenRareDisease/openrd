import { useState } from 'react';
import './AIChat.css';

export function AIChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim()) return;

    setLoading(true);
    const userMessage = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: input }),
      });

      const data = await response.json();

      if (data.success) {
        const aiMessage = { role: 'assistant', content: data.data.answer };
        setMessages((prev) => [...prev, aiMessage]);
      } else {
        const errorMessage = { role: 'assistant', content: '抱歉，AI 服务暂时不可用。' };
        setMessages((prev) => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error('AI 聊天错误:', error);
      const errorMessage = { role: 'assistant', content: '抱歉，出现错误，请稍后重试。' };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      setInput('');
    }
  };

  return (
    <div className="ai-chat">
      <div className="chat-header">
        <h3>FSHD AI 助手</h3>
        <p>专门为面肩肱型肌营养不良症患者提供帮助</p>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="welcome-message">
            <p>👋 你好！我是FSHD医疗助手，我可以帮助你解答关于面肩肱型肌营养不良症的问题。</p>
          </div>
        )}

        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.role}`}>
            <div className="message-avatar">{msg.role === 'user' ? '👤' : '🤖'}</div>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}

        {loading && (
          <div className="message assistant loading">
            <div className="message-avatar">🤖</div>
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="chat-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="输入关于FSHD的问题..."
          disabled={loading}
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()}>
          {loading ? '发送中...' : '发送'}
        </button>
      </div>
    </div>
  );
}
