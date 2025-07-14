import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const ChatRedirectPage = () => {
  const { characterId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (characterId) {
      navigate(`/characters/${characterId}`, { replace: true });
    } else {
      // characterId가 없는 비정상적인 경우, 홈으로 보냄
      navigate('/', { replace: true });
    }
  }, [characterId, navigate]);

  // 리다이렉트되는 동안 아무것도 렌더링하지 않음
  return null;
};

export default ChatRedirectPage; 