import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../lib/api'; // chatAPI 대신 api 인스턴스 직접 임포트
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/button';

const ChatRedirectPage = () => {
  const { characterId: id } = useParams(); // id로 받아서 characterId 또는 chatRoomId로 처리
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const resolveChatTarget = async () => {
      if (!id) {
        navigate('/', { replace: true });
        return;
      }

      try {
        /**
         * /chat/:id 진입 시 안전한 리다이렉트 정책
         *
         * 의도/동작:
         * - id가 chatRoomId면, 해당 roomId를 쿼리스트링 `room`으로 유지한 채
         *   `/ws/chat/:characterId?room=:roomId`로 이동한다.
         *   (원작챗/일반챗 모두 "정확히 그 방"으로 복원되도록 보장)
         * - id가 characterId면, 기존 동작대로 `/ws/chat/:characterId`로 이동한다.
         *
         * 왜 필요한가:
         * - roomId를 버리고 characterId로만 이동하면, 같은 캐릭터의 다른 방(일반챗/원작챗)이 섞여 있을 때
         *   "이어하기"가 엉뚱한 방으로 들어가 UX가 깨진다.
         */
        setLoading(true);
        setError('');
        const usp = new URLSearchParams(location.search || '');

        // api.js를 거치지 않고 직접 API 엔드포인트 호출
        const response = await api.get(`/chat/rooms/${id}`);
        const characterId = response.data.character_id;
        
        if (characterId) {
          // 2. 성공하면 character_id를 추출하여 실제 채팅 페이지로 이동
          // ✅ roomId 유지(원작챗/일반챗 정확 복원) + 기존 쿼리 보존
          usp.set('room', String(id));
          const qs = usp.toString();
          navigate(`/ws/chat/${characterId}${qs ? `?${qs}` : ''}`, { replace: true });
        } else {
          // 응답은 왔지만 character_id가 없는 비정상적인 경우
          console.warn('[ChatRedirectPage] chat room resolved but missing character_id:', response?.data);
          setError('채팅방 정보가 올바르지 않습니다.');
          setLoading(false);
        }
      } catch (err) {
        // 3. 실패하면 character_id라고 간주하고 바로 채팅 페이지로 이동
        // (404 Not Found 에러가 여기에 해당)
        try {
          const usp = new URLSearchParams(location.search || '');
          const qs = usp.toString();
          navigate(`/ws/chat/${id}${qs ? `?${qs}` : ''}`, { replace: true });
        } catch (_) {
          navigate(`/ws/chat/${id}`, { replace: true });
        }
      }
    };

    resolveChatTarget();
  }, [id, navigate, location.search]);

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
        <Button onClick={() => navigate('/')} variant="outline" className="bg-transparent border-white text-white hover:bg-gray-100 hover:text-gray-900">
          홈으로 돌아가기
        </Button>
      </div>
    );
  }

  return null;
};

export default ChatRedirectPage; 