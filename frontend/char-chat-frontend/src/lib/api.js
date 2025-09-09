/**
 * API 클라이언트 설정
 */

import axios from 'axios';

// API 기본 URL 설정
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

// Axios 인스턴스 생성
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 100000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 요청 인터셉터 - 토큰 자동 추가
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    const isGet = (config.method || 'get').toLowerCase() === 'get';
    const rawUrl = config.url || '';
    // 정규화된 path 계산 (절대/상대 URL 모두 지원, 쿼리 제거, 선행 슬래시 보장)
    let path = rawUrl;
    try {
      if (/^https?:\/\//i.test(rawUrl)) {
        path = new URL(rawUrl).pathname;
      }
    } catch (_) {}
    if (!path.startsWith('/')) path = `/${path}`;
    path = path.split('?')[0];
    const isPublicCharacters = path === '/characters' || /^\/characters\/\d+$/.test(path);
    const isPublicStories = path === '/stories' || /^\/stories\/\d+$/.test(path);
    const isPublicTags = path.startsWith('/tags');
    const isPublicGet = isGet && (isPublicCharacters || isPublicStories || isPublicTags);
    if (token && !isPublicGet) {
      config.headers.Authorization = `Bearer ${token}`;
    } else {
      // 공개 GET 요청은 Authorization 제거 (백엔드에서 500 방지)
      if (config.headers && config.headers.Authorization) {
        delete config.headers.Authorization;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 응답 인터셉터 - 토큰 만료/권한 오류 처리
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config || {};
    const status = error.response?.status;

    // 인증이 필요없는 공개 엔드포인트들
    const publicEndpoints = [
      '/characters',
      '/stories',
    ];
    
    const isPublicEndpoint = publicEndpoints.some(endpoint => 
      originalRequest.url?.includes(endpoint) && originalRequest.method === 'get'
    );

    // 401 Unauthorized 또는 403 Forbidden에서 토큰 갱신 시도 (공개 GET 엔드포인트 제외)
    if ((status === 401 || status === 403) && !originalRequest._retry && !isPublicEndpoint) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (refreshToken) {
          const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
            refresh_token: refreshToken,
          });

          const { access_token, refresh_token: newRefreshToken } = response.data;
          localStorage.setItem('access_token', access_token);
          localStorage.setItem('refresh_token', newRefreshToken);

          // 토큰 갱신 이벤트 브로드캐스트 (동일 탭)
          try {
            window.dispatchEvent(new CustomEvent('auth:tokenRefreshed', { detail: { access_token, refresh_token: newRefreshToken } }));
          } catch (_) {}

          // 원래 요청 재시도
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        // 리프레시 토큰도 만료된 경우 로그아웃
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        try {
          window.dispatchEvent(new Event('auth:loggedOut'));
        } catch (_) {}
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

// 🔐 인증 관련 API
export const authAPI = {
  login: (email, password) =>
    api.post('/auth/login', { email, password }),
  
  register: (email, username, password, gender) =>
    api.post('/auth/register', { email, username, password, gender }),
  
  logout: () =>
    api.post('/auth/logout'),
  
  getMe: () =>
    api.get('/auth/me'),
  
  refreshToken: (refreshToken) =>
    api.post('/auth/refresh', { refresh_token: refreshToken }),
  
  verifyEmail: (token) =>
    api.post('/auth/verify-email', { token }),
  
  sendVerificationEmail: () =>
    api.post('/auth/send-verification-email'),
  checkEmail: (email) => api.get(`/auth/check-email`, { params: { email } }),
  checkUsername: (username) => api.get(`/auth/check-username`, { params: { username } }),
  generateUsername: () => api.get('/auth/generate-username'),
  updatePassword: (current_password, new_password) =>
    api.post('/auth/update-password', { current_password, new_password }),
};

// 👤 사용자 관련 API
export const usersAPI = {
  // 사용자 프로필 조회
  getUserProfile: (userId) =>
    api.get(`/users/${userId}`),
  
  // 사용자 프로필 수정
  updateUserProfile: (userId, data) =>
    api.put(`/users/${userId}`, data),

  // 사용자 댓글 조회
  getUserCharacterComments: (userId, params = {}) =>
    api.get(`/users/${userId}/comments/characters`, { params }),
  // 사용자 스토리 댓글 조회
  getUserStoryComments: (userId, params = {}) =>
    api.get(`/users/${userId}/comments/stories`, { params }),
  
  // 사용자가 생성한 캐릭터 목록
  getUserCharacters: (userId, params = {}) =>
    api.get(`/users/${userId}/characters`, { params }),
  
  // 사용자가 생성한 스토리 목록
  getUserStories: (userId, params = {}) =>
    api.get(`/users/${userId}/stories`, { params }),

  // 최근 대화한 캐릭터 목록
  getRecentCharacters: (params = {}) =>
    api.get('/me/characters/recent', { params }),
  // 내가 좋아요한 캐릭터 목록
  getLikedCharacters: (params = {}) =>
    api.get('/me/characters/liked', { params }),
    
  // 모델 설정 관련
  getModelSettings: () =>
    api.get('/me/model-settings'),
    
  updateModelSettings: (model, subModel, responseLength) =>
    api.put('/me/model-settings', null, { 
      params: { model, sub_model: subModel, response_length: responseLength } 
    }),

  // 통계: 개요
  getCreatorStatsOverview: (userId, params = {}) =>
    api.get(`/users/${userId}/stats/overview`, { params }),
  // 통계: 시계열(예: chats 최근 7일)
  getCreatorTimeseries: (userId, params = {}) =>
    api.get(`/users/${userId}/stats/timeseries`, { params }),
  // 통계: 상위 캐릭터
  getCreatorTopCharacters: (userId, params = {}) =>
    api.get(`/users/${userId}/stats/top-characters`, { params }),
};

// 🎭 캐릭터 관련 API
export const charactersAPI = {
  getCharacters: (params = {}) =>
    api.get('/characters', { params }),
  
  getMyCharacters: (params = {}) =>
    api.get('/characters/my', { params }),
  
  getCharacter: (id) =>
    api.get(`/characters/${id}`),
  
  createCharacter: (data) =>
    api.post('/characters', data),

  // 🔥 CAVEDUCK 스타일 고급 생성 API
  createAdvancedCharacter: (data) =>
    api.post('/characters/advanced', data),
  
  updateAdvancedCharacter: (id, data) =>
    api.put(`/characters/advanced/${id}`, data),
  
  getAdvancedCharacter: (id) =>
    api.get(`/characters/advanced/${id}`),

  updateCharacter: (id, data) =>
    api.put(`/characters/${id}`, data),
  
  deleteCharacter: (id) =>
    api.delete(`/characters/${id}`),

  toggleCharacterPublic: (id) =>
    api.patch(`/characters/${id}/toggle-public`),
  
  likeCharacter: (id) =>
    api.post(`/characters/${id}/like`),
  
  unlikeCharacter: (id) =>
    api.delete(`/characters/${id}/like`),
  
  getLikeStatus: (id) =>
    api.get(`/characters/${id}/like-status`),
  
  getCharacterSettings: (id) =>
    api.get(`/characters/${id}/settings`),
  
  updateCharacterSettings: (id, data) =>
    api.put(`/characters/${id}/settings`, data),
  
  createCharacterSettings: (id, data) =>
    api.post(`/characters/${id}/settings`, data),
  
  getCharacterStats: (id) =>
    api.get(`/characters/${id}/stats`),
  
  // 댓글 관련 API
  getComments: (characterId, params = {}) =>
    api.get(`/characters/${characterId}/comments`, { params }),
  // 태그 관련(캐릭터별 연결)
  getCharacterTags: (characterId) =>
    api.get(`/characters/${characterId}/tags`),
  setCharacterTags: (characterId, tags) =>
    api.put(`/characters/${characterId}/tags`, { tags }),
  
  createComment: (characterId, data) =>
    api.post(`/characters/${characterId}/comments`, data),
  
  updateComment: (commentId, data) =>
    api.put(`/characters/comments/${commentId}`, data),
  
  deleteComment: (commentId) =>
    api.delete(`/characters/comments/${commentId}`),
  
  // 세계관 설정 API
  createWorldSetting: (data) =>
    api.post('/characters/world-settings', data),
  
  getWorldSettings: (params = {}) =>
    api.get('/characters/world-settings', { params }),
  
  // 커스텀 모듈 API
  createCustomModule: (data) =>
    api.post('/characters/custom-modules', data),
  
  getCustomModules: (params = {}) =>
    api.get('/characters/custom-modules', { params }),
};

// 🏷️ 태그 관련 API
export const tagsAPI = {
  getTags: () => api.get('/tags/'),
  getUsedTags: () => api.get('/tags/used'),
  createTag: (data) => api.post('/tags', data),
};

// 💬 채팅 관련 API
export const chatAPI = {
  // 🔥 CAVEDUCK 스타일 채팅 시작 API
  startChat: (characterId) =>
    api.post('/chat/start', { character_id: characterId }),

  sendMessage: (data) =>
    api.post('/chat/message', data),
  
  getChatHistory: (sessionId) =>
    api.get(`/chat/history/${sessionId}`),
  
  getChatSessions: () =>
    api.get('/chat/sessions'),
  
  // 채팅룸 관련 API (레거시)
  getChatRooms: (params = {}) =>
    api.get('/chat/rooms', { params }),
  
  createChatRoom: (data) =>
    api.post('/chat/rooms', data),
  
  getChatRoom: (id) =>
    api.get(`/chat/rooms/${id}`),
  
  getMessages: (roomId, params = {}) =>
    api.get(`/chat/rooms/${roomId}/messages`, { params }),
  
  sendMessageLegacy: (data) =>
    api.post('/chat/messages', data),
    
  // 채팅 삭제 관련 API
  clearChatMessages: (roomId) =>
    api.delete(`/chat/rooms/${roomId}/messages`),
    
  deleteChatRoom: (roomId) =>
    api.delete(`/chat/rooms/${roomId}`),
  // 메시지 수정/재생성
  updateMessage: (messageId, content) =>
    api.patch(`/chat/messages/${messageId}`, { content }),
  regenerateMessage: (messageId, instruction) =>
    api.post(`/chat/messages/${messageId}/regenerate`, { instruction }),
  feedbackMessage: (messageId, action) =>
    api.post(`/chat/messages/${messageId}/feedback`, { action }),
};

// 📖 스토리 관련 API
export const storiesAPI = {
  getStories: (params = {}) =>
    api.get('/stories', { params }),
  
  getMyStories: (params = {}) =>
    api.get('/stories/my', { params }),
  
  getStory: (id) =>
    api.get(`/stories/${id}`),
  
  createStory: (data) =>
    api.post('/stories', data),
  
  updateStory: (id, data) =>
    api.put(`/stories/${id}`, data),
  
  deleteStory: (id) =>
    api.delete(`/stories/${id}`),
  
  generateStory: (data) =>
    api.post('/stories/generate', data),
  
  likeStory: (id) =>
    api.post(`/stories/${id}/like`),
  
  unlikeStory: (id) =>
    api.delete(`/stories/${id}/like`),
  
  getLikeStatus: (id) =>
    api.get(`/stories/${id}/like-status`),
  
  // 스토리 댓글 관련 API
  getComments: (storyId, params = {}) =>
    api.get(`/stories/${storyId}/comments`, { params }),
  
  createComment: (storyId, data) =>
    api.post(`/stories/${storyId}/comments`, data),
  
  updateComment: (commentId, data) =>
    api.put(`/stories/comments/${commentId}`, data),
  
  deleteComment: (commentId) =>
    api.delete(`/stories/comments/${commentId}`),
};

// 📚 웹소설 원작(MVP 더미용)
export const worksAPI = {
  // 더미: 작품/회차 데이터 (MVP 시연용)
  getWork: async (workId) => {
    // 임시 더미 데이터
    return {
      data: {
        id: workId,
        title: '달빛 아래의 서사',
        author: 'Miru',
        cover_url: null,
        total_chapters: 3,
        main_characters: [
          { id: 'c1', name: '루나', avatar_url: null },
          { id: 'c2', name: '에단', avatar_url: null },
          { id: 'c3', name: '세라', avatar_url: null },
        ],
      }
    };
  },
  getChapter: async (workId, chapterNumber) => {
    const chapters = [
      { no: 1, title: '1화. 초대장', content: '달빛이 비추는 밤, 낡은 서가 사이로 초대장이 떨어졌다...' },
      { no: 2, title: '2화. 비밀 서고', content: '서고 깊은 곳, 봉인된 문이 미세한 빛을 내뿜었다...' },
      { no: 3, title: '3화. 달의 계승자', content: '루나는 자신의 운명을 받아들이기로 한다...' },
    ];
    const chap = chapters.find(c => c.no === Number(chapterNumber)) || chapters[0];
    return { data: { id: `${workId}-${chap.no}`, work_id: workId, number: chap.no, ...chap } };
  },
};

// ✨ 스토리 임포터 관련 API
export const storyImporterAPI = {
  analyzeStory: (content, ai_model, title = null) => {
    return api.post('/story-importer/analyze', { content, ai_model, title });
  },
};

// 💎 포인트 관련 API
export const pointAPI = {
  getBalance: () =>
    api.get('/point/balance'),
  
  usePoints: (data) =>
    api.post('/point/use', data),
  
  getTransactions: (params = {}) =>
    api.get('/point/transactions', { params }),
  
  getTransactionsSummary: () =>
    api.get('/point/transactions/summary'),
};

// 💳 결제 관련 API
export const paymentAPI = {
  getProducts: () =>
    api.get('/payment/products'),
  
  createProduct: (data) =>
    api.post('/payment/products', data),
  
  checkout: (data) =>
    api.post('/payment/checkout', data),
  
  webhook: (data) =>
    api.post('/payment/webhook', data),
  
  getPaymentHistory: (params = {}) =>
    api.get('/payment/history', { params }),
  
  getPayment: (paymentId) =>
    api.get(`/payment/payment/${paymentId}`),
};

// 📁 파일 관련 API
export const filesAPI = {
  uploadImages: (files) => {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });
    return api.post('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
};

// 📝 기억노트 관련 API
export const memoryNotesAPI = {
  // 특정 캐릭터의 기억노트 목록 조회
  getMemoryNotesByCharacter: (characterId) =>
    api.get(`/memory-notes/character/${characterId}`),

  // 기억노트 생성
  createMemoryNote: (memoryData) =>
    api.post('/memory-notes', memoryData),

  // 기억노트 수정
  updateMemoryNote: (memoryId, memoryData) =>
    api.put(`/memory-notes/${memoryId}`, memoryData),

  // 기억노트 삭제
  deleteMemoryNote: (memoryId) =>
    api.delete(`/memory-notes/${memoryId}`),

  // 기억노트 단일 조회
  getMemoryNote: (memoryId) =>
    api.get(`/memory-notes/${memoryId}`),
};

// 👤 유저 페르소나 관련 API
export const userPersonasAPI = {
  // 사용자의 모든 페르소나 목록 조회
  getUserPersonas: () =>
    api.get('/user-personas'),

  // 페르소나 생성
  createUserPersona: (personaData) =>
    api.post('/user-personas', personaData),

  // 페르소나 수정
  updateUserPersona: (personaId, personaData) =>
    api.put(`/user-personas/${personaId}`, personaData),

  // 페르소나 삭제
  deleteUserPersona: (personaId) =>
    api.delete(`/user-personas/${personaId}`),

  // 페르소나 단일 조회
  getUserPersona: (personaId) =>
    api.get(`/user-personas/${personaId}`),

  // 활성 페르소나 설정
  setActivePersona: (personaId) =>
    api.post('/user-personas/set-active', { persona_id: personaId }),

  // 현재 활성 페르소나 조회
  getCurrentActivePersona: () =>
    api.get('/user-personas/active/current'),
};

export { api, API_BASE_URL, SOCKET_URL };

