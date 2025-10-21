import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';

const AppLayout = ({ children, SidebarComponent = Sidebar, sidebarProps }) => {
  const location = useLocation();
  const onAgentPage = location.pathname === '/agent';
  const onDashboard = location.pathname === '/dashboard' || location.pathname === '/';
  return (
  <div className="flex h-screen bg-gray-900 overflow-hidden">
      {/* 사이드바 - 페이지별 커스텀 가능 */}
      {SidebarComponent ? <SidebarComponent {...sidebarProps} /> : null}
      
      {/* 메인 콘텐츠 영역: 에이전트 탭 외에는 스크롤 허용 */}
      <main className={`flex-1 flex flex-col relative min-w-0 ${onAgentPage ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {children}
        {/* PIP 스타일 플로팅 썸네일 제거 */}
      </main>
    </div>
  );
};

export default AppLayout; 