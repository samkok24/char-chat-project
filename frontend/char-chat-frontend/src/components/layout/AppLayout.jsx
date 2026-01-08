import React from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { Sheet, SheetContent } from '../ui/sheet';
import { useIsMobile } from '../../hooks/use-mobile';
import { Menu } from 'lucide-react';

const AppLayout = ({ children, SidebarComponent = Sidebar, sidebarProps, mobileHeaderRight }) => {
  const location = useLocation();
  const onAgentPage = location.pathname === '/agent';
  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);

  /**
   * 모바일 사이드바(Sheet) 닫힘 보장
   *
   * 의도:
   * - 모바일에서 사이드바를 연 뒤 메뉴를 눌러 라우팅이 바뀌면, Sheet가 열린 채로 남아 UX를 해치기 쉽다.
   * - location 변경을 감지해서 자동으로 닫아준다.
   *
   * 방어적:
   * - 모바일이 아닐 때는 상태를 건드리지 않는다.
   */
  React.useEffect(() => {
    if (!isMobile) return;
    setMobileSidebarOpen(false);
  }, [isMobile, location.pathname, location.search]);

  return (
    <div className="flex h-screen bg-gray-900 overflow-hidden">
      {/* 사이드바 - 페이지별 커스텀 가능 */}
      {SidebarComponent ? (
        <>
          {/* ✅ 데스크탑: 기존처럼 고정 사이드바 */}
          <div className="hidden md:flex">
            <SidebarComponent {...sidebarProps} />
          </div>

          {/* ✅ 모바일: Sheet(오버레이)로 사이드바 제공 */}
          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetContent
              side="left"
              // 배경/테두리를 앱 톤에 맞춘다. padding은 Sidebar 내부 레이아웃을 그대로 쓰기 위해 0.
              className="bg-gray-800 border-gray-700 p-0 w-[16rem] max-w-[92vw]"
            >
              <SidebarComponent {...sidebarProps} />
            </SheetContent>
          </Sheet>
        </>
      ) : null}

      {/* 콘텐츠 + 푸터 영역 */}
      <div className="flex-1 flex flex-col min-w-0">
        <main
          className="flex-1 flex flex-col relative min-w-0 overflow-hidden"
        >
          {/* ✅ 모바일 상단 헤더: '뒤로가기' 등 페이지 상단 버튼과 겹치지 않도록 헤더 영역을 분리한다. */}
          {SidebarComponent && (
            <div className="md:hidden flex-shrink-0 border-b border-gray-800 bg-gray-900/90 backdrop-blur">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  className="inline-flex items-center justify-center h-10 w-10 rounded-full border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors"
                  aria-label="메뉴 열기"
                  title="챕터8 - 캐릭터 ∞ 스토리"
                >
                  <Menu className="w-5 h-5" />
                </button>

                <div className="flex-1 min-w-0 text-center">
                  <span className="text-sm font-semibold text-gray-100 truncate">챕터8 - 캐릭터 ∞ 웹소설</span>
                </div>

                {/* 우측 영역: 페이지별 액션 슬롯(없으면 레이아웃 균형용 스페이서) */}
                {mobileHeaderRight ? (
                  <div className="flex items-center justify-end gap-2">
                    {mobileHeaderRight}
                  </div>
                ) : (
                  <div className="h-10 w-10" aria-hidden="true" />
                )}
              </div>
            </div>
          )}

          {/* 본문 스크롤 영역(Agent 메인 페이지는 기존처럼 overflow-hidden 유지) */}
          <div className={`flex-1 min-h-0 ${onAgentPage ? 'overflow-hidden' : 'overflow-y-auto'}`}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AppLayout;