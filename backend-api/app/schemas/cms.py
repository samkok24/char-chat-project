"""
CMS(홈 배너/홈 구좌) 설정 관련 Pydantic 스키마

의도:
- 프론트에서 관리자가 편집하는 "홈 배너/구좌" 설정을 서버(DB)에 저장/조회한다.
- 운영에서 모든 유저에게 동일하게 반영되도록 SSOT를 서버로 옮긴다.

방어적:
- 문자열은 trim + 태그 제거로 최소한의 입력 정리를 한다.
- 프론트와의 호환을 위해 camelCase 필드명을 그대로 사용한다.
"""

from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Optional, Any, Dict, List, Literal
import re


def _sanitize_text(value: Optional[str], max_length: Optional[int] = None) -> Optional[str]:
    """입력 텍스트를 방어적으로 정리한다(태그 제거 + trim)."""
    if value is None:
        return None
    text = re.sub(r"<[^>]*>", "", str(value)).strip()
    if max_length is not None and len(text) > max_length:
        raise ValueError(f"최대 {max_length}자까지 입력할 수 있습니다.")
    return text


class HomeBanner(BaseModel):
    """
    홈 배너 단위(프론트 cmsBanners.js와 동일 필드명)

    주의:
    - imageUrl/mobileImageUrl/linkUrl은 빈 문자열도 허용한다.
    - startAt/endAt/createdAt/updatedAt은 ISO 문자열 또는 null.
    """

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., min_length=1, max_length=80)
    title: str = Field("배너", min_length=1, max_length=200)
    imageUrl: str = Field("", max_length=2000)
    mobileImageUrl: str = Field("", max_length=2000)
    linkUrl: str = Field("", max_length=2000)
    openInNewTab: bool = False
    enabled: bool = True
    # ✅ 노출 대상: 전체/PC만/모바일만 (프론트 CMS에서 선택)
    # - 방어적으로 문자열로 받고, 유효하지 않으면 all로 보정한다.
    displayOn: str = Field("all", max_length=10)  # all|pc|mobile

    startAt: Optional[str] = None
    endAt: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None

    @field_validator("id", "title", "imageUrl", "mobileImageUrl", "linkUrl", mode="before")
    @classmethod
    def sanitize_strings(cls, v, info):
        max_map = {
            "id": 80,
            "title": 200,
            "imageUrl": 2000,
            "mobileImageUrl": 2000,
            "linkUrl": 2000,
        }
        out = _sanitize_text(v, max_map.get(info.field_name))
        return out if out is not None else ""

    @field_validator("displayOn", mode="before")
    @classmethod
    def sanitize_display_on(cls, v):
        raw = _sanitize_text(v, 10)
        key = (raw or "all").strip().lower()
        if key in ("pc", "desktop"):
            return "pc"
        if key in ("mobile", "m", "phone"):
            return "mobile"
        return "all"


class HomeSlotPick(BaseModel):
    """커스텀 구좌에 담기는 선택 항목(캐릭터/웹소설)"""

    model_config = ConfigDict(extra="ignore")

    type: Literal["character", "story"]
    # 프론트에서 여러 메타를 담아 저장하므로 item은 dict로 폭넓게 허용(향후 확장 대비)
    item: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("item", mode="before")
    @classmethod
    def sanitize_item(cls, v):
        if v is None:
            return {}
        if isinstance(v, dict):
            return v
        # 방어: dict가 아니면 빈 값으로 저장
        return {}


class HomeSlot(BaseModel):
    """
    홈 구좌 단위(프론트 cmsSlots.js와 동일 필드명)

    참고:
    - system/custom 구좌를 모두 표현한다.
    - system 구좌는 contentPicks가 비어 있어도 된다.
    """

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., min_length=1, max_length=120)
    title: str = Field("구좌", min_length=1, max_length=200)
    enabled: bool = True

    slotType: Optional[str] = Field(None, max_length=20)  # system|custom
    contentPicks: List[HomeSlotPick] = Field(default_factory=list)
    contentSortMode: Optional[str] = Field(None, max_length=20)  # metric|random

    startAt: Optional[str] = None
    endAt: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None

    @field_validator("id", "title", "slotType", "contentSortMode", mode="before")
    @classmethod
    def sanitize_slot_strings(cls, v, info):
        max_map = {
            "id": 120,
            "title": 200,
            "slotType": 20,
            "contentSortMode": 20,
        }
        out = _sanitize_text(v, max_map.get(info.field_name))
        return out if out is not None else ""



class TagDisplayConfig(BaseModel):
    """
    태그 노출/순서 설정(캐릭터 탭/태그 선택 모달 공통).

    의도:
    - 운영/데모에서 "태그 노출 순서"를 코드 배포 없이 즉시 바꾸기 위해 CMS에서 관리한다.
    - 태그 자체(tags 테이블)는 그대로 두고, 노출 정책만 site_configs에 저장한다(최소 수정).

    필드:
    - prioritySlugs: 상단 우선 노출(고정)할 태그 slug 목록(순서가 의미 있음)
    - hiddenSlugs: 유저에게 숨길 태그 slug 목록(노출/선택 UI에서 제외)
    - updatedAt: 서버 저장 시각(UTC ISO 문자열, 캐시 무효화/동기화 참고용)
    """

    model_config = ConfigDict(extra="ignore")

    prioritySlugs: List[str] = Field(default_factory=list)
    hiddenSlugs: List[str] = Field(default_factory=list)
    updatedAt: Optional[str] = None

    @field_validator("prioritySlugs", "hiddenSlugs", mode="before")
    @classmethod
    def sanitize_slug_list(cls, v):
        # 방어: None/이상 타입 처리 + 문자열 trim + 중복 제거
        if v is None:
            return []
        if isinstance(v, str):
            arr = [v]
        elif isinstance(v, list):
            arr = v
        else:
            return []

        out: List[str] = []
        seen = set()
        for item in (arr or []):
            try:
                s = _sanitize_text(item, 50) or ""
            except Exception:
                s = str(item or "").strip()
                if len(s) > 50:
                    s = s[:50]
            s = s.strip()
            if not s:
                continue
            # cover: 메타 태그는 UI 노출 금지(방어)
            if s.startswith("cover:"):
                continue
            if s in seen:
                continue
            seen.add(s)
            out.append(s)
        return out


"""
의도:
- 프론트에서 관리자가 편집하는 "홈 배너/구좌" 설정을 서버(DB)에 저장/조회한다.
- 운영에서 모든 유저에게 동일하게 반영되도록 SSOT를 서버로 옮긴다.

방어적:
- 문자열은 trim + 태그 제거로 최소한의 입력 정리를 한다.
- 프론트와의 호환을 위해 camelCase 필드명을 그대로 사용한다.
"""

from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Optional, Any, Dict, List, Literal
import re


def _sanitize_text(value: Optional[str], max_length: Optional[int] = None) -> Optional[str]:
    """입력 텍스트를 방어적으로 정리한다(태그 제거 + trim)."""
    if value is None:
        return None
    text = re.sub(r"<[^>]*>", "", str(value)).strip()
    if max_length is not None and len(text) > max_length:
        raise ValueError(f"최대 {max_length}자까지 입력할 수 있습니다.")
    return text


class HomeBanner(BaseModel):
    """
    홈 배너 단위(프론트 cmsBanners.js와 동일 필드명)

    주의:
    - imageUrl/mobileImageUrl/linkUrl은 빈 문자열도 허용한다.
    - startAt/endAt/createdAt/updatedAt은 ISO 문자열 또는 null.
    """

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., min_length=1, max_length=80)
    title: str = Field("배너", min_length=1, max_length=200)
    imageUrl: str = Field("", max_length=2000)
    mobileImageUrl: str = Field("", max_length=2000)
    linkUrl: str = Field("", max_length=2000)
    openInNewTab: bool = False
    enabled: bool = True
    # ✅ 노출 대상: 전체/PC만/모바일만 (프론트 CMS에서 선택)
    # - 방어적으로 문자열로 받고, 유효하지 않으면 all로 보정한다.
    displayOn: str = Field("all", max_length=10)  # all|pc|mobile

    startAt: Optional[str] = None
    endAt: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None

    @field_validator("id", "title", "imageUrl", "mobileImageUrl", "linkUrl", mode="before")
    @classmethod
    def sanitize_strings(cls, v, info):
        max_map = {
            "id": 80,
            "title": 200,
            "imageUrl": 2000,
            "mobileImageUrl": 2000,
            "linkUrl": 2000,
        }
        out = _sanitize_text(v, max_map.get(info.field_name))
        return out if out is not None else ""

    @field_validator("displayOn", mode="before")
    @classmethod
    def sanitize_display_on(cls, v):
        raw = _sanitize_text(v, 10)
        key = (raw or "all").strip().lower()
        if key in ("pc", "desktop"):
            return "pc"
        if key in ("mobile", "m", "phone"):
            return "mobile"
        return "all"


class HomeSlotPick(BaseModel):
    """커스텀 구좌에 담기는 선택 항목(캐릭터/웹소설)"""

    model_config = ConfigDict(extra="ignore")

    type: Literal["character", "story"]
    # 프론트에서 여러 메타를 담아 저장하므로 item은 dict로 폭넓게 허용(향후 확장 대비)
    item: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("item", mode="before")
    @classmethod
    def sanitize_item(cls, v):
        if v is None:
            return {}
        if isinstance(v, dict):
            return v
        # 방어: dict가 아니면 빈 값으로 저장
        return {}


class HomeSlot(BaseModel):
    """
    홈 구좌 단위(프론트 cmsSlots.js와 동일 필드명)

    참고:
    - system/custom 구좌를 모두 표현한다.
    - system 구좌는 contentPicks가 비어 있어도 된다.
    """

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., min_length=1, max_length=120)
    title: str = Field("구좌", min_length=1, max_length=200)
    enabled: bool = True

    slotType: Optional[str] = Field(None, max_length=20)  # system|custom
    contentPicks: List[HomeSlotPick] = Field(default_factory=list)
    contentSortMode: Optional[str] = Field(None, max_length=20)  # metric|random

    startAt: Optional[str] = None
    endAt: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None

    @field_validator("id", "title", "slotType", "contentSortMode", mode="before")
    @classmethod
    def sanitize_slot_strings(cls, v, info):
        max_map = {
            "id": 120,
            "title": 200,
            "slotType": 20,
            "contentSortMode": 20,
        }
        out = _sanitize_text(v, max_map.get(info.field_name))
        return out if out is not None else ""


