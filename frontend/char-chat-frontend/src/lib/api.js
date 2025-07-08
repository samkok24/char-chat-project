/**
 * API 클라이언트 설정
 */

import axios from 'axios';

// API 기본 URL 설정
const API_BASE_URL = 'http://localhost:8000'; // import.meta.env.VITE_API_URL || 'http://localhost:8000';
const SOCKET_URL = 'http://localhost:3001'; // import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

// Axios 인스턴스 생성
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 요청 인터셉터 - 토큰 자동 추가
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 응답 인터셉터 - 토큰 만료 처리
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // 인증이 필요없는 공개 엔드포인트들
    const publicEndpoints = [
      '/characters',
      '/stories',
    ];
    
    const isPublicEndpoint = publicEndpoints.some(endpoint => 
      originalRequest.url?.includes(endpoint) && originalRequest.method === 'get'
    );

    if (error.response?.status === 401 && !originalRequest._retry && !isPublicEndpoint) {
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

          // 원래 요청 재시도
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        // 리프레시 토큰도 만료된 경우 로그아웃
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

// API 함수들
export const authAPI = {
  login: (email, password) =>
    api.post('/auth/login', { email, password }),
  
  register: (email, username, password) =>
    api.post('/auth/register', { email, username, password }),
  
  logout: () =>
    api.post('/auth/logout'),
  
  getMe: () =>
    api.get('/auth/me'),
  
  refreshToken: (refreshToken) =>
    api.post('/auth/refresh', { refresh_token: refreshToken }),
};

export const charactersAPI = {
  getCharacters: (params = {}) =>
    api.get('/characters', { params }),
  
  getMyCharacters: (params = {}) =>
    api.get('/characters/my', { params }),
  
  getCharacter: (id) =>
    api.get(`/characters/${id}`),
  
  createCharacter: (data) =>
    api.post('/characters', data),
  
  updateCharacter: (id, data) =>
    api.put(`/characters/${id}`, data),
  
  deleteCharacter: (id) =>
    api.delete(`/characters/${id}`),
  
  likeCharacter: (id) =>
    api.post(`/characters/${id}/like`),
  
  unlikeCharacter: (id) =>
    api.delete(`/characters/${id}/like`),
  
  getCharacterSettings: (id) =>
    api.get(`/characters/${id}/settings`),
  
  updateCharacterSettings: (id, data) =>
    api.put(`/characters/${id}/settings`, data),
  
  // 댓글 관련 API
  getComments: (characterId, params = {}) =>
    api.get(`/characters/${characterId}/comments`, { params }),
  
  createComment: (characterId, data) =>
    api.post(`/characters/${characterId}/comments`, data),
  
  updateComment: (commentId, data) =>
    api.put(`/characters/comments/${commentId}`, data),
  
  deleteComment: (commentId) =>
    api.delete(`/characters/comments/${commentId}`),
};

export const chatAPI = {
  getChatRooms: (params = {}) =>
    api.get('/chat/rooms', { params }),
  
  createChatRoom: (data) =>
    api.post('/chat/rooms', data),
  
  getChatRoom: (id) =>
    api.get(`/chat/rooms/${id}`),
  
  getMessages: (roomId, params = {}) =>
    api.get(`/chat/rooms/${roomId}/messages`, { params }),
  
  sendMessage: (data) =>
    api.post('/chat/messages', data),
};

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
};

export { api, API_BASE_URL, SOCKET_URL };

