import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';

const AppLayout = ({ children, SidebarComponent = Sidebar, sidebarProps }) => {
  const location = useLocation();
  const onAgentPage = location.pathname === '/agent';
  const onDashboard = location.pathname === '/dashboard' || location.pathname === '/';
  return (
  <div className="flex h-screen bg-gray-900">
      {/* 사이드바 - 페이지별 커스텀 가능 */}
      {SidebarComponent ? <SidebarComponent {...sidebarProps} /> : null}
      
      {/* 메인 콘텐츠 영역: 에이전트 탭 외에는 스크롤 허용 */}
      <main className={`flex-1 flex flex-col relative ${onAgentPage ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {children}
        {/* PIP 스타일 플로팅 썸네일 */}
        <Link
          to={onAgentPage ? '/agent' : '/dashboard'}
          className="fixed right-8 bottom-5 z-40 block w-80 h-48 rounded-lg overflow-hidden group"
          title={'메인으로'}
        >
          <img
            src={'/main.png'}
            alt="pip"
            className="w-full h-full object-cover" />
          <div className="pointer-events-none absolute inset-0 rounded-lg border-2 border-purple-500/70 shadow-[0_0_20px_rgba(168,85,247,0.45)] animate-pulse"></div>
        </Link>
      </main>
    </div>
  );
};

export default AppLayout; 