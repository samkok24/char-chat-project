import React from 'react';
import Sidebar from './Sidebar';

const AppLayout = ({ children }) => {
  return (
    <div className="flex h-screen bg-gray-900">
      {/* 사이드바 - 항상 보임 */}
      <Sidebar />
      
      {/* 메인 콘텐츠 영역 */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
};

export default AppLayout; 