/**
 * 법적 페이지 (이용약관 / 개인정보처리방침 / 환불정책)
 * /legal/:type  (type = terms | privacy | refund)
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import { ArrowLeft } from 'lucide-react';

/* ───────── 콘텐츠 상수 ───────── */

const LEGAL_CONTACT_EMAIL = 'cha8.team@gmail.com';
const BUSINESS_INFO_TEXT = '상호 라이크노벨 | 사업자등록번호 327-24-00954 | 통신판매업신고 제 2020-성남분당C-0039호 | 주소 17084 경기 용인시 기흥구 공세로 150-29, B01-J207호(공세동, 테라스가든)';

const TERMS = {
  title: '이용약관',
  updatedAt: '2026-02-25',
  sections: [
    {
      heading: '제1조 (목적)',
      body: '이 약관은 챕터8 서비스(이하 "서비스")의 이용과 관련하여 회사와 회원 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다. 본 서비스는 웹소설 디지털 콘텐츠 판매 서비스입니다.',
    },
    {
      heading: '제2조 (사업자 정보)',
      body: `${BUSINESS_INFO_TEXT}\n고객문의: ${LEGAL_CONTACT_EMAIL}`,
    },
    {
      heading: '제3조 (정의)',
      body: `1. "회원"은 본 약관에 동의하고 서비스를 이용하는 자를 의미합니다.\n2. "루비"는 유료 기능 이용을 위해 구매 또는 지급되는 디지털 재화입니다.\n3. "유상 루비"는 회원이 결제로 구매한 루비를 말하며, "무상 루비"는 이벤트·보상 등으로 지급된 루비를 말합니다.`,
    },
    {
      heading: '제4조 (약관의 효력 및 변경)',
      body: '회사는 관련 법령을 위반하지 않는 범위에서 약관을 개정할 수 있으며, 개정 시 적용일자 및 사유를 서비스 내에 사전 공지합니다.',
    },
    {
      heading: '제5조 (회원가입 및 계정 관리)',
      body: '회원은 정확한 정보를 제공해야 하며, 계정과 비밀번호 관리 책임은 회원에게 있습니다. 회원의 관리 소홀로 발생한 손해에 대해 회사는 고의·중과실이 없는 한 책임지지 않습니다.',
    },
    {
      heading: '제6조 (유료 서비스)',
      body: `1. 유료 서비스 가격, 제공 혜택, 적용 기간은 서비스 화면 또는 결제 화면에 표시된 내용을 따릅니다.\n2. 루비는 디지털 콘텐츠 이용권의 성격을 가지며, 결제 취소·환불 기준은 환불정책 페이지를 따릅니다.`,
    },
    {
      heading: '제7조 (코인 사용 범위 및 제한)',
      body: `1. 결제로 충전한 루비(코인)는 웹소설 회차/작품 구매에만 사용할 수 있습니다.\n2. 캐릭터 채팅 기능은 무료 부가 기능이며, 유료 채팅/대화권/메시지권 상품은 제공하지 않습니다.\n3. 회원 간 채팅 기능은 제공하지 않으며, 유저 간 루비 전송(선물하기), 양도, 거래는 지원하지 않습니다.\n4. 루비는 환전·현금화할 수 없습니다.`,
    },
    {
      heading: '제8조 (결제 판매주체 및 정산)',
      body: '결제의 판매주체(merchant of record)는 회사입니다. 작가 콘텐츠 업로드 구조가 있더라도, 하위 판매자에게 결제대행사가 직접 지급하는 구조가 아니며, 정산/로열티 지급은 회사의 내부 프로세스로 처리합니다.',
    },
    {
      heading: '제9조 (청약철회 및 환불)',
      body: '회원은 관련 법령이 정한 범위 내에서 청약철회 및 환불을 신청할 수 있습니다. 구체적인 기준과 절차는 환불정책을 따릅니다.',
    },
    {
      heading: '제10조 (금지행위 및 이용제한)',
      body: `회원은 다음 행위를 해서는 안 됩니다.\n• 타인의 정보 도용 또는 허위 정보 등록\n• 법령 및 공서양속에 반하는 행위\n• 서비스 운영을 방해하거나 보안 취약점을 악용하는 행위\n회사는 약관 위반 시 서비스 이용을 제한할 수 있습니다.`,
    },
    {
      heading: '제11조 (면책)',
      body: '회사는 천재지변, 통신 장애, 제3자 서비스 장애 등 불가항력으로 인한 손해에 대해 책임지지 않습니다. AI 생성 결과는 확정적 사실이 아니며, 그 완전성·정확성을 보증하지 않습니다.',
    },
    {
      heading: '제12조 (준거법 및 관할)',
      body: '본 약관은 대한민국 법령을 준거법으로 하며, 서비스 이용 관련 분쟁은 관련 법령에 따른 관할 법원을 따릅니다.',
    },
  ],
};

const PRIVACY = {
  title: '개인정보처리방침',
  updatedAt: '2026-02-25',
  sections: [
    {
      heading: '1. 수집 항목',
      body: `회사는 다음 정보를 수집할 수 있습니다.\n• 필수: 이메일, 비밀번호(암호화), 닉네임\n• 선택: 프로필 이미지\n• 자동수집: 접속 IP, 기기·브라우저 정보, 쿠키, 이용기록, 결제 이용기록`,
    },
    {
      heading: '2. 수집·이용 목적',
      body: `• 회원 식별 및 인증, 계정 관리\n• 서비스 제공 및 결제·정산 처리\n• 고객문의 대응, 공지사항 전달\n• 부정이용 방지, 보안 및 서비스 품질 개선`,
    },
    {
      heading: '3. 보유 및 이용 기간',
      body: `원칙적으로 회원 탈퇴 시 지체 없이 파기합니다. 단, 법령상 보관 의무가 있는 경우 해당 기간 동안 보관합니다.\n• 계약/청약철회/대금결제/재화공급 기록: 5년\n• 소비자 불만·분쟁처리 기록: 3년\n• 접속기록: 3개월`,
    },
    {
      heading: '4. 파기 절차 및 방법',
      body: '보유기간 경과 또는 처리 목적 달성 시 즉시 파기합니다. 전자적 파일은 복구 불가능한 방식으로 삭제하며, 출력물은 분쇄 또는 소각 방식으로 파기합니다.',
    },
    {
      heading: '5. 제3자 제공',
      body: '회사는 원칙적으로 이용자 개인정보를 제3자에게 제공하지 않습니다. 단, 이용자 동의 또는 법령상 의무가 있는 경우에는 예외로 합니다.',
    },
    {
      heading: '6. 처리 위탁',
      body: `회사는 서비스 운영을 위해 아래 업무를 외부에 위탁할 수 있습니다.\n• 결제 처리: PortOne 및 제휴 PG사 (결제중계/결제대행)\n• 클라우드 인프라 운영: 호스팅/스토리지 사업자`,
    },
    {
      heading: '7. 이용자 권리 및 행사 방법',
      body: `이용자는 개인정보 열람·정정·삭제·처리정지를 요청할 수 있습니다.\n요청은 ${LEGAL_CONTACT_EMAIL}로 접수할 수 있으며, 회사는 지체 없이 조치합니다.`,
    },
    {
      heading: '8. 쿠키 정책',
      body: '회사는 로그인 유지, 보안, 서비스 개선을 위해 쿠키를 사용할 수 있습니다. 이용자는 브라우저 설정에서 쿠키 저장을 거부할 수 있으나, 일부 기능 이용이 제한될 수 있습니다.',
    },
    {
      heading: '9. 안전성 확보 조치',
      body: '비밀번호 암호화 저장, 접근권한 최소화, 접속기록 관리, 전송구간 암호화(SSL/TLS) 등 기술적·관리적 보호조치를 시행합니다.',
    },
    {
      heading: '10. 개인정보 보호책임자 및 문의',
      body: `개인정보 관련 문의/불만처리: ${LEGAL_CONTACT_EMAIL}`,
    },
  ],
};

const REFUND = {
  title: '환불정책',
  updatedAt: '2026-02-25',
  sections: [
    {
      heading: '1. 기본 원칙',
      body: '회사는 전자상거래 등 관련 법령 및 본 정책에 따라 유상 루비 결제 건의 취소·환불을 처리합니다.',
    },
    {
      heading: '2. 적용 범위',
      body: '유상 루비 결제는 웹소설 회차/작품 구매 목적의 선불 충전입니다. 캐릭터 채팅은 무료 부가 기능으로, 별도 유료 채팅 상품의 결제/환불 대상이 아닙니다.',
    },
    {
      heading: '3. 환불 신청 가능 기준',
      body: `다음에 해당하는 경우 환불을 신청할 수 있습니다.\n• 결제일(승인일) 포함 7일 이내이며, 해당 결제로 충전된 유상 루비를 전혀 사용하지 않은 경우\n• 시스템 장애·중복 결제 등 회사 귀책 사유로 정상 이용이 어려웠던 경우\n• 관련 법령에 따라 환불 의무가 인정되는 경우`,
    },
    {
      heading: '4. 환불 금액 산정',
      body: `환불금은 실제 결제한 유상 금액을 기준으로 산정합니다.\n• 산식: 환불액 = 실제 결제금액 × (미사용 유상 루비 ÷ 해당 결제로 지급된 유상 루비)\n• 일부 사용한 경우: 사용분을 제외한 미사용 유상 루비 비율만큼 환불\n• 무상 지급 루비(이벤트/보너스/프로모션): 환불 대상에서 제외`,
    },
    {
      heading: '5. 환불 제한',
      body: `다음의 경우 환불이 제한될 수 있습니다.\n• 해당 결제로 충전된 유상 루비를 전부 사용한 경우\n• 이용자 귀책 사유(계정 공유, 정책 위반 등)로 이용이 제한된 경우\n• 단순 변심 또는 AI 응답의 주관적 불만족만을 사유로 하는 경우\n• 법령에서 청약철회 예외로 인정되는 디지털 콘텐츠 소비가 완료된 경우\n• 루비의 환전·현금화·양도·회원 간 거래/선물을 요청하는 경우`,
    },
    {
      heading: '6. 환불 신청 방법',
      body: `환불 요청은 ${LEGAL_CONTACT_EMAIL}로 접수할 수 있으며, 아래 정보를 함께 제출해야 합니다.\n• 계정 정보: 이메일, 닉네임\n• 결제 정보: 결제일시, 결제금액, 결제수단, 주문/거래번호(확인 가능한 경우)\n• 환불 사유: 장애·오결제 여부 등 구체 사유`,
    },
    {
      heading: '7. 처리 기간 및 환불 수단',
      body: '회사는 접수일로부터 영업일 기준 7일 이내 처리 결과를 안내합니다. 환불은 원칙적으로 원 결제수단으로 진행하며, 결제대행사·카드사 정책에 따라 실제 입금/취소 반영 시점은 추가로 소요될 수 있습니다.',
    },
    {
      heading: '8. 분쟁 및 이의제기',
      body: `회원은 환불 처리 결과에 대해 이의가 있는 경우 ${LEGAL_CONTACT_EMAIL}로 재심을 요청할 수 있습니다. 회사는 관련 결제·이용 기록을 기준으로 재검토 후 결과를 안내합니다.`,
    },
  ],
};

const CONTENT_MAP = { terms: TERMS, privacy: PRIVACY, refund: REFUND };

/* ───────── 컴포넌트 ───────── */

export default function LegalPage() {
  const { type } = useParams();
  const navigate = useNavigate();
  const content = CONTENT_MAP[type];

  if (!content) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full text-gray-400">
          잘못된 페이지입니다.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* 헤더 */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">뒤로</span>
        </button>

        <h1 className="text-2xl font-bold text-white mb-1">{content.title}</h1>
        <p className="text-xs text-gray-500 mb-8">최종 업데이트: {content.updatedAt}</p>

        {/* 본문 */}
        <div className="space-y-6">
          {content.sections.map((sec, i) => (
            <section key={i}>
              <h2 className="text-base font-semibold text-white mb-2">{sec.heading}</h2>
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
                {sec.body}
              </p>
            </section>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
