# 프로젝트 소스 코드 분석 보고서

이 문서는 `char-chat-project`의 현재 소스 코드 구조와 각 모듈의 역할을 분석하여 정리한 것입니다.

## 1. `backend-api` (FastAPI)

FastAPI 기반의 메인 백엔드 서버입니다. REST API 제공을 주 목적으로 합니다.

### 1-1. `app/`

애플리케이션의 핵심 로직이 담긴 디렉터리입니다. **관심사 분리(SoC)** 원칙에 따라 체계적으로 구조화되어 있습니다.

-   **`api/`**: API 엔드포인트(라우터)를 정의합니다. (`/characters`, `/chat` 등)
-   **`core/`**: 설정, 보안, DB 연결 등 애플리케이션의 핵심 기반을 담당합니다.
-   **`models/`**: SQLAlchemy 데이터베이스 모델을 정의합니다. (테이블 구조)
-   **`schemas/`**: Pydantic 스키마를 정의하여 API의 입출력 데이터 유효성을 검사합니다.
-   **`services/`**: 실제 기능이 처리되는 비즈니스 로직을 구현합니다.

### 1-2. 기타 파일

-   **`Dockerfile`**: 백엔드 서버의 Docker 이미지를 생성합니다.
-   **`requirements.txt`**: 필요한 Python 라이브러리 목록입니다.
-   **`migrations/`**: DB 스키마 변경 이력을 관리하는 SQL 파일들이 있습니다.
-   **`precise_migration.py`**: 기존 데이터를 보존하며 안전하게 DB 스키마를 업데이트하는 커스텀 마이그레이션 스크립트입니다.

## 2. `chat-server` (Node.js + Socket.IO)

실시간 양방향 통신을 담당하는 독립적인 채팅 서버입니다.

-   **`src/`**: Node.js 소스 코드가 위치합니다.
    -   **`controllers/socketController.js`**: 소켓 이벤트(`sendMessage` 등)를 처리하는 핵심 로직입니다.
    -   **`middleware/authMiddleware.js`**: JWT를 통해 소켓 연결을 시도하는 사용자를 인증합니다.
    -   **`services/`**: Redis, AI API 등 외부 서비스와 연동하는 로직이 있습니다.
-   **`package.json`**: 필요한 Node.js 라이브러리(`socket.io`, `redis` 등) 목록입니다.

## 3. `frontend` (React + Vite)

사용자 인터페이스(UI)를 구축하는 React 기반의 프론트엔드 프로젝트입니다.

-   **`src/`**: 프론트엔드 로직의 핵심입니다.
    -   **`pages/`**: URL 경로에 따라 보여지는 페이지 단위의 컴포넌트입니다. (`HomePage`, `ChatPage` 등)
    -   **`components/`**: 버튼, 헤더 등 재사용 가능한 UI 조각들입니다. `shadcn/ui`가 사용되었습니다.
    -   **`contexts/`**: `AuthContext`, `SocketContext` 등을 통해 로그인 상태나 소켓 연결 같은 전역 상태를 관리합니다.
    -   **`lib/api.js`**: 백엔드 API 서버와 통신하는 함수들을 모아놓은 파일입니다.
-   **`vite.config.js`**: 빌드 도구로 Vite를 사용하여 빠른 개발 환경을 구성합니다.

## 4. `backend-flask`

FastAPI 서버와는 별개인 또 다른 Python 백엔드 서버입니다.

-   **`src/static/`**: 내부에 `index.html`과 JS/CSS 에셋을 포함하고 있어, API뿐만 아니라 웹페이지도 직접 제공하는 형태입니다.
-   **역할 추정**: 현재 메인 서비스와는 분리된 보조 기능(관리자 페이지, 특정 데모 등)을 수행하거나, 과거 버전의 레거시 코드로 추정됩니다.

## 5. `docker` 및 최상위 레벨 파일

프로젝트 전체의 개발 및 배포 환경을 구성합니다.

-   **`docker-compose.dev.yml`**: 개발 환경에서 필요한 모든 서비스(`backend`, `chat-server`, `frontend`, `redis`)를 한 번에 실행하고 관리하는 핵심 파일입니다. `volumes` 설정을 통해 로컬 코드와 컨테이너 내부를 실시간 동기화하여 개발 효율성을 높입니다.
-   **`docker/`**: `nginx.conf`, `docker-compose.yml` 등을 포함하며, 실제 프로덕션 배포 환경을 위한 설정들을 담고 있습니다.
-   **`.bat` 스크립트**: Windows 환경에서 Docker 컨테이너를 쉽게 시작하고 중지하기 위한 편의 스크립트입니다. 