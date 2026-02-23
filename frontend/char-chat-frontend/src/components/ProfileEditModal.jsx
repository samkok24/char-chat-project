import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Alert, AlertDescription } from './ui/alert';
import { Loader2, Check, Wand2, Upload, Trash2, Mail } from 'lucide-react';
import AvatarCropModal from './AvatarCropModal';
import { resolveImageUrl } from '../lib/images';
import { authAPI, filesAPI, usersAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const ProfileEditModal = ({ isOpen, onClose, profile }) => {
  const { updateUserProfile } = useAuth();
  const [username, setUsername] = useState(profile?.username || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
  const [usernameCheck, setUsernameCheck] = useState({ checked: true, available: true, message: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 이미지 크롭 상태
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState('');
  const fileInputRef = useRef(null);

  // 비밀번호 변경 상태
  const [currPw, setCurrPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwErrors, setPwErrors] = useState({ currPw: '', newPw: '', newPw2: '' });
  const currPwRef = useRef(null);
  const newPwRef = useRef(null);
  const newPw2Ref = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setUsername(profile?.username || '');
      setBio(profile?.bio || '');
      setAvatarUrl(profile?.avatar_url || '');
      setUsernameCheck({ checked: true, available: true, message: '' });
      setError(''); setSuccess('');
      setCurrPw(''); setNewPw(''); setNewPw2('');
      setPwErrors({ currPw: '', newPw: '', newPw2: '' });
    }
  }, [isOpen, profile]);

  // 닉네임 자동 중복확인 (디바운스 500ms)
  useEffect(() => {
    const v = (username || '').trim();
    if (!v) { setUsernameCheck({ checked: false, available: null, message: '' }); return; }
    if (v === profile?.username) { setUsernameCheck({ checked: true, available: true, message: '' }); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await authAPI.checkUsername(v);
        setUsernameCheck({ checked: true, available: data.available, message: data.available ? '사용 가능' : '이미 사용 중' });
      } catch (_) {
        setUsernameCheck({ checked: true, available: null, message: '확인 실패' });
      }
    }, 500);
    return () => clearTimeout(t);
  }, [username, profile?.username]);

  const handleClickUpload = () => fileInputRef.current?.click();
  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setCropSrc(url);
    setIsCropOpen(true);
    e.target.value = '';
  };

  const handleDeleteAvatar = () => setAvatarUrl('');

  const hasChanges = useMemo(() => (
    username !== (profile?.username || '') ||
    bio !== (profile?.bio || '') ||
    avatarUrl !== (profile?.avatar_url || '')
  ), [username, bio, avatarUrl, profile]);

  const canSave = hasChanges && (usernameCheck.available !== false);

  const saveProfile = async () => {
    if (!canSave) return;
    setLoading(true); setError(''); setSuccess('');
    try {
      // AuthContext의 updateUserProfile 사용 (전역 상태 즉시 반영)
      const result = await updateUserProfile({ username, bio, avatar_url: avatarUrl });
      
      if (result.success) {
        setSuccess('프로필이 저장되었습니다.');
        setTimeout(() => onClose?.('saved'), 800); // 성공 메시지 표시 후 닫기
      } else {
        setError(result.error || '저장에 실패했습니다.');
      }
    } catch (e) {
      setError(e?.response?.data?.detail || '저장에 실패했습니다.');
    } finally { setLoading(false); }
  };

  const changePassword = async () => {
    /**
     * 비밀번호 변경 프론트 1차 검증(방어적 UX)
     *
     * 의도/동작:
     * - 서버 요청 전에 누락/불일치/정책 위반을 즉시 안내하여 실패/혼란을 줄인다.
     * - 첫 번째 오류 필드로 자동 포커스를 이동해 수정 흐름을 빠르게 만든다.
     *
     * 주의:
     * - 최종 검증은 서버에서도 수행한다(현재 비밀번호 검증 등).
     */
    const validate = () => {
      const errs = { currPw: '', newPw: '', newPw2: '' };
      let first = null;

      const cp = String(currPw || '');
      const np = String(newPw || '');
      const np2 = String(newPw2 || '');

      if (!cp) {
        errs.currPw = '현재 비밀번호를 입력해주세요.';
        first = first || 'currPw';
      }
      if (!np) {
        errs.newPw = '새 비밀번호를 입력해주세요.';
        first = first || 'newPw';
      }
      if (!np2) {
        errs.newPw2 = '비밀번호 확인을 입력해주세요.';
        first = first || 'newPw2';
      }
      if (np) {
        const policyOk = np.length >= 8 && /[A-Za-z]/.test(np) && /\d/.test(np);
        if (!policyOk) {
          errs.newPw = '새 비밀번호는 영문/숫자 포함 8자 이상이어야 합니다.';
          first = first || 'newPw';
        }
      }
      if (np && cp && np === cp) {
        errs.newPw = '새 비밀번호는 현재 비밀번호와 달라야 합니다.';
        first = first || 'newPw';
      }
      if (np && np2 && np !== np2) {
        errs.newPw2 = '비밀번호 확인이 일치하지 않습니다.';
        first = first || 'newPw2';
      }

      return { ok: !errs.currPw && !errs.newPw && !errs.newPw2, errs, first };
    };

    setPwLoading(true); setError(''); setSuccess('');
    try {
      setPwErrors({ currPw: '', newPw: '', newPw2: '' });
      const v = validate();
      if (!v.ok) {
        setPwErrors(v.errs);
        // 상단에도 동일한 요약 메시지를 노출(스크린샷처럼 모달 상단 Alert로 즉시 인지)
        setError(v.errs.currPw || v.errs.newPw || v.errs.newPw2 || '비밀번호 입력을 확인해주세요.');
        try {
          if (v.first === 'currPw') currPwRef.current?.focus?.();
          else if (v.first === 'newPw') newPwRef.current?.focus?.();
          else if (v.first === 'newPw2') newPw2Ref.current?.focus?.();
        } catch (_) {}
        return;
      }

      await authAPI.updatePassword(currPw, newPw);
      setSuccess('비밀번호가 변경되었습니다.');
      setCurrPw(''); setNewPw(''); setNewPw2('');
      setPwErrors({ currPw: '', newPw: '', newPw2: '' });
    } catch (e) {
      console.error('비밀번호 변경 실패:', e);
      setError(e?.response?.data?.detail || '비밀번호 변경에 실패했습니다.');
    } finally { setPwLoading(false); }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(v)=>{ if(!v) onClose?.(); }}>
      {/* ✅ 다크 테마 강제 적용(가독성 개선)
       * - 현재 앱은 다크 UX를 기본으로 사용하지만, DialogContent는 `bg-background` 토큰을 사용한다.
       * - 루트에 `.dark`가 적용되지 않은 상태(또는 일부 페이지/상태)에서는 배경이 흰색으로 렌더링되어
       *   본 컴포넌트의 `text-gray-200` 라벨/설명들이 거의 보이지 않는 문제가 발생한다.
       * - 모달 내부에서만 `.dark`를 강제하여, 토큰/컴포넌트(Input, Alert 등) 스타일이 일관되게 다크로 동작하게 한다.
       */}
      <DialogContent className="sm:max-w-[640px] dark bg-gray-950 text-gray-100 border-gray-800">
        <DialogHeader>
          <DialogTitle>프로필 수정</DialogTitle>
        </DialogHeader>
        {error && (
          <Alert variant="destructive" className="mb-3"><AlertDescription>{error}</AlertDescription></Alert>
        )}
        {success && (
          <Alert className="mb-3"><AlertDescription>{success}</AlertDescription></Alert>
        )}

        {/* 프로필 이미지 */}
        <div className="mb-6">
          <Label className="mb-2 block text-gray-200 font-semibold">프로필 이미지</Label>
          <div className="flex items-center gap-4">
            <Avatar className="w-16 h-16">
              <AvatarImage src={resolveImageUrl(avatarUrl)} />
              <AvatarFallback>{(profile?.username||'U').charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex items-center gap-2">
              <Button 
                variant="secondary" 
                onClick={handleClickUpload}
                className="bg-purple-600 hover:bg-purple-700 text-white font-medium"
              >
                <Upload className="w-4 h-4 mr-2"/>업로드
              </Button>
              <Button 
                variant="outline" 
                onClick={handleDeleteAvatar}
                className="border-red-500 text-red-500 hover:bg-red-500 hover:text-white font-medium"
              >
                <Trash2 className="w-4 h-4 mr-2"/>삭제
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            </div>
          </div>
          <AvatarCropModal
            isOpen={isCropOpen}
            src={cropSrc}
            outputSize={1024}
            onCancel={()=>{ try{URL.revokeObjectURL(cropSrc);}catch(_){ } setIsCropOpen(false); setCropSrc(''); }}
            onConfirm={async (cropped)=>{
              setIsCropOpen(false);
              try {
                const res = await filesAPI.uploadImages([cropped]);
                const url = Array.isArray(res.data)? res.data[0] : res.data;
                setAvatarUrl(url);
              } finally { try{URL.revokeObjectURL(cropSrc);}catch(_){ } setCropSrc(''); }
            }}
          />
        </div>

        {/* 이메일/가입일 */}
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-gray-200 font-semibold">이메일</Label>
            <div className="mt-1 flex items-center gap-2">
              <Mail className="w-4 h-4 text-gray-400"/>
              <span className="text-sm text-gray-300">{profile?.email}</span>
            </div>
          </div>
          <div>
            <Label className="text-gray-200 font-semibold">가입일</Label>
            <div className="mt-1 text-sm text-gray-300">{new Date(profile?.created_at).toLocaleDateString('ko-KR')}</div>
          </div>
        </div>

        {/* 닉네임 */}
        <div className="mb-6">
          <Label htmlFor="username" className="text-gray-200 font-semibold">닉네임</Label>
          <div className="mt-1 flex items-center gap-2">
            <Input id="username" value={username} onChange={(e)=>setUsername(e.target.value)} placeholder="닉네임을 입력하세요" className="text-gray-900 dark:text-gray-100" />
            <Button 
              type="button" 
              variant="secondary" 
              onClick={async()=>{ const {data}=await authAPI.generateUsername(); setUsername(data.username||''); }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium whitespace-nowrap"
            >
              <Wand2 className="w-4 h-4 mr-1"/>자동생성
            </Button>
          </div>
          {usernameCheck.checked && usernameCheck.message && (
            <div className={`mt-1 text-xs font-semibold ${usernameCheck.available? 'text-green-400':'text-red-400'}`}>{usernameCheck.message}</div>
          )}
        </div>

        {/* 자기소개 */}
        <div className="mb-6">
          <Label htmlFor="bio" className="text-gray-200 font-semibold">자기소개</Label>
          <Textarea id="bio" value={bio} onChange={(e)=>setBio(e.target.value)} rows={4} maxLength={500} placeholder="자기소개를 입력하세요 (최대 500자)" className="text-gray-900 dark:text-gray-100" />
          <div className="text-xs text-gray-300 mt-1 font-medium">{bio.length}/500</div>
        </div>

        {/* 비밀번호 변경 */}
        <div className="mb-4">
          <Label className="block mb-2 text-gray-200 font-semibold">비밀번호 변경</Label>
          <div className="space-y-2">
            <div>
              <Label htmlFor="curr-pw" className="text-gray-200">현재 비밀번호</Label>
              <Input
                ref={currPwRef}
                id="curr-pw"
                type="password"
                value={currPw}
                onChange={(e)=>{ setCurrPw(e.target.value); setPwErrors(prev => ({ ...prev, currPw: '' })); }}
                className="text-gray-900 dark:text-gray-100"
              />
              {pwErrors.currPw && (
                <div className="mt-1 text-xs font-semibold text-red-400">{pwErrors.currPw}</div>
              )}
            </div>
            <div>
              <Label htmlFor="new-pw" className="text-gray-200">새 비밀번호</Label>
              <Input
                ref={newPwRef}
                id="new-pw"
                type="password"
                value={newPw}
                onChange={(e)=>{ setNewPw(e.target.value); setPwErrors(prev => ({ ...prev, newPw: '' })); }}
                placeholder="영문/숫자 조합 8자 이상"
                pattern="(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}"
                className="text-gray-900 dark:text-gray-100"
              />
              {pwErrors.newPw && (
                <div className="mt-1 text-xs font-semibold text-red-400">{pwErrors.newPw}</div>
              )}
            </div>
            <div>
              <Label htmlFor="new-pw2" className="text-gray-200">비밀번호 확인</Label>
              <Input
                ref={newPw2Ref}
                id="new-pw2"
                type="password"
                value={newPw2}
                onChange={(e)=>{ setNewPw2(e.target.value); setPwErrors(prev => ({ ...prev, newPw2: '' })); }}
                className="text-gray-900 dark:text-gray-100"
              />
              {pwErrors.newPw2 && (
                <div className="mt-1 text-xs font-semibold text-red-400">{pwErrors.newPw2}</div>
              )}
            </div>
            <Button 
              type="button" 
              onClick={changePassword} 
              disabled={pwLoading} 
              className="mt-1 bg-orange-600 hover:bg-orange-700 text-white font-medium disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              {pwLoading ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin"/>변경 중...</>) : '비밀번호 변경'}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={()=>onClose?.()}
            className="border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white font-medium"
          >
            취소
          </Button>
          <Button 
            onClick={saveProfile} 
            disabled={!canSave || loading}
            className="bg-green-600 hover:bg-green-700 text-white font-medium disabled:bg-gray-600 disabled:text-gray-400"
          >
            {loading ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin"/>저장 중...</>) : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProfileEditModal;


