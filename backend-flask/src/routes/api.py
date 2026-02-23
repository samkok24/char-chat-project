from flask import Blueprint, jsonify, request
import uuid
from datetime import datetime

# AI 서비스 조건부 import
try:
    from src.services.ai_service import ai_service
    AI_AVAILABLE = True
except ImportError as e:
    print(f"AI 서비스를 사용할 수 없습니다: {e}")
    AI_AVAILABLE = False
    ai_service = None

api_bp = Blueprint('api', __name__)

# 임시 데이터 저장소 (실제로는 데이터베이스 사용)
characters_db = [
    {
        'id': '1',
        'name': '아리아',
        'description': '친근하고 활발한 AI 캐릭터입니다. 일상 대화부터 창작까지 다양한 주제로 이야기할 수 있어요.',
        'avatar_url': None,
        'creator_username': 'user123',
        'chat_count': 1250,
        'like_count': 89,
        'is_public': True,
        'created_at': '2024-01-01T00:00:00Z'
    },
    {
        'id': '2',
        'name': '루나',
        'description': '신비롭고 지적인 AI 캐릭터입니다. 철학적인 대화와 깊이 있는 토론을 좋아해요.',
        'avatar_url': None,
        'creator_username': 'creator456',
        'chat_count': 890,
        'like_count': 156,
        'is_public': True,
        'created_at': '2024-01-02T00:00:00Z'
    },
    {
        'id': '3',
        'name': '제이크',
        'description': '유머러스하고 재치있는 AI 캐릭터입니다. 농담과 재미있는 이야기로 즐거운 시간을 만들어드려요.',
        'avatar_url': None,
        'creator_username': 'funmaker',
        'chat_count': 2100,
        'like_count': 234,
        'is_public': True,
        'created_at': '2024-01-03T00:00:00Z'
    },
    {
        'id': '4',
        'name': '소피아',
        'description': '따뜻하고 공감능력이 뛰어난 AI 캐릭터입니다. 고민 상담과 감정적 지지를 제공해드려요.',
        'avatar_url': None,
        'creator_username': 'helper789',
        'chat_count': 1680,
        'like_count': 312,
        'is_public': True,
        'created_at': '2024-01-04T00:00:00Z'
    },
    {
        'id': '5',
        'name': '알렉스',
        'description': '창의적이고 예술적인 AI 캐릭터입니다. 시, 소설, 그림 등 다양한 창작 활동을 함께 해요.',
        'avatar_url': None,
        'creator_username': 'artist101',
        'chat_count': 756,
        'like_count': 98,
        'is_public': True,
        'created_at': '2024-01-05T00:00:00Z'
    },
    {
        'id': '6',
        'name': '마야',
        'description': '모험을 좋아하는 AI 캐릭터입니다. 판타지 세계의 이야기와 모험담을 들려드려요.',
        'avatar_url': None,
        'creator_username': 'adventurer',
        'chat_count': 1420,
        'like_count': 187,
        'is_public': True,
        'created_at': '2024-01-06T00:00:00Z'
    }
]

chat_history_db = {}  # character_id -> [messages]

@api_bp.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'message': 'AI 캐릭터 챗 API 서버가 정상 작동 중입니다.',
        'timestamp': datetime.utcnow().isoformat()
    })

@api_bp.route('/characters', methods=['GET'])
def get_characters():
    """캐릭터 목록 조회"""
    try:
        search = request.args.get('search', '')
        limit = int(request.args.get('limit', 20))
        
        # 검색 필터링
        filtered_characters = characters_db
        if search:
            filtered_characters = [
                char for char in characters_db 
                if search.lower() in char['name'].lower() or search.lower() in char['description'].lower()
            ]
        
        # 제한
        result = filtered_characters[:limit]
        
        return jsonify({
            'data': result,
            'total': len(filtered_characters),
            'limit': limit
        })
    except Exception as e:
        return jsonify({'error': f'캐릭터 목록 조회 실패: {str(e)}'}), 500

@api_bp.route('/characters/<character_id>', methods=['GET'])
def get_character(character_id):
    """특정 캐릭터 조회"""
    try:
        character = next((char for char in characters_db if char['id'] == character_id), None)
        if not character:
            return jsonify({'error': '캐릭터를 찾을 수 없습니다.'}), 404
        
        return jsonify({'data': character})
    except Exception as e:
        return jsonify({'error': f'캐릭터 조회 실패: {str(e)}'}), 500

@api_bp.route('/characters', methods=['POST'])
def create_character():
    """새 캐릭터 생성"""
    try:
        data = request.json
        
        # 필수 필드 확인
        if not data.get('name') or not data.get('description'):
            return jsonify({'error': '캐릭터 이름과 설명은 필수입니다.'}), 400
        
        # 새 캐릭터 생성
        new_character = {
            'id': str(uuid.uuid4()),
            'name': data['name'],
            'description': data['description'],
            'avatar_url': data.get('avatar_url'),
            'creator_username': data.get('creator_username', 'anonymous'),
            'chat_count': 0,
            'like_count': 0,
            'is_public': data.get('is_public', True),
            'created_at': datetime.utcnow().isoformat()
        }
        
        characters_db.append(new_character)
        
        return jsonify({
            'message': '캐릭터가 성공적으로 생성되었습니다.',
            'data': new_character
        }), 201
        
    except Exception as e:
        return jsonify({'error': f'캐릭터 생성 실패: {str(e)}'}), 500

@api_bp.route('/characters/<character_id>/chat', methods=['POST'])
def chat_with_character():
    """캐릭터와 채팅"""
    try:
        character_id = request.view_args['character_id']
        data = request.json
        
        # 캐릭터 찾기
        character = next((char for char in characters_db if char['id'] == character_id), None)
        if not character:
            return jsonify({'error': '캐릭터를 찾을 수 없습니다.'}), 404
        
        user_message = data.get('message', '')
        if not user_message:
            return jsonify({'error': '메시지를 입력해주세요.'}), 400
        
        # 채팅 기록 가져오기
        chat_history = chat_history_db.get(character_id, [])
        
        # AI 응답 생성
        ai_provider = data.get('provider', 'gemini')
        if AI_AVAILABLE and ai_service:
            ai_response = ai_service.generate_character_response(
                character_name=character['name'],
                character_description=character['description'],
                user_message=user_message,
                chat_history=chat_history,
                provider=ai_provider
            )
        else:
            # AI 서비스가 없을 때 기본 응답
            ai_response = f"안녕하세요! 저는 {character['name']}입니다. '{user_message}'에 대한 응답을 준비 중입니다. (AI 서비스 연결 중...)"
        
        # 채팅 기록 업데이트
        if character_id not in chat_history_db:
            chat_history_db[character_id] = []
        
        # 사용자 메시지 추가
        user_msg = {
            'id': str(uuid.uuid4()),
            'content': user_message,
            'sender_type': 'user',
            'timestamp': datetime.utcnow().isoformat()
        }
        chat_history_db[character_id].append(user_msg)
        
        # AI 응답 추가
        ai_msg = {
            'id': str(uuid.uuid4()),
            'content': ai_response,
            'sender_type': 'character',
            'timestamp': datetime.utcnow().isoformat()
        }
        chat_history_db[character_id].append(ai_msg)
        
        # 채팅 카운트 증가
        character['chat_count'] += 1
        
        return jsonify({
            'user_message': user_msg,
            'ai_response': ai_msg,
            'character': character
        })
        
    except Exception as e:
        return jsonify({'error': f'채팅 처리 실패: {str(e)}'}), 500

@api_bp.route('/characters/<character_id>/history', methods=['GET'])
def get_chat_history(character_id):
    """채팅 기록 조회"""
    try:
        # 캐릭터 존재 확인
        character = next((char for char in characters_db if char['id'] == character_id), None)
        if not character:
            return jsonify({'error': '캐릭터를 찾을 수 없습니다.'}), 404
        
        history = chat_history_db.get(character_id, [])
        limit = int(request.args.get('limit', 50))
        
        return jsonify({
            'data': history[-limit:],  # 최근 메시지부터
            'total': len(history),
            'character': character
        })
        
    except Exception as e:
        return jsonify({'error': f'채팅 기록 조회 실패: {str(e)}'}), 500

@api_bp.route('/stories/generate', methods=['POST'])
def generate_story():
    """AI 스토리 생성"""
    try:
        data = request.json
        
        keywords = data.get('keywords', [])
        genre = data.get('genre', '판타지')
        length = data.get('length', 'medium')
        provider = data.get('provider', 'gemini')
        
        if not keywords:
            return jsonify({'error': '키워드를 입력해주세요.'}), 400
        
        # AI로 스토리 생성
        if AI_AVAILABLE and ai_service:
            story_content = ai_service.generate_story(
                keywords=keywords,
                genre=genre,
                length=length,
                provider=provider
            )
        else:
            # AI 서비스가 없을 때 기본 스토리
            story_content = f"키워드 '{', '.join(keywords) if isinstance(keywords, list) else keywords}'를 바탕으로 한 {genre} 스토리를 생성 중입니다... (AI 서비스 연결 중)"
        
        # 스토리 정보 구성
        story = {
            'id': str(uuid.uuid4()),
            'title': f"{genre} 스토리",
            'content': story_content,
            'keywords': keywords,
            'genre': genre,
            'length': length,
            'provider': provider,
            'created_at': datetime.utcnow().isoformat()
        }
        
        return jsonify({
            'message': '스토리가 성공적으로 생성되었습니다.',
            'data': story
        })
        
    except Exception as e:
        return jsonify({'error': f'스토리 생성 실패: {str(e)}'}), 500

