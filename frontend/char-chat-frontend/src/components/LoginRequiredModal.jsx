import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';

const LoginRequiredModal = ({ isOpen, onClose, onLogin, onRegister }) => {
  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent aria-describedby="login-required-desc">
        <DialogHeader>
          <DialogTitle>로그인이 필요합니다</DialogTitle>
          <DialogDescription id="login-required-desc">
            캐릭터 생성 및 소설로 생성 기능은 로그인 후 이용할 수 있어요.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onRegister}>회원가입하기</Button>
          <Button className="bg-purple-600 hover:bg-purple-700" onClick={onLogin}>로그인하기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LoginRequiredModal;


