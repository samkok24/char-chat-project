# Node.js 20 Alpine 이미지 사용
FROM node:20-alpine

# 작업 디렉토리 설정
WORKDIR /app

# package.json과 pnpm-lock.yaml 복사
COPY package.json pnpm-lock.yaml* ./

# pnpm 설치 및 의존성 설치
RUN npm install -g pnpm
RUN pnpm install

# 애플리케이션 코드 복사
COPY . .

# 포트 노출
EXPOSE 5173

# 개발 서버 실행
CMD ["pnpm", "run", "dev", "--host", "0.0.0.0", "--port", "5173"]

