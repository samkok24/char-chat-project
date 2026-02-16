import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { Sheet, SheetContent } from '../ui/sheet';
import { useIsMobile } from '../../hooks/use-mobile';
import { Menu, Home as HomeIcon } from 'lucide-react';

const AppLayout = ({ children, SidebarComponent = Sidebar, sidebarProps, mobileHeaderRight }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const onAgentPage = location.pathname === '/agent';
  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  React.useEffect(() => {
    /**
     * ✅ 반응형: "모바일은 놔두고", 데스크탑에서만 화면 폭이 좁아질 때 아이콘 모드
     *
     * 요구사항:
     * - 경쟁사처럼 "화면이 좁아질 때만" 사이드바가 아이콘으로 바뀐다.
     * - 모바일은 기존처럼 Sheet(오버레이) 사용 → 아이콘 모드로 바꾸지 않는다.
     *
     * 정책:
     * - md 이상(>=768px) & xl 미만(<1280px)일 때만 접기
     * - xl 이상이면 펼치기
     */
    try {
      if (typeof window === 'undefined') return () => {};
      if (!window.matchMedia) return () => {};

      const mq = window.matchMedia('(min-width: 768px) and (max-width: 1279px)');
      const sync = () => {
        try {
          // 모바일은 useIsMobile이 true → collapsed 강제 해제
          if (isMobile) {
            setSidebarCollapsed(false);
            return;
          }
          setSidebarCollapsed(Boolean(mq.matches));
        } catch (_) {}
      };

      sync();
      try { mq.addEventListener('change', sync); } catch (_) {
        try { mq.addListener(sync); } catch (_) {}
      }
      return () => {
        try { mq.removeEventListener('change', sync); } catch (_) {
          try { mq.removeListener(sync); } catch (_) {}
        }
      };
    } catch (_) {
      return () => {};
    }
  }, [isMobile]);

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
            <SidebarComponent
              {...sidebarProps}
              collapsed={Boolean(sidebarCollapsed)}
            />
          </div>

          {/* ✅ 모바일: Sheet(오버레이)로 사이드바 제공 */}
          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetContent
              side="left"
              // 배경/테두리를 앱 톤에 맞춘다. padding은 Sidebar 내부 레이아웃을 그대로 쓰기 위해 0.
              className="bg-gray-800 border-gray-700 p-0 w-[16rem] max-w-[92vw]"
            >
              <SidebarComponent {...sidebarProps} collapsed={false} />
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMobileSidebarOpen(true)}
                    className="inline-flex items-center justify-center h-10 w-10 rounded-full border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors"
                    aria-label="메뉴 열기"
                    title="메뉴"
                  >
                    <Menu className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // ✅ 모바일 헤더 홈 버튼: 언제든 메인 화면으로 복귀
                      try { navigate('/dashboard'); } catch (_) {}
                    }}
                    className="inline-flex items-center justify-center h-10 w-10 rounded-full border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors"
                    aria-label="메인 화면으로 이동"
                    title="메인"
                  >
                    <HomeIcon className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 min-w-0 text-center">
                  <span className="text-sm font-semibold text-gray-100 truncate">챕터8</span>
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