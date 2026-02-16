#!/usr/bin/env python3
"""
디시인사이드 AI 채팅 갤러리 & 아카라이브 AI 채팅 채널에서
RP용 프롬프트 샘플을 크롤링하는 스크립트.

사용법:
    python crawl_rp_prompts.py --site dcinside --pages 50
    python crawl_rp_prompts.py --site arca --pages 50
    python crawl_rp_prompts.py --site all --pages 30

출력:
    - backend-api/tools/crawled_prompts_dcinside.json
    - backend-api/tools/crawled_prompts_arca.json
"""

import argparse
import json
import os
import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

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

# 디시인사이드 AI 채팅 갤러리
DC_BASE_URL = "https://gall.dcinside.com/mgallery/board"
DC_GALLERY_ID = "aichatting"

# 아카라이브 AI 채팅 채널
ARCA_BASE_URL = "https://arca.live/b/characterai"

# Rate limiting (초)
REQUEST_DELAY = 1.5

# 프롬프트 관련 키워드 (제목 필터링용)
PROMPT_KEYWORDS = [
    "프롬", "프롬프트", "prompt",
    "반납", "배포",
    "제작", "공유",
    "캐릭터", "봇",
    "시트", "설정",
]

# 제외 키워드
EXCLUDE_KEYWORDS = [
    "질문", "어떻게", "왜",
    "후기", "리뷰",
    "잡담", "ㅋㅋ",
]


# ============================================================================
# 유틸리티 함수
# ============================================================================

def safe_request(url: str, max_retries: int = 3) -> Optional[requests.Response]:
    """
    안전한 HTTP GET 요청 (재시도 포함).
    """
    for attempt in range(max_retries):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            if resp.status_code == 200:
                return resp
            print(f"  [WARN] Status {resp.status_code} for {url}")
        except requests.RequestException as e:
            print(f"  [ERROR] Request failed (attempt {attempt + 1}): {e}")
        time.sleep(REQUEST_DELAY * (attempt + 1))
    return None


def is_prompt_related(title: str) -> bool:
    """
    제목이 프롬프트 관련인지 판단.
    """
    title_lower = title.lower()
    
    # 제외 키워드 체크
    for kw in EXCLUDE_KEYWORDS:
        if kw in title_lower:
            return False
    
    # 프롬프트 키워드 체크
    for kw in PROMPT_KEYWORDS:
        if kw in title_lower:
            return True
    
    return False


def extract_prompt_content(html_content: str) -> str:
    """
    HTML에서 프롬프트 본문 텍스트를 추출.
    마크다운 형식, 코드블록 등을 보존.
    """
    soup = BeautifulSoup(html_content, "html.parser")
    
    # 스크립트/스타일 제거
    for tag in soup(["script", "style", "iframe"]):
        tag.decompose()
    
    # 본문 텍스트 추출
    text = soup.get_text(separator="\n", strip=True)
    
    # 연속 줄바꿈 정리
    text = re.sub(r"\n{3,}", "\n\n", text)
    
    return text.strip()


# ============================================================================
# 디시인사이드 크롤러
# ============================================================================

def crawl_dcinside_list(page: int) -> List[Dict[str, Any]]:
    """
    디시인사이드 AI 채팅 갤러리 글 목록 수집.
    """
    url = f"{DC_BASE_URL}/lists/?id={DC_GALLERY_ID}&page={page}"
    resp = safe_request(url)
    if not resp:
        return []
    
    soup = BeautifulSoup(resp.text, "html.parser")
    posts = []
    
    # 글 목록 테이블에서 추출
    for row in soup.select("tr.ub-content"):
        try:
            # 공지 제외
            if "ub-notice" in row.get("class", []):
                continue
            
            # 글 번호
            no_elem = row.select_one("td.gall_num")
            if not no_elem:
                continue
            post_no = no_elem.get_text(strip=True)
            if not post_no.isdigit():
                continue
            
            # 제목
            title_elem = row.select_one("td.gall_tit a")
            if not title_elem:
                continue
            title = title_elem.get_text(strip=True)
            
            # 말머리
            subject_elem = row.select_one("td.gall_subject")
            subject = subject_elem.get_text(strip=True) if subject_elem else ""
            
            # 조회수
            count_elem = row.select_one("td.gall_count")
            view_count = int(count_elem.get_text(strip=True)) if count_elem else 0
            
            # 추천수
            recommend_elem = row.select_one("td.gall_recommend")
            recommend = int(recommend_elem.get_text(strip=True)) if recommend_elem else 0
            
            posts.append({
                "no": post_no,
                "title": title,
                "subject": subject,
                "view_count": view_count,
                "recommend": recommend,
                "url": f"{DC_BASE_URL}/view/?id={DC_GALLERY_ID}&no={post_no}",
            })
        except Exception as e:
            print(f"  [WARN] Parse error: {e}")
            continue
    
    return posts


def crawl_dcinside_content(post_no: str) -> Optional[str]:
    """
    디시인사이드 글 본문 수집.
    """
    url = f"{DC_BASE_URL}/view/?id={DC_GALLERY_ID}&no={post_no}"
    resp = safe_request(url)
    if not resp:
        return None
    
    soup = BeautifulSoup(resp.text, "html.parser")
    
    # 본문 영역
    content_div = soup.select_one("div.write_div")
    if not content_div:
        return None
    
    return extract_prompt_content(str(content_div))


def crawl_dcinside(max_pages: int = 50) -> List[Dict[str, Any]]:
    """
    디시인사이드 AI 채팅 갤러리 전체 크롤링.
    """
    print(f"\n[디시인사이드] AI 채팅 갤러리 크롤링 시작 (최대 {max_pages} 페이지)")
    
    all_posts = []
    collected_prompts = []
    
    # 1단계: 글 목록 수집
    for page in range(1, max_pages + 1):
        print(f"  페이지 {page}/{max_pages} 목록 수집 중...")
        posts = crawl_dcinside_list(page)
        all_posts.extend(posts)
        time.sleep(REQUEST_DELAY)
    
    print(f"  총 {len(all_posts)}개 글 발견")
    
    # 2단계: 프롬프트 관련 글 필터링
    prompt_posts = [p for p in all_posts if is_prompt_related(p["title"]) or "프롬" in p.get("subject", "")]
    print(f"  프롬프트 관련 글: {len(prompt_posts)}개")
    
    # 추천수 높은 순으로 정렬
    prompt_posts.sort(key=lambda x: x["recommend"], reverse=True)
    
    # 3단계: 본문 수집 (상위 200개까지)
    for idx, post in enumerate(prompt_posts[:200]):
        print(f"  [{idx + 1}/{min(len(prompt_posts), 200)}] '{post['title'][:30]}...' 본문 수집 중...")
        content = crawl_dcinside_content(post["no"])
        
        if content and len(content) > 500:  # 최소 500자 이상
            collected_prompts.append({
                "source": "dcinside",
                "post_no": post["no"],
                "title": post["title"],
                "subject": post.get("subject", ""),
                "view_count": post["view_count"],
                "recommend": post["recommend"],
                "url": post["url"],
                "content": content,
                "content_length": len(content),
                "crawled_at": datetime.now().isoformat(),
            })
        
        time.sleep(REQUEST_DELAY)
    
    print(f"  수집 완료: {len(collected_prompts)}개 프롬프트")
    return collected_prompts


# ============================================================================
# 아카라이브 크롤러
# ============================================================================

def crawl_arca_list(page: int) -> List[Dict[str, Any]]:
    """
    아카라이브 AI 채팅 채널 글 목록 수집.
    """
    url = f"{ARCA_BASE_URL}?p={page}"
    resp = safe_request(url)
    if not resp:
        return []
    
    soup = BeautifulSoup(resp.text, "html.parser")
    posts = []
    
    # 글 목록에서 추출
    for article in soup.select("a.vrow"):
        try:
            # 공지 제외
            if "notice" in article.get("class", []):
                continue
            
            # 글 번호 (href에서 추출)
            href = article.get("href", "")
            match = re.search(r"/(\d+)", href)
            if not match:
                continue
            post_no = match.group(1)
            
            # 제목
            title_elem = article.select_one("span.title")
            if not title_elem:
                continue
            title = title_elem.get_text(strip=True)
            
            # 카테고리
            badge_elem = article.select_one("span.badge")
            category = badge_elem.get_text(strip=True) if badge_elem else ""
            
            # 조회수
            view_elem = article.select_one("span.col-view")
            view_count = 0
            if view_elem:
                view_text = view_elem.get_text(strip=True)
                view_count = int(re.sub(r"[^\d]", "", view_text) or 0)
            
            # 추천수
            rate_elem = article.select_one("span.col-rate")
            recommend = 0
            if rate_elem:
                rate_text = rate_elem.get_text(strip=True)
                recommend = int(re.sub(r"[^\d]", "", rate_text) or 0)
            
            posts.append({
                "no": post_no,
                "title": title,
                "category": category,
                "view_count": view_count,
                "recommend": recommend,
                "url": f"https://arca.live/b/characterai/{post_no}",
            })
        except Exception as e:
            print(f"  [WARN] Parse error: {e}")
            continue
    
    return posts


def crawl_arca_content(post_no: str) -> Optional[str]:
    """
    아카라이브 글 본문 수집.
    """
    url = f"https://arca.live/b/characterai/{post_no}"
    resp = safe_request(url)
    if not resp:
        return None
    
    soup = BeautifulSoup(resp.text, "html.parser")
    
    # 본문 영역
    content_div = soup.select_one("div.article-body")
    if not content_div:
        return None
    
    return extract_prompt_content(str(content_div))


def crawl_arca(max_pages: int = 50) -> List[Dict[str, Any]]:
    """
    아카라이브 AI 채팅 채널 전체 크롤링.
    """
    print(f"\n[아카라이브] AI 채팅 채널 크롤링 시작 (최대 {max_pages} 페이지)")
    
    all_posts = []
    collected_prompts = []
    
    # 1단계: 글 목록 수집
    for page in range(1, max_pages + 1):
        print(f"  페이지 {page}/{max_pages} 목록 수집 중...")
        posts = crawl_arca_list(page)
        all_posts.extend(posts)
        time.sleep(REQUEST_DELAY)
    
    print(f"  총 {len(all_posts)}개 글 발견")
    
    # 2단계: 프롬프트 관련 글 필터링
    prompt_posts = [p for p in all_posts if is_prompt_related(p["title"])]
    print(f"  프롬프트 관련 글: {len(prompt_posts)}개")
    
    # 추천수 높은 순으로 정렬
    prompt_posts.sort(key=lambda x: x["recommend"], reverse=True)
    
    # 3단계: 본문 수집 (상위 200개까지)
    for idx, post in enumerate(prompt_posts[:200]):
        print(f"  [{idx + 1}/{min(len(prompt_posts), 200)}] '{post['title'][:30]}...' 본문 수집 중...")
        content = crawl_arca_content(post["no"])
        
        if content and len(content) > 500:  # 최소 500자 이상
            collected_prompts.append({
                "source": "arca",
                "post_no": post["no"],
                "title": post["title"],
                "category": post.get("category", ""),
                "view_count": post["view_count"],
                "recommend": post["recommend"],
                "url": post["url"],
                "content": content,
                "content_length": len(content),
                "crawled_at": datetime.now().isoformat(),
            })
        
        time.sleep(REQUEST_DELAY)
    
    print(f"  수집 완료: {len(collected_prompts)}개 프롬프트")
    return collected_prompts


# ============================================================================
# 메인
# ============================================================================

def save_results(data: List[Dict[str, Any]], filename: str):
    """
    결과를 JSON 파일로 저장.
    """
    output_path = os.path.join(os.path.dirname(__file__), filename)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\n저장 완료: {output_path} ({len(data)}개)")


def main():
    parser = argparse.ArgumentParser(description="RP 프롬프트 크롤러")
    parser.add_argument(
        "--site",
        choices=["dcinside", "arca", "all"],
        default="all",
        help="크롤링할 사이트 (기본: all)",
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=30,
        help="크롤링할 페이지 수 (기본: 30)",
    )
    args = parser.parse_args()
    
    print("=" * 60)
    print("RP 프롬프트 크롤러")
    print(f"대상: {args.site}, 페이지: {args.pages}")
    print("=" * 60)
    
    if args.site in ("dcinside", "all"):
        dc_results = crawl_dcinside(max_pages=args.pages)
        if dc_results:
            save_results(dc_results, "crawled_prompts_dcinside.json")
    
    if args.site in ("arca", "all"):
        arca_results = crawl_arca(max_pages=args.pages)
        if arca_results:
            save_results(arca_results, "crawled_prompts_arca.json")
    
    print("\n크롤링 완료!")


if __name__ == "__main__":
    main()
