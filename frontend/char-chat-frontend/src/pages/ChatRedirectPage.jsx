import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api'; // chatAPI 대신 api 인스턴스 직접 임포트
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/button';

const ChatRedirectPage = () => {
  const { characterId: id } = useParams(); // id로 받아서 characterId 또는 chatRoomId로 처리
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const resolveChatTarget = async () => {
      if (!id) {
        navigate('/', { replace: true });
        return;
      }

      try {
        // api.js를 거치지 않고 직접 API 엔드포인트 호출
        const response = await api.get(`/chat/rooms/${id}`);
        const characterId = response.data.character_id;
        
        if (characterId) {
          // 2. 성공하면 character_id를 추출하여 실제 채팅 페이지로 이동
          navigate(`/ws/chat/${characterId}`, { replace: true });
        } else {
          // 응답은 왔지만 character_id가 없는 비정상적인 경우
          throw new Error('채팅방 정보가 올바르지 않습니다.');
        }
      } catch (err) {
        // 3. 실패하면 character_id라고 간주하고 바로 채팅 페이지로 이동
        // (404 Not Found 에러가 여기에 해당)
        navigate(`/ws/chat/${id}`, { replace: true });
      }
    };

    resolveChatTarget();
  }, [id, navigate]);

  // API 호출 및 리다이렉트 동안 로딩/에러 상태를 보여줌
  if (loading) {
     return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin mb-4" />
        <p>채팅방으로 이동 중...</p>
      </div>
    );
  }

  if (error) {
     return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center text-center p-4">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-xl font-bold mb-2">오류</h3>
        <p className="mb-6">{error}</p>
        <Button onClick={() => navigate('/')} variant="outline" className="bg-transparent border-white text-white hover:bg-white hover:text-gray-900">
          홈으로 돌아가기
        </Button>
      </div>
    );
  }

  return null;
};

export default ChatRedirectPage; 