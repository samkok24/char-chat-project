import os


def get_project_root() -> str:
    """backend-api 프로젝트 루트 절대경로를 반환한다.
    이 파일은 backend-api/app/core/paths.py 에 위치하므로,
    상위 상위 디렉토리가 프로젝트 루트가 된다.
    """
    app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    project_root = os.path.dirname(app_dir)
    return project_root


def get_upload_dir() -> str:
    """업로드 디렉토리 절대경로를 반환한다.
    - 환경변수 UPLOAD_DIRECTORY 가 설정되면 이를 우선 사용한다.
    - 없으면 프로젝트 루트의 data/uploads 를 사용한다.
    디렉토리는 존재를 보장한다.
    """
    env_dir = os.getenv("UPLOAD_DIRECTORY")
    if env_dir:
        os.makedirs(env_dir, exist_ok=True)
        return env_dir

    uploads = os.path.join(get_project_root(), "data", "uploads")
    os.makedirs(uploads, exist_ok=True)
    return uploads



