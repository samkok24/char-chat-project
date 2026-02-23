/**
 * 법적 페이지 (이용약관 / 개인정보처리방침 / 환불정책)
 * /legal/:type  (type = terms | privacy | refund)
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import { ArrowLeft } from 'lucide-react';

/* ───────── 콘텐츠 상수 ───────── */

const TERMS = {
  title: '이용약관',
  updatedAt: '2026-02-23',
  sections: [
    {
      heading: '제1조 (목적)',
      body: '이 약관은 스토리다이브(이하 "회사")가 제공하는 AI 캐릭터 채팅 서비스(이하 "서비스")의 이용 조건 및 절차, 회사와 회원의 권리·의무·책임사항을 규정함을 목적으로 합니다.',
    },
    {
      heading: '제2조 (정의)',
      body: `1. "서비스"란 회사가 제공하는 AI 캐릭터 채팅, 콘텐츠 생성, 스토리 열람 등 일체의 온라인 서비스를 말합니다.\n2. "회원"이란 본 약관에 동의하고 회원가입을 완료한 자를 말합니다.\n3. "루비"란 서비스 내에서 유료 기능 이용을 위해 구매하는 가상 재화를 말합니다.`,
    },
    {
      heading: '제3조 (약관의 효력 및 변경)',
      body: '회사는 약관을 변경할 경우, 적용일 7일 전부터 서비스 내 공지사항을 통해 고지합니다. 변경된 약관에 동의하지 않는 회원은 서비스 이용을 중단하고 탈퇴할 수 있습니다.',
    },
    {
      heading: '제4조 (서비스의 제공 및 변경)',
      body: '회사는 AI 기술을 활용한 캐릭터 채팅 서비스를 제공하며, 서비스의 내용을 기술적·운영적 필요에 따라 변경할 수 있습니다. 주요 변경 시 사전 공지합니다.',
    },
    {
      heading: '제5조 (회원가입 및 계정)',
      body: '이용자는 회사가 정한 가입 양식에 따라 회원 정보를 기입하고 본 약관에 동의함으로써 회원가입을 신청합니다. 회원은 자신의 계정 정보를 안전하게 관리할 책임이 있습니다.',
    },
    {
      heading: '제6조 (회원의 의무)',
      body: `회원은 다음 행위를 하여서는 안 됩니다.\n1. 타인의 정보를 도용하거나 허위 정보를 등록하는 행위\n2. 서비스를 이용하여 법령 또는 공서양속에 반하는 행위\n3. 서비스의 운영을 고의로 방해하는 행위\n4. 기타 관계 법령에 위반되는 행위`,
    },
    {
      heading: '제7조 (서비스 이용 제한)',
      body: '회사는 회원이 본 약관을 위반하거나 서비스의 정상적인 운영을 방해하는 경우, 서비스 이용을 제한하거나 회원 자격을 정지·상실시킬 수 있습니다.',
    },
    {
      heading: '제8조 (면책)',
      body: '회사는 천재지변, 전쟁, 기간통신사업자의 서비스 중지 등 불가항력으로 인한 서비스 제공 불능에 대해 책임을 지지 않습니다. AI가 생성한 콘텐츠는 참고 목적이며, 회사는 그 정확성·완전성을 보증하지 않습니다.',
    },
    {
      heading: '제9조 (준거법 및 관할)',
      body: '본 약관의 해석 및 적용에 관하여는 대한민국 법률을 준거법으로 하며, 서비스 이용과 관련한 분쟁은 회사의 본사 소재지를 관할하는 법원을 합의관할로 합니다.',
    },
  ],
};

const PRIVACY = {
  title: '개인정보처리방침',
  updatedAt: '2026-02-23',
  sections: [
    {
      heading: '1. 수집하는 개인정보 항목',
      body: `회사는 서비스 제공을 위해 다음과 같은 개인정보를 수집합니다.\n• 필수: 이메일 주소, 비밀번호(암호화 저장), 닉네임\n• 선택: 프로필 이미지\n• 자동 수집: 접속 IP, 쿠키, 서비스 이용 기록, 기기 정보`,
    },
    {
      heading: '2. 개인정보의 수집 및 이용 목적',
      body: `• 회원 관리: 가입·인증, 서비스 제공, 고지·안내\n• 서비스 제공: AI 채팅 서비스, 콘텐츠 개인화, 결제 처리\n• 서비스 개선: 이용 통계 분석, 신규 기능 개발`,
    },
    {
      heading: '3. 개인정보의 보유 및 이용 기간',
      body: '회원 탈퇴 시 지체 없이 파기합니다. 단, 관련 법령에 의해 보존할 필요가 있는 경우 해당 법령에서 정한 기간 동안 보관합니다.\n• 전자상거래법에 의한 거래기록: 5년\n• 통신비밀보호법에 의한 로그인 기록: 3개월',
    },
    {
      heading: '4. 개인정보의 제3자 제공',
      body: '회사는 원칙적으로 회원의 개인정보를 외부에 제공하지 않습니다. 다만, 회원의 동의가 있거나 법령에 의한 경우에는 예외로 합니다.',
    },
    {
      heading: '5. 개인정보의 처리 위탁',
      body: '회사는 서비스 향상을 위해 다음과 같이 개인정보 처리를 위탁하고 있습니다.\n• 결제 처리: Paddle (결제 대행)\n• 클라우드 호스팅: 서비스 인프라 운영',
    },
    {
      heading: '6. 이용자의 권리',
      body: '회원은 언제든지 자신의 개인정보를 조회·수정·삭제할 수 있으며, 회원 탈퇴를 통해 개인정보 처리 정지를 요청할 수 있습니다. 관련 문의는 서비스 내 문의하기를 이용해 주세요.',
    },
    {
      heading: '7. 개인정보의 안전성 확보 조치',
      body: '회사는 개인정보의 안전성 확보를 위해 다음과 같은 조치를 취하고 있습니다.\n• 비밀번호 암호화 저장\n• 접속 기록 보관 및 위·변조 방지\n• 개인정보에 대한 접근 제한\n• SSL/TLS를 통한 네트워크 구간 암호화',
    },
    {
      heading: '8. 개인정보 보호책임자',
      body: '개인정보 처리에 관한 불만이나 문의는 아래 연락처로 문의해 주세요.\n• 이메일: support@storydive.com',
    },
  ],
};

const REFUND = {
  title: '환불정책',
  updatedAt: '2026-02-23',
  sections: [
    {
      heading: '1. 환불 원칙',
      body: '회사는 회원이 구매한 유료 서비스(루비 등)에 대해 관련 법령 및 본 정책에 따라 환불을 처리합니다.',
    },
    {
      heading: '2. 환불 가능 조건',
      body: `다음의 경우 환불을 신청할 수 있습니다.\n• 결제 후 유료 서비스를 전혀 사용하지 않은 경우\n• 서비스 장애로 인해 유료 서비스를 이용하지 못한 경우\n• 기타 관련 법령에 따라 환불이 인정되는 경우`,
    },
    {
      heading: '3. 환불 제한',
      body: `다음의 경우 환불이 제한될 수 있습니다.\n• 구매한 루비를 일부 또는 전부 사용한 경우 (미사용분에 한해 환불)\n• 이벤트·프로모션으로 무상 지급된 루비\n• 회원의 귀책사유로 인한 서비스 이용 불가`,
    },
    {
      heading: '4. 환불 절차',
      body: '환불을 원하시는 경우, 서비스 내 문의하기 또는 support@storydive.com으로 요청해 주세요. 환불 요청 접수 후 영업일 기준 7일 이내에 처리됩니다.',
    },
    {
      heading: '5. 환불 금액 및 방법',
      body: '환불 금액은 실제 결제 금액을 기준으로 산정하며, 원래 결제 수단을 통해 환불됩니다. 결제 대행사(Paddle) 정책에 따라 환불 처리 기간이 달라질 수 있습니다.',
    },
    {
      heading: '6. 청약 철회',
      body: '전자상거래법에 따라 결제일로부터 7일 이내에 청약 철회가 가능합니다. 단, 이미 사용한 콘텐츠에 대해서는 청약 철회가 제한될 수 있습니다.',
    },
    {
      heading: '7. 문의',
      body: '환불 관련 문의: support@storydive.com',
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
