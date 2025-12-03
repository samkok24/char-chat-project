import React from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';

const AppLayout = ({ children, SidebarComponent = Sidebar, sidebarProps }) => {
  const location = useLocation();
  const onAgentPage = location.pathname === '/agent';

  return (
    <div className="flex h-screen bg-gray-900 overflow-hidden">
      {/* 사이드바 - 페이지별 커스텀 가능 */}
      {SidebarComponent ? <SidebarComponent {...sidebarProps} /> : null}

      {/* 콘텐츠 + 푸터 영역 */}
      <div className="flex-1 flex flex-col min-w-0">
        <main
          className={`flex-1 flex flex-col relative min-w-0 ${
            onAgentPage ? 'overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;