import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../components/ui/accordion';
import { ArrowLeft, HelpCircle, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import AppLayout from '../components/layout/AppLayout';
import { useAuth } from '../contexts/AuthContext';
import { faqsAPI, faqCategoriesAPI } from '../lib/api';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Alert, AlertDescription } from '../components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

/**
 * FAQ 카테고리 기본 메타(SSOT)
 * - 아이콘/기본 id는 프론트에서 고정한다.
 * - 큰 항목명(타이틀)은 서버에서 로드되며, 관리자에 의해 수정될 수 있다(서버 값 우선).
 */
const FAQ_CATEGORIES = [
  { id: 'account', title: '계정 관련'},
  { id: 'character', title: '캐릭터 관련'},
  { id: 'chat', title: '채팅 관련'},
  { id: 'story', title: '작품 관련'},
  { id: 'payment', title: '결제 및 포인트' },
  { id: 'technical', title: '기술 지원'},
];

const FAQPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;

  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [categoryTitleDraft, setCategoryTitleDraft] = useState('');
  const [categoryEditError, setCategoryEditError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ category: FAQ_CATEGORIES[0]?.id || 'account', question: '', answer: '' });
  const [createError, setCreateError] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ category: FAQ_CATEGORIES[0]?.id || 'account', question: '', answer: '' });
  const [editError, setEditError] = useState('');
  const [openItem, setOpenItem] = useState('');

  const { data: categoryRows = [] } = useQuery({
    queryKey: ['faqCategories', 'list'],
    queryFn: async () => {
      try {
        const res = await faqCategoriesAPI.list();
        return Array.isArray(res?.data) ? res.data : [];
      } catch (e) {
        // 카테고리 로드 실패 시에도 FAQ 화면은 기본 카테고리(프론트 상수)로 렌더링한다.
        try { console.error('[faq_categories] list failed:', e); } catch (_) {}
        return [];
      }
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const categories = useMemo(() => {
    const base = Array.isArray(FAQ_CATEGORIES) ? FAQ_CATEGORIES : [];
    const server = Array.isArray(categoryRows) ? categoryRows : [];
    const baseIds = new Set(base.map((c) => String(c?.id || '').trim()).filter(Boolean));

    const serverMap = new Map();
    for (const row of server) {
      const id = String(row?.id || '').trim();
      if (!id) continue;
      serverMap.set(id, row);
    }

    const merged = base.map((c) => {
      const id = String(c?.id || '').trim();
      const row = id ? serverMap.get(id) : null;
      const title = String(row?.title || '').trim() || String(c?.title || '').trim() || id;
      return { ...c, title };
    });

    // 서버에만 존재하는 카테고리가 있으면 뒤에 붙인다(방어적)
    for (const row of server) {
      const id = String(row?.id || '').trim();
      if (!id || baseIds.has(id)) continue;
      merged.push({ id, title: String(row?.title || '').trim() || id, icon: '❓' });
    }

    return merged;
  }, [categoryRows]);

  const { data: faqItems = [], isLoading, error: loadError } = useQuery({
    queryKey: ['faqs', 'list'],
    queryFn: async () => {
      try {
        const res = await faqsAPI.list(isAdmin ? { include_all: true } : {});
        return Array.isArray(res?.data) ? res.data : [];
      } catch (e) {
        try { console.error('[faqs] list failed:', e); } catch (_) {}
        throw e;
      }
    },
    staleTime: 10 * 1000,
    refetchOnWindowFocus: true,
  });

  const itemsByCategory = useMemo(() => {
    const map = new Map();
    const arr = Array.isArray(faqItems) ? faqItems : [];
    for (const it of arr) {
      const cat = String(it?.category || '').trim() || 'technical';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(it);
    }
    // 정렬: order_index asc, created_at desc
    for (const [cat, list] of map.entries()) {
      list.sort((a, b) => {
        const ao = Number(a?.order_index || 0);
        const bo = Number(b?.order_index || 0);
        if (ao !== bo) return ao - bo;
        const at = new Date(a?.created_at || a?.updated_at || 0).getTime();
        const bt = new Date(b?.created_at || b?.updated_at || 0).getTime();
        return bt - at;
      });
      map.set(cat, list);
    }
    return map;
  }, [faqItems]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const category = String(createForm.category || '').trim();
      const question = String(createForm.question || '').trim();
      const answer = String(createForm.answer || '').trim();
      if (!category) throw new Error('카테고리를 선택해주세요.');
      if (!question) throw new Error('질문을 입력해주세요.');
      if (!answer) throw new Error('답변을 입력해주세요.');
      return await faqsAPI.create({ category, question, answer });
    },
    onSuccess: async () => {
      setCreateOpen(false);
      setCreateForm({ category: FAQ_CATEGORIES[0]?.id || 'account', question: '', answer: '' });
      setCreateError('');
      await queryClient.invalidateQueries({ queryKey: ['faqs', 'list'] });
    },
    onError: (e) => {
      const msg = e?.response?.data?.detail || e?.message || 'FAQ 생성에 실패했습니다.';
      setCreateError(String(msg));
      try { console.error('[faqs] create failed:', e); } catch (_) {}
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingId) throw new Error('대상이 없습니다.');
      const category = String(editForm.category || '').trim();
      const question = String(editForm.question || '').trim();
      const answer = String(editForm.answer || '').trim();
      if (!category) throw new Error('카테고리를 선택해주세요.');
      if (!question) throw new Error('질문을 입력해주세요.');
      if (!answer) throw new Error('답변을 입력해주세요.');
      return await faqsAPI.update(editingId, { category, question, answer });
    },
    onSuccess: async () => {
      setEditingId(null);
      setEditError('');
      await queryClient.invalidateQueries({ queryKey: ['faqs', 'list'] });
    },
    onError: (e) => {
      const msg = e?.response?.data?.detail || e?.message || 'FAQ 수정에 실패했습니다.';
      setEditError(String(msg));
      try { console.error('[faqs] update failed:', e); } catch (_) {}
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      if (!id) throw new Error('대상이 없습니다.');
      return await faqsAPI.delete(id);
    },
    onSuccess: async () => {
      setEditingId(null);
      setEditError('');
      await queryClient.invalidateQueries({ queryKey: ['faqs', 'list'] });
    },
    onError: (e) => {
      const msg = e?.response?.data?.detail || e?.message || 'FAQ 삭제에 실패했습니다.';
      setEditError(String(msg));
      try { console.error('[faqs] delete failed:', e); } catch (_) {}
    },
  });

  const categoryUpsertMutation = useMutation({
    mutationFn: async () => {
      if (!editingCategoryId) throw new Error('대상이 없습니다.');
      const title = String(categoryTitleDraft || '').trim();
      if (!title) throw new Error('카테고리명을 입력해주세요.');
      return await faqCategoriesAPI.upsert(editingCategoryId, { title });
    },
    onSuccess: async () => {
      setEditingCategoryId(null);
      setCategoryTitleDraft('');
      setCategoryEditError('');
      await queryClient.invalidateQueries({ queryKey: ['faqCategories', 'list'] });
    },
    onError: (e) => {
      const msg = e?.response?.data?.detail || e?.message || '카테고리 수정에 실패했습니다.';
      setCategoryEditError(String(msg));
      try { console.error('[faq_categories] upsert failed:', e); } catch (_) {}
    },
  });

  const startCategoryEdit = (category) => {
    try {
      const id = String(category?.id || '').trim();
      if (!id) return;
      setEditingCategoryId(id);
      setCategoryTitleDraft(String(category?.title || '').trim());
      setCategoryEditError('');
    } catch (_) {}
  };

  const cancelCategoryEdit = () => {
    setEditingCategoryId(null);
    setCategoryTitleDraft('');
    setCategoryEditError('');
  };

  const startEdit = (it) => {
    try {
      if (!it?.id) return;
      setEditingId(String(it.id));
      setEditForm({
        category: String(it.category || '').trim() || (FAQ_CATEGORIES[0]?.id || 'account'),
        question: String(it.question || '').trim(),
        answer: String(it.answer || '').trim(),
      });
      setEditError('');
      setOpenItem(String(it.id));
    } catch (_) {}
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError('');
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="mb-6"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            뒤로 가기
          </Button>

          <Card className="bg-gray-800 border-gray-700 mb-6">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-3">
                  <HelpCircle className="w-8 h-8 text-purple-500" />
                  <h1 className="text-3xl font-bold text-white">자주 묻는 질문 (FAQ)</h1>
                </div>
                {isAdmin && (
                  <Button
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={() => { setCreateOpen((v) => !v); setCreateError(''); }}
                    title="FAQ 작성"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    FAQ 작성
                  </Button>
                )}
              </div>
              <p className="text-gray-400">
                궁금한 사항을 카테고리별로 확인해보세요.
              </p>
            </CardContent>
          </Card>

          {createOpen && isAdmin && (
            <div className="mb-5 p-4 rounded-xl border border-gray-800 bg-gray-900/30">
              {createError && (
                <Alert variant="destructive" className="mb-3">
                  <AlertDescription>{createError}</AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1 space-y-2">
                  <div className="text-sm text-gray-300">카테고리</div>
                  <Select
                    value={createForm.category}
                    onValueChange={(v) => setCreateForm((p) => ({ ...p, category: v }))}
                  >
                    <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
                      <SelectValue placeholder="카테고리 선택" />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 text-white border-gray-700 max-h-64 overflow-auto">
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2 space-y-2">
                  <Input
                    value={createForm.question}
                    onChange={(e) => setCreateForm((p) => ({ ...p, question: e.target.value }))}
                    placeholder="질문"
                    className="bg-gray-900 border-gray-700 text-white"
                  />
                </div>
                <div className="md:col-span-3 space-y-2">
                  <Textarea
                    value={createForm.answer}
                    onChange={(e) => setCreateForm((p) => ({ ...p, answer: e.target.value }))}
                    placeholder="답변"
                    className="bg-gray-900 border-gray-700 text-white min-h-[160px]"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                      onClick={() => { setCreateOpen(false); setCreateError(''); }}
                    >
                      취소
                    </Button>
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
            </div>
          )}

          {loadError && (
            <Alert variant="destructive" className="mb-5">
              <AlertDescription>FAQ를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            {categories.map((category) => {
              const items = itemsByCategory.get(category.id) || [];
              return (
              <Card key={category.id} className="bg-gray-800 border-gray-700">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="text-2xl">{category.icon}</span>
                      {isAdmin && editingCategoryId === category.id ? (
                        <div className="min-w-0">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                            <Input
                              value={categoryTitleDraft}
                              onChange={(e) => setCategoryTitleDraft(e.target.value)}
                              placeholder="카테고리명"
                              className="bg-gray-900 border-gray-700 text-white h-9 sm:w-[260px]"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  categoryUpsertMutation.mutate();
                                }
                              }}
                            />
                            <div className="flex items-center gap-2">
                              <Button
                                onClick={() => categoryUpsertMutation.mutate()}
                                disabled={categoryUpsertMutation.isPending}
                                className="bg-purple-600 hover:bg-purple-700 text-white h-9"
                              >
                                {categoryUpsertMutation.isPending ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />저장</>) : '저장'}
                              </Button>
                              <Button
                                variant="outline"
                                className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700 h-9"
                                onClick={cancelCategoryEdit}
                              >
                                취소
                              </Button>
                            </div>
                          </div>
                          {categoryEditError && (
                            <Alert variant="destructive" className="mt-3">
                              <AlertDescription>{categoryEditError}</AlertDescription>
                            </Alert>
                          )}
                        </div>
                      ) : (
                        <h2 className="text-xl font-semibold text-white break-words">
                          {category.title}
                        </h2>
                      )}
                    </div>
                    {isAdmin && editingCategoryId !== category.id && (
                      <button
                        type="button"
                        className="p-1.5 rounded hover:bg-gray-700 text-gray-300 hover:text-white"
                        title="카테고리명 수정"
                        onClick={() => startCategoryEdit(category)}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {isLoading ? (
                    <div className="flex items-center gap-2 text-gray-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      불러오는 중...
                    </div>
                  ) : items.length === 0 ? (
                    <div className="text-sm text-gray-400">등록된 FAQ가 없습니다.</div>
                  ) : (
                    <Accordion
                      type="single"
                      collapsible
                      value={openItem}
                      onValueChange={setOpenItem}
                      className="w-full"
                    >
                    {items.map((item) => (
                      <AccordionItem
                        key={item.id}
                        value={String(item.id)}
                        className="border-gray-700"
                      >
                        <AccordionTrigger className="text-left text-gray-200 hover:text-white">
                          <div className="w-full flex items-start justify-between gap-3">
                            <span className="min-w-0 break-words">{item.question}</span>
                            {isAdmin && (
                              // ⚠️ AccordionTrigger는 내부적으로 <button>이라, 그 안에 <button>을 중첩하면 브라우저가 DOM을 깨뜨릴 수 있음.
                              // 아이콘은 button 대신 span(role=button)로 처리해 클릭 동작을 안정화한다.
                              <span className="flex items-center gap-1 flex-shrink-0">
                                <span
                                  role="button"
                                  tabIndex={0}
                                  className="p-1.5 rounded hover:bg-gray-700 text-gray-300 hover:text-white"
                                  title="수정"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    startEdit(item);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      startEdit(item);
                                    }
                                  }}
                                >
                                  <Pencil className="w-4 h-4" />
                                </span>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  className="p-1.5 rounded hover:bg-gray-700 text-red-300 hover:text-red-200"
                                  title="삭제"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (!window.confirm('이 FAQ를 삭제하시겠습니까?')) return;
                                    deleteMutation.mutate(String(item.id));
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (!window.confirm('이 FAQ를 삭제하시겠습니까?')) return;
                                      deleteMutation.mutate(String(item.id));
                                    }
                                  }}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </span>
                              </span>
                            )}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="text-gray-400 pt-2">
                          {editError && editingId === String(item.id) && (
                            <Alert variant="destructive" className="mb-3">
                              <AlertDescription>{editError}</AlertDescription>
                            </Alert>
                          )}
                          {isAdmin && editingId === String(item.id) ? (
                            <div className="space-y-2">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="md:col-span-1 space-y-2">
                                  <div className="text-sm text-gray-300">카테고리</div>
                                  <Select
                                    value={editForm.category}
                                    onValueChange={(v) => setEditForm((p) => ({ ...p, category: v }))}
                                  >
                                    <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
                                      <SelectValue placeholder="카테고리 선택" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-800 text-white border-gray-700 max-h-64 overflow-auto">
                                      {categories.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="md:col-span-2 space-y-2">
                                  <Input
                                    value={editForm.question}
                                    onChange={(e) => setEditForm((p) => ({ ...p, question: e.target.value }))}
                                    placeholder="질문"
                                    className="bg-gray-900 border-gray-700 text-white"
                                  />
                                </div>
                                <div className="md:col-span-3 space-y-2">
                                  <Textarea
                                    value={editForm.answer}
                                    onChange={(e) => setEditForm((p) => ({ ...p, answer: e.target.value }))}
                                    placeholder="답변"
                                    className="bg-gray-900 border-gray-700 text-white min-h-[140px]"
                                  />
                                </div>
                              </div>
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="outline"
                                  className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                  onClick={cancelEdit}
                                >
                                  취소
                                </Button>
                                <Button
                                  onClick={() => updateMutation.mutate()}
                                  disabled={updateMutation.isPending}
                                  className="bg-purple-600 hover:bg-purple-700 text-white"
                                >
                                  {updateMutation.isPending ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />저장</>) : '저장'}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap text-gray-400">{item.answer}</div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                  )}
                </CardContent>
              </Card>
            );})}
          </div>

          <Card className="bg-gray-800 border-gray-700 mt-6">
            <CardContent className="pt-6 text-center">
              <p className="text-gray-400 mb-4">
                원하는 답변을 찾지 못하셨나요?
              </p>
              <Button
                onClick={() => navigate('/contact')}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                1:1 문의하기
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
};

export default FAQPage;


