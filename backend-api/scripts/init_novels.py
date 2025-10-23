"""
스토리 다이브용 초기 원작 소설 데이터 삽입 스크립트
"""

import asyncio
import sys
import os
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.novel import Novel


SAMPLE_NOVELS = [
    {
        "title": "로또1등이라 엄청 즐겁게 회사생활하기",
        "author": "작가미상",
        "full_text": """회사에 출근하는 아침이었다. 지하철은 여전히 붐볐고, 사람들은 피곤한 표정으로 휴대폰만 들여다보고 있었다.

나는 오늘도 어김없이 팀장의 잔소리를 들을 생각에 한숨이 나왔다. 3년차 직장인, 연봉은 턱없이 적고, 야근은 일상이다.

그런데 어젯밤 확인한 로또 번호가 자꾸 머릿속을 맴돌았다. 설마... 아니겠지? 하지만 확인해보고 싶은 마음은 억누를 수 없었다.

회사 화장실에 들어가 조심스럽게 당첨번호를 확인했다. 1등. 20억.

심장이 터질 것 같았다. 손이 떨렸다. 이게... 진짜인가?

그 순간부터 모든 게 달라 보이기 시작했다. 팀장의 잔소리도, 야근도, 월급도 이제 아무 의미가 없었다.

"이제부터는... 내가 하고 싶은 대로 산다."

회의실로 향하는 발걸음이 평소와 달리 가벼웠다. 팀장이 뭐라고 하든, 이제 난 자유다.""",
        "story_cards": [
            {
                "plot": "평범한 직장인이 로또 1등에 당첨되면서 회사 생활에 대한 태도가 180도 바뀌는 이야기. 당첨 사실을 숨긴 채 회사에서 벌어지는 유쾌한 에피소드들.",
                "characters": [
                    {"name": "주인공", "description": "3년차 직장인, 로또 1등 당첨자", "personality": "원래는 소심했지만 당첨 후 자신감 넘침"},
                    {"name": "팀장", "description": "꼰대 스타일의 상사", "personality": "권위적이고 잔소리가 많음"},
                    {"name": "동료들", "description": "같은 부서 직원들", "personality": "각자의 사연을 가진 평범한 직장인들"}
                ],
                "locations": [
                    {"name": "회사", "description": "중견 IT 기업의 사무실"},
                    {"name": "지하철", "description": "출퇴근 시간의 붐비는 2호선"},
                    {"name": "편의점", "description": "회사 근처 24시간 편의점"}
                ],
                "world": "현대 한국의 평범한 회사 문화. 야근, 회식, 상하관계가 명확한 보수적인 조직문화."
            },
            {
                "plot": "20억이라는 거금을 손에 쥔 주인공이 퇴사 타이밍을 재며 벌이는 복수와 성장의 이야기. 회사의 부조리를 하나씩 폭로하고 새로운 삶을 설계한다.",
                "characters": [
                    {"name": "김대리 (주인공)", "description": "당첨 후 달라진 직장인", "personality": "이제는 당당하고 통쾌하게 자신의 의견을 말함"},
                    {"name": "박과장", "description": "주인공의 멘토였던 선배", "personality": "회사 생활에 지쳤지만 생계 때문에 버티는 중"},
                    {"name": "최부장", "description": "회사의 실세", "personality": "정치적이고 계산적임"}
                ],
                "locations": [
                    {"name": "회의실", "description": "권력 게임이 벌어지는 공간"},
                    {"name": "사장실", "description": "최종 보스가 있는 곳"},
                    {"name": "옥상", "description": "주인공이 담배를 피우며 인생을 고민하던 장소"}
                ],
                "world": "대한민국 직장 문화의 어두운 면. 야근 강요, 부당한 대우, 상사의 갑질이 만연한 환경. 하지만 돈이 생기면 모든 게 달라진다."
            }
        ]
    },
    {
        "title": "전셋집에서 시작하는 나의 히어로 아카데미아",
        "author": "작가미상",
        "full_text": """좁은 전셋집 방에서 눈을 떴다. 몸이 이상했다. 거울을 보니... 10살 정도 된 아이의 모습이었다.

"이게 무슨...?"

머릿속에 낯선 기억들이 흘러들어왔다. 여기는 '나의 히어로 아카데미아' 세계. 그리고 나는 개성도 없는 평범한 집안의 아이.

엄마는 편의점에서 아르바이트를 하시고, 아빠는 공사장 일용직이다. 이 좁은 전셋집이 우리의 전부다.

"하지만... 나는 원작을 알고 있어."

데쿠가 유에이에 입학하기 2년 전. 아직 올마이트는 현역이고, 빌런 연합도 본격적으로 활동하기 전이다.

돈도 없고, 개성도 없고, 빽도 없다. 하지만 나에겐 '지식'이 있다.

"일단... 살아남자. 그리고 기회를 잡자."

창밖으로 보이는 무사시 타마가와 지역의 풍경. 이곳에서 나의 히어로 스토리가 시작된다.""",
        "story_cards": [
            {
                "plot": "나의 히어로 아카데미아 세계에 빙의한 주인공이 가난한 전셋집에서 시작하여 자신만의 방식으로 성장해나가는 이야기.",
                "characters": [
                    {"name": "주인공", "description": "원작 지식을 가진 빙의자, 10살", "personality": "냉철하고 현실적, 생존을 최우선으로 생각함"},
                    {"name": "엄마", "description": "편의점 아르바이트생", "personality": "억척스럽지만 따뜻한 성격"},
                    {"name": "아빠", "description": "건설 현장 일용직 노동자", "personality": "과묵하지만 가족을 사랑함"}
                ],
                "locations": [
                    {"name": "전셋집", "description": "무사시 타마가와 지역의 작은 원룸"},
                    {"name": "편의점", "description": "엄마가 일하는 24시간 편의점"},
                    {"name": "무사시 타마가와", "description": "도쿄 외곽의 주택가"}
                ],
                "world": "개성이라는 초능력이 일상화된 현대 일본. 히어로와 빌런이 존재하며, 히어로는 연예인처럼 인기를 얻는다. 유에이 고교는 최고의 히어로 양성 학교."
            },
            {
                "plot": "원작 지식을 활용해 미래의 위기를 대비하고, 올마이트와 데쿠를 돕는 조력자가 되는 이야기. 빌런 연합의 음모를 사전에 차단한다.",
                "characters": [
                    {"name": "주인공", "description": "미래를 아는 자", "personality": "전략적이고 계획적, 히어로보다는 뒤에서 돕는 스타일"},
                    {"name": "올마이트", "description": "No.1 히어로", "personality": "정의롭고 카리스마 넘침"},
                    {"name": "데쿠", "description": "미래의 No.1 히어로", "personality": "열정적이고 순수함"}
                ],
                "locations": [
                    {"name": "유에이 고교", "description": "일본 최고의 히어로 양성 학교"},
                    {"name": "다구바 해변", "description": "올마이트가 데쿠를 훈련시킨 장소"},
                    {"name": "카미노", "description": "올마이트의 마지막 전투가 벌어질 곳"}
                ],
                "world": "히어로 사회의 이면. 올마이트의 힘이 약해지고 있으며, 빌런 연합이 점점 강해진다. AFO(올 포 원)라는 최악의 빌런이 그림자 속에서 움직인다."
            }
        ]
    }
]


async def init_novels():
    """Novel 테이블에 샘플 데이터 삽입"""
    async with AsyncSessionLocal() as db:
        try:
            # 기존 데이터 확인
            result = await db.execute(select(Novel))
            existing_novels = result.scalars().all()
            
            if existing_novels:
                print(f"⚠️  이미 {len(existing_novels)}개의 소설이 존재합니다.")
                print("기존 데이터를 삭제하고 새로 삽입하려면 수동으로 DELETE를 실행하세요.")
                return
            
            # 샘플 소설 삽입
            for novel_data in SAMPLE_NOVELS:
                novel = Novel(**novel_data)
                db.add(novel)
                print(f"✅ '{novel_data['title']}' 추가 완료")
            
            await db.commit()
            print(f"\n🎉 총 {len(SAMPLE_NOVELS)}개의 소설이 성공적으로 삽입되었습니다!")
            
        except Exception as e:
            await db.rollback()
            print(f"❌ 오류 발생: {e}")
            raise


if __name__ == "__main__":
    print("📚 스토리 다이브 초기 소설 데이터 삽입 시작...\n")
    asyncio.run(init_novels())

