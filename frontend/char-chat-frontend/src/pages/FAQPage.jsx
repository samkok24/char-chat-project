import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../components/ui/accordion';
import { ArrowLeft, HelpCircle } from 'lucide-react';
import AppLayout from '../components/layout/AppLayout';

const FAQPage = () => {
  const navigate = useNavigate();

  const faqCategories = [
    {
      id: 'account',
      title: '계정 관련',
      icon: '👤',
      items: [
        {
          q: '회원가입은 어떻게 하나요?',
          a: '홈페이지 상단의 "회원가입" 버튼을 클릭하신 후, 이메일과 비밀번호를 입력하시면 됩니다. 이메일 인증을 완료하시면 바로 이용하실 수 있습니다.',
        },
        {
          q: '비밀번호를 잊어버렸어요.',
          a: '로그인 페이지의 "비밀번호를 잊으셨나요?" 링크를 클릭하신 후, 가입하신 이메일 주소를 입력하시면 비밀번호 재설정 메일을 발송해드립니다.',
        },
        {
          q: '이메일 인증 메일이 오지 않아요.',
          a: '스팸함을 확인해보시고, 그래도 없다면 인증 페이지에서 "재발송" 버튼을 클릭해주세요. 여전히 받지 못하신다면 1:1 문의를 통해 연락주시기 바랍니다.',
        },
        {
          q: '계정을 삭제할 수 있나요?',
          a: '현재는 계정 삭제 기능을 제공하지 않습니다. 계정 삭제가 필요하시다면 1:1 문의를 통해 요청해주시기 바랍니다.',
        },
      ],
    },
    {
      id: 'character',
      title: '캐릭터 관련',
      icon: '🎭',
      items: [
        {
          q: '캐릭터를 어떻게 만들 수 있나요?',
          a: '메인 페이지의 "캐릭터 만들기" 버튼을 클릭하시거나, 상단 메뉴에서 "내 캐릭터" → "캐릭터 만들기"를 선택하시면 됩니다. 캐릭터 이름, 설명, 성격 등을 입력하시면 됩니다.',
        },
        {
          q: '캐릭터 이미지는 어떻게 추가하나요?',
          a: '캐릭터 상세 페이지에서 "대표이미지 생성/삽입" 버튼을 클릭하시면 AI로 이미지를 생성하거나 직접 업로드할 수 있습니다.',
        },
        {
          q: '원작챗이 무엇인가요?',
          a: '원작챗은 웹소설이나 웹툰의 등장인물과 대화할 수 있는 기능입니다. 작품 상세 페이지에서 등장인물을 선택하시면 해당 캐릭터와 대화를 시작할 수 있습니다.',
        },
        {
          q: '캐릭터를 공개/비공개로 설정할 수 있나요?',
          a: '네, 캐릭터 상세 페이지에서 설정을 통해 공개 여부를 변경할 수 있습니다. 비공개로 설정하면 본인만 볼 수 있습니다.',
        },
      ],
    },
    {
      id: 'chat',
      title: '채팅 관련',
      icon: '💬',
      items: [
        {
          q: '채팅은 어떻게 시작하나요?',
          a: '캐릭터 카드를 클릭하시거나, 캐릭터 상세 페이지에서 "캐릭터챗 하기" 버튼을 클릭하시면 채팅을 시작할 수 있습니다.',
        },
        {
          q: '채팅 기록은 어디서 볼 수 있나요?',
          a: '상단 메뉴의 "채팅 기록"에서 이전 대화 내역을 확인할 수 있습니다.',
        },
        {
          q: 'AI 모델을 변경할 수 있나요?',
          a: '채팅 중 "모델 선택" 버튼을 클릭하시면 다양한 AI 모델 중에서 선택할 수 있습니다. 각 모델마다 응답 스타일이 다릅니다.',
        },
        {
          q: '채팅이 너무 느려요.',
          a: 'AI 모델에 따라 응답 속도가 다를 수 있습니다. 더 빠른 응답을 원하시면 "모델 선택"에서 빠른 모델을 선택해보세요.',
        },
      ],
    },
    {
      id: 'story',
      title: '작품 관련',
      icon: '📚',
      items: [
        {
          q: '작품을 어떻게 등록하나요?',
          a: '상단 메뉴의 "작품 만들기"를 클릭하신 후, 작품 정보를 입력하고 회차를 추가하시면 됩니다.',
        },
        {
          q: '등장인물은 어떻게 추출하나요?',
          a: '작품 상세 페이지에서 "등장인물" 섹션의 "다시 생성하기" 버튼을 클릭하시면 AI가 자동으로 등장인물을 추출합니다.',
        },
        {
          q: '작품을 수정/삭제할 수 있나요?',
          a: '작품 상세 페이지에서 "수정" 버튼을 클릭하시면 작품 정보와 회차를 수정할 수 있습니다. 삭제는 작품 설정에서 가능합니다.',
        },
        {
          q: '작품을 공개/비공개로 설정할 수 있나요?',
          a: '네, 작품 상세 페이지에서 공개 여부를 설정할 수 있습니다.',
        },
      ],
    },
    {
      id: 'payment',
      title: '결제 및 포인트',
      icon: '💎',
      items: [
        {
          q: '포인트는 어떻게 충전하나요?',
          a: '상단 메뉴의 "포인트 충전"을 클릭하시면 결제 페이지로 이동합니다.',
        },
        {
          q: '포인트는 어디에 사용되나요?',
          a: 'AI 이미지 생성, 프리미엄 기능 등에 포인트가 사용됩니다.',
        },
        {
          q: '환불이 가능한가요?',
          a: '포인트 충전 후 미사용 포인트에 한해 환불이 가능합니다. 자세한 내용은 1:1 문의를 통해 문의해주세요.',
        },
      ],
    },
    {
      id: 'technical',
      title: '기술 지원',
      icon: '🔧',
      items: [
        {
          q: '페이지가 제대로 로드되지 않아요.',
          a: '브라우저 캐시를 삭제하시거나 시크릿 모드로 접속해보세요. 문제가 계속되면 1:1 문의를 통해 문의해주세요.',
        },
        {
          q: '이미지가 업로드되지 않아요.',
          a: '이미지 파일 형식(jpg, png, webp)과 크기(최대 10MB)를 확인해주세요. 그래도 안 되면 1:1 문의를 통해 문의해주세요.',
        },
        {
          q: '오류 메시지가 나타나요.',
          a: '오류 메시지의 내용을 확인하시고, 1:1 문의를 통해 오류 내용과 함께 문의해주시면 빠르게 해결해드리겠습니다.',
        },
      ],
    },
  ];

  return (
    <AppLayout>
      <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="mb-6"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            뒤로 가기
          </Button>

          <Card className="bg-gray-800 border-gray-700 mb-6">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-2">
                <HelpCircle className="w-8 h-8 text-purple-500" />
                <h1 className="text-3xl font-bold text-white">자주 묻는 질문 (FAQ)</h1>
              </div>
              <p className="text-gray-400">
                궁금한 사항을 카테고리별로 확인해보세요.
              </p>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {faqCategories.map((category) => (
              <Card key={category.id} className="bg-gray-800 border-gray-700">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-2xl">{category.icon}</span>
                    <h2 className="text-xl font-semibold text-white">
                      {category.title}
                    </h2>
                  </div>
                  <Accordion type="single" collapsible className="w-full">
                    {category.items.map((item, index) => (
                      <AccordionItem
                        key={index}
                        value={`${category.id}-${index}`}
                        className="border-gray-700"
                      >
                        <AccordionTrigger className="text-left text-gray-200 hover:text-white">
                          {item.q}
                        </AccordionTrigger>
                        <AccordionContent className="text-gray-400 pt-2">
                          {item.a}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="bg-gray-800 border-gray-700 mt-6">
            <CardContent className="pt-6 text-center">
              <p className="text-gray-400 mb-4">
                원하는 답변을 찾지 못하셨나요?
              </p>
              <Button
                onClick={() => navigate('/contact')}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                1:1 문의하기
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
};

export default FAQPage;


