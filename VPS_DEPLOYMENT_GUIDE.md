# 🚀 VPS 배포 및 도메인 연결 가이드

> VPS(가상 서버)에 배포하고 도메인을 연결하는 완전한 가이드

## 📋 목차

1. [VPS 선택 및 서버 준비](#1-vps-선택-및-서버-준비)
2. [서버 초기 설정](#2-서버-초기-설정)
3. [Docker 설치](#3-docker-설치)
4. [도메인 구매 및 DNS 설정](#4-도메인-구매-및-dns-설정)
5. [프로젝트 배포](#5-프로젝트-배포)
6. [SSL 인증서 설정 (Let's Encrypt)](#6-ssl-인증서-설정-lets-encrypt)
7. [Nginx 설정](#7-nginx-설정)
8. [방화벽 설정](#8-방화벽-설정)
9. [모니터링 및 유지보수](#9-모니터링-및-유지보수)

---

## 1. VPS 선택 및 서버 준비

### 추천 VPS 제공업체

| 제공업체 | 최소 사양 | 월 비용 | 추천 이유 |
|---------|----------|---------|----------|
| **DigitalOcean** | 2GB RAM, 1 vCPU | $12 | 간단한 UI, 좋은 문서 |
| **Linode** | 2GB RAM, 1 vCPU | $12 | 빠른 성능, 좋은 지원 |
| **Vultr** | 2GB RAM, 1 vCPU | $12 | 전 세계 위치, 빠른 SSD |
| **AWS EC2** | t3.small | ~$15 | 확장성, 다양한 옵션 |
| **Hetzner** | 2GB RAM, 1 vCPU | €4.15 | 저렴한 가격, 유럽 위치 |

### 최소 서버 사양

- **RAM**: 2GB 이상 (권장: 4GB)
- **CPU**: 1 vCPU 이상 (권장: 2 vCPU)
- **Storage**: 20GB 이상 SSD
- **OS**: Ubuntu 22.04 LTS 또는 Debian 12

### 서버 생성 후 확인사항

1. **IP 주소 확인**: 서버 대시보드에서 공인 IP 확인
2. **SSH 키 설정**: 공개 키를 서버에 등록
3. **루트 접근**: SSH로 서버 접속 가능한지 확인

---

## 2. 서버 초기 설정

### 2.1 서버 접속

```bash
# SSH로 서버 접속
ssh root@your-server-ip

# 또는 키 파일 사용
ssh -i ~/.ssh/your-key.pem root@your-server-ip
```

### 2.2 시스템 업데이트

```bash
# Ubuntu/Debian
apt update && apt upgrade -y

# 시간대 설정
timedatectl set-timezone Asia/Seoul
```

### 2.3 사용자 생성 (선택사항, 보안 강화)

```bash
# 새 사용자 생성
adduser deploy
usermod -aG sudo deploy

# SSH 키 복사
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# 루트 SSH 비활성화 (선택사항)
# nano /etc/ssh/sshd_config
# PermitRootLogin no
# systemctl restart sshd
```

---

## 3. Docker 설치

### 3.1 Docker 설치

```bash
# Docker 설치 스크립트 실행
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Docker Compose 설치
apt install docker-compose-plugin -y

# Docker 서비스 시작
systemctl start docker
systemctl enable docker

# 현재 사용자를 docker 그룹에 추가
usermod -aG docker $USER
# 또는
usermod -aG docker deploy

# 재접속 후 확인
docker --version
docker compose version
```

### 3.2 Docker 확인

```bash
# Docker가 정상 작동하는지 확인
docker run hello-world
```

---

## 4. 도메인 구매 및 DNS 설정

### 4.1 도메인 구매

**추천 도메인 등록업체:**
- **Namecheap**: 저렴하고 간단
- **Cloudflare**: DNS 관리 편리, 무료 프록시
- **Google Domains**: 간단한 UI
- **가비아/후이즈**: 한국 도메인 (.kr)

### 4.2 DNS 설정

도메인 등록업체의 DNS 관리 페이지에서 다음 레코드 추가:

#### A 레코드 (IPv4)

```
Type: A
Name: @ (또는 비워두기)
Value: your-server-ip
TTL: 3600 (또는 기본값)
```

#### A 레코드 (www 서브도메인)

```
Type: A
Name: www
Value: your-server-ip
TTL: 3600
```

#### CNAME 레코드 (선택사항, www를 메인 도메인으로 리다이렉트)

```
Type: CNAME
Name: www
Value: your-domain.com
TTL: 3600
```

### 4.3 DNS 전파 확인

```bash
# DNS 전파 확인 (몇 분~몇 시간 소요)
nslookup your-domain.com
dig your-domain.com

# 또는 온라인 도구 사용
# https://www.whatsmydns.net/
```

---

## 5. 프로젝트 배포

### 5.1 프로젝트 클론

```bash
# 프로젝트 디렉토리 생성
mkdir -p /opt/char-chat
cd /opt/char-chat

# Git에서 클론 (또는 SCP로 업로드)
git clone https://github.com/yourusername/char-chat-project.git .

# 또는 SCP로 업로드
# 로컬에서 실행:
# scp -r ./char-chat-project root@your-server-ip:/opt/char-chat
```

### 5.2 환경 변수 설정

```bash
# 프로젝트 루트에 .env 파일 생성
cd /opt/char-chat
nano .env
```

`.env` 파일 내용:

```env
# ============================================
# 환경 설정
# ============================================
ENVIRONMENT=production
DEBUG=false
NODE_ENV=production

# ============================================
# 데이터베이스 설정 (PostgreSQL)
# ============================================
POSTGRES_DB=char_chat_db
POSTGRES_USER=char_chat_user
POSTGRES_PASSWORD=your-secure-password-here-MUST-CHANGE

# ============================================
# Redis 설정
# ============================================
REDIS_URL=redis://redis:6379/0

# ============================================
# JWT 인증 설정
# ============================================
SECRET_KEY=your-super-secret-key-change-this-MUST-CHANGE
JWT_SECRET_KEY=your-super-secret-jwt-key-change-this-MUST-CHANGE
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# ============================================
# AI API 키 (최소 1개 필수)
# ============================================
GEMINI_API_KEY=your-gemini-api-key-here
CLAUDE_API_KEY=your-claude-api-key-here
OPENAI_API_KEY=your-openai-api-key-here
IMAGEN_API_KEY=your-imagen-api-key-here

# ============================================
# 프론트엔드 URL 설정
# ============================================
FRONTEND_BASE_URL=https://your-domain.com
VITE_API_URL=https://api.your-domain.com
VITE_SOCKET_URL=wss://socket.your-domain.com

# ============================================
# 파일 저장소 설정 (S3/R2 호환)
# ============================================
STORAGE_BACKEND=S3
R2_ENDPOINT_URL=https://your-r2-endpoint.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET=your-bucket-name
R2_PUBLIC_BASE_URL=https://your-cdn-domain.com
R2_ADDRESSING_STYLE=path

# ============================================
# 기능 플래그
# ============================================
ORIGCHAT_V2=true
RANKING_SCHEDULER_ENABLED=1
```

### 5.3 Docker Compose 설정 수정

```bash
cd /opt/char-chat/docker

# docker-compose.yml 확인 및 수정
nano docker-compose.yml
```

프로덕션용 설정 확인:
- 환경 변수가 `.env` 파일에서 로드되는지 확인
- 포트가 외부에 노출되지 않도록 설정 (Nginx만 외부 노출)

### 5.4 프론트엔드 빌드 설정

프로덕션 빌드를 위해 프론트엔드 Dockerfile 수정이 필요할 수 있습니다:

```bash
cd /opt/char-chat/frontend/char-chat-frontend
nano Dockerfile
```

프로덕션용 Dockerfile 예시:

```dockerfile
# 빌드 단계
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_URL
ARG VITE_SOCKET_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
RUN pnpm build

# 프로덕션 단계
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 5.5 데이터베이스 마이그레이션

```bash
# PostgreSQL 컨테이너 시작
cd /opt/char-chat/docker
docker compose up -d postgres

# 잠시 대기 (데이터베이스 초기화)
sleep 10

# 마이그레이션 실행
docker compose exec backend python postgres_migration.py

# 또는 수동으로 SQL 실행
docker compose exec postgres psql -U char_chat_user -d char_chat_db -f /docker-entrypoint-initdb.d/init.sql
```

---

## 6. SSL 인증서 설정 (Let's Encrypt)

### 6.1 Certbot 설치

```bash
# Certbot 설치
apt install certbot python3-certbot-nginx -y
```

### 6.2 Nginx 컨테이너 외부에서 SSL 설정

Nginx가 Docker 컨테이너로 실행되므로, 호스트에 Nginx를 임시로 설치하거나 다른 방법 사용:

**방법 1: 호스트에 Nginx 설치 (권장)**

```bash
# 호스트에 Nginx 설치
apt install nginx -y

# 기본 설정 비활성화
rm /etc/nginx/sites-enabled/default

# Certbot으로 인증서 발급
certbot certonly --standalone -d your-domain.com -d www.your-domain.com

# 인증서 위치 확인
ls -la /etc/letsencrypt/live/your-domain.com/
```

**방법 2: Docker 컨테이너 내부에서 설정 (복잡)**

Docker 볼륨으로 인증서를 마운트해야 합니다.

### 6.3 인증서 자동 갱신 설정

```bash
# Certbot 자동 갱신 테스트
certbot renew --dry-run

# Cron 작업 추가 (매일 2시에 확인)
crontab -e
# 다음 줄 추가:
0 2 * * * certbot renew --quiet --deploy-hook "docker compose -f /opt/char-chat/docker/docker-compose.yml restart nginx"
```

---

## 7. Nginx 설정

### 7.1 프로덕션용 Nginx 설정 파일 생성

```bash
cd /opt/char-chat/docker
nano nginx.production.conf
```

프로덕션용 Nginx 설정:

```nginx
events {
    worker_connections 1024;
}

http {
    # 업스트림 서버 정의
    upstream frontend {
        server frontend:3000;
    }

    upstream backend {
        server backend:8000;
    }

    upstream chat {
        server chat-server:3001;
    }

    # 로그 설정
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    # 기본 설정
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 100M;

    # Gzip 압축
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss;

    # HTTP에서 HTTPS로 리다이렉트
    server {
        listen 80;
        server_name your-domain.com www.your-domain.com;
        
        # Let's Encrypt 인증을 위한 경로
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        # 모든 HTTP 요청을 HTTPS로 리다이렉트
        location / {
            return 301 https://$server_name$request_uri;
        }
    }

    # HTTPS 서버 설정
    server {
        listen 443 ssl http2;
        server_name your-domain.com www.your-domain.com;

        # SSL 인증서 설정
        ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

        # SSL 보안 설정
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 10m;

        # HSTS 헤더
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

        # 프론트엔드 (React 앱)
        location / {
            proxy_pass http://frontend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # WebSocket 지원
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }

        # API 요청
        location /api/ {
            proxy_pass http://backend/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # 타임아웃 설정
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
        }

        # 정적 파일 (업로드된 파일)
        location /static/ {
            proxy_pass http://backend/static/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # 캐싱 설정
            expires 7d;
            add_header Cache-Control "public";
        }

        # Socket.IO 연결
        location /socket.io/ {
            proxy_pass http://chat;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # WebSocket 타임아웃
            proxy_read_timeout 86400;
        }

        # 정적 파일 캐싱
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            proxy_pass http://frontend;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

### 7.2 Docker Compose에 SSL 볼륨 추가

`docker/docker-compose.yml` 수정:

```yaml
  nginx:
    image: nginx:alpine
    container_name: char_chat_nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.production.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro  # SSL 인증서 마운트
      - /var/www/certbot:/var/www/certbot:ro  # Certbot 인증 경로
    depends_on:
      - frontend
      - backend
      - chat-server
    networks:
      - char_chat_network
    restart: unless-stopped
```

### 7.3 서비스 시작

```bash
cd /opt/char-chat/docker
docker compose up -d --build
```

---

## 8. 방화벽 설정

### 8.1 UFW 방화벽 설정

```bash
# UFW 설치 및 활성화
apt install ufw -y
ufw default deny incoming
ufw default allow outgoing

# 필요한 포트만 열기
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS

# 방화벽 활성화
ufw enable

# 상태 확인
ufw status
```

### 8.2 Cloud Provider 방화벽 (선택사항)

DigitalOcean, AWS 등에서는 추가로 방화벽 규칙을 설정할 수 있습니다:
- **인바운드**: 22 (SSH), 80 (HTTP), 443 (HTTPS)만 허용
- **아웃바운드**: 모두 허용

---

## 9. 모니터링 및 유지보수

### 9.1 로그 확인

```bash
# 모든 서비스 로그
cd /opt/char-chat/docker
docker compose logs -f

# 특정 서비스 로그
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f nginx
```

### 9.2 서비스 상태 확인

```bash
# 컨테이너 상태 확인
docker compose ps

# 리소스 사용량 확인
docker stats

# 디스크 사용량 확인
df -h
docker system df
```

### 9.3 백업 스크립트

```bash
# 백업 스크립트 생성
nano /opt/char-chat/backup.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# PostgreSQL 백업
docker compose exec -T postgres pg_dump -U char_chat_user char_chat_db > $BACKUP_DIR/db_$DATE.sql

# Redis 백업 (선택사항)
docker compose exec -T redis redis-cli SAVE
docker compose cp redis:/data/dump.rdb $BACKUP_DIR/redis_$DATE.rdb

# 오래된 백업 삭제 (30일 이상)
find $BACKUP_DIR -name "*.sql" -mtime +30 -delete
find $BACKUP_DIR -name "*.rdb" -mtime +30 -delete

echo "Backup completed: $DATE"
```

```bash
# 실행 권한 부여
chmod +x /opt/char-chat/backup.sh

# Cron에 추가 (매일 새벽 3시)
crontab -e
# 추가:
0 3 * * * /opt/char-chat/backup.sh >> /var/log/backup.log 2>&1
```

### 9.4 자동 재시작 설정

Docker Compose의 `restart: unless-stopped` 설정으로 자동 재시작이 이미 설정되어 있습니다.

### 9.5 업데이트 프로세스

```bash
# 코드 업데이트
cd /opt/char-chat
git pull

# 환경 변수 확인
nano .env

# 재빌드 및 재시작
cd docker
docker compose down
docker compose up -d --build

# 마이그레이션 실행 (필요시)
docker compose exec backend python postgres_migration.py
```

---

## 🔧 문제 해결

### 문제 1: SSL 인증서 발급 실패

```bash
# 포트 80이 열려있는지 확인
netstat -tuln | grep :80

# Nginx가 80 포트를 사용 중이면 중지
systemctl stop nginx
docker compose stop nginx

# Certbot 재실행
certbot certonly --standalone -d your-domain.com
```

### 문제 2: 도메인 연결 안 됨

```bash
# DNS 확인
nslookup your-domain.com
dig your-domain.com

# 방화벽 확인
ufw status
iptables -L

# Nginx 로그 확인
docker compose logs nginx
```

### 문제 3: 서비스가 시작되지 않음

```bash
# 로그 확인
docker compose logs

# 컨테이너 상태 확인
docker compose ps

# 환경 변수 확인
docker compose exec backend env | grep DATABASE_URL
```

### 문제 4: 데이터베이스 연결 실패

```bash
# PostgreSQL 컨테이너 확인
docker compose ps postgres

# 연결 테스트
docker compose exec postgres psql -U char_chat_user -d char_chat_db

# 환경 변수 확인
docker compose exec backend env | grep DATABASE_URL
```

---

## 📚 추가 리소스

- [DigitalOcean 튜토리얼](https://www.digitalocean.com/community/tutorials)
- [Let's Encrypt 문서](https://letsencrypt.org/docs/)
- [Nginx 문서](https://nginx.org/en/docs/)
- [Docker Compose 문서](https://docs.docker.com/compose/)

---

## ✅ 배포 체크리스트

- [ ] VPS 서버 생성 완료
- [ ] 서버 초기 설정 완료
- [ ] Docker 및 Docker Compose 설치 완료
- [ ] 도메인 구매 및 DNS 설정 완료
- [ ] 프로젝트 클론 및 환경 변수 설정 완료
- [ ] 데이터베이스 마이그레이션 완료
- [ ] SSL 인증서 발급 완료
- [ ] Nginx 설정 완료
- [ ] 방화벽 설정 완료
- [ ] 서비스 시작 및 테스트 완료
- [ ] 백업 스크립트 설정 완료
- [ ] 모니터링 설정 완료

---

**마지막 업데이트**: 2024년 8월
**버전**: 1.0


