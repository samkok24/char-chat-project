import React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Save, Trash2, ArrowUp, ArrowDown, ExternalLink, Image as ImageIcon, Settings, X } from 'lucide-react';

import AppLayout from '../components/layout/AppLayout';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI } from '../lib/api';
import {
  HOME_BANNERS_STORAGE_KEY,
  HOME_BANNERS_CHANGED_EVENT,
  DEFAULT_HOME_BANNERS,
  getHomeBanners,
  setHomeBanners,
  sanitizeHomeBanner,
} from '../lib/cmsBanners';
import {
  HOME_SLOTS_STORAGE_KEY,
  HOME_SLOTS_CHANGED_EVENT,
  HOME_SLOTS_CURATED_CHARACTERS_SLOT_ID,
  HOME_SLOTS_CURATED_CHARACTERS_MAX,
  DEFAULT_HOME_SLOTS,
  getHomeSlots,
  setHomeSlots,
  sanitizeHomeSlot,
} from '../lib/cmsSlots';

/**
 * /cms 관리자 페이지 (UI만)
 *
 * 목표:
 * - 메인 탭 홈 배너를 관리(추가/삭제/이미지 교체/링크/노출 기간)
 *
 * 제약:
 * - 현재는 "UI만" 요구사항에 맞춰 로컬스토리지에 저장한다.
 * - 운영에서 전 유저에 반영하려면 추후 서버/DB 연동이 필요.
 */

const toDatetimeLocal = (iso) => {
  try {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (_) {
    return '';
  }
};

const fromDatetimeLocal = (v) => {
  try {
    const s = String(v || '').trim();
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch (_) {
    return null;
  }
};

const isExternalUrl = (url) => /^https?:\/\//i.test(String(url || ''));

/**
 * 이미지 캐시 버스터
 *
 * 문제/의도:
 * - 배너 이미지를 같은 URL로 교체(업로드/덮어쓰기)하면 브라우저 캐시로 인해 "예전 이미지가 계속 보이는" 현상이 자주 발생한다.
 * - 배너의 updatedAt/createdAt을 v 파라미터로 붙여 최신 이미지를 강제로 로드한다.
 *
 * 방어적:
 * - data: URL(로컬 업로드 base64)은 그대로 반환한다.
 * - hash(#)가 있는 URL도 보존한다.
 */
const withCacheBust = (url, versionKey) => {
  try {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^data:/i.test(raw)) return raw;

    const verRaw = String(versionKey || '').trim();
    if (!verRaw) return raw;

    // ISO 문자열이면 timestamp로(더 짧고 안정적인 값)
    let ver = verRaw;
    try {
      const t = new Date(verRaw).getTime();
      if (Number.isFinite(t) && t > 0) ver = String(t);
    } catch (_) {}

    const hashIdx = raw.indexOf('#');
    const base = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    const hash = hashIdx >= 0 ? raw.slice(hashIdx) : '';
    const joined = `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(ver)}`;
    return `${joined}${hash}`;
  } catch (e) {
    try { console.warn('[CMSPage] withCacheBust failed:', e); } catch (_) {}
    return String(url || '');
  }
};

const computeStatus = (b) => {
  try {
    const enabled = b.enabled !== false;
    if (!enabled) return { key: 'disabled', label: '비활성', className: 'bg-gray-700 text-gray-200' };
    const now = Date.now();
    const start = b.startAt ? new Date(b.startAt).getTime() : null;
    const end = b.endAt ? new Date(b.endAt).getTime() : null;
    if (start && Number.isFinite(start) && now < start) return { key: 'pending', label: '대기', className: 'bg-blue-700 text-white' };
    if (end && Number.isFinite(end) && now > end) return { key: 'ended', label: '종료', className: 'bg-red-700 text-white' };
    return { key: 'active', label: '노출중', className: 'bg-green-700 text-white' };
  } catch (_) {
    return { key: 'unknown', label: '확인필요', className: 'bg-gray-700 text-gray-200' };
  }
};

const CMSPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;

  const [activeTab, setActiveTab] = React.useState('banners'); // banners | slots | aiModels
  const [banners, setBannersState] = React.useState(() => getHomeBanners());
  const [slots, setSlotsState] = React.useState(() => getHomeSlots());
  const [saving, setSaving] = React.useState(false);

  // ===== 추천 캐릭터(초심자 온보딩) 선택 UI 상태 =====
  // - "구좌명"과 달리 추천 캐릭터 목록은 입력 중 trim 이슈가 없도록 배열 자체를 편집한다.
  const [curatedSearch, setCuratedSearch] = React.useState('');
  const [curatedSearchResults, setCuratedSearchResults] = React.useState([]);
  const [curatedSearching, setCuratedSearching] = React.useState(false);

  // 배너 탭: 탭/창 동기화(방어적)
  // - focus 이벤트는 파일 업로드(File Picker)에서도 발생할 수 있어, "저장 전 편집 상태"를 로컬스토리지의 옛 값으로 덮어쓰는 버그를 만들 수 있다.
  // - 따라서 focus 재로드는 사용하지 않고,
  //   (1) 같은 탭에서 저장(setHomeBanners) 시 발생하는 커스텀 이벤트
  //   (2) 다른 탭/창에서 로컬스토리지가 변경될 때 발생하는 storage 이벤트
  //   로만 동기화한다.
  React.useEffect(() => {
    const refreshBanners = () => {
      try { setBannersState(getHomeBanners()); } catch (_) {}
    };
    const onCustom = () => refreshBanners();
    const onStorage = (e) => {
      try {
        if (!e) return;
        if (e.key === HOME_BANNERS_STORAGE_KEY) refreshBanners();
      } catch (_) {}
    };
    try { window.addEventListener(HOME_BANNERS_CHANGED_EVENT, onCustom); } catch (_) {}
    try { window.addEventListener('storage', onStorage); } catch (_) {}
    return () => {
      try { window.removeEventListener(HOME_BANNERS_CHANGED_EVENT, onCustom); } catch (_) {}
      try { window.removeEventListener('storage', onStorage); } catch (_) {}
    };
  }, []);

  // 구좌 탭: 탭/창 동기화(방어적)
  React.useEffect(() => {
    const refreshSlots = () => {
      try { setSlotsState(getHomeSlots()); } catch (_) {}
    };
    const onCustom = () => refreshSlots();
    const onStorage = (e) => {
      try {
        if (!e) return;
        if (e.key === HOME_SLOTS_STORAGE_KEY) refreshSlots();
      } catch (_) {}
    };
    try { window.addEventListener(HOME_SLOTS_CHANGED_EVENT, onCustom); } catch (_) {}
    try { window.addEventListener('storage', onStorage); } catch (_) {}
    return () => {
      try { window.removeEventListener(HOME_SLOTS_CHANGED_EVENT, onCustom); } catch (_) {}
      try { window.removeEventListener('storage', onStorage); } catch (_) {}
    };
  }, []);

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8">
          <div className="max-w-3xl mx-auto">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  관리자 페이지
                </CardTitle>
                <CardDescription className="text-gray-400">접근 권한이 없습니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate('/dashboard')} className="bg-purple-600 hover:bg-purple-700 text-white">
                  홈으로 이동
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </AppLayout>
    );
  }

  const updateBanner = (id, patch) => {
    setBannersState((prev) => {
      const next = (Array.isArray(prev) ? prev : []).map((b) => (String(b.id) === String(id) ? sanitizeHomeBanner({ ...b, ...patch, id: b.id }) : b));
      return next;
    });
  };

  const addBanner = () => {
    const b = sanitizeHomeBanner({
      title: `배너 ${Math.max(1, (banners || []).length + 1)}`,
      imageUrl: '',
      linkUrl: '/notices',
      openInNewTab: false,
      enabled: true,
      startAt: null,
      endAt: null,
    });
    setBannersState((prev) => [...(Array.isArray(prev) ? prev : []), b]);
    toast.success('배너가 추가되었습니다. 아래에서 내용을 수정한 뒤 저장하세요.');
  };

  const removeBanner = (id) => {
    if (!window.confirm('이 배너를 삭제하시겠습니까?')) return;
    setBannersState((prev) => (Array.isArray(prev) ? prev.filter((b) => String(b.id) !== String(id)) : []));
    // UX: 클릭 피드백(저장 전 상태임을 명확히)
    toast.success('배너가 삭제되었습니다. 저장 버튼을 눌러 반영하세요.');
  };

  /**
   * 배너 이미지 제거(PC/모바일 개별)
   *
   * 의도:
   * - "이미지 제거" 기능이 없으면 URL/업로드를 지우기 위해 긴 값을 직접 삭제해야 하며 UX가 매우 나빠진다.
   */
  const clearBannerImage = (id, kind) => {
    const k = String(kind || '').toLowerCase();
    const isMobile = k === 'mobile';
    const label = isMobile ? '모바일' : 'PC';
    if (!window.confirm(`${label} 배너 이미지를 제거하시겠습니까?`)) return;
    try {
      updateBanner(id, isMobile ? { mobileImageUrl: '' } : { imageUrl: '' });
      toast.success(`${label} 배너 이미지가 제거되었습니다. 저장 버튼을 눌러 반영하세요.`);
    } catch (e) {
      console.error('[CMSPage] clearBannerImage failed:', e);
      toast.error('이미지 제거에 실패했습니다.');
    }
  };

  const moveBanner = (id, dir) => {
    setBannersState((prev) => {
      const arr = Array.isArray(prev) ? [...prev] : [];
      const idx = arr.findIndex((b) => String(b.id) === String(id));
      if (idx < 0) return arr;
      const nextIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (nextIdx < 0 || nextIdx >= arr.length) return arr;
      const tmp = arr[idx];
      arr[idx] = arr[nextIdx];
      arr[nextIdx] = tmp;
      return arr;
    });
  };

  const handlePickImage = async (id, file) => {
    try {
      if (!file) return;
      if (!String(file.type || '').startsWith('image/')) {
        toast.error('이미지 파일만 업로드할 수 있습니다.');
        return;
      }
      // 로컬스토리지 용량 방어(대략적인 경고)
      if (file.size > 2.5 * 1024 * 1024) {
        toast.warning('이미지 용량이 큽니다. 저장 실패(용량 초과)가 날 수 있어요. 가능하면 더 작은 이미지로 교체하세요.');
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
        reader.readAsDataURL(file);
      });
      updateBanner(id, { imageUrl: dataUrl });
      toast.success('이미지가 적용되었습니다. 저장 버튼을 눌러 반영하세요.');
    } catch (e) {
      console.error('[CMSPage] image read failed:', e);
      toast.error('이미지 적용에 실패했습니다.');
    }
  };

  /**
   * 모바일 배너 이미지 업로드(로컬 저장)
   *
   * 의도/동작:
   * - PC 배너(`imageUrl`)과 별도로, 모바일 전용 배너(`mobileImageUrl`)를 설정한다.
   * - 모바일 화면에서 PC용 배너가 깨지거나(과도 크롭/가독성 저하) 레이아웃이 틀어지는 문제를 예방한다.
   */
  const handlePickMobileImage = async (id, file) => {
    try {
      if (!file) return;
      if (!String(file.type || '').startsWith('image/')) {
        toast.error('이미지 파일만 업로드할 수 있습니다.');
        return;
      }
      // 로컬스토리지 용량 방어(대략적인 경고)
      if (file.size > 2.5 * 1024 * 1024) {
        toast.warning('이미지 용량이 큽니다. 저장 실패(용량 초과)가 날 수 있어요. 가능하면 더 작은 이미지로 교체하세요.');
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
        reader.readAsDataURL(file);
      });
      updateBanner(id, { mobileImageUrl: dataUrl });
      toast.success('모바일 이미지가 적용되었습니다. 저장 버튼을 눌러 반영하세요.');
    } catch (e) {
      console.error('[CMSPage] mobile image read failed:', e);
      toast.error('모바일 이미지 적용에 실패했습니다.');
    }
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      // 간단 검증: 기간 역전 방지
      for (const b of (banners || [])) {
        const start = b.startAt ? new Date(b.startAt).getTime() : null;
        const end = b.endAt ? new Date(b.endAt).getTime() : null;
        if (start && end && Number.isFinite(start) && Number.isFinite(end) && start > end) {
          toast.error(`"${b.title || '배너'}"의 노출 기간이 올바르지 않습니다. (시작 > 종료)`);
          setSaving(false);
          return;
        }
      }

      const res = setHomeBanners(banners);
      if (!res.ok) {
        toast.error('저장에 실패했습니다. (로컬 저장소 용량 초과 가능)');
        return;
      }
      toast.success('저장 완료! 홈 배너에 반영되었습니다.');
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = () => {
    if (!window.confirm('기본값으로 초기화하시겠습니까? (현재 설정이 사라집니다)')) return;
    setBannersState(DEFAULT_HOME_BANNERS.map(sanitizeHomeBanner));
    toast.success('기본값으로 초기화되었습니다. 저장 버튼을 눌러 반영하세요.');
  };

  // ===== 홈 구좌(슬롯) 관리 =====
  /**
   * 구좌(슬롯) 수정
   *
   * 주의(중요):
   * - `sanitizeHomeSlot()`은 `title`에 `trim()`을 적용한다.
   * - 구좌 제목 Input에서 매 키 입력마다 sanitize를 적용하면,
   *   사용자가 띄어쓰기를 입력하는 순간(트레일링 스페이스)이 즉시 제거되어
   *   "구좌명에 띄어쓰기가 안 들어가는" UX 버그가 발생한다.
   * - 따라서 `title` 패치는 입력 중에는 원문을 유지하고,
   *   최종 저장(`setHomeSlots`) 시점에만 sanitize(trim)되도록 한다.
   */
  const updateSlot = (id, patch) => {
    setSlotsState((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      const safePatch = (patch && typeof patch === 'object') ? patch : {};

      const hasTitlePatch = Object.prototype.hasOwnProperty.call(safePatch, 'title');
      const rawTitle = hasTitlePatch ? safePatch.title : undefined;

      return arr.map((s) => {
        if (String(s?.id) !== String(id)) return s;

        const merged = { ...(s || {}), ...safePatch, id: s?.id };
        const normalized = sanitizeHomeSlot(merged);

        // ✅ 입력 UX: 띄어쓰기(특히 트레일링 스페이스)를 유지한다.
        if (hasTitlePatch) {
          normalized.title = (typeof rawTitle === 'string') ? rawTitle : String(rawTitle ?? '');
        }
        return normalized;
      });
    });
  };

  const addSlot = () => {
    const s = sanitizeHomeSlot({
      title: `구좌 ${Math.max(1, (slots || []).length + 1)}`,
      enabled: true,
      startAt: null,
      endAt: null,
    });
    setSlotsState((prev) => [...(Array.isArray(prev) ? prev : []), s]);
    toast.success('구좌가 추가되었습니다. 아래에서 내용을 수정한 뒤 저장하세요.');
  };

  /**
   * 추천 캐릭터 검색(관리자용)
   *
   * 의도:
   * - 추천 캐릭터는 하드코딩하지 않고, 운영자가 CMS에서 선택한다.
   * - 지금은 "간단 검색 + 최대 20개"만 제공해도 데모/운영에 충분하다.
   *
   * 방어적:
   * - API 응답 포맷이 배열/객체로 달라져도 안전하게 처리한다.
   */
  const runCuratedCharacterSearch = React.useCallback(async () => {
    const q = String(curatedSearch || '').trim();
    if (!q) {
      setCuratedSearchResults([]);
      return;
    }

    setCuratedSearching(true);
    try {
      const res = await charactersAPI.getCharacters({ search: q, limit: 20 });
      const raw = res?.data;
      const arr =
        Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.characters)
            ? raw.characters
            : [];

      // 최소 필드만 보장 (id/name/avatar_url)
      const normalized = arr
        .map((c) => ({
          id: c?.id,
          name: c?.name,
          avatar_url: c?.avatar_url || c?.thumbnail_url || '',
          source_type: c?.source_type,
          is_origchat: c?.is_origchat,
          origin_story_id: c?.origin_story_id,
        }))
        .filter((c) => !!c.id);

      setCuratedSearchResults(normalized);
    } catch (e) {
      try { console.error('[CMSPage] curated character search failed:', e); } catch (_) {}
      toast.error('캐릭터 검색에 실패했습니다.');
      setCuratedSearchResults([]);
    } finally {
      setCuratedSearching(false);
    }
  }, [curatedSearch]);

  const moveSlot = (id, dir) => {
    setSlotsState((prev) => {
      const arr = Array.isArray(prev) ? [...prev] : [];
      const idx = arr.findIndex((s) => String(s.id) === String(id));
      if (idx < 0) return arr;
      const nextIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (nextIdx < 0 || nextIdx >= arr.length) return arr;
      const tmp = arr[idx];
      arr[idx] = arr[nextIdx];
      arr[nextIdx] = tmp;
      return arr;
    });
  };

  const saveSlotsAll = async () => {
    setSaving(true);
    try {
      // 간단 검증: 기간 역전 방지
      for (const s of (slots || [])) {
        const start = s.startAt ? new Date(s.startAt).getTime() : null;
        const end = s.endAt ? new Date(s.endAt).getTime() : null;
        if (start && end && Number.isFinite(start) && Number.isFinite(end) && start > end) {
          toast.error(`"${s.title || '구좌'}"의 노출 기간이 올바르지 않습니다. (시작 > 종료)`);
          setSaving(false);
          return;
        }
      }

      const res = setHomeSlots(slots);
      if (!res.ok) {
        toast.error('저장에 실패했습니다. (로컬 저장소 용량 초과 가능)');
        return;
      }
      toast.success('저장 완료! 구좌 설정이 저장되었습니다.');
    } finally {
      setSaving(false);
    }
  };

  const resetSlotsToDefault = () => {
    if (!window.confirm('기본값으로 초기화하시겠습니까? (현재 설정이 사라집니다)')) return;
    setSlotsState(DEFAULT_HOME_SLOTS.map(sanitizeHomeSlot));
    toast.success('기본값으로 초기화되었습니다. 저장 버튼을 눌러 반영하세요.');
  };

  const isBannersTab = activeTab === 'banners';
  const isSlotsTab = activeTab === 'slots';
  const isAiModelsTab = activeTab === 'aiModels';

  return (
    <AppLayout>
      <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Settings className="w-6 h-6 text-purple-300" />
              <div>
                <div className="text-xl font-bold text-white">관리자 페이지</div>
                <div className="text-sm text-gray-400">
                  {isBannersTab ? '배너 조작' : isSlotsTab ? '구좌 조작' : 'AI모델 조작(준비중)'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isAiModelsTab ? (
                <Button
                  variant="outline"
                  className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                  disabled
                  title="준비중"
                >
                  준비중
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                    onClick={isBannersTab ? resetToDefault : resetSlotsToDefault}
                  >
                    초기화
                  </Button>
                  <Button
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={isBannersTab ? saveAll : saveSlotsAll}
                    disabled={saving}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {saving ? '저장 중...' : '저장'}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* 상단 탭 */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              className={`h-9 px-3 ${isBannersTab ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-700' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
              onClick={() => setActiveTab('banners')}
              title="배너 조작"
            >
              배너 조작
            </Button>
            <Button
              variant="outline"
              className={`h-9 px-3 ${isSlotsTab ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-700' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
              onClick={() => setActiveTab('slots')}
              title="구좌 조작"
            >
              구좌 조작
            </Button>
            <Button
              variant="outline"
              className={`h-9 px-3 ${isAiModelsTab ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-700' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
              onClick={() => setActiveTab('aiModels')}
              title="AI모델 조작(준비중)"
            >
              AI모델 조작
            </Button>
          </div>

          {isBannersTab && (
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-white">홈 배너</CardTitle>
                <CardDescription className="text-gray-400">
                  배너 이미지/링크/노출 기간을 설정할 수 있습니다. (현재는 로컬 저장소 기반)
                </CardDescription>
              </div>
              <Button
                onClick={addBanner}
                className="bg-pink-600 hover:bg-pink-700 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                배너 추가
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {(banners || []).length === 0 ? (
                <div className="text-gray-400 text-sm">배너가 없습니다. “배너 추가”를 눌러 등록하세요.</div>
              ) : (
                (banners || []).map((b, idx) => {
                  const status = computeStatus(b);
                  const href = String(b.linkUrl || '').trim();
                  const external = href && isExternalUrl(href);
                  return (
                    <div key={b.id} className="rounded-xl border border-gray-700 bg-gray-900/30 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-semibold text-white truncate">
                              #{idx + 1} {b.title || '배너'}
                            </div>
                            <Badge className={status.className}>{status.label}</Badge>
                            {external && (
                              <Badge className="bg-gray-700 text-gray-200">
                                <ExternalLink className="w-3 h-3 mr-1" />
                                외부링크
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {b.startAt ? new Date(b.startAt).toLocaleString('ko-KR') : '시작 제한 없음'}
                            {' '}~{' '}
                            {b.endAt ? new Date(b.endAt).toLocaleString('ko-KR') : '종료 제한 없음'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button
                            variant="outline"
                            className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                            onClick={() => moveBanner(b.id, 'up')}
                            disabled={idx === 0}
                            title="위로"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                            onClick={() => moveBanner(b.id, 'down')}
                            disabled={idx === (banners.length - 1)}
                            title="아래로"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="destructive"
                            className="h-9 px-3"
                            onClick={() => removeBanner(b.id)}
                            title="삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      {/* 미리보기 */}
                      <div className="mt-4">
                        <div className="text-xs text-gray-400 mb-2 flex items-center gap-2">
                          <ImageIcon className="w-4 h-4" />
                          미리보기
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* PC/공통 */}
                          <div className="rounded-xl overflow-hidden border border-gray-800 bg-gray-800/40">
                            <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-300 flex items-center justify-between">
                              <span className="font-semibold">PC 배너</span>
                              <span className="text-[11px] text-gray-500">imageUrl</span>
                            </div>
                            <div className="relative">
                              <div className="absolute inset-0 bg-gradient-to-r from-[#2a160c] via-[#15121a] to-[#0b1627]" />
                              {b.imageUrl ? (
                                <img
                                  src={withCacheBust(b.imageUrl, b.updatedAt || b.createdAt)}
                                  alt={b.title || '배너'}
                                  className="relative w-full h-[140px] object-cover"
                                  onLoad={(e) => { try { e.currentTarget.style.display = ''; } catch (_) {} }}
                                  onError={(e) => { try { e.currentTarget.style.display = 'none'; } catch (_) {} }}
                                />
                              ) : (
                                <div className="relative w-full h-[140px] flex items-center px-6">
                                  <div className="text-white">
                                    <div className="text-lg font-bold">배너 이미지가 없습니다</div>
                                    <div className="text-sm text-white/80 mt-1">아래에서 이미지 URL 또는 파일 업로드로 등록하세요.</div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 모바일 */}
                          <div className="rounded-xl overflow-hidden border border-gray-800 bg-gray-800/40">
                            <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-300 flex items-center justify-between">
                              <span className="font-semibold">모바일 배너</span>
                              <span className="text-[11px] text-gray-500">mobileImageUrl</span>
                            </div>
                            <div className="relative">
                              <div className="absolute inset-0 bg-gradient-to-r from-[#2a160c] via-[#15121a] to-[#0b1627]" />
                              {(b.mobileImageUrl || b.imageUrl) ? (
                                <img
                                  src={withCacheBust((b.mobileImageUrl || b.imageUrl), b.updatedAt || b.createdAt)}
                                  alt={b.title || '배너'}
                                  className="relative w-full h-[140px] object-contain"
                                  onLoad={(e) => { try { e.currentTarget.style.display = ''; } catch (_) {} }}
                                  onError={(e) => { try { e.currentTarget.style.display = 'none'; } catch (_) {} }}
                                />
                              ) : (
                                <div className="relative w-full h-[140px] flex items-center px-6">
                                  <div className="text-white">
                                    <div className="text-lg font-bold">모바일 이미지가 없습니다</div>
                                    <div className="text-sm text-white/80 mt-1">없으면 PC 배너(imageUrl)를 사용합니다.</div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 편집 폼 */}
                      <div className="mt-4 space-y-4">
                        {/* 기본 정보 */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-gray-300">배너 제목(관리용)</Label>
                            <Input
                              value={b.title || ''}
                              onChange={(e) => updateBanner(b.id, { title: e.target.value })}
                              className="bg-gray-900 border-gray-700 text-white"
                              placeholder="예: 겨울 이벤트 배너"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-gray-300">링크(URL 또는 내부 경로)</Label>
                            <Input
                              value={b.linkUrl || ''}
                              onChange={(e) => updateBanner(b.id, { linkUrl: e.target.value })}
                              className="bg-gray-900 border-gray-700 text-white"
                              placeholder="예: /notices 또는 https://example.com"
                            />
                          </div>
                        </div>

                        {/* PC 배너 설정 */}
                        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white">PC 배너 이미지 설정</div>
                              <div className="text-xs text-gray-500 leading-relaxed mt-1">
                                권장(PC): <span className="text-gray-300 font-medium">2400×420</span> (약 5.7:1)
                                <br />
                                참고: PC에서는 화면 폭에 따라 상/하가 약간 잘릴 수 있으니(cover) 중요한 텍스트는 중앙에 배치하세요.
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                              onClick={() => clearBannerImage(b.id, 'pc')}
                              disabled={!String(b.imageUrl || '').trim()}
                              title="PC 이미지 제거"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              제거
                            </Button>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-gray-300">PC 이미지 URL</Label>
                            <Input
                              value={b.imageUrl || ''}
                              onChange={(e) => updateBanner(b.id, { imageUrl: e.target.value })}
                              className="bg-gray-900 border-gray-700 text-white"
                              placeholder="예: /banners/banner1.png 또는 https://..."
                            />
                            <div className="text-xs text-gray-500 leading-relaxed">
                              팁: `frontend/public`에 이미지를 넣으면 `/파일명` 형태로 사용할 수 있어요.
                              <br />
                              동일 URL로 교체 시 캐시로 예전 이미지가 보일 수 있어, 이 화면/홈 배너는 자동으로 최신을 강제 로드합니다.
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-gray-300">PC 이미지 파일 업로드(로컬 저장)</Label>
                            <Input
                              type="file"
                              accept="image/*"
                              className="bg-gray-900 border-gray-700 text-white"
                              onChange={(e) => handlePickImage(b.id, e.target.files?.[0])}
                            />
                            <div className="text-xs text-gray-500">
                              파일 업로드는 브라우저 로컬 저장소에 저장됩니다(용량 제한 있음).
                            </div>
                          </div>
                        </div>

                        {/* 모바일 배너 설정 */}
                        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white">모바일 배너 이미지 설정</div>
                              <div className="text-xs text-gray-500 leading-relaxed mt-1">
                                권장(모바일): <span className="text-gray-300 font-medium">1080×400</span> (약 2.7:1)
                                <br />
                                비워두면 PC 이미지(imageUrl)가 모바일에도 사용됩니다.
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                              onClick={() => clearBannerImage(b.id, 'mobile')}
                              disabled={!String(b.mobileImageUrl || '').trim()}
                              title="모바일 이미지 제거"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              제거
                            </Button>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-gray-300">모바일 이미지 URL (옵션)</Label>
                            <Input
                              value={b.mobileImageUrl || ''}
                              onChange={(e) => updateBanner(b.id, { mobileImageUrl: e.target.value })}
                              className="bg-gray-900 border-gray-700 text-white"
                              placeholder="예: /banners/banner1_mobile.png 또는 https://..."
                            />
                            <div className="text-xs text-gray-500 leading-relaxed">
                              모바일에서만 우선 사용합니다. 비워두면 PC 이미지(imageUrl)가 그대로 사용됩니다.
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-gray-300">모바일 이미지 파일 업로드(로컬 저장, 옵션)</Label>
                            <Input
                              type="file"
                              accept="image/*"
                              className="bg-gray-900 border-gray-700 text-white"
                              onChange={(e) => handlePickMobileImage(b.id, e.target.files?.[0])}
                            />
                            <div className="text-xs text-gray-500">
                              모바일 전용 이미지입니다. 비워두면 PC 이미지가 모바일에도 사용됩니다.
                            </div>
                          </div>
                        </div>

                        {/* 노출 기간 */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-gray-300">노출 시작(연월일시)</Label>
                            <Input
                              type="datetime-local"
                              value={toDatetimeLocal(b.startAt)}
                              onChange={(e) => updateBanner(b.id, { startAt: fromDatetimeLocal(e.target.value) })}
                              className="bg-gray-900 border-gray-700 text-white"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-gray-300">노출 종료(연월일시)</Label>
                            <Input
                              type="datetime-local"
                              value={toDatetimeLocal(b.endAt)}
                              onChange={(e) => updateBanner(b.id, { endAt: fromDatetimeLocal(e.target.value) })}
                              className="bg-gray-900 border-gray-700 text-white"
                            />
                          </div>
                        </div>

                        {/* 토글 */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white">배너 활성화</div>
                              <div className="text-xs text-gray-500">끄면 기간과 상관없이 숨김 처리됩니다.</div>
                            </div>
                            <Switch
                              checked={b.enabled !== false}
                              onCheckedChange={(v) => updateBanner(b.id, { enabled: !!v })}
                            />
                          </div>

                          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white">새 탭으로 열기</div>
                              <div className="text-xs text-gray-500">외부 링크는 새 탭을 권장합니다.</div>
                            </div>
                            <Switch
                              checked={!!b.openInNewTab}
                              onCheckedChange={(v) => updateBanner(b.id, { openInNewTab: !!v })}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
          )}

          {isSlotsTab && (
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-white">홈 구좌</CardTitle>
                  <CardDescription className="text-gray-400">
                    구좌 순서/숨김/노출 시간을 설정할 수 있습니다. (기본: 상시, 현재는 로컬 저장소 기반)
                  </CardDescription>
                </div>
                <Button
                  onClick={addSlot}
                  className="bg-pink-600 hover:bg-pink-700 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  구좌 추가
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {(slots || []).length === 0 ? (
                  <div className="text-gray-400 text-sm">구좌가 없습니다. “구좌 추가”를 눌러 등록하세요.</div>
                ) : (
                  (slots || []).map((s, idx) => {
                    const status = computeStatus(s);
                    const isCuratedPickSlot = String(s?.id || '') === HOME_SLOTS_CURATED_CHARACTERS_SLOT_ID;
                    const curatedPicks = Array.isArray(s?.characterPicks) ? s.characterPicks : [];
                    return (
                      <div key={s.id} className="rounded-xl border border-gray-700 bg-gray-900/30 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="text-sm font-semibold text-white truncate">
                                #{idx + 1} {s.title || '구좌'}
                              </div>
                              <Badge className={status.className}>{status.label}</Badge>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {s.startAt ? new Date(s.startAt).toLocaleString('ko-KR') : '상시'}
                              {' '}~{' '}
                              {s.endAt ? new Date(s.endAt).toLocaleString('ko-KR') : '상시'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Button
                              variant="outline"
                              className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                              onClick={() => moveSlot(s.id, 'up')}
                              disabled={isCuratedPickSlot || idx === 0}
                              title={isCuratedPickSlot ? '상단 고정 구좌' : '위로'}
                            >
                              <ArrowUp className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                              onClick={() => moveSlot(s.id, 'down')}
                              disabled={isCuratedPickSlot || idx === ((slots || []).length - 1)}
                              title={isCuratedPickSlot ? '상단 고정 구좌' : '아래로'}
                            >
                              <ArrowDown className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="mt-4 space-y-4">
                          {isCuratedPickSlot && (
                            <div className="rounded-lg border border-purple-500/30 bg-purple-900/10 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-white">추천 캐릭터(최대 {HOME_SLOTS_CURATED_CHARACTERS_MAX}명)</div>
                                  <div className="text-xs text-gray-400 mt-1">
                                    메인 화면 상단에 고정 노출되는 초심자용 구좌입니다. (선택이 없으면 안내 문구만 보입니다)
                                  </div>
                                </div>
                                <Badge className="bg-purple-700 text-white">
                                  {Math.min(curatedPicks.length, HOME_SLOTS_CURATED_CHARACTERS_MAX)}/{HOME_SLOTS_CURATED_CHARACTERS_MAX}
                                </Badge>
                              </div>

                              {/* 선택된 캐릭터 */}
                              {curatedPicks.length === 0 ? (
                                <div className="mt-3 text-sm text-gray-300">
                                  아직 선택된 추천 캐릭터가 없습니다.
                                </div>
                              ) : (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {curatedPicks.slice(0, HOME_SLOTS_CURATED_CHARACTERS_MAX).map((p) => {
                                    const pid = String(p?.id || '').trim();
                                    const name = String(p?.name || '').trim() || `ID: ${pid}`;
                                    const img = String(p?.avatar_url || '').trim();
                                    return (
                                      <div
                                        key={pid || name}
                                        className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900/40 px-2.5 py-1"
                                      >
                                        <Avatar className="h-6 w-6">
                                          <AvatarImage src={img} alt={name} />
                                          <AvatarFallback className="bg-gray-800 text-gray-200 text-xs">
                                            {name?.charAt(0) || 'C'}
                                          </AvatarFallback>
                                        </Avatar>
                                        <span className="text-xs text-gray-200 max-w-[180px] truncate" title={name}>{name}</span>
                                        <button
                                          type="button"
                                          className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
                                          onClick={() => {
                                            const next = curatedPicks.filter((x) => String(x?.id || '') !== pid);
                                            updateSlot(s.id, { characterPicks: next });
                                          }}
                                          aria-label="추천 캐릭터 제거"
                                          title="제거"
                                        >
                                          <X className="h-4 w-4" />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* 검색/추가 */}
                              <form
                                className="mt-4 flex flex-col sm:flex-row gap-2"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  runCuratedCharacterSearch();
                                }}
                              >
                                <Input
                                  value={curatedSearch}
                                  onChange={(e) => setCuratedSearch(e.target.value)}
                                  className="bg-gray-900 border-gray-700 text-white"
                                  placeholder="캐릭터 이름으로 검색 (예: 여우, 기사, 학생...)"
                                />
                                <Button
                                  type="submit"
                                  variant="outline"
                                  className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                  disabled={curatedSearching}
                                >
                                  {curatedSearching ? '검색 중...' : '검색'}
                                </Button>
                              </form>

                              {curatedSearchResults.length > 0 && (
                                <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950/30">
                                  <div className="max-h-[260px] overflow-auto">
                                    {curatedSearchResults.map((c) => {
                                      const cid = String(c?.id || '').trim();
                                      const name = String(c?.name || '').trim() || `ID: ${cid}`;
                                      const img = String(c?.avatar_url || '').trim();
                                      const already = curatedPicks.some((p) => String(p?.id || '') === cid);
                                      const disabled = already || curatedPicks.length >= HOME_SLOTS_CURATED_CHARACTERS_MAX;
                                      return (
                                        <div
                                          key={cid}
                                          className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-900 last:border-b-0"
                                        >
                                          <div className="flex items-center gap-3 min-w-0">
                                            <Avatar className="h-8 w-8">
                                              <AvatarImage src={img} alt={name} />
                                              <AvatarFallback className="bg-gray-800 text-gray-200 text-xs">
                                                {name?.charAt(0) || 'C'}
                                              </AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0">
                                              <div className="text-sm text-gray-100 truncate" title={name}>{name}</div>
                                              <div className="text-xs text-gray-500 truncate">ID: {cid}</div>
                                            </div>
                                          </div>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                                            disabled={disabled}
                                            onClick={() => {
                                              if (!cid) return;
                                              if (already) return;
                                              if (curatedPicks.length >= HOME_SLOTS_CURATED_CHARACTERS_MAX) {
                                                toast.error(`추천 캐릭터는 최대 ${HOME_SLOTS_CURATED_CHARACTERS_MAX}명까지 선택할 수 있습니다.`);
                                                return;
                                              }
                                              const next = [
                                                ...curatedPicks,
                                                { id: cid, name, avatar_url: img },
                                              ];
                                              updateSlot(s.id, { characterPicks: next });
                                            }}
                                          >
                                            {already ? '선택됨' : '추가'}
                                          </Button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label className="text-gray-300">구좌 제목(관리용)</Label>
                              <Input
                                value={s.title || ''}
                                onChange={(e) => updateSlot(s.id, { title: e.target.value })}
                                className="bg-gray-900 border-gray-700 text-white"
                                placeholder="예: 추천 캐릭터 섹션"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-gray-300">상시 노출</Label>
                              <Button
                                variant="outline"
                                className="w-full bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                onClick={() => updateSlot(s.id, { startAt: null, endAt: null })}
                                title="노출 시간을 비워 상시로 설정"
                              >
                                상시로 설정(시간 비우기)
                              </Button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label className="text-gray-300">노출 시작(연월일시)</Label>
                              <Input
                                type="datetime-local"
                                value={toDatetimeLocal(s.startAt)}
                                onChange={(e) => updateSlot(s.id, { startAt: fromDatetimeLocal(e.target.value) })}
                                className="bg-gray-900 border-gray-700 text-white"
                              />
                              <div className="text-xs text-gray-500">비워두면 “상시”로 처리됩니다.</div>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-gray-300">노출 종료(연월일시)</Label>
                              <Input
                                type="datetime-local"
                                value={toDatetimeLocal(s.endAt)}
                                onChange={(e) => updateSlot(s.id, { endAt: fromDatetimeLocal(e.target.value) })}
                                className="bg-gray-900 border-gray-700 text-white"
                              />
                              <div className="text-xs text-gray-500">비워두면 “상시”로 처리됩니다.</div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white">구좌 활성화</div>
                              <div className="text-xs text-gray-500">끄면 기간과 상관없이 숨김 처리됩니다.</div>
                            </div>
                            <Switch
                              checked={s.enabled !== false}
                              onCheckedChange={(v) => updateSlot(s.id, { enabled: !!v })}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          )}

          {isAiModelsTab && (
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">AI 모델 조작</CardTitle>
                <CardDescription className="text-gray-400">
                  추후 기획 후 구현됩니다. (지금은 탭 버튼만 제공)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-gray-400 text-sm">준비중입니다.</div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default CMSPage;






