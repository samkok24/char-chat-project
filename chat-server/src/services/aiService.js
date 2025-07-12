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
   * 스트리밍 캐릭터 응답 생성
   */
  async* generateCharacterResponseStream(character, userMessage, roomId) {
    try {
      const settings = character.settings || this.defaultSettings;
      const aiModel = settings.ai_model || this.defaultSettings.model;

      const context = await this.getConversationContext(roomId);
      const systemPrompt = this.buildSystemPrompt(character, settings);
      const conversationHistory = this.buildConversationHistory(context, userMessage);
      
      if (aiModel.includes('gemini')) {
        yield* this.generateGeminiStream(systemPrompt, conversationHistory, settings);
      } else {
        // 기본값으로 Gemini 사용
        yield* this.generateGeminiStream(systemPrompt, conversationHistory, settings);
      }
    } catch (error) {
      logger.error('AI 스트리밍 응답 생성 오류:', error);
      yield this.getFallbackResponse(character);
    }
  }

  /**
   * Gemini를 사용한 스트리밍 응답 생성
   */
  async* generateGeminiStream(systemPrompt, conversationHistory, settings) {
    if (!this.gemini) {
      throw new Error('Gemini API 키가 설정되지 않았습니다.');
    }

    const model = this.gemini.getGenerativeModel({
      model: 'gemini-pro',
      systemInstruction: {
        parts: [{ text: systemPrompt }],
        role: "user"
      },
    });

    const result = await model.generateContentStream({
      contents: conversationHistory,
      generationConfig: {
        temperature: parseFloat(settings.temperature) || this.defaultSettings.temperature,
        maxOutputTokens: parseInt(settings.max_tokens) || this.defaultSettings.maxTokens,
        topP: 0.8,
        topK: 40
      }
    });

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        yield chunkText;
      }
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

      // 시스템 지침을 포함하여 모델 동적 생성
      const model = this.gemini.getGenerativeModel({
        model: 'gemini-pro',
        systemInstruction: {
          parts: [{ text: systemPrompt }],
          role: "user" // system prompt의 역할을 명시
        },
      });

      const result = await model.generateContent({
        contents: conversationHistory, // 구조화된 대화 기록 전달
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
    let systemPrompt = `당신은 AI 캐릭터 '${character.name}'입니다. 다음 설정에 따라 사용자와 대화하세요.`;

    // 1. 기본 정보 (Info)
    let info = `- 이름: ${character.name}`;
    if (character.description) {
      info += `\n- 설명: ${character.description}`;
    }
    systemPrompt += `\n\n[기본 정보]\n${info}`;

    // 2. 성격 및 배경 (Persona)
    let persona = '';
    if (character.personality) {
      persona += `\n- 성격: ${character.personality}`;
    }
    if (character.background_story) {
      persona += `\n- 배경: ${character.background_story}`;
    }
    if (character.speech_style) {
      persona += `\n- 말투: ${character.speech_style}`;
    }
    if (persona) {
      systemPrompt += `\n\n[성격 및 배경]\n${persona}`;
    }

    // 3. 응답 예시 (Few-shot)
    if (character.greeting) {
      systemPrompt += `\n\n[응답 예시]\n- 첫인사: "${character.greeting}"`;
    }

    // 4. 지침 (Instructions)
    const instructions = `
- 반드시 [성격 및 배경]에 충실하여 '${character.name}'으로서 대화하세요.
- 사용자의 말을 경청하고, 자연스럽게 대화를 이어가세요.
- 절대로 AI나 챗봇임을 드러내지 마세요.
- 모든 답변은 한국어로 해야 합니다.
- 답변은 1~2 문장 내외로 간결하게 유지하세요.`;
    systemPrompt += `\n\n[지침]\n${instructions}`;

    return systemPrompt;
  }

  /**
   * 대화 히스토리 구성
   */
  buildConversationHistory(context, currentMessage) {
    const history = [];

    if (context && context.messages) {
      // 최근 10개 메시지만 사용
      const recentMessages = context.messages.slice(-10);
      
      for (const msg of recentMessages) {
        // Gemini API에 맞는 역할(role)로 변경 ('character' -> 'model')
        const role = msg.senderType === 'user' ? 'user' : 'model';
        history.push({
          role: role,
          parts: [{ text: msg.content.trim() }]
        });
      }
    }

    // 현재 메시지 추가
    history.push({
      role: 'user',
      parts: [{ text: currentMessage.trim() }]
    });

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

