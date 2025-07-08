/**
 * AI 서비스 - 캐릭터 응답 생성
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
// const Anthropic = require('anthropic');
const config = require('../config/config');
const logger = require('../utils/logger');
const redisService = require('./redisService');

class AIService {
  constructor() {
    // Gemini AI 초기화
    if (config.GEMINI_API_KEY) {
      this.gemini = new GoogleGenerativeAI(config.GEMINI_API_KEY);
      this.geminiModel = this.gemini.getGenerativeModel({ model: 'gemini-pro' });
    }

    // Claude AI 초기화 (현재 비활성화)
    // if (config.CLAUDE_API_KEY) {
    //   this.claude = new Anthropic({
    //     apiKey: config.CLAUDE_API_KEY
    //   });
    // }

    // 기본 설정
    this.defaultSettings = {
      temperature: config.DEFAULT_TEMPERATURE,
      maxTokens: config.DEFAULT_MAX_TOKENS,
      model: config.DEFAULT_AI_MODEL
    };
  }

  /**
   * 캐릭터 응답 생성
   */
  async generateCharacterResponse(character, userMessage, roomId) {
    try {
      // 캐릭터 설정 가져오기
      const settings = character.settings || this.defaultSettings;
      const aiModel = settings.ai_model || this.defaultSettings.model;

      // 대화 컨텍스트 가져오기
      const context = await this.getConversationContext(roomId);

      // 시스템 프롬프트 구성
      const systemPrompt = this.buildSystemPrompt(character, settings);

      // 대화 히스토리 구성
      const conversationHistory = this.buildConversationHistory(context, userMessage);

      // AI 모델에 따라 응답 생성
      let response;
      if (aiModel.includes('gemini')) {
        response = await this.generateGeminiResponse(systemPrompt, conversationHistory, settings);
      } else if (aiModel.includes('claude')) {
        response = await this.generateClaudeResponse(systemPrompt, conversationHistory, settings);
      } else {
        // 기본값으로 Gemini 사용
        response = await this.generateGeminiResponse(systemPrompt, conversationHistory, settings);
      }

      // 컨텍스트 업데이트
      await this.updateConversationContext(roomId, userMessage, response);

      return response;

    } catch (error) {
      logger.error('AI 응답 생성 오류:', error);
      return this.getFallbackResponse(character);
    }
  }

  /**
   * Gemini를 사용한 응답 생성
   */
  async generateGeminiResponse(systemPrompt, conversationHistory, settings) {
    try {
      if (!this.gemini) {
        throw new Error('Gemini API 키가 설정되지 않았습니다.');
      }

      // 프롬프트 구성
      const prompt = `${systemPrompt}\n\n대화 기록:\n${conversationHistory}\n\n위 대화를 바탕으로 캐릭터로서 자연스럽게 응답해주세요. 한국어로 답변하세요.`;

      const result = await this.geminiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: parseFloat(settings.temperature) || this.defaultSettings.temperature,
          maxOutputTokens: parseInt(settings.max_tokens) || this.defaultSettings.maxTokens,
          topP: 0.8,
          topK: 40
        }
      });

      const response = result.response;
      const text = response.text();

      if (!text || text.trim().length === 0) {
        throw new Error('빈 응답을 받았습니다.');
      }

      return text.trim();

    } catch (error) {
      logger.error('Gemini API 오류:', error);
      throw error;
    }
  }

  /**
   * Claude를 사용한 응답 생성
   */
  async generateClaudeResponse(systemPrompt, conversationHistory, settings) {
    try {
      if (!this.claude) {
        throw new Error('Claude API 키가 설정되지 않았습니다.');
      }

      const response = await this.claude.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: parseInt(settings.max_tokens) || this.defaultSettings.maxTokens,
        temperature: parseFloat(settings.temperature) || this.defaultSettings.temperature,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `대화 기록:\n${conversationHistory}\n\n위 대화를 바탕으로 캐릭터로서 자연스럽게 응답해주세요. 한국어로 답변하세요.`
          }
        ]
      });

      const text = response.content[0].text;

      if (!text || text.trim().length === 0) {
        throw new Error('빈 응답을 받았습니다.');
      }

      return text.trim();

    } catch (error) {
      logger.error('Claude API 오류:', error);
      throw error;
    }
  }

  /**
   * 시스템 프롬프트 구성
   */
  buildSystemPrompt(character, settings) {
    let systemPrompt = settings.system_prompt || `당신은 ${character.name}입니다.`;

    // 캐릭터 정보 추가
    if (character.personality) {
      systemPrompt += `\n\n성격: ${character.personality}`;
    }

    if (character.background_story) {
      systemPrompt += `\n\n배경 스토리: ${character.background_story}`;
    }

    if (character.description) {
      systemPrompt += `\n\n설명: ${character.description}`;
    }

    // 기본 지침 추가
    systemPrompt += `\n\n지침:
- 항상 ${character.name}의 성격과 배경에 맞게 응답하세요.
- 자연스럽고 친근한 대화를 유지하세요.
- 사용자의 메시지에 적절히 반응하고 대화를 이어가세요.
- 한국어로 응답하세요.
- 너무 길지 않게 적절한 길이로 응답하세요.`;

    return systemPrompt;
  }

  /**
   * 대화 히스토리 구성
   */
  buildConversationHistory(context, currentMessage) {
    let history = '';

    if (context && context.messages) {
      // 최근 10개 메시지만 사용
      const recentMessages = context.messages.slice(-10);
      
      for (const msg of recentMessages) {
        const sender = msg.senderType === 'user' ? '사용자' : msg.senderName || '캐릭터';
        history += `${sender}: ${msg.content}\n`;
      }
    }

    // 현재 메시지 추가
    history += `사용자: ${currentMessage}\n`;

    return history;
  }

  /**
   * 대화 컨텍스트 가져오기
   */
  async getConversationContext(roomId) {
    try {
      const context = await redisService.getAIContext(roomId);
      if (context) {
        return context;
      }

      // 캐시된 메시지에서 컨텍스트 구성
      const cachedMessages = await redisService.getCachedMessages(roomId, 10);
      return {
        messages: cachedMessages.reverse(), // 시간순 정렬
        lastUpdated: new Date().toISOString()
      };

    } catch (error) {
      logger.error('컨텍스트 조회 오류:', error);
      return { messages: [] };
    }
  }

  /**
   * 대화 컨텍스트 업데이트
   */
  async updateConversationContext(roomId, userMessage, aiResponse) {
    try {
      const context = await this.getConversationContext(roomId);
      
      // 새 메시지들 추가
      const newMessages = [
        {
          senderType: 'user',
          content: userMessage,
          timestamp: new Date().toISOString()
        },
        {
          senderType: 'character',
          content: aiResponse,
          timestamp: new Date().toISOString()
        }
      ];

      // 기존 메시지와 합치기 (최근 20개만 유지)
      const allMessages = [...(context.messages || []), ...newMessages].slice(-20);

      const updatedContext = {
        messages: allMessages,
        lastUpdated: new Date().toISOString()
      };

      await redisService.setAIContext(roomId, updatedContext, 3600); // 1시간 캐시

    } catch (error) {
      logger.error('컨텍스트 업데이트 오류:', error);
    }
  }

  /**
   * 폴백 응답 (오류 시 사용)
   */
  getFallbackResponse(character) {
    const fallbackResponses = [
      '죄송해요, 잠시 생각이 정리되지 않네요. 다시 말씀해 주시겠어요?',
      '음... 뭔가 말하고 싶은데 단어가 떠오르지 않아요.',
      '잠깐만요, 다시 한 번 말씀해 주실 수 있나요?',
      '아, 미안해요. 잠시 딴 생각을 했네요. 뭐라고 하셨죠?',
      '조금 더 자세히 설명해 주시면 좋겠어요.'
    ];

    const randomIndex = Math.floor(Math.random() * fallbackResponses.length);
    return fallbackResponses[randomIndex];
  }

  /**
   * AI 모델 상태 확인
   */
  async checkAIStatus() {
    const status = {
      gemini: false,
      claude: false
    };

    // Gemini 상태 확인
    if (this.gemini && config.GEMINI_API_KEY) {
      try {
        await this.geminiModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }]
        });
        status.gemini = true;
      } catch (error) {
        logger.warn('Gemini API 상태 확인 실패:', error.message);
      }
    }

    // Claude 상태 확인
    if (this.claude && config.CLAUDE_API_KEY) {
      try {
        await this.claude.messages.create({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }]
        });
        status.claude = true;
      } catch (error) {
        logger.warn('Claude API 상태 확인 실패:', error.message);
      }
    }

    return status;
  }
}

module.exports = new AIService();

