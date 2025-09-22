import os
import uuid
from typing import Optional


class Storage:
    def save_bytes(self, data: bytes, *, content_type: Optional[str] = None, key_hint: Optional[str] = None) -> str:
        raise NotImplementedError
    def generate_presigned_url(self, key: str, *, expires_in: int = 300) -> Optional[str]:
        return None


class LocalStorage(Storage):
    def __init__(self, base_dir: str, public_base: str = "/static") -> None:
        self.base_dir = base_dir
        self.public_base = public_base.rstrip("/")
        os.makedirs(self.base_dir, exist_ok=True)

    def save_bytes(self, data: bytes, *, content_type: Optional[str] = None, key_hint: Optional[str] = None) -> str:
        ext = ".png"
        if key_hint and "." in key_hint:
            ext = "." + key_hint.split(".")[-1]
        name = f"{uuid.uuid4()}{ext}"
        path = os.path.join(self.base_dir, name)
        with open(path, "wb") as f:
            f.write(data)
        return f"{self.public_base}/{name}"


class S3Storage(Storage):
    def __init__(self, *, endpoint_url: str, access_key: str, secret_key: str, bucket: str, region: Optional[str] = None, public_base_url: Optional[str] = None) -> None:
        try:
            import boto3  # type: ignore
            from botocore.config import Config  # type: ignore
        except Exception as e:
            raise RuntimeError("boto3 not installed") from e
        self._boto3 = boto3
        addressing_style = (os.getenv("S3_ADDRESSING_STYLE") or os.getenv("R2_ADDRESSING_STYLE") or "path").lower()
        # R2는 프리사인에 SigV4 필요. 주소 스타일은 env로 선택(path/virtual)
        cfg = Config(signature_version="s3v4", s3={"addressing_style": addressing_style})
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=cfg,
        )
        self.bucket = bucket
        self.public_base_url = public_base_url.rstrip("/") if public_base_url else None
        # Ensure bucket exists or provide actionable error
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except Exception as e:
            auto_create = os.getenv("S3_AUTO_CREATE_BUCKET") == "1" or os.getenv("R2_AUTO_CREATE_BUCKET") == "1"
            if auto_create:
                try:
                    # R2/S3 create bucket (R2는 권한 필요)
                    self.client.create_bucket(Bucket=self.bucket)
                except Exception as ce:
                    raise RuntimeError(f"Storage bucket '{self.bucket}' not found and auto-create failed: {ce}")
            else:
                raise RuntimeError(f"Storage bucket '{self.bucket}' not found. Create it in R2 dashboard and set R2_BUCKET correctly. Original: {e}")

    def save_bytes(self, data: bytes, *, content_type: Optional[str] = None, key_hint: Optional[str] = None) -> str:
        ext = ""
        if key_hint and "." in key_hint:
            ext = "." + key_hint.split(".")[-1]
        key = f"uploads/{uuid.uuid4()}{ext}"
        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, **extra_args)
        if self.public_base_url:
            return f"{self.public_base_url}/{key}"
        # 기본 S3 URL (path-style 권장: endpoint/bucket/key)
        endpoint = self.client.meta.endpoint_url.rstrip("/")
        return f"{endpoint}/{self.bucket}/{key}"

    def generate_presigned_url(self, key: str, *, expires_in: int = 300) -> Optional[str]:
        try:
            url = self.client.generate_presigned_url(
                ClientMethod="get_object",
                Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=max(60, min(3600, int(expires_in))),
            )
            return url
        except Exception:
            return None


def get_storage() -> Storage:
    backend = (os.getenv("STORAGE_BACKEND") or "local").lower()
    if backend == "s3":
        endpoint = os.getenv("S3_ENDPOINT_URL") or os.getenv("R2_ENDPOINT_URL")
        access_key = os.getenv("S3_ACCESS_KEY_ID") or os.getenv("R2_ACCESS_KEY_ID")
        secret_key = os.getenv("S3_SECRET_ACCESS_KEY") or os.getenv("R2_SECRET_ACCESS_KEY")
        bucket = os.getenv("S3_BUCKET") or os.getenv("R2_BUCKET")
        region = os.getenv("S3_REGION") or os.getenv("R2_REGION")
        public_base = os.getenv("S3_PUBLIC_BASE_URL") or os.getenv("R2_PUBLIC_BASE_URL")
        if not (endpoint and access_key and secret_key and bucket):
            raise RuntimeError("S3/R2 storage is not fully configured")
        return S3Storage(endpoint_url=endpoint, access_key=access_key, secret_key=secret_key, bucket=bucket, region=region, public_base_url=public_base)
    else:
        # local
        from app.core.paths import get_upload_dir
        base_dir = get_upload_dir()
        return LocalStorage(base_dir=base_dir, public_base="/static")


