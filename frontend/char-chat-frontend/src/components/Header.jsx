/**
 * 공통 헤더 컴포넌트
 */

import React, { useState, useEffect } from 'react';
import { resolveImageUrl } from '../lib/images';
import { pointAPI } from '../lib/api';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { clearCreateCharacterDraft, hasCreateCharacterDraft } from '../lib/createCharacterDraft';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import {
  MessageCircle,
  Plus,
  BookOpen,
  LogIn,
  UserPlus,
  LogOut,
  User,
  Gem,
  Settings
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const Header = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [draftPromptOpen, setDraftPromptOpen] = React.useState(false);
  const [rubyBalance, setRubyBalance] = useState(null);

  // 루비 잔액 조회
  useEffect(() => {
    if (!isAuthenticated) { setRubyBalance(null); return; }
    let mounted = true;
    (async () => {
      try {
        const res = await pointAPI.getBalance();
        if (mounted) setRubyBalance(res.data?.balance ?? 0);
      } catch { /* best-effort */ }
    })();
    return () => { mounted = false; };
  }, [isAuthenticated]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleCreateCharacterClick = React.useCallback((e) => {
    try { e?.preventDefault?.(); } catch (_) {}
    try {
      if (hasCreateCharacterDraft()) {
        setDraftPromptOpen(true);
        return;
      }
    } catch (_) {}
    navigate('/characters/create');
  }, [navigate]);

  const handleDraftStartFresh = React.useCallback(() => {
    try { clearCreateCharacterDraft(); } catch (_) {}
    try { setDraftPromptOpen(false); } catch (_) {}
    try { navigate('/characters/create'); } catch (_) {}
  }, [navigate]);

  const handleDraftLoad = React.useCallback(() => {
    try { setDraftPromptOpen(false); } catch (_) {}
    try { navigate('/characters/create'); } catch (_) {}
  }, [navigate]);

  return (
    <header className="bg-white/80 backdrop-blur-sm shadow-sm border-b sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-4">
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                <MessageCircle className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-gray-900">AI 캐릭터 챗</h1>
            </Link>
          </div>

          <div className="flex items-center space-x-4">
            {isAuthenticated ? (
              <>
                <Button variant="outline" onClick={handleCreateCharacterClick}>
                  <Plus className="w-4 h-4 mr-2" />
                  캐릭터 생성
                </Button>
                <Link to="/my-characters">
                  <Button variant="outline">
                    내 캐릭터
                  </Button>
                </Link>
                <Link to="/favorites">
                  <Button variant="outline">
                    관심 캐릭터
                  </Button>
                </Link>
                <Button variant="outline">
                  <BookOpen className="w-4 h-4 mr-2" />
                  스토리
                </Button>

                {/* 루비 잔액 */}
                <Button variant="outline" onClick={() => navigate('/ruby/charge')} className="gap-1.5">
                  <Gem className="w-4 h-4 text-pink-500" />
                  <span className="font-semibold">{rubyBalance !== null ? rubyBalance.toLocaleString() : '...'}</span>
                </Button>

                {/* 프로필 드롭다운 메뉴 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={resolveImageUrl(user?.avatar_url)} alt={user?.username} />
                        <AvatarFallback className="bg-gradient-to-r from-purple-600 to-blue-600 text-white">
                          {user?.username?.charAt(0)?.toUpperCase() || 'U'}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end">
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{user?.username}</p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {user?.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/profile')}>
                      <User className="mr-2 h-4 w-4" />
                      <span>마이페이지</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/ruby/charge')}>
                      <Gem className="mr-2 h-4 w-4 text-pink-500" />
                      <span>루비 충전</span>
                      <Badge className="ml-auto bg-pink-100 text-pink-800" variant="secondary">
                        {rubyBalance !== null ? rubyBalance.toLocaleString() : '...'}
                      </Badge>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/settings')}>
                      <Settings className="mr-2 h-4 w-4" />
                      <span>설정</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>로그아웃</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Link to="/login">
                  <Button className="bg-purple-600 text-white px-6 py-2 rounded-lg font-medium border-0 transition-none hover:bg-purple-600 hover:text-white active:bg-purple-600 focus:bg-purple-600">
                    로그인
                  </Button>
                </Link>
                <Link to="/register">
                  <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
                    <UserPlus className="w-4 h-4 mr-2" />
                    회원가입
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
        <AlertDialog open={draftPromptOpen} onOpenChange={setDraftPromptOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>임시저장된 초안을 찾았어요</AlertDialogTitle>
              <AlertDialogDescription>
                이어서 불러오시겠어요? 새로 만들기를 선택하면 기존 임시저장은 삭제됩니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleDraftLoad}>불러오기</AlertDialogCancel>
              <AlertDialogAction onClick={handleDraftStartFresh}>새로 만들기</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </header>
  );
};

export default Header; 
