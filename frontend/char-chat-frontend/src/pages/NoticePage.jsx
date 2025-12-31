/**
 * 공지사항 페이지
 *
 * 요구사항:
 * - 유저: 공지 목록/상세 열람
 * - 관리자: 공지 CRUD + 상단 고정
 *
 * UX:
 * - 메인 우상단 종 아이콘의 빨간 점은 "마지막으로 공지를 본 시각(lastSeen)" 기준으로 판단한다.
 * - 사용자가 이 페이지에 진입하면 lastSeen을 최신 공지 시각으로 갱신하여 빨간 점을 해제한다.
 */

import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AppLayout from '../components/layout/AppLayout';
import { useAuth } from '../contexts/AuthContext';
import { noticesAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { ArrowLeft, Loader2, Pencil, Trash2, Plus, Pin } from 'lucide-react';

const LAST_SEEN_KEY = 'notices:lastSeenAt';

const safeParseDateMs = (v) => {
  try {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch (_) {
    return 0;
  }
};

/**
 * 공지 작성일 표시 포맷 (KST 기준, 시간 제거)
 *
 * 의도:
 * - 공지사항 게시판에서는 "연/월/일"만 노출한다. (요구사항)
 * - 서버가 UTC로 내려줘도 KST 기준 날짜가 일관되게 보이도록 Intl timeZone을 사용한다.
 */
const formatKST = (iso) => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (!year || !month || !day) return '';
    return `${year}.${month}.${day}`;
  } catch (_) {
    return '';
  }
};

const NoticePage = () => {
  const navigate = useNavigate();
  const { noticeId } = useParams();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createForm, setCreateForm] = React.useState({ title: '', content: '', is_pinned: false, is_published: true });
  const [createError, setCreateError] = React.useState('');

  const [editMode, setEditMode] = React.useState(false);
  const [editForm, setEditForm] = React.useState({ title: '', content: '', is_pinned: false, is_published: true });
  const [editError, setEditError] = React.useState('');

  const { data: notices = [], isLoading, error } = useQuery({
    queryKey: ['notices', 'list'],
    queryFn: async () => {
      const res = await noticesAPI.list();
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 10 * 1000,
    refetchOnWindowFocus: true,
  });

  const { data: noticeDetailData, isLoading: noticeDetailLoading } = useQuery({
    queryKey: ['notices', 'detail', noticeId],
    enabled: !!noticeId,
    queryFn: async () => {
      try {
        if (!noticeId) return null;
        const res = await noticesAPI.get(noticeId);
        return res?.data || null;
      } catch (e) {
        try { console.error('[notices] detail failed:', e); } catch (_) {}
        return null;
      }
    },
    staleTime: 10 * 1000,
    refetchOnWindowFocus: true,
  });

  const currentNotice = React.useMemo(() => {
    if (!noticeId) return null;
    // 방어: 목록에 없더라도 상세 API로 진입 가능하도록 한다.
    return noticeDetailData || (notices || []).find((n) => String(n.id) === String(noticeId)) || null;
  }, [notices, noticeId, noticeDetailData]);

  const latestAtMs = React.useMemo(() => {
    // 방어: 목록 정렬이 "상단 고정 먼저"이므로, 첫 항목이 최신이 아닐 수 있다.
    // - 전체 목록에서 created_at 최대값을 찾아서 lastSeen을 갱신한다.
    const arr = Array.isArray(notices) ? notices : [];
    let maxMs = 0;
    for (const n of arr) {
      const t = n?.created_at ? safeParseDateMs(n.created_at) : 0;
      if (t > maxMs) maxMs = t;
    }
    return maxMs;
  }, [notices]);

  // ✅ 공지 페이지 진입 시: "마지막 확인 시각"을 최신 공지로 업데이트하여 빨간 점을 해제한다.
  React.useEffect(() => {
    if (!latestAtMs) return;
    try {
      const prev = safeParseDateMs(localStorage.getItem(LAST_SEEN_KEY));
      if (!prev || latestAtMs > prev) {
        localStorage.setItem(LAST_SEEN_KEY, new Date(latestAtMs).toISOString());
      }
    } catch (_) {}
  }, [latestAtMs]);

  // 상세 진입 시 편집 폼 초기화
  React.useEffect(() => {
    if (!currentNotice) return;
    setEditMode(false);
    setEditError('');
    setEditForm({
      title: currentNotice.title || '',
      content: currentNotice.content || '',
      is_pinned: !!currentNotice.is_pinned,
      is_published: currentNotice.is_published !== false,
    });
  }, [currentNotice?.id]);

  /**
   * 상세 폼 동기화(방어적)
   *
   * 의도:
   * - "상단고정 버튼" 등으로 서버 상태가 바뀌었을 때(= updated_at 변경),
   *   편집 모드가 아닐 경우 폼을 최신 상태로 맞춘다.
   * - 편집 중에는 사용자의 입력을 덮어쓰지 않는다.
   */
  React.useEffect(() => {
    if (!currentNotice) return;
    if (editMode) return;
    setEditForm({
      title: currentNotice.title || '',
      content: currentNotice.content || '',
      is_pinned: !!currentNotice.is_pinned,
      is_published: currentNotice.is_published !== false,
    });
  }, [currentNotice?.updated_at, editMode]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const title = String(createForm.title || '').trim();
      const content = String(createForm.content || '').trim();
      if (!title) throw new Error('제목을 입력해주세요.');
      if (!content) throw new Error('내용을 입력해주세요.');
      return await noticesAPI.create({
        title,
        content,
        is_pinned: !!createForm.is_pinned,
        is_published: createForm.is_published !== false,
      });
    },
    onSuccess: async () => {
      setCreateOpen(false);
      setCreateForm({ title: '', content: '', is_pinned: false, is_published: true });
      setCreateError('');
      await queryClient.invalidateQueries({ queryKey: ['notices', 'list'] });
    },
    onError: (e) => {
      const msg = e?.response?.data?.detail || e?.message || '공지 생성에 실패했습니다.';
      setCreateError(String(msg));
      try { console.error('[notices] create failed:', e); } catch (_) {}
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!currentNotice?.id) throw new Error('대상이 없습니다.');
      const title = String(editForm.title || '').trim();
      const content = String(editForm.content || '').trim();
      if (!title) throw new Error('제목을 입력해주세요.');
      if (!content) throw new Error('내용을 입력해주세요.');
      return await noticesAPI.update(currentNotice.id, {
        title,
        content,
        is_pinned: !!editForm.is_pinned,
        is_published: editForm.is_published !== false,
      });
    },
    onSuccess: async () => {
      setEditMode(false);
      setEditError('');
      await queryClient.invalidateQueries({ queryKey: ['notices', 'list'] });
      if (currentNotice?.id) {
        await queryClient.invalidateQueries({ queryKey: ['notices', 'detail', String(currentNotice.id)] });
      }
    },
    onError: (e) => {
      const msg = e?.response?.data?.detail || e?.message || '공지 수정에 실패했습니다.';
      setEditError(String(msg));
      try { console.error('[notices] update failed:', e); } catch (_) {}
    },
  });

  const pinToggleMutation = useMutation({
    mutationFn: async () => {
      if (!currentNotice?.id) throw new Error('대상이 없습니다.');
      return await noticesAPI.update(currentNotice.id, { is_pinned: !currentNotice.is_pinned });
    },
    onSuccess: async () => {
      setEditError('');
      await queryClient.invalidateQueries({ queryKey: ['notices', 'list'] });
      if (currentNotice?.id) {
        await queryClient.invalidateQueries({ queryKey: ['notices', 'detail', String(currentNotice.id)] });
      }
    },
    onError: (e) => {
      const msg = e?.response?.data?.detail || e?.message || '상단 고정 설정에 실패했습니다.';
      setEditError(String(msg));
      try { console.error('[notices] pin toggle failed:', e); } catch (_) {}
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!currentNotice?.id) throw new Error('대상이 없습니다.');
      return await noticesAPI.delete(currentNotice.id);
    },
    onSuccess: async () => {
      setEditMode(false);
      setEditError('');
      navigate('/notices');
      await queryClient.invalidateQueries({ queryKey: ['notices', 'list'] });
    },
    onError: (e) => {
      const msg = e?.response?.data?.detail || e?.message || '공지 삭제에 실패했습니다.';
      setEditError(String(msg));
      try { console.error('[notices] delete failed:', e); } catch (_) {}
    },
  });

  const pinnedNotices = React.useMemo(() => (notices || []).filter((n) => !!n?.is_pinned), [notices]);
  const normalNotices = React.useMemo(() => (notices || []).filter((n) => !n?.is_pinned), [notices]);

  /**
   * 상세 화면에서 보여줄 "고정 상태" (게시판 UX)
   *
   * 의도:
   * - 편집 중에는 폼(editForm)의 고정 상태가 UI(배지/버튼 텍스트)에 반영돼야 한다.
   * - 평소에는 서버(currentNotice) 상태를 그대로 반영한다.
   */
  const effectivePinned = React.useMemo(() => {
    try {
      if (!currentNotice) return false;
      return editMode ? !!editForm.is_pinned : !!currentNotice.is_pinned;
    } catch (_) {
      return false;
    }
  }, [currentNotice?.id, currentNotice?.is_pinned, editMode, editForm.is_pinned]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <Button
              variant="ghost"
              onClick={() => {
                // ✅ UX: 공지 목록에서 "뒤로가기"를 누르면 메인탭으로 이동해야 한다.
                // - 기존 구현(navigate(-1))은 상세 → 목록 이동 후, 목록에서 뒤로가기 시 다시 상세로 돌아가는 문제가 있었다.
                // - 상세 화면에서는 "목록"으로, 목록 화면에서는 메인(/dashboard)으로 고정한다.
                if (noticeId) { navigate('/notices'); return; }
                navigate('/dashboard');
              }}
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              {noticeId ? '목록' : '메인'}
            </Button>
          </div>

          {/* ✅ 게시판 UX: 목록(/notices)과 상세(/notices/:id)를 분리해서 "게시판" 느낌을 만든다. */}
          {!noticeId ? (
            <div>
              {/* 상단 타이틀/액션 (박스 제거: 심플/모던) */}
              <div className="flex items-end justify-between gap-3 mb-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-semibold text-white">공지사항</h1>
                  <p className="text-sm text-gray-400 mt-1">업데이트/운영 공지를 확인하세요.</p>
                </div>
                {isAdmin && (
                  <Button
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={() => { setCreateOpen((v) => !v); setCreateError(''); }}
                    title="새 공지 작성"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    글쓰기
                  </Button>
                )}
              </div>

                {createOpen && isAdmin && (
                  <div className="mb-5 p-4 rounded-xl border border-gray-800 bg-gray-900/30">
                    {createError && (
                      <Alert variant="destructive" className="mb-3">
                        <AlertDescription>{createError}</AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-2">
                      <Input
                        value={createForm.title}
                        onChange={(e) => setCreateForm((p) => ({ ...p, title: e.target.value }))}
                        placeholder="제목"
                        className="bg-gray-900 border-gray-700 text-white"
                      />
                      <Textarea
                        value={createForm.content}
                        onChange={(e) => setCreateForm((p) => ({ ...p, content: e.target.value }))}
                        placeholder="내용"
                        className="bg-gray-900 border-gray-700 text-white min-h-[180px]"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!createForm.is_pinned}
                            onChange={(e) => setCreateForm((p) => ({ ...p, is_pinned: !!e.target.checked }))}
                            className="accent-purple-600"
                          />
                          상단 고정
                        </label>
                        <Button
                          onClick={() => createMutation.mutate()}
                          disabled={createMutation.isPending}
                          className="bg-purple-600 hover:bg-purple-700 text-white"
                        >
                          {createMutation.isPending ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />저장</>) : '저장'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {isLoading ? (
                  <div className="flex items-center gap-2 text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    불러오는 중...
                  </div>
                ) : error ? (
                  <div className="text-red-400 text-sm">공지사항을 불러오지 못했습니다.</div>
                ) : notices.length === 0 ? (
                  <div className="text-gray-400 text-sm">등록된 공지사항이 없습니다.</div>
                ) : (
                  <div className="border-t border-gray-800">
                    {/* 바디: 심플한 라인/호버만 적용 */}
                    <div className="divide-y divide-gray-800">
                      {pinnedNotices.map((n) => {
                        const isLatest = !!latestAtMs && safeParseDateMs(n?.created_at) === latestAtMs;
                        return (
                          <Link
                            key={n.id}
                            to={`/notices/${n.id}`}
                            className="block bg-yellow-500/5 hover:bg-yellow-500/10 transition-colors"
                          >
                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2 sm:gap-3 px-2 py-3 items-center">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Badge className="bg-yellow-600 hover:bg-yellow-600 text-white flex-shrink-0">
                                    <Pin className="w-3 h-3 mr-1" />
                                    공지
                                  </Badge>
                                  <span className="text-sm font-semibold text-white truncate">{n.title}</span>
                                  {isLatest && (
                                    <Badge className="bg-red-600/20 hover:bg-red-600/20 text-red-200 border border-red-500/30 px-1.5 py-0.5 text-[10px] leading-none flex-shrink-0">
                                      N
                                    </Badge>
                                  )}
                                </div>
                                <div className="sm:hidden text-xs text-gray-500 mt-1">{formatKST(n.created_at)}</div>
                              </div>
                              <div className="hidden sm:block text-right text-xs text-gray-500">{formatKST(n.created_at)}</div>
                            </div>
                          </Link>
                        );
                      })}

                      {normalNotices.map((n) => {
                        const isLatest = !!latestAtMs && safeParseDateMs(n?.created_at) === latestAtMs;
                        return (
                          <Link
                            key={n.id}
                            to={`/notices/${n.id}`}
                            className="block hover:bg-gray-800/40 transition-colors"
                          >
                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2 sm:gap-3 px-2 py-3 items-center">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-sm text-white truncate">{n.title}</span>
                                  {isLatest && (
                                    <Badge className="bg-red-600/20 hover:bg-red-600/20 text-red-200 border border-red-500/30 px-1.5 py-0.5 text-[10px] leading-none flex-shrink-0">
                                      N
                                    </Badge>
                                  )}
                                </div>
                                <div className="sm:hidden text-xs text-gray-500 mt-1">{formatKST(n.created_at)}</div>
                              </div>
                              <div className="hidden sm:block text-right text-xs text-gray-500">{formatKST(n.created_at)}</div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
            </div>
          ) : (
            <div>
              <div className="mb-4">
                <h1 className="text-xl sm:text-2xl font-semibold text-white">공지사항</h1>
                <p className="text-sm text-gray-400 mt-1">
                  {currentNotice ? '공지 내용을 확인하세요.' : '공지사항을 불러오는 중입니다.'}
                </p>
              </div>
                {(() => {
                  const showLoading = !!noticeId && (noticeDetailLoading || (!currentNotice && isLoading));
                  if (showLoading) {
                    return (
                      <div className="flex items-center gap-2 text-gray-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        불러오는 중...
                      </div>
                    );
                  }
                  if (!currentNotice) {
                    return <div className="text-gray-400 text-sm">존재하지 않는 공지사항입니다.</div>;
                  }

                  return (
                    <div className="space-y-5">
                      {editError && (
                        <Alert variant="destructive">
                          <AlertDescription>{editError}</AlertDescription>
                        </Alert>
                      )}

                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {effectivePinned && (
                            <Badge className="bg-yellow-600 hover:bg-yellow-600 text-white">
                              <Pin className="w-3 h-3 mr-1" />
                              상단 고정
                            </Badge>
                          )}
                          <span className="text-xs text-gray-500">{formatKST(currentNotice.created_at)}</span>
                        </div>

                        {isAdmin && (
                          <div className="flex flex-wrap items-center gap-2 justify-end">
                            {/* ✅ 관리자 전용: 상단고정 버튼(요구사항) */}
                            <Button
                              variant="secondary"
                              className="bg-gray-700 hover:bg-gray-600 text-white"
                              onClick={() => {
                                // 편집 중에는 로컬 폼만 토글, 편집 중이 아니면 즉시 서버 반영
                                if (editMode) {
                                  setEditForm((p) => ({ ...p, is_pinned: !p.is_pinned }));
                                  return;
                                }
                                pinToggleMutation.mutate();
                              }}
                              disabled={pinToggleMutation.isPending}
                              title={effectivePinned ? '고정 해제' : '상단 고정'}
                            >
                              <Pin className="w-4 h-4 mr-2" />
                              {effectivePinned ? '고정해제' : '상단고정'}
                            </Button>

                            {!editMode ? (
                              <Button
                                variant="secondary"
                                className="bg-gray-700 hover:bg-gray-600 text-white"
                                onClick={() => setEditMode(true)}
                              >
                                <Pencil className="w-4 h-4 mr-2" />
                                수정
                              </Button>
                            ) : (
                              <Button
                                className="bg-purple-600 hover:bg-purple-700 text-white"
                                onClick={() => updateMutation.mutate()}
                                disabled={updateMutation.isPending}
                              >
                                {updateMutation.isPending ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />저장</>) : '저장'}
                              </Button>
                            )}

                            <Button
                              variant="destructive"
                              onClick={() => {
                                if (!window.confirm('이 공지사항을 삭제하시겠습니까?')) return;
                                deleteMutation.mutate();
                              }}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              삭제
                            </Button>

                            {editMode && (
                              <Button
                                variant="ghost"
                                className="text-gray-300"
                                onClick={() => {
                                  setEditMode(false);
                                  setEditError('');
                                  setEditForm({
                                    title: currentNotice.title || '',
                                    content: currentNotice.content || '',
                                    is_pinned: !!currentNotice.is_pinned,
                                    is_published: currentNotice.is_published !== false,
                                  });
                                }}
                              >
                                취소
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      {editMode && isAdmin ? (
                        <div className="space-y-2">
                          <Input
                            value={editForm.title}
                            onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
                            className="bg-gray-900 border-gray-700 text-white"
                          />
                          <Textarea
                            value={editForm.content}
                            onChange={(e) => setEditForm((p) => ({ ...p, content: e.target.value }))}
                            className="bg-gray-900 border-gray-700 text-white min-h-[360px]"
                          />
                          <div className="text-xs text-gray-500">
                            * 상단 고정은 우측의 <b>상단고정</b> 버튼으로 설정합니다.
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="text-2xl sm:text-3xl font-semibold text-white leading-snug">{currentNotice.title}</div>
                          <div className="whitespace-pre-wrap text-gray-200 leading-relaxed text-[15px] sm:text-base">
                            {currentNotice.content}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default NoticePage;




