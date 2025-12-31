/**
 * 온보딩: "30초만에 캐릭터 만나기" 모달
 *
 * 목표:
 * - 이미지 + 원하는 캐릭터 느낌(텍스트) + 태그를 입력하면,
 *   AI가 캐릭터 설정을 자동 완성(초안 생성)하고, 유저는 프리뷰/수정 후
 *   "공개 캐릭터"로 생성하여 바로 대화/상세로 진입할 수 있다.
 *
 * 안전/방어:
 * - AI 초안 생성은 `/characters/quick-generate`로 수행(DB 저장 X).
 * - 실제 저장은 기존 SSOT(`/characters/advanced`)로만 수행.
 * - 실패 시 조용히 무시하지 않고 console.error + 사용자 에러 메시지로 알림.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { charactersAPI, filesAPI, tagsAPI, api } from '../lib/api';
import { resolveImageUrl } from '../lib/images';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Alert, AlertDescription } from './ui/alert';
import TagSelectModal from './TagSelectModal';

const dispatchToast = (type, message) => {
  try {
    window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
  } catch (_) {}
};

const DEFAULT_SEED_PLACEHOLDER =
  '예) 무뚝뚝하지만 은근 다정한 경호원. 말투는 짧고 단호. 상황은 밤거리. 로맨스/긴장감.';

export default function QuickMeetCharacterModal({
  open,
  onClose,
  initialName = '',
  initialSeedText = '',
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  const [step, setStep] = useState('input'); // 'input' | 'preview'
  const [name, setName] = useState(initialName);
  const [seedText, setSeedText] = useState(initialSeedText);
  const [error, setError] = useState('');

  const [allTags, setAllTags] = useState([]);
  const [selectedTagSlugs, setSelectedTagSlugs] = useState([]);
  const [tagModalOpen, setTagModalOpen] = useState(false);

  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [uploadedImageUrl, setUploadedImageUrl] = useState('');
  const resolvedUploadedUrl = useMemo(() => resolveImageUrl(uploadedImageUrl || '') || '', [uploadedImageUrl]);

  const [draft, setDraft] = useState(null); // CharacterCreateRequest 형태(초안)
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);

  const selectedTagNames = useMemo(() => {
    const map = new Map((allTags || []).map((t) => [t.slug, t.name]));
    return (selectedTagSlugs || []).map((slug) => map.get(slug) || slug);
  }, [allTags, selectedTagSlugs]);

  const resetAll = () => {
    setStep('input');
    setName(initialName || '');
    setSeedText(initialSeedText || '');
    setError('');
    setDraft(null);
    setSelectedTagSlugs([]);
    setImageFile(null);
    setUploadedImageUrl('');
    if (imagePreviewUrl) {
      try { URL.revokeObjectURL(imagePreviewUrl); } catch (_) {}
    }
    setImagePreviewUrl('');
  };

  // 모달 열릴 때 초기값 반영 + 태그 로드(방어적)
  useEffect(() => {
    if (!open) return;
    setName((v) => (v?.trim() ? v : (initialName || '')));
    setSeedText((v) => (v?.trim() ? v : (initialSeedText || '')));
    setError('');
    setStep('input');
    setDraft(null);
    setUploadedImageUrl('');
    (async () => {
      try {
        const res = await tagsAPI.getTags();
        setAllTags(res.data || []);
      } catch (e) {
        console.error('[QuickMeetCharacterModal] failed to load tags:', e);
        setAllTags([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 모달 닫힐 때: 객체 URL 정리
  useEffect(() => {
    if (open) return;
    if (imagePreviewUrl) {
      try { URL.revokeObjectURL(imagePreviewUrl); } catch (_) {}
    }
    setImagePreviewUrl('');
  }, [open, imagePreviewUrl]);

  const onPickImage = (file) => {
    try {
      setError('');
      setDraft(null);
      setUploadedImageUrl('');
      setImageFile(file || null);
      if (imagePreviewUrl) {
        try { URL.revokeObjectURL(imagePreviewUrl); } catch (_) {}
      }
      if (file) {
        const url = URL.createObjectURL(file);
        setImagePreviewUrl(url);
      } else {
        setImagePreviewUrl('');
      }
    } catch (e) {
      console.error('[QuickMeetCharacterModal] onPickImage failed:', e);
    }
  };

  const validateInput = () => {
    const n = String(name || '').trim();
    const s = String(seedText || '').trim();
    if (!n) return '캐릭터명을 입력해주세요.';
    if (!s) return '원하는 캐릭터 느낌을 입력해주세요.';
    if (!imageFile && !uploadedImageUrl) return '대표 이미지를 넣어주세요.';
    return '';
  };

  const handleGenerateDraft = async () => {
    const msg = validateInput();
    if (msg) {
      setError(msg);
      return;
    }
    setGenerating(true);
    setError('');
    try {
      let imgUrl = uploadedImageUrl;
      if (!imgUrl) {
        const uploadRes = await filesAPI.uploadImages([imageFile]);
        const urls = Array.isArray(uploadRes.data) ? uploadRes.data : [uploadRes.data];
        imgUrl = String(urls[0] || '').trim();
        if (!imgUrl) throw new Error('image_upload_failed');
        setUploadedImageUrl(imgUrl);
      }

      const payload = {
        name: String(name || '').trim(),
        seed_text: String(seedText || '').trim(),
        image_url: imgUrl,
        tags: selectedTagNames,
        ai_model: 'gemini',
      };

      const res = await charactersAPI.quickGenerateCharacterDraft(payload);
      setDraft(res.data || null);
      setStep('preview');
      dispatchToast('success', '캐릭터 초안을 생성했습니다. 프리뷰를 확인해주세요.');
    } catch (e) {
      console.error('[QuickMeetCharacterModal] generate draft failed:', e);
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      setError(`초안 생성 실패: ${detail}`);
    } finally {
      setGenerating(false);
    }
  };

  const ensurePublishPublic = (payload) => {
    const p = payload || {};
    return {
      ...p,
      publish_settings: {
        ...(p.publish_settings || {}),
        is_public: true,
        custom_module_id: null,
        use_translation: true,
      },
    };
  };

  const ensureMedia = (payload) => {
    const p = payload || {};
    const url = (p?.media_settings?.avatar_url || uploadedImageUrl || '').trim();
    if (!url) return p;
    const base = {
      ...(p.media_settings || {}),
      avatar_url: url,
      image_descriptions: Array.isArray(p?.media_settings?.image_descriptions) && p.media_settings.image_descriptions.length
        ? p.media_settings.image_descriptions
        : [{ url, description: '', keywords: [] }],
    };
    return { ...p, media_settings: base };
  };

  const handleCreateAndNavigate = async (target) => {
    if (!draft) return;
    if (creating) return;
    setCreating(true);
    setError('');
    try {
      let payload = ensurePublishPublic(draft);
      payload = ensureMedia(payload);

      const res = await charactersAPI.createAdvancedCharacter(payload);
      const createdId = res?.data?.id;
      if (!createdId) throw new Error('created_id_missing');

      // 태그 연결(선택)
      try {
        if (Array.isArray(selectedTagSlugs) && selectedTagSlugs.length > 0) {
          await api.put(`/characters/${createdId}/tags`, { tags: selectedTagSlugs });
        }
      } catch (e) {
        console.error('[QuickMeetCharacterModal] set tags failed:', e);
        // 태그 실패는 치명적이지 않으므로 생성/이동은 계속
      }

      // 캐시 무효화(홈/목록 반영)
      try { queryClient.invalidateQueries({ queryKey: ['characters'] }); } catch (_) {}
      try { queryClient.invalidateQueries({ queryKey: ['trending-characters-daily'] }); } catch (_) {}

      onClose?.();
      resetAll();

      if (target === 'chat') {
        navigate(`/ws/chat/${createdId}?new=1`);
        return;
      }
      navigate(`/characters/${createdId}`);
    } catch (e) {
      console.error('[QuickMeetCharacterModal] create character failed:', e);
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      setError(`캐릭터 생성 실패: ${detail}`);
    } finally {
      setCreating(false);
    }
  };

  const previewName = String(draft?.basic_info?.name || name || '').trim();
  const previewDesc = String(draft?.basic_info?.description || '').trim();
  const previewGreeting = String(draft?.basic_info?.greeting || '').trim();

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose?.(); resetAll(); } }}>
        <DialogContent className="bg-gray-900 text-white border border-gray-700 max-w-3xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-white text-xl font-semibold">30초만에 캐릭터 만나기</DialogTitle>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertDescription style={{ whiteSpace: 'pre-line' }}>{error}</AlertDescription>
            </Alert>
          )}

          {step === 'input' && (
            <div className="space-y-4">
              <div className="text-sm text-gray-300 leading-relaxed">
                이미지 + 느낌을 입력하면 AI가 캐릭터 설정을 자동으로 채워줍니다. 생성된 캐릭터는 공개로 저장됩니다.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-200">캐릭터명</div>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="예: 마동석"
                    className="h-11 rounded-xl bg-gray-800/60 border-gray-700/80 text-white placeholder:text-gray-400 focus-visible:ring-purple-500/30 focus-visible:border-purple-500/40"
                    maxLength={100}
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-200">대표 이미지</div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onPickImage(e.target.files?.[0] || null)}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 rounded-xl border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60"
                      onClick={() => {
                        try { fileInputRef.current?.click(); } catch (_) {}
                      }}
                    >
                      이미지 선택
                    </Button>
                    <div className="min-w-0 flex-1 text-xs text-gray-400 truncate">
                      {imageFile
                        ? imageFile.name
                        : (uploadedImageUrl ? '업로드된 이미지 사용 중' : '선택된 이미지 없음')}
                    </div>
                  </div>
                  {(imagePreviewUrl || resolvedUploadedUrl) && (
                    <div className="mt-2">
                      <img
                        src={imagePreviewUrl || resolvedUploadedUrl}
                        alt="미리보기"
                        className="w-full max-h-[220px] object-contain rounded-xl border border-gray-800 bg-black/30"
                        loading="lazy"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-200">원하는 캐릭터 느낌</div>
                <Textarea
                  value={seedText}
                  onChange={(e) => setSeedText(e.target.value)}
                  placeholder={DEFAULT_SEED_PLACEHOLDER}
                  className="rounded-xl bg-gray-800/60 border-gray-700/80 text-white placeholder:text-gray-400 focus-visible:ring-purple-500/30 focus-visible:border-purple-500/40"
                  rows={4}
                  maxLength={2000}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-gray-200">태그(선택)</div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60"
                    onClick={() => setTagModalOpen(true)}
                  >
                    태그 선택
                  </Button>
                </div>
                <div className="text-xs text-gray-400">
                  {selectedTagNames.length ? `선택됨: ${selectedTagNames.join(', ')}` : '선택된 태그 없음'}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-end pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60"
                  onClick={() => { onClose?.(); resetAll(); }}
                >
                  닫기
                </Button>
                <Button
                  type="button"
                  className="h-11 rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-sm shadow-purple-900/30"
                  onClick={handleGenerateDraft}
                  disabled={generating}
                >
                  {generating ? '생성 중…' : '캐릭터 생성하기'}
                </Button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-800 bg-gray-950/20 p-4">
                <div className="text-lg font-semibold text-white">{previewName || '캐릭터'}</div>
                <div className="text-sm text-gray-300 mt-1">{previewDesc || '설명이 없습니다.'}</div>
                {!!(imagePreviewUrl || resolvedUploadedUrl) && (
                  <div className="mt-3">
                    <img
                      src={imagePreviewUrl || resolvedUploadedUrl}
                      alt="대표 이미지"
                      className="w-full max-h-[260px] object-contain rounded-xl border border-gray-800 bg-black/30"
                      loading="lazy"
                    />
                  </div>
                )}
                {previewGreeting && (
                  <div className="mt-3 text-xs text-gray-300 whitespace-pre-line border-t border-gray-800 pt-3">
                    {previewGreeting}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-gray-300">프리뷰를 확인한 후, 수정하거나 다시 생성할 수 있어요.</div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60"
                    onClick={() => {
                      // ✅ 요구사항: "수정"은 입력 단계로 돌아가되, 유저가 입력했던 정보(이미지/텍스트/태그)는 유지한다.
                      setError('');
                      setStep('input');
                    }}
                    disabled={creating}
                  >
                    수정
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60"
                    onClick={resetAll}
                    disabled={creating}
                  >
                    다시 생성하기
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-end pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60"
                  onClick={() => { onClose?.(); resetAll(); }}
                  disabled={creating}
                >
                  닫기
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60"
                  onClick={() => handleCreateAndNavigate('detail')}
                  disabled={creating}
                >
                  상세페이지 보기
                </Button>
                <Button
                  type="button"
                  className="h-11 rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-sm shadow-purple-900/30"
                  onClick={() => handleCreateAndNavigate('chat')}
                  disabled={creating}
                >
                  {creating ? '저장 중…' : '대화하러 가기'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <TagSelectModal
        isOpen={tagModalOpen}
        onClose={() => setTagModalOpen(false)}
        allTags={allTags}
        selectedSlugs={selectedTagSlugs}
        onSave={(slugs) => setSelectedTagSlugs(Array.isArray(slugs) ? slugs : [])}
      />
    </>
  );
}


