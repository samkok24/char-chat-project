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

  useEffect(() => {
    if (isOpen) {
      setUsername(profile?.username || '');
      setBio(profile?.bio || '');
      setAvatarUrl(profile?.avatar_url || '');
      setUsernameCheck({ checked: true, available: true, message: '' });
      setError(''); setSuccess('');
      setCurrPw(''); setNewPw(''); setNewPw2('');
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
    setPwLoading(true); setError(''); setSuccess('');
    try {
      if (newPw.length < 8 || !(/[A-Za-z]/.test(newPw) && /\d/.test(newPw))) {
        setError('새 비밀번호는 영문/숫자 포함 8자 이상이어야 합니다.');
        return;
      }
      if (newPw !== newPw2) { setError('비밀번호 확인이 일치하지 않습니다.'); return; }
      await authAPI.updatePassword(currPw, newPw);
      setSuccess('비밀번호가 변경되었습니다.');
      setCurrPw(''); setNewPw(''); setNewPw2('');
    } catch (e) {
      setError(e?.response?.data?.detail || '비밀번호 변경에 실패했습니다.');
    } finally { setPwLoading(false); }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(v)=>{ if(!v) onClose?.(); }}>
      <DialogContent className="sm:max-w-[640px]">
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
              <Input id="curr-pw" type="password" value={currPw} onChange={(e)=>setCurrPw(e.target.value)} className="text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <Label htmlFor="new-pw" className="text-gray-200">새 비밀번호</Label>
              <Input id="new-pw" type="password" value={newPw} onChange={(e)=>setNewPw(e.target.value)} placeholder="영문/숫자 조합 8자 이상" pattern="(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}" className="text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <Label htmlFor="new-pw2" className="text-gray-200">비밀번호 확인</Label>
              <Input id="new-pw2" type="password" value={newPw2} onChange={(e)=>setNewPw2(e.target.value)} className="text-gray-900 dark:text-gray-100" />
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


