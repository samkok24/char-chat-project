from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash, check_password_hash
from src.models.user import User, db
import jwt
import datetime
import os

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/register', methods=['POST', 'OPTIONS'])
def register():
    """회원가입"""
    if request.method == 'OPTIONS':
        # CORS preflight 요청 처리
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
        return response
        
    try:
        data = request.json
        
        # 필수 필드 확인
        if not data.get('email') or not data.get('password'):
            return jsonify({'error': '이메일과 비밀번호는 필수입니다.'}), 400
        
        # 이메일 중복 확인
        existing_user = User.query.filter_by(email=data['email']).first()
        if existing_user:
            return jsonify({'error': '이미 존재하는 이메일입니다.'}), 400
        
        # 사용자명 설정 (이메일에서 추출 또는 제공된 값 사용)
        username = data.get('username', data['email'].split('@')[0])
        
        # 사용자명 중복 확인
        existing_username = User.query.filter_by(username=username).first()
        if existing_username:
            # 중복되면 숫자 추가
            counter = 1
            original_username = username
            while existing_username:
                username = f"{original_username}{counter}"
                existing_username = User.query.filter_by(username=username).first()
                counter += 1
        
        # 비밀번호 해시화
        password_hash = generate_password_hash(data['password'])
        
        # 새 사용자 생성
        user = User(
            username=username,
            email=data['email'],
            password_hash=password_hash
        )
        
        db.session.add(user)
        db.session.commit()
        
        # JWT 토큰 생성
        token = generate_token(user.id)
        
        return jsonify({
            'message': '회원가입이 완료되었습니다.',
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email
            },
            'access_token': token,
            'refresh_token': token  # 현재는 같은 토큰을 사용, 나중에 별도 구현 가능
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'회원가입 중 오류가 발생했습니다: {str(e)}'}), 500

@auth_bp.route('/login', methods=['POST', 'OPTIONS'])
def login():
    """로그인"""
    if request.method == 'OPTIONS':
        # CORS preflight 요청 처리
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
        return response
        
    try:
        data = request.json
        
        # 필수 필드 확인
        if not data.get('email') or not data.get('password'):
            return jsonify({'error': '이메일과 비밀번호를 입력해주세요.'}), 400
        
        # 사용자 찾기
        user = User.query.filter_by(email=data['email']).first()
        
        if not user or not check_password_hash(user.password_hash, data['password']):
            return jsonify({'error': '이메일 또는 비밀번호가 올바르지 않습니다.'}), 401
        
        # JWT 토큰 생성
        token = generate_token(user.id)
        
        return jsonify({
            'message': '로그인 성공',
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email
            },
            'access_token': token,
            'refresh_token': token  # 현재는 같은 토큰을 사용, 나중에 별도 구현 가능
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'로그인 중 오류가 발생했습니다: {str(e)}'}), 500

@auth_bp.route('/me', methods=['GET'])
def get_current_user():
    """현재 사용자 정보 조회"""
    try:
        # Authorization 헤더에서 토큰 추출
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': '인증 토큰이 필요합니다.'}), 401
        
        token = auth_header.split(' ')[1]
        
        # 토큰 검증
        user_id = verify_token(token)
        if not user_id:
            return jsonify({'error': '유효하지 않은 토큰입니다.'}), 401
        
        # 사용자 정보 조회
        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': '사용자를 찾을 수 없습니다.'}), 404
        
        return jsonify({
            'data': {
                'id': user.id,
                'username': user.username,
                'email': user.email
            }
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'사용자 정보 조회 중 오류가 발생했습니다: {str(e)}'}), 500

def generate_token(user_id):
    """JWT 토큰 생성"""
    payload = {
        'user_id': user_id,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    secret_key = os.getenv('JWT_SECRET_KEY', 'default-secret-key')
    return jwt.encode(payload, secret_key, algorithm='HS256')

def verify_token(token):
    """JWT 토큰 검증"""
    try:
        secret_key = os.getenv('JWT_SECRET_KEY', 'default-secret-key')
        payload = jwt.decode(token, secret_key, algorithms=['HS256'])
        return payload['user_id']
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

