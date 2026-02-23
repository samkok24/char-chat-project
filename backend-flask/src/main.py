import os
import sys
# DON'T CHANGE THIS !!!
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flask import Flask, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
from src.models.user import db
from src.routes.user import user_bp
from src.routes.api import api_bp
from src.routes.auth import auth_bp

# AI 서비스 조건부 import
try:
    from src.services.ai_service import ai_service
    AI_AVAILABLE = True
except ImportError as e:
    print(f"AI 서비스를 사용할 수 없습니다: {e}")
    AI_AVAILABLE = False
    ai_service = None

app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), 'static'))
app.config['SECRET_KEY'] = 'asdf#FGSgvasgf$5$WGT'

# CORS 설정 - 모든 도메인에서 모든 메서드 허용
CORS(app, 
     origins=["*"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
     allow_headers=["Content-Type", "Authorization"],
     supports_credentials=True)

# SocketIO 설정
socketio = SocketIO(app, cors_allowed_origins="*")

app.register_blueprint(user_bp, url_prefix='/api')
app.register_blueprint(api_bp, url_prefix='/api')
app.register_blueprint(auth_bp, url_prefix='/api/auth')

# uncomment if you need to use database
app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(os.path.dirname(__file__), 'database', 'app.db')}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db.init_app(app)
with app.app_context():
    db.create_all()

# Socket.IO 이벤트 핸들러
@socketio.on('connect')
def handle_connect():
    print('클라이언트가 연결되었습니다.')
    emit('connected', {'message': '서버에 연결되었습니다.'})

@socketio.on('disconnect')
def handle_disconnect():
    print('클라이언트가 연결을 해제했습니다.')

@socketio.on('join_character_room')
def handle_join_character_room(data):
    character_id = data.get('character_id')
    if character_id:
        join_room(f'character_{character_id}')
        emit('joined_room', {'character_id': character_id})
        print(f'사용자가 캐릭터 {character_id} 방에 참가했습니다.')

@socketio.on('leave_character_room')
def handle_leave_character_room(data):
    character_id = data.get('character_id')
    if character_id:
        leave_room(f'character_{character_id}')
        emit('left_room', {'character_id': character_id})
        print(f'사용자가 캐릭터 {character_id} 방을 떠났습니다.')

@socketio.on('send_message')
def handle_send_message(data):
    try:
        character_id = data.get('character_id')
        user_message = data.get('message')
        provider = data.get('provider', 'gemini')
        
        if not character_id or not user_message:
            emit('error', {'message': '캐릭터 ID와 메시지가 필요합니다.'})
            return
        
        # 캐릭터 정보 가져오기 (API 라우트에서 가져온 데이터 사용)
        from src.routes.api import characters_db, chat_history_db
        character = next((char for char in characters_db if char['id'] == character_id), None)
        
        if not character:
            emit('error', {'message': '캐릭터를 찾을 수 없습니다.'})
            return
        
        # 채팅 기록 가져오기
        chat_history = chat_history_db.get(character_id, [])
        
        # AI 응답 생성
        if AI_AVAILABLE and ai_service:
            ai_response = ai_service.generate_character_response(
                character_name=character['name'],
                character_description=character['description'],
                user_message=user_message,
                chat_history=chat_history,
                provider=provider
            )
        else:
            # AI 서비스가 없을 때 기본 응답
            ai_response = f"안녕하세요! 저는 {character['name']}입니다. '{user_message}'에 대한 응답을 준비 중입니다. (AI 서비스 연결 중...)"
        
        # 메시지 데이터 구성
        import uuid
        from datetime import datetime
        
        user_msg = {
            'id': str(uuid.uuid4()),
            'content': user_message,
            'sender_type': 'user',
            'timestamp': datetime.utcnow().isoformat()
        }
        
        ai_msg = {
            'id': str(uuid.uuid4()),
            'content': ai_response,
            'sender_type': 'character',
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # 채팅 기록 업데이트
        if character_id not in chat_history_db:
            chat_history_db[character_id] = []
        
        chat_history_db[character_id].append(user_msg)
        chat_history_db[character_id].append(ai_msg)
        
        # 채팅 카운트 증가
        character['chat_count'] += 1
        
        # 방의 모든 사용자에게 메시지 전송
        socketio.emit('new_message', {
            'user_message': user_msg,
            'ai_response': ai_msg,
            'character': character
        }, room=f'character_{character_id}')
        
    except Exception as e:
        print(f'메시지 처리 오류: {e}')
        emit('error', {'message': f'메시지 처리 중 오류가 발생했습니다: {str(e)}'})

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    static_folder_path = app.static_folder
    if static_folder_path is None:
            return "Static folder not configured", 404

    if path != "" and os.path.exists(os.path.join(static_folder_path, path)):
        return send_from_directory(static_folder_path, path)
    else:
        index_path = os.path.join(static_folder_path, 'index.html')
        if os.path.exists(index_path):
            return send_from_directory(static_folder_path, 'index.html')
        else:
            return "index.html not found", 404


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
