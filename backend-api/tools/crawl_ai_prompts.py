"""
디시인사이드 AI 채팅 갤러리 / 아카라이브 AI 채팅 채널에서
고품질 RP 프롬프트를 크롤링하는 스크립트.

사용법:
    python crawl_ai_prompts.py --site dcinside --pages 10
    python crawl_ai_prompts.py --site arca --pages 10

출력:
    outputs/crawled_prompts_dcinside_YYYYMMDD.json
    outputs/crawled_prompts_arca_YYYYMMDD.json
"""

import argparse
import json
import os
import re
import time
from datetime import datetime
from typing import List, Dict, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

# ============================================================================
# 설정
# ============================================================================

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}

# 디시인사이드 갤러리들
DC_BASE_URL = "https://gall.dcinside.com"

# 크롤링 대상 갤러리 목록 (갤러리 ID: 표시 이름)
DC_GALLERIES = {
    "wrtnai": "크랙(뤼튼)",    # https://gall.dcinside.com/mgallery/board/lists/?id=wrtnai (메인!)
    "babechat": "바베챗",      # https://gall.dcinside.com/mgallery/board/lists/?id=babechat
    "aichatting": "AI 채팅",   # https://gall.dcinside.com/mgallery/board/lists/?id=aichatting
    "aicharacter": "AI 캐릭터", # https://gall.dcinside.com/mgallery/board/lists/?id=aicharacter
}

# 아카라이브 AI 채팅 채널
ARCA_BASE_URL = "https://arca.live"
ARCA_CHANNEL = "characterai"
ARCA_LIST_URL = f"{ARCA_BASE_URL}/b/{ARCA_CHANNEL}"

# RP 캐릭터 프롬프트 키워드 (제목에서 필터링) - 완화됨
PROMPT_KEYWORDS = [
    "캐릭터", "봇", "페르소나", "페소", "시트", "설정",
    "rp", "롤플", "롤플레이", "시뮬", "시뮬레이터",
    "배포", "공유", "퍼메", "퍼머",
    "프롬프트", "세계관", "스토리",
    "제작", "완성", "업로드", "올림",
]

# 프롬프트 관련 말머리 (이게 있으면 키워드 없어도 통과)
PROMPT_CATEGORIES = [
    "홍보", "🔰홍보", "🔴홍보",  # 캐릭터 배포
    "제작현황", "제작중",
    "유저노트",
    "🔨제작",
    "📢홍보",
]

# 제외 키워드 (제목) - 완화됨
EXCLUDE_KEYWORDS = [
    "질문", "도움", "어떻게", "추천해", "뭐가", "왜이러",
    "후기", "리뷰만", "감상만",
]

# 이미지 생성 프롬프트 감지 패턴 (본문에서 제외)
IMAGE_PROMPT_PATTERNS = [
    r"solo,?\s",  # NAI/SD 태그
    r"looking_at",
    r"cowboy_shot",
    r"upper_body",
    r"from_above",
    r"from_below",
    r"depth_of_field",
    r"bokeh",
    r"cinematic",
    r"lighting,?\s",
    r"\d+::",  # 가중치 문법 1.2::
    r"::,",
    r"pov,?\s",
    r"indoor,?\s",
    r"outdoor,?\s",
]

OUTPUT_DIR = "outputs"


# ============================================================================
# 디시인사이드 크롤러
# ============================================================================

def crawl_dcinside_list(gallery_id: str, page: int = 1) -> List[Dict]:
    """
    디시인사이드 갤러리 목록에서 프롬프트 관련 게시물 링크를 수집한다.
    """
    url = f"{DC_BASE_URL}/mgallery/board/lists/?id={gallery_id}&page={page}"
    gallery_name = DC_GALLERIES.get(gallery_id, gallery_id)
    print(f"[DC:{gallery_name}] 목록 크롤링: page {page}")
    
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"[DC] 목록 요청 실패: {e}")
        return []
    
    soup = BeautifulSoup(resp.text, "html.parser")
    posts = []
    
    # 게시물 목록 파싱
    rows = soup.select("tr.ub-content")
    for row in rows:
        try:
            # 공지 제외
            if row.select_one(".icon_notice"):
                continue
            
            # 제목 추출
            title_elem = row.select_one(".gall_tit a:first-child")
            if not title_elem:
                continue
            
            title = title_elem.get_text(strip=True)
            href = title_elem.get("href", "")
            
            # 말머리 추출
            em_elem = row.select_one(".gall_tit em")
            category = em_elem.get_text(strip=True) if em_elem else ""
            
            # 프롬프트 관련 게시물만 필터링
            title_lower = title.lower()
            category_lower = category.lower()
            
            # 디버그: 처음 3개 게시물 출력
            if len(posts) < 3:
                print(f"    [DEBUG] 말머리=[{category}] 제목=[{title[:30]}...]")
            
            # 1) 프롬프트 관련 말머리 체크 (최우선)
            is_prompt = any(cat in category for cat in PROMPT_CATEGORIES)
            
            # 2) 프롬프트 키워드 체크 (말머리 또는 제목)
            if not is_prompt:
                is_prompt = any(kw in title_lower or kw in category_lower for kw in PROMPT_KEYWORDS)
            
            # 3) 긴 제목은 프롬프트일 가능성 (설정 공유)
            if not is_prompt and len(title) > 50:
                is_prompt = True
            
            # 제외: 이미지 관련, 질문
            if any(kw in title_lower for kw in EXCLUDE_KEYWORDS):
                continue
            if any(kw in title_lower for kw in ["윶캐", "돚거", "그뽑", "pov", "프롬프롬"]):
                continue
            
            if not is_prompt:
                continue
            
            # 조회수/추천수 추출
            view_elem = row.select_one(".gall_count")
            rec_elem = row.select_one(".gall_recommend")
            views = int(view_elem.get_text(strip=True)) if view_elem else 0
            recs = int(rec_elem.get_text(strip=True)) if rec_elem else 0
            
            # 추천 0개 이상 (일단 다 수집, 나중에 필터링)
            # if recs < 1:
            #     continue
            
            post_url = urljoin(DC_BASE_URL, href)
            posts.append({
                "title": title,
                "category": category,
                "url": post_url,
                "views": views,
                "recs": recs,
            })
            
        except Exception as e:
            print(f"[DC] 행 파싱 오류: {e}")
            continue
    
    print(f"[DC] 페이지 {page}에서 {len(posts)}개 게시물 발견")
    return posts


def crawl_dcinside_post(url: str) -> Optional[Dict]:
    """
    디시인사이드 게시물 본문에서 프롬프트 내용을 추출한다.
    """
    print(f"[DC] 본문 크롤링: {url}")
    
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"[DC] 본문 요청 실패: {e}")
        return None
    
    soup = BeautifulSoup(resp.text, "html.parser")
    
    try:
        # 제목
        title_elem = soup.select_one(".title_subject")
        title = title_elem.get_text(strip=True) if title_elem else ""
        
        # 본문
        content_elem = soup.select_one(".write_div")
        if not content_elem:
            return None
        
        # 본문 텍스트 추출 (HTML 태그 제거, 줄바꿈 보존)
        for br in content_elem.find_all("br"):
            br.replace_with("\n")
        content = content_elem.get_text(separator="\n").strip()
        
        # 너무 짧으면 스킵 (RP 프롬프트는 보통 800자 이상)
        if len(content) < 800:
            print(f"[DC] 본문이 너무 짧음 ({len(content)}자), 스킵")
            return None
        
        # 이미지 생성 프롬프트 감지 (NAI/SD 태그 패턴)
        image_pattern_count = 0
        content_lower = content.lower()
        for pattern in IMAGE_PROMPT_PATTERNS:
            if re.search(pattern, content_lower):
                image_pattern_count += 1
        
        # 이미지 프롬프트 패턴이 3개 이상이면 스킵
        if image_pattern_count >= 3:
            print(f"[DC] 이미지 생성 프롬프트로 판단 (패턴 {image_pattern_count}개), 스킵")
            return None
        
        # 작성자
        writer_elem = soup.select_one(".nickname")
        writer = writer_elem.get_text(strip=True) if writer_elem else "익명"
        
        # 작성일
        date_elem = soup.select_one(".gall_date")
        date_str = date_elem.get("title", "") if date_elem else ""
        
        return {
            "source": "dcinside",
            "title": title,
            "content": content,
            "writer": writer,
            "date": date_str,
            "url": url,
            "char_count": len(content),
        }
        
    except Exception as e:
        print(f"[DC] 본문 파싱 오류: {e}")
        return None


def crawl_dcinside(pages: int = 10, galleries: List[str] = None) -> List[Dict]:
    """
    디시인사이드 여러 갤러리에서 프롬프트를 크롤링한다.
    
    Args:
        pages: 각 갤러리당 크롤링할 페이지 수
        galleries: 크롤링할 갤러리 ID 목록 (None이면 전체)
    """
    if galleries is None:
        galleries = list(DC_GALLERIES.keys())
    
    all_posts = []
    
    for gallery_id in galleries:
        gallery_name = DC_GALLERIES.get(gallery_id, gallery_id)
        print(f"\n{'='*50}")
        print(f"[DC:{gallery_name}] 갤러리 크롤링 시작")
        print(f"{'='*50}")
        
        for page in range(1, pages + 1):
            posts = crawl_dcinside_list(gallery_id, page)
            for post in posts:
                post["gallery"] = gallery_id
                post["gallery_name"] = gallery_name
            all_posts.extend(posts)
            time.sleep(1)  # Rate limiting
    
    print(f"\n[DC] 총 {len(all_posts)}개 게시물 발견, 본문 크롤링 시작...\n")
    
    results = []
    for i, post in enumerate(all_posts):
        print(f"[{i+1}/{len(all_posts)}] ", end="")
        data = crawl_dcinside_post(post["url"])
        if data:
            data["meta"] = {
                "gallery": post.get("gallery", ""),
                "gallery_name": post.get("gallery_name", ""),
                "category": post.get("category", ""),
                "views": post.get("views", 0),
                "recs": post.get("recs", 0),
            }
            results.append(data)
        time.sleep(0.5)  # Rate limiting
    
    return results


# ============================================================================
# 아카라이브 크롤러
# ============================================================================

def crawl_arca_list(page: int = 1) -> List[Dict]:
    """
    아카라이브 채널 목록에서 프롬프트 관련 게시물 링크를 수집한다.
    """
    url = f"{ARCA_LIST_URL}?p={page}"
    print(f"[ARCA] 목록 크롤링: {url}")
    
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"[ARCA] 목록 요청 실패: {e}")
        return []
    
    soup = BeautifulSoup(resp.text, "html.parser")
    posts = []
    
    # 게시물 목록 파싱
    rows = soup.select(".list-table a.vrow")
    for row in rows:
        try:
            # 공지 제외
            if "notice" in row.get("class", []):
                continue
            
            # 제목 추출
            title_elem = row.select_one(".title")
            if not title_elem:
                continue
            
            title = title_elem.get_text(strip=True)
            href = row.get("href", "")
            
            # 카테고리 추출
            badge_elem = row.select_one(".badge")
            category = badge_elem.get_text(strip=True) if badge_elem else ""
            
            # 프롬프트 관련 게시물만 필터링
            title_lower = title.lower()
            
            # 제외 키워드 체크
            if any(kw in title_lower for kw in EXCLUDE_KEYWORDS):
                continue
            
            # 프롬프트 키워드 체크
            is_prompt = any(kw in title_lower or kw in category.lower() for kw in PROMPT_KEYWORDS)
            
            # 특정 카테고리는 높은 확률로 프롬프트
            if category in ["배포", "공유", "프롬프트", "캐릭터"]:
                is_prompt = True
            
            if not is_prompt:
                continue
            
            # 추천수 추출
            rec_elem = row.select_one(".vcol.col-rate")
            recs = 0
            if rec_elem:
                rec_text = rec_elem.get_text(strip=True)
                try:
                    recs = int(rec_text) if rec_text else 0
                except:
                    pass
            
            # 추천 1개 이상만
            if recs < 1:
                continue
            
            post_url = urljoin(ARCA_BASE_URL, href)
            posts.append({
                "title": title,
                "category": category,
                "url": post_url,
                "recs": recs,
            })
            
        except Exception as e:
            print(f"[ARCA] 행 파싱 오류: {e}")
            continue
    
    print(f"[ARCA] 페이지 {page}에서 {len(posts)}개 게시물 발견")
    return posts


def crawl_arca_post(url: str) -> Optional[Dict]:
    """
    아카라이브 게시물 본문에서 프롬프트 내용을 추출한다.
    """
    print(f"[ARCA] 본문 크롤링: {url}")
    
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"[ARCA] 본문 요청 실패: {e}")
        return None
    
    soup = BeautifulSoup(resp.text, "html.parser")
    
    try:
        # 제목
        title_elem = soup.select_one(".title-row .title")
        title = title_elem.get_text(strip=True) if title_elem else ""
        
        # 본문
        content_elem = soup.select_one(".article-body")
        if not content_elem:
            return None
        
        # 본문 텍스트 추출
        for br in content_elem.find_all("br"):
            br.replace_with("\n")
        content = content_elem.get_text(separator="\n").strip()
        
        # 너무 짧으면 스킵
        if len(content) < 500:
            print(f"[ARCA] 본문이 너무 짧음 ({len(content)}자), 스킵")
            return None
        
        # 작성자
        writer_elem = soup.select_one(".user-info .username")
        writer = writer_elem.get_text(strip=True) if writer_elem else "익명"
        
        # 작성일
        date_elem = soup.select_one(".date")
        date_str = date_elem.get_text(strip=True) if date_elem else ""
        
        return {
            "source": "arca",
            "title": title,
            "content": content,
            "writer": writer,
            "date": date_str,
            "url": url,
            "char_count": len(content),
        }
        
    except Exception as e:
        print(f"[ARCA] 본문 파싱 오류: {e}")
        return None


def crawl_arca(pages: int = 10) -> List[Dict]:
    """
    아카라이브 AI 채팅 채널에서 프롬프트를 크롤링한다.
    """
    all_posts = []
    
    for page in range(1, pages + 1):
        posts = crawl_arca_list(page)
        all_posts.extend(posts)
        time.sleep(1)  # Rate limiting
    
    print(f"\n[ARCA] 총 {len(all_posts)}개 게시물 발견, 본문 크롤링 시작...\n")
    
    results = []
    for i, post in enumerate(all_posts):
        print(f"[{i+1}/{len(all_posts)}] ", end="")
        data = crawl_arca_post(post["url"])
        if data:
            data["meta"] = {
                "category": post.get("category", ""),
                "recs": post.get("recs", 0),
            }
            results.append(data)
        time.sleep(0.5)  # Rate limiting
    
    return results


# ============================================================================
# 메인
# ============================================================================

def save_results(results: List[Dict], site: str):
    """
    크롤링 결과를 JSON 파일로 저장한다.
    """
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"crawled_prompts_{site}_{date_str}.json"
    filepath = os.path.join(OUTPUT_DIR, filename)
    
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 저장 완료: {filepath}")
    print(f"   - 총 {len(results)}개 프롬프트")
    
    # 통계 출력
    if results:
        char_counts = [r.get("char_count", 0) for r in results]
        print(f"   - 평균 길이: {sum(char_counts) // len(char_counts)}자")
        print(f"   - 최소 길이: {min(char_counts)}자")
        print(f"   - 최대 길이: {max(char_counts)}자")


def main():
    parser = argparse.ArgumentParser(description="AI RP 프롬프트 크롤러")
    parser.add_argument("--site", choices=["dcinside", "arca", "all"], default="dcinside",
                        help="크롤링 대상 사이트")
    parser.add_argument("--pages", type=int, default=10,
                        help="각 갤러리당 크롤링할 페이지 수")
    parser.add_argument("--gallery", type=str, default="all",
                        help="디시 갤러리 선택 (crack, babychat, aichatting, aicharacter, all)")
    args = parser.parse_args()
    
    print("=" * 60)
    print("AI RP 프롬프트 크롤러")
    print("=" * 60)
    print(f"대상 사이트: {args.site}")
    print(f"페이지/갤러리: {args.pages}")
    print(f"갤러리: {args.gallery}")
    print("=" * 60)
    
    # 갤러리 선택
    if args.gallery == "all":
        galleries = None  # 전체
    else:
        galleries = [g.strip() for g in args.gallery.split(",")]
    
    if args.site in ["dcinside", "all"]:
        print("\n[1] 디시인사이드 갤러리 크롤링 시작")
        print(f"    대상: {galleries if galleries else '전체 (' + ', '.join(DC_GALLERIES.keys()) + ')'}\n")
        dc_results = crawl_dcinside(args.pages, galleries)
        if dc_results:
            save_results(dc_results, "dcinside_rp")
    
    if args.site in ["arca", "all"]:
        print("\n[2] 아카라이브 AI 채팅 채널 크롤링 시작\n")
        arca_results = crawl_arca(args.pages)
        if arca_results:
            save_results(arca_results, "arca_rp")
    
    print("\n✅ 크롤링 완료!")


if __name__ == "__main__":
    main()
