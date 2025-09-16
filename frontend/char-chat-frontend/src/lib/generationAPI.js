import { apiClient } from './api';

export const generationAPI = {
  generatePreview: async (payload) => {
    const response = await apiClient.post(`/generate/preview`, payload);
    return response.data;
  },

  generateCanvas: async (payload) => {
    const response = await apiClient.post(`/generate/canvas`, payload);
    return response.data;
  },

  stopGeneration: async (payload) => {
    const response = await apiClient.post(`/generate/stop`, payload);
    return response.data;
  },

  connectToStream: (streamId, { onMessage, onError, onDone, onOpen }) => {
    const base = apiClient.defaults.baseURL?.replace(/\/$/, '') || '';
    const url = `${base}/generate/stream/${encodeURIComponent(streamId)}`;
    const es = new EventSource(url, { withCredentials: true });

    es.onopen = (event) => {
      try { onOpen?.(event); } catch {}
    };

    es.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(event.data);
        onMessage?.(parsed);
      } catch (e) {
        onError?.({ message: 'parse_error' });
      }
    });

    es.addEventListener('done', (event) => {
      try {
        const parsed = JSON.parse(event.data);
        onDone?.(parsed);
      } catch (e) {
        onError?.({ message: 'parse_error' });
      } finally {
        es.close();
      }
    });

    es.addEventListener('error', (event) => {
      onError?.(event);
    });

    return es;
  },
};
