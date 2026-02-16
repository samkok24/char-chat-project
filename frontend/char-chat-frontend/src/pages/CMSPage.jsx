import React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Save, Trash2, ArrowUp, ArrowDown, ExternalLink, Image as ImageIcon, Settings, X, UserPlus, Copy, GripVertical, ListOrdered, RefreshCw, Search } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

import AppLayout from '../components/layout/AppLayout';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI, storiesAPI, tagsAPI, usersAPI, metricsAPI, cmsAPI, filesAPI } from '../lib/api';
import { resolveImageUrl } from '../lib/images';
import {
  HOME_BANNERS_STORAGE_KEY,
  HOME_BANNERS_CHANGED_EVENT,
  DEFAULT_HOME_BANNERS,
  getHomeBanners,
  isDefaultHomeBannersConfig,
  setHomeBanners,
  sanitizeHomeBanner,
} from '../lib/cmsBanners';
import {
  HOME_SLOTS_STORAGE_KEY,
  HOME_SLOTS_CHANGED_EVENT,
  DEFAULT_HOME_SLOTS,
  getHomeSlots,
  isDefaultHomeSlotsConfig,
  setHomeSlots,
  sanitizeHomeSlot,
  isSystemHomeSlotId,
} from '../lib/cmsSlots';
import {
  HOME_POPUPS_STORAGE_KEY,
  HOME_POPUPS_CHANGED_EVENT,
  DEFAULT_HOME_POPUPS_CONFIG,
  getHomePopupsConfig,
  isDefaultHomePopupsConfig,
  setHomePopupsConfig,
  sanitizeHomePopupsConfig,
  sanitizeHomePopupItem,
} from '../lib/cmsPopups';
import {
  CHARACTER_TAG_DISPLAY_STORAGE_KEY,
  CHARACTER_TAG_DISPLAY_CHANGED_EVENT,
  DEFAULT_CHARACTER_TAG_DISPLAY,
  getCharacterTagDisplay,
  isDefaultCharacterTagDisplayConfig,
  sanitizeCharacterTagDisplay,
  setCharacterTagDisplay,
} from '../lib/cmsTagDisplay';

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

/**
 * ✅ 구버전 CMS(로컬스토리지) 호환: data: 이미지 URL을 서버 업로드 URL로 변환한다.
 *
 * 왜 필요한가?
 * - 과거에는 배너 이미지가 base64(data:)로 로컬스토리지에 저장되었고, 이 값은 매우 길다.
 * - 운영 SSOT(DB) 저장 시에는 payload 검증(백엔드 schema max_length)에 의해 422가 발생할 수 있다.
 * - 따라서 저장 직전에 data: 이미지를 /files/upload로 업로드해 URL(/static/...)로 치환한다.
 *
 * 방어적:
 * - 파싱/디코딩 실패 시 null 반환(서버 저장을 막고 토스트로 안내)
 * - image/* 타입만 처리
 */
const isDataImageUrl = (raw) => {
  try {
    const s = String(raw || '').trim();
    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(s);
  } catch (_) {
    return false;
  }
};

const dataImageUrlToFile = (dataUrl, filenameBase) => {
  try {
    const raw = String(dataUrl || '').trim();
    if (!isDataImageUrl(raw)) return null;

    const commaIdx = raw.indexOf(',');
    if (commaIdx < 0) return null;

    const meta = raw.slice(0, commaIdx);
    const b64 = raw.slice(commaIdx + 1);
    const mimeMatch = meta.match(/^data:([^;]+);base64$/i);
    const mime = (mimeMatch?.[1] || '').trim().toLowerCase();
    if (!mime || !mime.startsWith('image/')) return null;

    let ext = mime.split('/')[1] || 'png';
    if (ext === 'jpeg') ext = 'jpg';
    // svg+xml 같은 케이스 방어
    ext = ext.replace(/[^a-z0-9]+/gi, '');
    if (!ext) ext = 'png';

    // base64 → Uint8Array
    const bin = atob(String(b64 || '').trim());
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);

    const name = `${String(filenameBase || 'banner').trim() || 'banner'}.${ext}`;
    return new File([bytes], name, { type: mime });
  } catch (e) {
    try { console.warn('[CMSPage] dataImageUrlToFile failed:', e); } catch (_) {}
    return null;
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

  const [activeTab, setActiveTab] = React.useState('banners'); // users | userLogs | banners | popups | slots | tags | aiModels
  const [banners, setBannersState] = React.useState(() => getHomeBanners());
  const [popupsConfig, setPopupsConfigState] = React.useState(() => getHomePopupsConfig());
  const [slots, setSlotsState] = React.useState(() => getHomeSlots());
  // ✅ 구좌 목록 보기 탭(요구사항): 활성/비활성 분리하여 복잡도 감소
  const [slotListTab, setSlotListTab] = React.useState('enabled'); // enabled | disabled
  const [tagDisplay, setTagDisplayState] = React.useState(() => getCharacterTagDisplay());
  const [saving, setSaving] = React.useState(false);

  // ===== 태그 관리 탭(관리자) =====
  const [tagListQuery, setTagListQuery] = React.useState('');
  const [newTagName, setNewTagName] = React.useState('');
  const [newTagSlug, setNewTagSlug] = React.useState('');
  const [creatingTag, setCreatingTag] = React.useState(false);
  const [deletingTagId, setDeletingTagId] = React.useState(null);
  // ✅ 태그 순서 편집 모달(ISBN 입력 느낌)
  const [tagOrderModalOpen, setTagOrderModalOpen] = React.useState(false);
  const [tagOrderMode, setTagOrderMode] = React.useState('text'); // text | drag
  const [tagOrderText, setTagOrderText] = React.useState('');
  const [tagOrderErrors, setTagOrderErrors] = React.useState([]); // [{ line, value, message }]
  const tagOrderDragFromRef = React.useRef(null);

  // ===== 회원관리 탭 (관리자) =====
  const USERS_PAGE_SIZE = 100;
  const [usersPage, setUsersPage] = React.useState(1);
  const [usersLoading, setUsersLoading] = React.useState(false);
  const [usersTotal, setUsersTotal] = React.useState(0);
  const [usersItems, setUsersItems] = React.useState([]);
  const [usersReloadKey, setUsersReloadKey] = React.useState(0);
  const [trafficLoading, setTrafficLoading] = React.useState(false);
  const [trafficSummary, setTrafficSummary] = React.useState(null);
  const [onlineLoading, setOnlineLoading] = React.useState(false);
  const [onlineSummary, setOnlineSummary] = React.useState(null);
  const [onlineReloadKey, setOnlineReloadKey] = React.useState(0);

  // ===== 유저 로그(이탈 페이지) =====
  const [pageExitDay, setPageExitDay] = React.useState(''); // YYYYMMDD(KST), empty=server default(today)
  const [pageExitLoading, setPageExitLoading] = React.useState(false);
  const [pageExitSummary, setPageExitSummary] = React.useState(null);
  const [pageExitReloadKey, setPageExitReloadKey] = React.useState(0);
  const [pageExitQuery, setPageExitQuery] = React.useState('');

  // ===== 유저 로그 서브탭 + 유저 활동 =====
  const [userLogSubTab, setUserLogSubTab] = React.useState('traffic'); // 'traffic' | 'activity' | 'ab'
  const [activityQuery, setActivityQuery] = React.useState('');
  const [activityStartDate, setActivityStartDate] = React.useState('');
  const [activityEndDate, setActivityEndDate] = React.useState('');
  const [activityPageGroup, setActivityPageGroup] = React.useState('');
  const [activityPage, setActivityPage] = React.useState(1);
  const [activityLoading, setActivityLoading] = React.useState(false);
  const [activityData, setActivityData] = React.useState(null);
  const [activityReloadKey, setActivityReloadKey] = React.useState(0);

  // ===== AB 테스트 서브탭 =====
  const [abTestName, setAbTestName] = React.useState('ab_home');
  const [abDay, setAbDay] = React.useState('');
  const [abLoading, setAbLoading] = React.useState(false);
  const [abData, setAbData] = React.useState(null);
  const [abReloadKey, setAbReloadKey] = React.useState(0);

  // ===== 테스트 계정 생성(관리자) =====
  const [testUserOpen, setTestUserOpen] = React.useState(false);
  const [testUserGender, setTestUserGender] = React.useState('male'); // male|female
  const [testUserCreating, setTestUserCreating] = React.useState(false);
  const [testUserResult, setTestUserResult] = React.useState(null); // { email, password, username, ... }

  /**
   * ✅ 테스트 계정 생성 (메일 인증 완료 상태)
   *
   * 의도:
   * - 운영/개발에서 새 계정 테스트를 빠르게 하기 위해, 관리자 페이지에서 1클릭 생성.
   * - 이메일 인증(is_verified)이 된 상태로 생성해서 바로 로그인 가능하게 한다.
   *
   * 방어적:
   * - 실패 시 상세 원인(HTTP/status/detail)을 토스트로 노출한다(에러를 씹지 않기).
   */
  const createTestUser = React.useCallback(async () => {
    if (testUserCreating) return;
    setTestUserCreating(true);
    try {
      const payload = { gender: (testUserGender === 'female' ? 'female' : 'male') };
      const res = await usersAPI.adminCreateTestUser(payload);
      const data = res?.data || null;
      if (!data || !data.email || !data.password) {
        throw new Error('응답이 올바르지 않습니다.');
      }
      setTestUserResult(data);
      toast.success('테스트 계정이 생성되었습니다.');
      // 목록 갱신
      try { setUsersReloadKey((k) => (Number(k || 0) + 1)); } catch (_) {}
    } catch (e) {
      let detail = '';
      try {
        const status = e?.response?.status;
        const d = e?.response?.data?.detail;
        const msg = d || e?.message || '';
        if (status) detail = ` (HTTP ${status}${msg ? `: ${msg}` : ''})`;
        else if (msg) detail = ` (${msg})`;
      } catch (_) {}
      toast.error(`테스트 계정 생성에 실패했습니다.${detail}`);
    } finally {
      setTestUserCreating(false);
    }
  }, [testUserCreating, testUserGender]);

  /**
   * ✅ 운영 SSOT: 서버(DB)에서 CMS 설정을 로드한다.
   *
   * 의도:
   * - 기존 로컬스토리지 기반 CMS는 "해당 브라우저/기기"에만 반영되는 구조였다.
   * - 운영에서는 유저 전원에게 동일 배너/구좌가 반영되어야 하므로, 서버에서 불러와 편집 UI에 반영한다.
   *
   * 방어적:
   * - 서버 로드 실패 시 기존 로컬 값(getHomeBanners/getHomeSlots)로 유지한다.
   * - 서버에서 내려온 값도 로컬스토리지에 캐시해, 기존 이벤트/미리보기 흐름을 깨지 않게 한다.
   */
  React.useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    const loadFromServer = async () => {
      try {
        const [bRes, pRes, sRes, tRes] = await Promise.all([
          cmsAPI.getHomeBanners().catch((e) => ({ __err: e })),
          cmsAPI.getHomePopups().catch((e) => ({ __err: e })),
          cmsAPI.getHomeSlots().catch((e) => ({ __err: e })),
          cmsAPI.getCharacterTagDisplay().catch((e) => ({ __err: e })),
        ]);
        if (!active) return;

        // 배너
        try {
          const serverBanners = Array.isArray(bRes?.data) ? bRes.data : null;
          if (serverBanners) {
            // ✅ 안전 전환: 기존 로컬스토리지 기반으로 편집해둔 값이 있다면, 서버가 "기본값(초기 상태)"일 때는 로컬을 우선 유지한다.
            // - 배포 직후(서버 SSOT 비어있음) 관리자 로컬 설정이 덮어써져 사라지는 사고를 방지한다.
            let skipApply = false;
            try {
              const hasLocal = !!localStorage.getItem(HOME_BANNERS_STORAGE_KEY);
              const looksDefault = isDefaultHomeBannersConfig(serverBanners);
              if (hasLocal && looksDefault) {
                // 로컬 우선(서버로 전파하려면 "저장" 버튼을 눌러 SSOT에 업로드하면 됨)
                skipApply = true;
              }
            } catch (_) {}
            if (!skipApply) {
              const saved = setHomeBanners(serverBanners);
              if (saved?.ok) setBannersState(saved.items);
              else setBannersState((serverBanners || []).map(sanitizeHomeBanner));
            }
          }
        } catch (e) {
          try { console.warn('[CMSPage] apply server banners failed:', e); } catch (_) {}
        }

        // 팝업
        try {
          const serverPopups = (pRes && pRes.data && typeof pRes.data === 'object') ? pRes.data : null;
          if (serverPopups) {
            // ✅ 안전 전환: 서버가 "기본값(비활성/빈 목록)"이고 로컬에 값이 있으면 로컬을 우선 유지한다.
            let skipApply = false;
            try {
              const hasLocal = !!localStorage.getItem(HOME_POPUPS_STORAGE_KEY);
              const looksDefault = isDefaultHomePopupsConfig(serverPopups);
              if (hasLocal && looksDefault) skipApply = true;
            } catch (_) {}
            if (!skipApply) {
              const saved = setHomePopupsConfig(serverPopups);
              if (saved?.ok) setPopupsConfigState(saved.config);
              else setPopupsConfigState(sanitizeHomePopupsConfig(serverPopups));
            }
          }
        } catch (e) {
          try { console.warn('[CMSPage] apply server popups failed:', e); } catch (_) {}
        }

        // 구좌
        try {
          const serverSlots = Array.isArray(sRes?.data) ? sRes.data : null;
          if (serverSlots) {
            // ✅ 안전 전환: 서버가 기본 구좌(초기값)로만 내려오고, 로컬에 편집값이 있으면 로컬을 우선 유지한다.
            let skipApply = false;
            try {
              const hasLocal = !!localStorage.getItem(HOME_SLOTS_STORAGE_KEY);
              const looksDefault = isDefaultHomeSlotsConfig(serverSlots);
              if (hasLocal && looksDefault) {
                skipApply = true;
              }
            } catch (_) {}
            if (!skipApply) {
              const saved = setHomeSlots(serverSlots);
              if (saved?.ok) setSlotsState(saved.items);
              else setSlotsState((serverSlots || []).map(sanitizeHomeSlot));
            }
          }
        } catch (e) {
          try { console.warn('[CMSPage] apply server slots failed:', e); } catch (_) {}
        }

        // 태그 노출/순서(CMS)
        try {
          const serverTagDisplay = (tRes && tRes.data && typeof tRes.data === 'object') ? tRes.data : null;
          if (serverTagDisplay) {
            // ✅ 안전 전환: 서버가 "미설정 기본값"이고 로컬에 값이 있으면, 관리자 로컬을 우선 유지한다.
            let skipApply = false;
            try {
              const hasLocal = !!localStorage.getItem(CHARACTER_TAG_DISPLAY_STORAGE_KEY);
              const looksDefault = isDefaultCharacterTagDisplayConfig(serverTagDisplay);
              if (hasLocal && looksDefault) skipApply = true;
            } catch (_) {}
            if (!skipApply) {
              const saved = setCharacterTagDisplay(serverTagDisplay);
              if (saved?.ok) setTagDisplayState(saved.item);
              else setTagDisplayState(sanitizeCharacterTagDisplay(serverTagDisplay));
            }
          }
        } catch (e) {
          try { console.warn('[CMSPage] apply server tag display failed:', e); } catch (_) {}
        }
      } catch (e) {
        // 전체 실패는 로컬 폴백으로 유지 (운영 안정)
        try { console.warn('[CMSPage] loadFromServer failed(keep local):', e); } catch (_) {}
      }
    };
    loadFromServer();
    return () => { active = false; };
  }, [isAdmin]);

  // ===== CMS 커스텀 구좌: 콘텐츠(캐릭터/웹소설) 선택 모달 상태 =====
  // 요구사항(대표님):
  // - 구좌 추가 → 새 구좌 박스에서 콘텐츠(캐릭터/원작챗/웹소설)를 다중 선택
  // - 정렬 방식: 대화수(조회수) 순 | 랜덤(새로고침마다)
  // - 태그 선택 + 검색어 검색 + 타입 필터(전체/캐릭터/원작챗/웹소설)
  const [allTags, setAllTags] = React.useState([]); // [{ id?, slug, name }]
  const [tagsLoading, setTagsLoading] = React.useState(false);

  const [contentPickerOpen, setContentPickerOpen] = React.useState(false);
  const [contentPickerSlotId, setContentPickerSlotId] = React.useState(null);
  const [contentPickerType, setContentPickerType] = React.useState('all'); // all|character|origchat|webnovel
  const [contentPickerQuery, setContentPickerQuery] = React.useState('');
  const [contentPickerTagQuery, setContentPickerTagQuery] = React.useState('');
  const [contentPickerTags, setContentPickerTags] = React.useState([]); // [slug]
  const [contentPickerSortMode, setContentPickerSortMode] = React.useState('metric'); // metric|random
  const [contentSearching, setContentSearching] = React.useState(false);
  const [contentResults, setContentResults] = React.useState([]); // [{ key, type, item }]
  const [contentSelectedKeys, setContentSelectedKeys] = React.useState([]); // selection order
  const [contentSelectedByKey, setContentSelectedByKey] = React.useState({}); // key -> { type, item }

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

  // 태그 관리 탭: 탭/창 동기화(방어적)
  React.useEffect(() => {
    const refreshTagDisplay = () => {
      try { setTagDisplayState(getCharacterTagDisplay()); } catch (_) {}
    };
    const onCustom = () => refreshTagDisplay();
    const onStorage = (e) => {
      try {
        if (!e) return;
        if (e.key === CHARACTER_TAG_DISPLAY_STORAGE_KEY) refreshTagDisplay();
      } catch (_) {}
    };
    try { window.addEventListener(CHARACTER_TAG_DISPLAY_CHANGED_EVENT, onCustom); } catch (_) {}
    try { window.addEventListener('storage', onStorage); } catch (_) {}
    return () => {
      try { window.removeEventListener(CHARACTER_TAG_DISPLAY_CHANGED_EVENT, onCustom); } catch (_) {}
      try { window.removeEventListener('storage', onStorage); } catch (_) {}
    };
  }, []);

  /**
   * 태그 목록 조회(공통).
   * - 콘텐츠 선택 모달 / 태그 관리 탭에서 공용으로 사용한다(SSOT/DRY).
   */
  const fetchTagsForCMS = React.useCallback(async () => {
    const res = await tagsAPI.getTags();
    const raw = res?.data;
    const arr = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.tags)
        ? raw.tags
        : Array.isArray(raw?.items)
          ? raw.items
          : [];

    return (arr || [])
      .map((t) => ({
        id: t?.id,
        slug: String(t?.slug || t?.name || '').trim(),
        name: String(t?.name || t?.slug || '').trim(),
      }))
      .filter((t) => !!t.slug);
  }, []);

  // 태그 목록 로드(콘텐츠 선택 모달용) - 베스트 에포트
  React.useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    const load = async () => {
      setTagsLoading(true);
      try {
        const normalized = await fetchTagsForCMS();
        if (!active) return;
        setAllTags(normalized || []);
      } catch (e) {
        try { console.error('[CMSPage] tagsAPI.getTags failed:', e); } catch (_) {}
        if (active) setAllTags([]);
      } finally {
        if (active) setTagsLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [isAdmin, fetchTagsForCMS]);

  // 회원 목록 로드(관리자) - activeTab/usersPage 변화에 따라
  React.useEffect(() => {
    if (!isAdmin) return;
    if (activeTab !== 'users') return;

    let active = true;
    const loadUsers = async () => {
      setUsersLoading(true);
      try {
        const page = Math.max(1, Number(usersPage || 1));
        const skip = (page - 1) * USERS_PAGE_SIZE;
        const res = await usersAPI.adminListUsers({ skip, limit: USERS_PAGE_SIZE });
        const data = res?.data || {};
        const total = Number(data?.total || 0) || 0;
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!active) return;
        setUsersTotal(total);
        setUsersItems(items);
      } catch (e) {
        try { console.error('[CMSPage] adminListUsers failed:', e); } catch (_) {}
        if (active) {
          setUsersTotal(0);
          setUsersItems([]);
        }
        toast.error('회원 목록을 불러오지 못했습니다.');
      } finally {
        if (active) setUsersLoading(false);
      }
    };

    loadUsers();
    return () => { active = false; };
  }, [isAdmin, activeTab, usersPage, usersReloadKey]);

  // 트래픽 요약(최소 구현: 채팅 기반 DAU/WAU/MAU)
  React.useEffect(() => {
    if (!isAdmin) return;
    if (activeTab !== 'users') return;

    let active = true;
    const loadTraffic = async () => {
      setTrafficLoading(true);
      try {
        const res = await metricsAPI.getTraffic();
        if (!active) return;
        setTrafficSummary(res?.data || null);
      } catch (e) {
        try { console.error('[CMSPage] metricsAPI.getTraffic failed:', e); } catch (_) {}
        if (active) setTrafficSummary(null);
      } finally {
        if (active) setTrafficLoading(false);
      }
    };

    loadTraffic();
    return () => { active = false; };
  }, [isAdmin, activeTab, usersReloadKey]);

  // 실시간 온라인(접속) - Redis 하트비트 기반
  React.useEffect(() => {
    if (!isAdmin) return;
    if (activeTab !== 'users') return;

    let active = true;
    let timer = null;

    const loadOnline = async () => {
      setOnlineLoading(true);
      try {
        const res = await metricsAPI.getOnlineNow({ window_sec: 60 });
        if (!active) return;
        setOnlineSummary(res?.data || null);
      } catch (e) {
        try { console.error('[CMSPage] metricsAPI.getOnlineNow failed:', e); } catch (_) {}
        if (active) setOnlineSummary(null);
      } finally {
        if (active) setOnlineLoading(false);
      }
    };

    loadOnline();
    // 관리자 화면에서만 가볍게 폴링(10초)
    try { timer = setInterval(() => { try { loadOnline(); } catch (_) {} }, 10 * 1000); } catch (_) {}

    return () => {
      active = false;
      try { if (timer) clearInterval(timer); } catch (_) {}
    };
  }, [isAdmin, activeTab, usersReloadKey, onlineReloadKey]);

  // 유저 로그(이탈 페이지): /metrics/traffic/page-exits
  React.useEffect(() => {
    if (!isAdmin) return;
    if (activeTab !== 'userLogs') return;

    let active = true;
    const load = async () => {
      setPageExitLoading(true);
      try {
        const params = {};
        const d = String(pageExitDay || '').trim();
        if (d) params.day = d;
        params.top_n = 200;
        const res = await metricsAPI.getPageExitSummary(params);
        if (!active) return;
        setPageExitSummary(res?.data || null);
      } catch (e) {
        try { console.error('[CMSPage] metricsAPI.getPageExitSummary failed:', e); } catch (_) {}
        if (active) setPageExitSummary(null);
      } finally {
        if (active) setPageExitLoading(false);
      }
    };

    load();
    return () => { active = false; };
  }, [isAdmin, activeTab, pageExitDay, pageExitReloadKey]);

  // 유저 활동 로그: /metrics/user-activity/search
  React.useEffect(() => {
    if (!isAdmin) return;
    if (activeTab !== 'userLogs' || userLogSubTab !== 'activity') return;

    let active = true;
    const load = async () => {
      setActivityLoading(true);
      try {
        const params = { page: activityPage, page_size: 50 };
        const q = String(activityQuery || '').trim();
        if (q) params.query = q;
        const sd = String(activityStartDate || '').trim();
        if (sd) params.start_date = sd;
        const ed = String(activityEndDate || '').trim();
        if (ed) params.end_date = ed;
        const pg = String(activityPageGroup || '').trim();
        if (pg) params.page_group = pg;
        const res = await metricsAPI.searchUserActivity(params);
        if (!active) return;
        setActivityData(res?.data || null);
      } catch (e) {
        try { console.error('[CMSPage] searchUserActivity failed:', e); } catch (_) {}
        if (active) setActivityData(null);
      } finally {
        if (active) setActivityLoading(false);
      }
    };

    load();
    return () => { active = false; };
  }, [isAdmin, activeTab, userLogSubTab, activityQuery, activityStartDate, activityEndDate, activityPageGroup, activityPage, activityReloadKey]);

  // AB 테스트 데이터 로드
  React.useEffect(() => {
    if (!isAdmin || activeTab !== 'userLogs' || userLogSubTab !== 'ab') return;
    let active = true;
    const load = async () => {
      setAbLoading(true);
      try {
        const params = { test: abTestName };
        const d = String(abDay || '').trim();
        if (d) params.day = d;
        const res = await metricsAPI.getAbSummary(params);
        if (active) setAbData(res?.data || null);
      } catch (e) {
        try { console.error('[CMSPage] AB summary failed:', e); } catch (_) {}
        if (active) setAbData(null);
      } finally {
        if (active) setAbLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [isAdmin, activeTab, userLogSubTab, abTestName, abDay, abReloadKey]);

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
      // ✅ 운영 안정: base64(dataUrl)를 CMS 설정에 저장하면 요청 바디가 커져(413/Timeout) 배포 환경에서 실패하기 쉽다.
      // - 따라서 파일은 서버(/files/upload)로 업로드하고, URL(/static/...)만 CMS 설정에 저장한다.
      let url = '';
      try {
        const res = await filesAPI.uploadImages([file]);
        const arr = res?.data;
        url = Array.isArray(arr) ? String(arr[0] || '').trim() : '';
      } catch (e) {
        console.error('[CMSPage] image upload failed:', e);
        toast.error('이미지 업로드에 실패했습니다.');
        return;
      }
      if (!url) {
        toast.error('이미지 업로드 결과가 비어있습니다.');
        return;
      }
      updateBanner(id, { imageUrl: url });
      toast.success('이미지가 업로드되었습니다. 저장 버튼을 눌러 전 유저에게 반영하세요.');
    } catch (e) {
      console.error('[CMSPage] image pick failed:', e);
      toast.error('이미지 적용에 실패했습니다.');
    }
  };

  /**
   * 모바일 배너 이미지 업로드(서버 업로드)
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
      let url = '';
      try {
        const res = await filesAPI.uploadImages([file]);
        const arr = res?.data;
        url = Array.isArray(arr) ? String(arr[0] || '').trim() : '';
      } catch (e) {
        console.error('[CMSPage] mobile image upload failed:', e);
        toast.error('모바일 이미지 업로드에 실패했습니다.');
        return;
      }
      if (!url) {
        toast.error('모바일 이미지 업로드 결과가 비어있습니다.');
        return;
      }
      updateBanner(id, { mobileImageUrl: url });
      toast.success('모바일 이미지가 업로드되었습니다. 저장 버튼을 눌러 전 유저에게 반영하세요.');
    } catch (e) {
      console.error('[CMSPage] mobile image pick failed:', e);
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

      /**
       * ✅ 운영 SSOT 저장
       *
       * 우선순위:
       * 1) 서버 저장(전 유저 반영)
       * 2) 로컬스토리지 캐시(기존 미리보기/이벤트 흐름 유지)
       *
       * 방어적:
       * - 서버 저장 실패 시에도 작업물을 잃지 않도록 로컬 저장은 시도한다.
       * - 단, 유저 전원 반영은 서버 저장이 성공해야 한다는 점을 토스트로 알린다.
       */
      let savedToServer = false;
      let serverItems = null;
      let serverSaveError = null;
      try {
        // ✅ 서버 저장 전에 data: 이미지 URL(구버전 로컬 저장)을 서버 업로드 URL로 변환한다.
        // - 변환 후에만 putHomeBanners를 호출해야 422(max_length)로 실패하지 않는다.
        let payload = (Array.isArray(banners) ? banners : []).map(sanitizeHomeBanner);
        let didMigrate = false;

        for (let i = 0; i < payload.length; i++) {
          const b = payload[i] || {};
          const id = String(b.id || '').trim() || `banner_${i}`;
          const title = String(b.title || '').trim() || '배너';
          let next = { ...b };

          // PC 이미지
          if (isDataImageUrl(next.imageUrl)) {
            didMigrate = true;
            const file = dataImageUrlToFile(next.imageUrl, `banner_${id}_pc`);
            if (!file) throw new Error(`"${title}" 배너의 PC 이미지 변환에 실패했습니다.`);
            const up = await filesAPI.uploadImages([file]);
            const url = Array.isArray(up?.data) ? String(up.data?.[0] || '').trim() : '';
            if (!url) throw new Error(`"${title}" 배너의 PC 이미지 업로드에 실패했습니다.`);
            next.imageUrl = url;
          }

          // 모바일 이미지(옵션)
          if (isDataImageUrl(next.mobileImageUrl)) {
            didMigrate = true;
            const file = dataImageUrlToFile(next.mobileImageUrl, `banner_${id}_mobile`);
            if (!file) throw new Error(`"${title}" 배너의 모바일 이미지 변환에 실패했습니다.`);
            const up = await filesAPI.uploadImages([file]);
            const url = Array.isArray(up?.data) ? String(up.data?.[0] || '').trim() : '';
            if (!url) throw new Error(`"${title}" 배너의 모바일 이미지 업로드에 실패했습니다.`);
            next.mobileImageUrl = url;
          }

          payload[i] = sanitizeHomeBanner(next);
        }

        // 변환이 있었다면 UI/로컬 상태도 URL 기반으로 맞춰준다(재저장/재시도 UX 안정화)
        if (didMigrate) {
          try { setBannersState(payload); } catch (_) {}
        }

        const resp = await cmsAPI.putHomeBanners(payload);
        serverItems = Array.isArray(resp?.data) ? resp.data : null;
        savedToServer = !!serverItems;
      } catch (e) {
        console.error('[CMSPage] putHomeBanners failed:', e);
        serverSaveError = e;
        savedToServer = false;
      }

      const toPersist = (Array.isArray(serverItems) && serverItems.length) ? serverItems : banners;
      const res = setHomeBanners(toPersist);
      if (!res.ok) {
        toast.error('저장에 실패했습니다. (로컬 저장소 용량 초과 가능)');
        return;
      }
      if (savedToServer) toast.success('저장 완료! (전 유저에게 반영됩니다)');
      else {
        // ✅ 에러를 씹지 말고, 가능한 범위에서 원인을 사용자에게 알려준다.
        let detail = '';
        try {
          const status = serverSaveError?.response?.status;
          const serverDetail = serverSaveError?.response?.data?.detail;
          const msg = serverDetail || serverSaveError?.message || '';
          if (status) detail = ` (HTTP ${status}${msg ? `: ${msg}` : ''})`;
          else if (msg) detail = ` (${msg})`;
        } catch (_) {}
        toast.error(`서버 저장에 실패했습니다. 현재는 로컬에만 저장되었습니다. (유저 전체 반영 안 됨)${detail}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = () => {
    if (!window.confirm('기본값으로 초기화하시겠습니까? (현재 설정이 사라집니다)')) return;
    setBannersState(DEFAULT_HOME_BANNERS.map(sanitizeHomeBanner));
    toast.success('기본값으로 초기화되었습니다. 저장 버튼을 눌러 반영하세요.');
  };

  // ===== 홈 팝업 관리 =====
  const updatePopupsConfig = (patch) => {
    const safePatch = (patch && typeof patch === 'object') ? patch : {};
    setPopupsConfigState((prev) => sanitizeHomePopupsConfig({ ...(prev || {}), ...safePatch }));
  };

  const updatePopupItem = (id, patch) => {
    const pid = String(id || '').trim();
    if (!pid) return;
    const safePatch = (patch && typeof patch === 'object') ? patch : {};
    setPopupsConfigState((prev) => {
      const cfg = sanitizeHomePopupsConfig(prev);
      const nextItems = (cfg.items || []).map((p) => {
        if (String(p?.id || '').trim() !== pid) return p;
        const merged = sanitizeHomePopupItem({ ...(p || {}), ...safePatch, id: p?.id });
        // 입력 UX: message/title은 입력 중 trim을 유지하고 싶으면 여기서 raw 유지 가능(현재는 단순 적용)
        return merged;
      });
      return sanitizeHomePopupsConfig({ ...cfg, items: nextItems });
    });
  };

  const addPopup = () => {
    const labelIdx = (Array.isArray(popupsConfig?.items) ? popupsConfig.items.length : 0) + 1;
    setPopupsConfigState((prev) => {
      const cfg = sanitizeHomePopupsConfig(prev);
      const p = sanitizeHomePopupItem({
        enabled: false,
        title: `팝업 ${labelIdx}`,
        message: '',
        displayOn: 'all',
        dismissDays: 1,
      });
      return sanitizeHomePopupsConfig({ ...cfg, items: [...(cfg.items || []), p] });
    });
    toast.success('팝업이 추가되었습니다. 아래에서 내용을 수정한 뒤 저장하세요.');
  };

  const removePopup = (id) => {
    const pid = String(id || '').trim();
    if (!pid) return;
    if (!window.confirm('이 팝업을 삭제하시겠습니까?')) return;
    setPopupsConfigState((prev) => {
      const cfg = sanitizeHomePopupsConfig(prev);
      const nextItems = (cfg.items || []).filter((p) => String(p?.id || '').trim() !== pid);
      return sanitizeHomePopupsConfig({ ...cfg, items: nextItems });
    });
    toast.success('팝업이 삭제되었습니다. 저장 버튼을 눌러 전 유저에게 반영하세요.');
  };

  const movePopup = (id, dir) => {
    const pid = String(id || '').trim();
    if (!pid) return;
    setPopupsConfigState((prev) => {
      const cfg = sanitizeHomePopupsConfig(prev);
      const arr = Array.isArray(cfg.items) ? [...cfg.items] : [];
      const idx = arr.findIndex((p) => String(p?.id || '').trim() === pid);
      if (idx < 0) return cfg;
      const nextIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (nextIdx < 0 || nextIdx >= arr.length) return cfg;
      const tmp = arr[idx];
      arr[idx] = arr[nextIdx];
      arr[nextIdx] = tmp;
      return sanitizeHomePopupsConfig({ ...cfg, items: arr });
    });
  };

  const pickPopupImage = async (id, which = 'pc') => {
    const pid = String(id || '').trim();
    if (!pid) return;
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e?.target?.files?.[0];
        if (!file) return;
        // ✅ 운영 안정: base64(dataUrl)를 저장하지 않고, 서버(/files/upload) 업로드 URL만 저장한다.
        let url = '';
        try {
          const res = await filesAPI.uploadImages([file]);
          const arr = res?.data;
          url = Array.isArray(arr) ? String(arr[0] || '').trim() : '';
        } catch (err) {
          console.error('[CMSPage] popup image upload failed:', err);
          toast.error('이미지 업로드에 실패했습니다.');
          return;
        }
        if (!url) {
          toast.error('이미지 업로드 결과가 비어있습니다.');
          return;
        }
        updatePopupItem(pid, which === 'mobile' ? { mobileImageUrl: url } : { imageUrl: url });
        toast.success('이미지가 업로드되었습니다. 저장 버튼을 눌러 전 유저에게 반영하세요.');
      };
      input.click();
    } catch (e) {
      console.error('[CMSPage] popup image pick failed:', e);
      toast.error('이미지 적용에 실패했습니다.');
    }
  };

  const resetPopupsToDefault = () => {
    if (!window.confirm('기본값으로 초기화하시겠습니까? (현재 설정이 사라집니다)')) return;
    setPopupsConfigState(sanitizeHomePopupsConfig(DEFAULT_HOME_POPUPS_CONFIG));
    toast.success('기본값으로 초기화되었습니다. 저장 버튼을 눌러 반영하세요.');
  };

  const savePopupsAll = async () => {
    setSaving(true);
    try {
      const cfg = sanitizeHomePopupsConfig(popupsConfig);
      // 간단 검증: 기간 역전 방지
      for (const p of (cfg.items || [])) {
        const start = p.startAt ? new Date(p.startAt).getTime() : null;
        const end = p.endAt ? new Date(p.endAt).getTime() : null;
        if (start && end && Number.isFinite(start) && Number.isFinite(end) && start > end) {
          toast.error(`"${p.title || '팝업'}"의 노출 기간이 올바르지 않습니다. (시작 > 종료)`);
          setSaving(false);
          return;
        }
      }

      let savedToServer = false;
      let serverConfig = null;
      let serverSaveError = null;
      try {
        // ✅ 서버 저장 전에 data: 이미지 URL(구버전 로컬 저장)을 서버 업로드 URL로 변환한다.
        const payload = sanitizeHomePopupsConfig(cfg);
        let didMigrate = false;
        const nextItems = [...(payload.items || [])];
        for (let i = 0; i < nextItems.length; i++) {
          const p = nextItems[i] || {};
          const id = String(p.id || '').trim() || `popup_${i}`;
          const title = String(p.title || '').trim() || '팝업';
          const next = { ...p };

          if (isDataImageUrl(next.imageUrl)) {
            didMigrate = true;
            const file = dataImageUrlToFile(next.imageUrl, `popup_${id}_pc`);
            if (!file) throw new Error(`"${title}" 팝업의 PC 이미지 변환에 실패했습니다.`);
            const up = await filesAPI.uploadImages([file]);
            const url = Array.isArray(up?.data) ? String(up.data?.[0] || '').trim() : '';
            if (!url) throw new Error(`"${title}" 팝업의 PC 이미지 업로드에 실패했습니다.`);
            next.imageUrl = url;
          }
          if (isDataImageUrl(next.mobileImageUrl)) {
            didMigrate = true;
            const file = dataImageUrlToFile(next.mobileImageUrl, `popup_${id}_mobile`);
            if (!file) throw new Error(`"${title}" 팝업의 모바일 이미지 변환에 실패했습니다.`);
            const up = await filesAPI.uploadImages([file]);
            const url = Array.isArray(up?.data) ? String(up.data?.[0] || '').trim() : '';
            if (!url) throw new Error(`"${title}" 팝업의 모바일 이미지 업로드에 실패했습니다.`);
            next.mobileImageUrl = url;
          }

          nextItems[i] = sanitizeHomePopupItem(next);
        }

        const toSend = sanitizeHomePopupsConfig({ ...payload, items: nextItems });
        if (didMigrate) {
          try { setPopupsConfigState(toSend); } catch (_) {}
        }

        const resp = await cmsAPI.putHomePopups(toSend);
        serverConfig = (resp && resp.data && typeof resp.data === 'object') ? resp.data : null;
        savedToServer = !!serverConfig;
      } catch (e) {
        console.error('[CMSPage] putHomePopups failed:', e);
        serverSaveError = e;
        savedToServer = false;
      }

      const toPersist = serverConfig || cfg;
      const saved = setHomePopupsConfig(toPersist);
      if (saved?.ok) setPopupsConfigState(saved.config);

      if (savedToServer) toast.success('저장 완료! (전 유저에게 반영됩니다)');
      else {
        let detail = '';
        try {
          const status = serverSaveError?.response?.status;
          const serverDetail = serverSaveError?.response?.data?.detail;
          const msg = serverDetail || serverSaveError?.message || '';
          if (status) detail = ` (HTTP ${status}${msg ? `: ${msg}` : ''})`;
          else if (msg) detail = ` (${msg})`;
        } catch (_) {}
        toast.error(`서버 저장에 실패했습니다. 현재는 로컬에만 저장되었습니다. (유저 전체 반영 안 됨)${detail}`);
      }
    } finally {
      setSaving(false);
    }
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

  // ===== 커스텀 구좌: 콘텐츠 선택/정렬 =====
  const MAX_CUSTOM_PICKS = 40; // 로컬 저장소/UX 보호

  const _makePickKey = (type, id) => `${String(type || '').trim()}:${String(id || '').trim()}`;

  const _normalizeCharacterPickItem = (c) => {
    return {
      id: String(c?.id || '').trim(),
      name: String(c?.name || '').trim() || '캐릭터',
      description: String(c?.description || '').trim(),
      avatar_url: String(c?.avatar_url || c?.thumbnail_url || '').trim(),
      thumbnail_url: String(c?.thumbnail_url || '').trim(),
      origin_story_id: c?.origin_story_id ? String(c.origin_story_id) : null,
      is_origchat: !!c?.origin_story_id || !!c?.is_origchat,
      source_type: c?.source_type,
      chat_count: Number(c?.chat_count ?? c?.chatCount ?? 0) || 0,
      like_count: Number(c?.like_count ?? c?.likeCount ?? 0) || 0,
      creator_id: c?.creator_id || null,
      creator_username: String(c?.creator_username || '').trim(),
      creator_avatar_url: String(c?.creator_avatar_url || '').trim(),
    };
  };

  const _normalizeStoryPickItem = (s) => {
    return {
      id: String(s?.id || '').trim(),
      title: String(s?.title || '').trim() || '제목 없음',
      excerpt: String(s?.excerpt || '').trim(),
      cover_url: String(s?.cover_url || s?.coverUrl || '').trim(),
      is_webtoon: !!s?.is_webtoon,
      is_origchat: !!s?.is_origchat,
      view_count: Number(s?.view_count ?? s?.viewCount ?? 0) || 0,
      like_count: Number(s?.like_count ?? s?.likeCount ?? 0) || 0,
      tags: Array.isArray(s?.tags) ? s.tags.map((t) => String(t)).filter(Boolean) : [],
      creator_id: s?.creator_id || null,
      creator_username: String(s?.creator_username || '').trim(),
      creator_avatar_url: String(s?.creator_avatar_url || '').trim(),
    };
  };

  const openContentPickerForSlot = (slot) => {
    const sid = String(slot?.id || '').trim();
    if (!sid) return;

    // 기존 선택 복원
    const picks = Array.isArray(slot?.contentPicks) ? slot.contentPicks : [];
    const nextByKey = {};
    const nextKeys = [];
    for (const p of picks) {
      try {
        const t = String(p?.type || '').trim().toLowerCase();
        const type = (t === 'story' ? 'story' : (t === 'character' ? 'character' : ''));
        const pid = String(p?.item?.id || '').trim();
        if (!type || !pid) continue;
        const key = _makePickKey(type, pid);
        if (nextByKey[key]) continue;
        nextByKey[key] = { type, item: p?.item };
        nextKeys.push(key);
      } catch (_) {}
    }

    setContentPickerSlotId(sid);
    setContentSelectedByKey(nextByKey);
    setContentSelectedKeys(nextKeys);
    setContentPickerSortMode(String(slot?.contentSortMode || 'metric') === 'random' ? 'random' : 'metric');
    setContentPickerOpen(true);
  };

  const closeContentPicker = () => {
    setContentPickerOpen(false);
    setContentPickerSlotId(null);
    setContentResults([]);
    // 선택/태그/검색어는 "다음 구좌에서도 재사용"이 편할 수 있어 유지한다.
  };

  const runContentSearch = async () => {
    const q = String(contentPickerQuery || '').trim();
    // ✅ 방어/UX: 태그는 보통 '#태그'로 인지하는데, 서버 slug는 '#'가 없다.
    // - 사용자가 '#롤플'처럼 입력해도 정상 동작하도록, 검색 요청 직전에 '#'를 제거해 정규화한다.
    const tagsCsv = (contentPickerTags || [])
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .map((s) => (s.startsWith('#') ? s.replace(/^#+/, '').trim() : s))
      .filter(Boolean)
      .join(',');

    if (!q && !tagsCsv) {
      toast.error('검색어 또는 태그를 1개 이상 입력/선택해주세요.');
      return;
    }

    setContentSearching(true);
    try {
      const params = {
        search: q || undefined,
        tags: tagsCsv || undefined,
        limit: 40,
      };

      const mode = String(contentPickerType || 'all').trim().toLowerCase();
      const needChars = (mode === 'all' || mode === 'character' || mode === 'origchat');
      const needStories = (mode === 'all' || mode === 'webnovel');

      const [charsRes, storiesRes] = await Promise.all([
        needChars ? charactersAPI.getCharacters(params) : Promise.resolve(null),
        needStories ? storiesAPI.getStories(params) : Promise.resolve(null),
      ]);

      const merged = [];

      // characters
      try {
        const raw = charsRes?.data;
        const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.characters) ? raw.characters : []);
        const normalized = (arr || [])
          .map((c) => _normalizeCharacterPickItem(c))
          .filter((c) => !!c.id);

        const filtered = normalized.filter((c) => {
          if (mode === 'character') {
            // 일반 캐릭터: origin_story_id 없음 + IMPORTED 제외
            return !c.origin_story_id && String(c.source_type || '').toUpperCase() !== 'IMPORTED';
          }
          if (mode === 'origchat') {
            return !!c.origin_story_id;
          }
          return true;
        });

        for (const c of filtered) {
          merged.push({ key: _makePickKey('character', c.id), type: 'character', item: c });
        }
      } catch (e) {
        try { console.error('[CMSPage] character search normalize failed:', e); } catch (_) {}
      }

      // stories
      try {
        const raw = storiesRes?.data;
        const arr = Array.isArray(raw)
          ? raw
          : (Array.isArray(raw?.stories) ? raw.stories : (Array.isArray(raw?.items) ? raw.items : []));
        const normalized = (arr || [])
          .map((s) => _normalizeStoryPickItem(s))
          .filter((s) => !!s.id);

        for (const s of normalized) {
          merged.push({ key: _makePickKey('story', s.id), type: 'story', item: s });
        }
      } catch (e) {
        try { console.error('[CMSPage] story search normalize failed:', e); } catch (_) {}
      }

      setContentResults(merged);
      if (merged.length === 0) toast('검색 결과가 없습니다.');
    } catch (e) {
      try { console.error('[CMSPage] runContentSearch failed:', e); } catch (_) {}
      toast.error('검색에 실패했습니다.');
      setContentResults([]);
    } finally {
      setContentSearching(false);
    }
  };

  /**
   * 콘텐츠 선택 모달: 태그 추가/제거
   *
   * 의도:
   * - CMS에서 태그를 "선택"하여 검색 필터로 사용한다(콤마 구분 slug 전달).
   * - 저장은 로컬스토리지이므로, 지나치게 큰 태그 배열/중복을 방지한다.
   */
  const addContentPickerTag = (slugLike) => {
    // ✅ 방어/UX: '#태그' 입력을 허용(서버 slug는 '#' 없이 저장/검색됨)
    const slug = String(slugLike || '').trim().replace(/^#+/, '').trim();
    if (!slug) return;
    setContentPickerTags((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      if (arr.includes(slug)) return arr;
      return [...arr, slug].slice(0, 20);
    });
    setContentPickerTagQuery('');
  };

  const removeContentPickerTag = (slugLike) => {
    const slug = String(slugLike || '').trim();
    if (!slug) return;
    setContentPickerTags((prev) => (Array.isArray(prev) ? prev.filter((t) => String(t) !== slug) : []));
  };

  const clearContentPickerSelection = () => {
    setContentSelectedByKey({});
    setContentSelectedKeys([]);
  };

  const toggleContentPick = (result) => {
    const key = String(result?.key || '').trim();
    const type = String(result?.type || '').trim();
    const item = result?.item;
    if (!key || !type || !item) return;

    const exists = !!contentSelectedByKey[key];
    if (exists) {
      setContentSelectedByKey((prev) => {
        const next = { ...(prev || {}) };
        delete next[key];
        return next;
      });
      setContentSelectedKeys((prev) => (Array.isArray(prev) ? prev.filter((k) => String(k) !== key) : []));
      return;
    }

    // max guard
    try {
      const cur = Array.isArray(contentSelectedKeys) ? contentSelectedKeys.length : 0;
      if (cur >= MAX_CUSTOM_PICKS) {
        toast.error(`최대 ${MAX_CUSTOM_PICKS}개까지 선택할 수 있습니다.`);
        return;
      }
    } catch (_) {}

    setContentSelectedByKey((prev) => ({ ...(prev || {}), [key]: { type, item } }));
    setContentSelectedKeys((prev) => [...(Array.isArray(prev) ? prev : []), key]);
  };

  const applyContentPickerToSlot = () => {
    const sid = String(contentPickerSlotId || '').trim();
    if (!sid) {
      toast.error('구좌 정보를 찾을 수 없습니다.');
      return;
    }

    const keys = Array.isArray(contentSelectedKeys) ? contentSelectedKeys : [];
    const byKey = (contentSelectedByKey && typeof contentSelectedByKey === 'object') ? contentSelectedByKey : {};
    const picks = keys.map((k) => byKey[k]).filter(Boolean);

    updateSlot(sid, {
      slotType: 'custom',
      contentPicks: picks,
      contentSortMode: (contentPickerSortMode === 'random' ? 'random' : 'metric'),
    });

    toast.success('콘텐츠가 설정되었습니다. 저장 버튼을 눌러 반영하세요.');
    closeContentPicker();
  };

  /**
   * ✅ 구좌 순서 이동(활성/비활성 탭 호환)
   *
   * 문제/의도:
   * - 활성 탭에서 "위로"를 눌렀는데 중간에 비활성 구좌가 끼어있으면,
   *   실제로는 swap이 발생해도 UI(활성 리스트)에서는 순서가 안 바뀐 것처럼 보일 수 있다.
   * - 따라서 현재 탭(활성/비활성)과 동일한 상태의 구좌끼리만 서로 교환하도록 한다.
   */
  const moveSlot = (id, dir) => {
    const tab = String(slotListTab || 'enabled').trim().toLowerCase();
    const matchesTab = (s) => {
      if (tab === 'disabled') return s?.enabled === false;
      return s?.enabled !== false;
    };

    setSlotsState((prev) => {
      const arr = Array.isArray(prev) ? [...prev] : [];
      const idx = arr.findIndex((s) => String(s?.id || '') === String(id || ''));
      if (idx < 0) return arr;

      let targetIdx = -1;
      if (dir === 'up') {
        for (let i = idx - 1; i >= 0; i -= 1) {
          if (matchesTab(arr[i])) { targetIdx = i; break; }
        }
      } else {
        for (let i = idx + 1; i < arr.length; i += 1) {
          if (matchesTab(arr[i])) { targetIdx = i; break; }
        }
      }

      if (targetIdx < 0) return arr;
      const tmp = arr[idx];
      arr[idx] = arr[targetIdx];
      arr[targetIdx] = tmp;
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

      /**
       * ✅ 운영 SSOT 저장(홈 구좌)
       *
       * 우선순위:
       * 1) 서버 저장(전 유저 반영)
       * 2) 로컬 캐시(기존 HomePage 로직/이벤트 유지)
       */
      let savedToServer = false;
      let serverItems = null;
      try {
        const payload = (Array.isArray(slots) ? slots : []).map((x) => {
          // 입력 중 title 트레일링 스페이스를 유지해두었으므로, 저장 시점에는 sanitize(trim)를 적용한다.
          try { return sanitizeHomeSlot(x); } catch (_) { return x; }
        });
        const resp = await cmsAPI.putHomeSlots(payload);
        serverItems = Array.isArray(resp?.data) ? resp.data : null;
        savedToServer = !!serverItems;
      } catch (e) {
        console.error('[CMSPage] putHomeSlots failed:', e);
        savedToServer = false;
      }

      const toPersist = (Array.isArray(serverItems) && serverItems.length) ? serverItems : slots;
      const res = setHomeSlots(toPersist);
      if (!res.ok) {
        toast.error('저장에 실패했습니다. (로컬 저장소 용량 초과 가능)');
        return;
      }
      if (savedToServer) toast.success('저장 완료! (전 유저에게 반영됩니다)');
      else toast.error('서버 저장에 실패했습니다. 현재는 로컬에만 저장되었습니다. (유저 전체 반영 안 됨)');
    } finally {
      setSaving(false);
    }
  };

  const resetSlotsToDefault = () => {
    if (!window.confirm('기본값으로 초기화하시겠습니까? (현재 설정이 사라집니다)')) return;
    setSlotsState(DEFAULT_HOME_SLOTS.map(sanitizeHomeSlot));
    toast.success('기본값으로 초기화되었습니다. 저장 버튼을 눌러 반영하세요.');
  };

  // ===== 태그 관리(노출/순서 + CRUD) =====
  const _safeSlug = (v) => {
    try { return String(v || '').trim(); } catch (_) { return ''; }
  };
  const _splitLines = (text) => {
    try {
      return String(text || '')
        .split(/\r?\n/)
        .map((s) => String(s || '').trim())
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  };

  /**
   * 태그 이름 조회용 Map (slug -> name)
   * - 태그 순서 편집(오타 검증) / UI 표시에서 공통으로 사용한다.
   */
  const tagNameBySlug = React.useMemo(() => {
    const m = new Map();
    try {
      (Array.isArray(allTags) ? allTags : []).forEach((t) => {
        const slug = String(t?.slug || '').trim();
        if (!slug) return;
        const name = String(t?.name || t?.slug || '').trim();
        m.set(slug, name || slug);
      });
    } catch (_) {}
    return m;
  }, [allTags]);

  const addPrioritySlug = (slugLike) => {
    const slug = _safeSlug(slugLike);
    if (!slug) return;
    setTagDisplayState((prev) => {
      const cur = sanitizeCharacterTagDisplay(prev);
      const seed = (Array.isArray(cur.prioritySlugs) && cur.prioritySlugs.length)
        ? cur.prioritySlugs
        : (Array.isArray(DEFAULT_CHARACTER_TAG_DISPLAY?.prioritySlugs) ? DEFAULT_CHARACTER_TAG_DISPLAY.prioritySlugs : []);
      const nextPriority = [...(seed || []).filter((s) => _safeSlug(s) !== slug), slug];
      const nextHidden = (cur.hiddenSlugs || []).filter((s) => _safeSlug(s) !== slug);
      return sanitizeCharacterTagDisplay({ ...cur, prioritySlugs: nextPriority, hiddenSlugs: nextHidden });
    });
  };

  const removePrioritySlug = (slugLike) => {
    const slug = _safeSlug(slugLike);
    if (!slug) return;
    setTagDisplayState((prev) => {
      const cur = sanitizeCharacterTagDisplay(prev);
      const seed = (Array.isArray(cur.prioritySlugs) && cur.prioritySlugs.length)
        ? cur.prioritySlugs
        : (Array.isArray(DEFAULT_CHARACTER_TAG_DISPLAY?.prioritySlugs) ? DEFAULT_CHARACTER_TAG_DISPLAY.prioritySlugs : []);
      const nextPriority = (seed || []).filter((s) => _safeSlug(s) !== slug);
      return sanitizeCharacterTagDisplay({ ...cur, prioritySlugs: nextPriority });
    });
  };

  const movePrioritySlug = (slugLike, dir) => {
    const slug = _safeSlug(slugLike);
    if (!slug) return;
    setTagDisplayState((prev) => {
      const cur = sanitizeCharacterTagDisplay(prev);
      const seed = (Array.isArray(cur.prioritySlugs) && cur.prioritySlugs.length)
        ? cur.prioritySlugs
        : (Array.isArray(DEFAULT_CHARACTER_TAG_DISPLAY?.prioritySlugs) ? DEFAULT_CHARACTER_TAG_DISPLAY.prioritySlugs : []);
      const arr = Array.isArray(seed) ? [...seed] : [];
      const idx = arr.findIndex((s) => _safeSlug(s) === slug);
      if (idx < 0) return cur;
      const nextIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (nextIdx < 0 || nextIdx >= arr.length) return cur;
      const tmp = arr[idx];
      arr[idx] = arr[nextIdx];
      arr[nextIdx] = tmp;
      return sanitizeCharacterTagDisplay({ ...cur, prioritySlugs: arr });
    });
  };

  // 태그 순서 편집 모달(멀티라인 텍스트 + 드래그)에서 현재 노출 순서를 만든다.
  const buildEffectiveVisibleTagOrder = React.useCallback(() => {
    const cur = sanitizeCharacterTagDisplay(tagDisplay);
    const hiddenSet = new Set((cur.hiddenSlugs || []).map(_safeSlug).filter(Boolean));

    // 1) 우선순위(없으면 기본값)
    const seed = (Array.isArray(cur.prioritySlugs) && cur.prioritySlugs.length)
      ? cur.prioritySlugs
      : (Array.isArray(DEFAULT_CHARACTER_TAG_DISPLAY?.prioritySlugs) ? DEFAULT_CHARACTER_TAG_DISPLAY.prioritySlugs : []);

    const out = [];
    const seen = new Set();

    const push = (slugLike) => {
      const s = _safeSlug(slugLike);
      if (!s) return;
      if (s.startsWith('cover:')) return;
      if (hiddenSet.has(s)) return;
      if (!tagNameBySlug.has(s)) return; // 존재하는 태그만
      if (seen.has(s)) return;
      seen.add(s);
      out.push(s);
    };

    // 우선순위 먼저
    (seed || []).forEach(push);
    // 그 다음 전체 태그(기본은 가나다로 내려옴)
    (Array.isArray(allTags) ? allTags : []).forEach((t) => push(t?.slug));

    return out;
  }, [tagDisplay, allTags, tagNameBySlug]);

  const tagSlugByLower = React.useMemo(() => {
    const m = new Map();
    try {
      (Array.isArray(allTags) ? allTags : []).forEach((t) => {
        const slug = _safeSlug(t?.slug);
        if (!slug) return;
        if (slug.startsWith('cover:')) return;
        m.set(slug.toLowerCase(), slug);
      });
    } catch (_) {}
    return m;
  }, [allTags]);

  /**
   * 태그 순서 텍스트 입력 유효성 검증(오타 방지).
   *
   * 규칙:
   * - 한 줄 = 태그 slug
   * - 존재하지 않는 태그/중복/cover:* 는 오류
   * - 대소문자만 다른 경우(SF/sf)는 자동으로 서버 slug로 정규화
   */
  const validateTagOrderText = React.useCallback((text) => {
    const lines = String(text || '').split(/\r?\n/);
    const errors = [];
    const slugs = [];
    const seen = new Set();

    for (let i = 0; i < lines.length; i += 1) {
      const raw = String(lines[i] || '').trim();
      if (!raw) continue;
      if (raw.startsWith('cover:')) {
        errors.push({ line: i + 1, value: raw, message: 'cover: 태그는 사용할 수 없습니다.' });
        continue;
      }
      const canonical = tagSlugByLower.get(raw.toLowerCase()) || null;
      if (!canonical) {
        errors.push({ line: i + 1, value: raw, message: '존재하지 않는 태그입니다.' });
        continue;
      }
      if (seen.has(canonical)) {
        errors.push({ line: i + 1, value: raw, message: `중복 태그입니다. (${canonical})` });
        continue;
      }
      seen.add(canonical);
      slugs.push(canonical);
    }

    return { slugs, errors };
  }, [tagSlugByLower]);

  React.useEffect(() => {
    if (!tagOrderModalOpen) return;
    try {
      const v = validateTagOrderText(tagOrderText);
      setTagOrderErrors(v.errors || []);
    } catch (_) {
      setTagOrderErrors([]);
    }
  }, [tagOrderModalOpen, tagOrderText, validateTagOrderText]);

  const openTagOrderModal = () => {
    // 태그 목록이 없으면(로드 지연) 먼저 불러오게 유도
    if (!Array.isArray(allTags) || allTags.length === 0) {
      toast.error('태그 목록을 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    const initial = buildEffectiveVisibleTagOrder();
    setTagOrderMode('text');
    setTagOrderText(initial.join('\n'));
    setTagOrderModalOpen(true);
  };

  const applyTagOrderModal = () => {
    const { slugs, errors } = validateTagOrderText(tagOrderText);
    if ((errors || []).length > 0) {
      toast.error(`태그 순서에 오류가 있습니다. (${errors.length}개)`);
      return;
    }

    // 숨김과 충돌 방지: priority에 있으면 hidden에서 제거(기존 UX와 동일)
    const slugSet = new Set((slugs || []).map(_safeSlug).filter(Boolean));
    setTagDisplayState((prev) => {
      const cur = sanitizeCharacterTagDisplay(prev);
      const nextHidden = (cur.hiddenSlugs || []).filter((s) => !slugSet.has(_safeSlug(s)));
      return sanitizeCharacterTagDisplay({ ...cur, prioritySlugs: slugs, hiddenSlugs: nextHidden });
    });

    toast.success('순서가 적용되었습니다. 상단 “저장”을 누르면 전 유저에게 반영됩니다.');
    setTagOrderModalOpen(false);
  };

  const addHiddenSlug = (slugLike) => {
    const slug = _safeSlug(slugLike);
    if (!slug) return;
    setTagDisplayState((prev) => {
      const cur = sanitizeCharacterTagDisplay(prev);
      const nextHidden = [...(cur.hiddenSlugs || []).filter((s) => _safeSlug(s) !== slug), slug];
      const nextPriority = (cur.prioritySlugs || []).filter((s) => _safeSlug(s) !== slug);
      return sanitizeCharacterTagDisplay({ ...cur, hiddenSlugs: nextHidden, prioritySlugs: nextPriority });
    });
  };

  const removeHiddenSlug = (slugLike) => {
    const slug = _safeSlug(slugLike);
    if (!slug) return;
    setTagDisplayState((prev) => {
      const cur = sanitizeCharacterTagDisplay(prev);
      const nextHidden = (cur.hiddenSlugs || []).filter((s) => _safeSlug(s) !== slug);
      return sanitizeCharacterTagDisplay({ ...cur, hiddenSlugs: nextHidden });
    });
  };

  const resetTagDisplayToDefault = () => {
    if (!window.confirm('기본값으로 초기화하시겠습니까? (현재 설정이 사라집니다)')) return;
    setTagDisplayState(sanitizeCharacterTagDisplay(DEFAULT_CHARACTER_TAG_DISPLAY));
    toast.success('기본값으로 초기화되었습니다. 저장 버튼을 눌러 반영하세요.');
  };

  const saveTagDisplayAll = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = sanitizeCharacterTagDisplay(tagDisplay);
      const toSend = {
        prioritySlugs: Array.isArray(payload?.prioritySlugs) ? payload.prioritySlugs : [],
        hiddenSlugs: Array.isArray(payload?.hiddenSlugs) ? payload.hiddenSlugs : [],
      };

      let savedToServer = false;
      let serverItem = null;
      let serverSaveError = null;
      try {
        const resp = await cmsAPI.putCharacterTagDisplay(toSend);
        serverItem = (resp && resp.data && typeof resp.data === 'object') ? resp.data : null;
        savedToServer = !!serverItem;
      } catch (e) {
        console.error('[CMSPage] putCharacterTagDisplay failed:', e);
        serverSaveError = e;
        savedToServer = false;
      }

      // 서버 저장이 실패해도, 로컬 캐시는 시도(작업물 보호)
      const toPersist = serverItem || toSend;
      const saved = setCharacterTagDisplay(toPersist);
      if (saved?.ok) setTagDisplayState(saved.item);

      if (savedToServer) toast.success('저장 완료! (전 유저에게 반영됩니다)');
      else {
        let detail = '';
        try {
          const status = serverSaveError?.response?.status;
          const serverDetail = serverSaveError?.response?.data?.detail;
          const msg = serverDetail || serverSaveError?.message || '';
          if (status) detail = ` (HTTP ${status}${msg ? `: ${msg}` : ''})`;
          else if (msg) detail = ` (${msg})`;
        } catch (_) {}
        toast.error(`서버 저장에 실패했습니다. 현재는 로컬에만 저장되었습니다. (유저 전체 반영 안 됨)${detail}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTag = async () => {
    if (creatingTag) return;
    const name = String(newTagName || '').trim();
    const slug = String(newTagSlug || '').trim() || name;
    if (!name) {
      toast.error('태그명을 입력하세요.');
      return;
    }
    if (!slug) {
      toast.error('태그 슬러그를 입력하세요.');
      return;
    }
    if (slug.startsWith('cover:')) {
      toast.error('cover: 로 시작하는 태그는 사용할 수 없습니다.');
      return;
    }

    setCreatingTag(true);
    try {
      await tagsAPI.createTag({ name, slug });
      toast.success('태그가 추가되었습니다.');
      setNewTagName('');
      setNewTagSlug('');
      try {
        const normalized = await fetchTagsForCMS();
        setAllTags(normalized || []);
      } catch (e) {
        try { console.error('[CMSPage] reload tags after create failed:', e); } catch (_) {}
      }
    } catch (e) {
      let detail = '';
      try {
        const status = e?.response?.status;
        const serverDetail = e?.response?.data?.detail;
        const msg = serverDetail || e?.message || '';
        if (status) detail = ` (HTTP ${status}${msg ? `: ${msg}` : ''})`;
        else if (msg) detail = ` (${msg})`;
      } catch (_) {}
      toast.error(`태그 추가에 실패했습니다.${detail}`);
    } finally {
      setCreatingTag(false);
    }
  };

  const handleDeleteTag = async (t) => {
    const id = t?.id;
    const slug = String(t?.slug || '').trim();
    const name = String(t?.name || '').trim() || slug;
    if (!id) {
      toast.error('태그 ID가 없어 삭제할 수 없습니다.');
      return;
    }
    if (!window.confirm(`"${name}" 태그를 삭제하시겠습니까?\n\n주의: 사용 중인 태그/기본 태그는 삭제할 수 없습니다.`)) return;
    if (deletingTagId) return;

    setDeletingTagId(String(id));
    try {
      await tagsAPI.deleteTag(id);
      toast.success('태그가 삭제되었습니다.');

      // 표시 설정에서도 제거(참조 정리)
      try {
        if (slug) {
          setTagDisplayState((prev) => {
            const cur = sanitizeCharacterTagDisplay(prev);
            return sanitizeCharacterTagDisplay({
              ...cur,
              prioritySlugs: (cur.prioritySlugs || []).filter((s) => _safeSlug(s) !== slug),
              hiddenSlugs: (cur.hiddenSlugs || []).filter((s) => _safeSlug(s) !== slug),
            });
          });
        }
      } catch (_) {}

      // 목록 갱신
      try {
        const normalized = await fetchTagsForCMS();
        setAllTags(normalized || []);
      } catch (e) {
        try { console.error('[CMSPage] reload tags after delete failed:', e); } catch (_) {}
      }
    } catch (e) {
      let detail = '';
      try {
        const status = e?.response?.status;
        const serverDetail = e?.response?.data?.detail;
        const msg = serverDetail || e?.message || '';
        if (status) detail = ` (HTTP ${status}${msg ? `: ${msg}` : ''})`;
        else if (msg) detail = ` (${msg})`;
      } catch (_) {}
      toast.error(`태그 삭제에 실패했습니다.${detail}`);
    } finally {
      setDeletingTagId(null);
    }
  };

  const refreshUsers = React.useCallback(() => {
    // activeTab/usersPage useEffect가 실제 로드를 수행한다.
    setUsersReloadKey((k) => (Number(k || 0) + 1));
  }, []);

  const isBannersTab = activeTab === 'banners';
  const isPopupsTab = activeTab === 'popups';
  const isSlotsTab = activeTab === 'slots';
  const isTagsTab = activeTab === 'tags';
  const isAiModelsTab = activeTab === 'aiModels';
  const isUsersTab = activeTab === 'users';
  const isUserLogsTab = activeTab === 'userLogs';

  const enabledSlotsCount = React.useMemo(() => {
    try {
      const arr = Array.isArray(slots) ? slots : [];
      return arr.filter((s) => s?.enabled !== false).length;
    } catch (_) {
      return 0;
    }
  }, [slots]);

  const disabledSlotsCount = React.useMemo(() => {
    try {
      const arr = Array.isArray(slots) ? slots : [];
      return arr.filter((s) => s?.enabled === false).length;
    } catch (_) {
      return 0;
    }
  }, [slots]);

  const visibleSlotsForTab = React.useMemo(() => {
    const arr = Array.isArray(slots) ? slots : [];
    const tab = String(slotListTab || 'enabled').trim().toLowerCase();
    if (tab === 'disabled') return arr.filter((s) => s?.enabled === false);
    return arr.filter((s) => s?.enabled !== false);
  }, [slots, slotListTab]);

  const filteredTagsForManage = React.useMemo(() => {
    const q = String(tagListQuery || '').trim().toLowerCase();
    const arr = Array.isArray(allTags) ? allTags : [];
    if (!q) return arr;
    return arr.filter((t) => {
      const slug = String(t?.slug || '').toLowerCase();
      const name = String(t?.name || '').toLowerCase();
      return slug.includes(q) || name.includes(q);
    });
  }, [allTags, tagListQuery]);

  const filteredExitRows = React.useMemo(() => {
    const rows = Array.isArray(pageExitSummary?.rows) ? pageExitSummary.rows : [];
    const q = String(pageExitQuery || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const p = String(r?.path || '').toLowerCase();
      const g = String(r?.group_label || r?.group || '').toLowerCase();
      return p.includes(q) || g.includes(q);
    });
  }, [pageExitSummary, pageExitQuery]);

  // 차트 데이터: 파이차트(그룹별 이동+이탈 비중)
  const pieData = React.useMemo(() => {
    const groups = Array.isArray(pageExitSummary?.groups) ? pageExitSummary.groups : [];
    return groups
      .filter((g) => Number(g?.departures || 0) > 0)
      .map((g) => ({
        name: String(g?.group_label || g?.group || '기타'),
        value: Number(g?.departures || 0),
        uv: Number(g?.unique_visitors || 0),
      }));
  }, [pageExitSummary]);

  // 차트 데이터: 바차트(상위 10 경로 — 이탈수 + 조회수)
  const barData = React.useMemo(() => {
    const rows = Array.isArray(pageExitSummary?.rows) ? pageExitSummary.rows : [];
    return rows.slice(0, 10).map((r) => ({
      path: String(r?.path || '').length > 30 ? String(r?.path || '').slice(0, 27) + '...' : String(r?.path || ''),
      fullPath: String(r?.path || ''),
      departures: Number(r?.departures || 0),
      views: Number(r?.views || 0),
    }));
  }, [pageExitSummary]);

  const effectivePrioritySlugsForDisplay = React.useMemo(() => {
    try {
      const cur = sanitizeCharacterTagDisplay(tagDisplay);
      const hiddenSet = new Set((cur.hiddenSlugs || []).map((s) => _safeSlug(s)).filter(Boolean));
      const seed = (Array.isArray(cur.prioritySlugs) && cur.prioritySlugs.length)
        ? cur.prioritySlugs
        : (Array.isArray(DEFAULT_CHARACTER_TAG_DISPLAY?.prioritySlugs) ? DEFAULT_CHARACTER_TAG_DISPLAY.prioritySlugs : []);
      const out = [];
      const seen = new Set();
      for (const it of (seed || [])) {
        const slug = _safeSlug(it);
        if (!slug) continue;
        if (slug.startsWith('cover:')) continue;
        if (hiddenSet.has(slug)) continue;
        if (!tagNameBySlug.has(slug)) continue;
        if (seen.has(slug)) continue;
        seen.add(slug);
        out.push(slug);
      }
      return out;
    } catch (_) {
      return [];
    }
  }, [tagDisplay, tagNameBySlug]);

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
                    {isUsersTab ? '회원 관리' : isUserLogsTab ? '유저 로그(이탈)' : isBannersTab ? '배너 조작' : isPopupsTab ? '팝업 설정' : isSlotsTab ? '구좌 조작' : isTagsTab ? '태그 관리' : 'AI모델 조작(준비중)'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(isAiModelsTab || isUsersTab || isUserLogsTab) ? (
                  <>
                    {isUsersTab && (
                      <Button
                      variant="outline"
                      className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                      onClick={() => setTestUserOpen(true)}
                      title="테스트 계정 생성(메일 인증 완료)"
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      테스트 계정 생성
                    </Button>
                  )}
                  <Button
                    variant="outline"
                      className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                      onClick={() => {
                        if (isUsersTab) refreshUsers();
                        if (isUserLogsTab) setPageExitReloadKey((k) => (Number(k || 0) + 1));
                      }}
                      disabled={isAiModelsTab}
                      title={isAiModelsTab ? '준비중' : '새로고침'}
                    >
                    {isAiModelsTab ? '준비중' : '새로고침'}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                    onClick={isBannersTab ? resetToDefault : isPopupsTab ? resetPopupsToDefault : isSlotsTab ? resetSlotsToDefault : resetTagDisplayToDefault}
                  >
                    초기화
                  </Button>
                  <Button
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={isBannersTab ? saveAll : isPopupsTab ? savePopupsAll : isSlotsTab ? saveSlotsAll : saveTagDisplayAll}
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
                className={`h-9 px-3 ${isUsersTab ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-700' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
                onClick={() => { setActiveTab('users'); setUsersPage(1); }}
                title="회원 관리"
              >
                회원 관리
              </Button>
              <Button
                variant="outline"
                className={`h-9 px-3 ${isUserLogsTab ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-700' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
                onClick={() => setActiveTab('userLogs')}
                title="유저 로그(이탈)"
              >
                유저 로그
              </Button>
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
              className={`h-9 px-3 ${isPopupsTab ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-700' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
              onClick={() => setActiveTab('popups')}
              title="팝업 설정"
            >
              팝업 설정
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
              className={`h-9 px-3 ${isTagsTab ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-700' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
              onClick={() => setActiveTab('tags')}
              title="태그 관리"
            >
              태그 관리
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

          {isUsersTab && (
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">회원 목록</CardTitle>
                <CardDescription className="text-gray-400">
                  100명 단위 페이지네이션. 관리자 계정은 ADMIN으로 표시됩니다. (최근 로그인 날짜는 현재 “최근 채팅 활동 시간”으로 대체됩니다.)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 트래픽 요약(채팅 기반) */}
                <div className="rounded-lg border border-gray-800 bg-gray-950/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">트래픽 요약(채팅 기준)</div>
                    <div className="text-xs text-gray-500">
                      {trafficLoading ? '불러오는 중...' : (trafficSummary?.day ? `KST ${trafficSummary.day}` : '')}
                    </div>
                  </div>
                  {trafficSummary ? (
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <div className="rounded-md border border-gray-800 bg-gray-900/30 p-3">
                        <div className="text-xs text-gray-500">DAU</div>
                        <div className="text-lg font-bold text-white">{Number(trafficSummary?.dau_chat || 0).toLocaleString()}</div>
                      </div>
                      <div className="rounded-md border border-gray-800 bg-gray-900/30 p-3">
                        <div className="text-xs text-gray-500">WAU(7d)</div>
                        <div className="text-lg font-bold text-white">{Number(trafficSummary?.wau_chat || 0).toLocaleString()}</div>
                      </div>
                      <div className="rounded-md border border-gray-800 bg-gray-900/30 p-3">
                        <div className="text-xs text-gray-500">MAU(30d)</div>
                        <div className="text-lg font-bold text-white">{Number(trafficSummary?.mau_chat || 0).toLocaleString()}</div>
                      </div>
                      <div className="rounded-md border border-gray-800 bg-gray-900/30 p-3">
                        <div className="text-xs text-gray-500">신규가입</div>
                        <div className="text-lg font-bold text-white">{Number(trafficSummary?.new_users || 0).toLocaleString()}</div>
                      </div>
                      <div className="rounded-md border border-gray-800 bg-gray-900/30 p-3">
                        <div className="text-xs text-gray-500">유저 대화수</div>
                        <div className="text-lg font-bold text-white">{Number(trafficSummary?.user_messages || 0).toLocaleString()}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-gray-400">
                      트래픽 지표를 불러오지 못했습니다. (관리자 권한/서버 상태를 확인해주세요)
                    </div>
                  )}
                  <div className="mt-2 text-xs text-gray-500">
                    주의: 현재 DAU/WAU/MAU는 “유저 발화(sender_type=user)” 기준입니다. 스토리 열람 DAU는 per-user 로그가 없어 추후 이벤트 로그가 필요합니다.
                  </div>
                </div>

                {/* 실시간 온라인(접속) - 운영 배포 판단용 */}
                <div className="rounded-lg border border-gray-800 bg-gray-950/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">실시간 온라인(최근 60초)</div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-gray-500">
                        {onlineLoading ? '불러오는 중...' : (onlineSummary?.as_of ? new Date(onlineSummary.as_of).toLocaleTimeString('ko-KR') : '')}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                        onClick={() => setOnlineReloadKey((k) => (Number(k || 0) + 1))}
                        disabled={onlineLoading}
                        title="새로고침"
                      >
                        새로고침
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-md border border-gray-800 bg-gray-900/30 p-3">
                      <div className="text-xs text-gray-500">온라인</div>
                      <div className="text-lg font-bold text-white">
                        {onlineLoading ? '...' : Number(onlineSummary?.online || 0).toLocaleString()}
                      </div>
                    </div>
                    <div className="rounded-md border border-gray-800 bg-gray-900/30 p-3">
                      <div className="text-xs text-gray-500">TTL</div>
                      <div className="text-lg font-bold text-white">
                        {Number(onlineSummary?.ttl_sec || 60).toLocaleString()}s
                      </div>
                    </div>
                    <div className="rounded-md border border-gray-800 bg-gray-900/30 p-3">
                      <div className="text-xs text-gray-500">활성</div>
                      <div className="text-lg font-bold text-white">
                        {(onlineSummary && onlineSummary.enabled === false) ? 'OFF' : 'ON'}
                      </div>
                    </div>
                    <div className="rounded-md border border-gray-800 bg-gray-900/30 p-3">
                      <div className="text-xs text-gray-500">소스</div>
                      <div className="text-sm font-semibold text-white truncate" title={String(onlineSummary?.source || '')}>
                        {String(onlineSummary?.source || '-')}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 text-xs text-gray-500">
                    기준: 최근 60초 내 하트비트. 비로그인은 IP+UA 기반이라 오차가 있을 수 있습니다.
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="text-sm text-gray-300">
                    총 <span className="font-semibold text-white">{Number(usersTotal || 0).toLocaleString()}</span>명
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                      onClick={() => setUsersPage((p) => Math.max(1, Number(p || 1) - 1))}
                      disabled={usersLoading || usersPage <= 1}
                    >
                      이전 100명
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                      onClick={() => {
                        const totalPages = Math.max(1, Math.ceil((Number(usersTotal || 0) || 0) / USERS_PAGE_SIZE));
                        setUsersPage((p) => Math.min(totalPages, Number(p || 1) + 1));
                      }}
                      disabled={usersLoading || (usersPage >= Math.max(1, Math.ceil((Number(usersTotal || 0) || 0) / USERS_PAGE_SIZE)))}
                    >
                      다음 100명
                    </Button>
                  </div>
                </div>

                <div className="text-xs text-gray-500">
                  페이지 {usersPage} / {Math.max(1, Math.ceil((Number(usersTotal || 0) || 0) / USERS_PAGE_SIZE))}
                </div>

                <Table className="text-gray-200">
                  <TableHeader>
                    <TableRow className="border-gray-700">
                      <TableHead className="text-gray-200">no</TableHead>
                      <TableHead className="text-gray-200">이메일</TableHead>
                      <TableHead className="text-gray-200">닉네임</TableHead>
                      <TableHead className="text-gray-200">가입일</TableHead>
                      <TableHead className="text-gray-200">최근 로그인</TableHead>
                      <TableHead className="text-gray-200 text-right">생성캐릭터수</TableHead>
                      <TableHead className="text-gray-200 text-right">이용 대화수</TableHead>
                      <TableHead className="text-gray-200 text-right">이용 조회수</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usersLoading ? (
                      <TableRow className="border-gray-800">
                        <TableCell colSpan={8} className="text-center text-gray-400 py-8">
                          불러오는 중...
                        </TableCell>
                      </TableRow>
                    ) : (usersItems || []).length === 0 ? (
                      <TableRow className="border-gray-800">
                        <TableCell colSpan={8} className="text-center text-gray-400 py-8">
                          표시할 회원이 없습니다.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (usersItems || []).map((u, idx) => {
                        const no = (Math.max(1, Number(usersPage || 1)) - 1) * USERS_PAGE_SIZE + idx + 1;
                        const email = String(u?.email || '').trim();
                        const username = String(u?.username || '').trim();
                        const isAdminUser = !!u?.is_admin;
                        const createdAt = u?.created_at ? new Date(u.created_at) : null;
                        const lastLoginAt = u?.last_login_at ? new Date(u.last_login_at) : null;
                        const createdChars = Number(u?.created_character_count || 0) || 0;
                        const usedChats = Number(u?.used_chat_count || 0) || 0;
                        const usedViews = Number(u?.used_view_count || 0) || 0;
                        return (
                          <TableRow key={String(u?.id || no)} className={`border-gray-800 ${isAdminUser ? 'bg-orange-900/10' : ''}`}>
                            <TableCell className="text-gray-400">{no}</TableCell>
                            <TableCell className="max-w-[220px] truncate" title={email}>{email || '-'}</TableCell>
                            <TableCell className="max-w-[220px]" title={username}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="truncate">{username || '-'}</span>
                                {isAdminUser ? (
                                  <Badge className="bg-orange-500 text-black hover:bg-orange-500 text-[10px] px-2 py-0.5">
                                    ADMIN
                                  </Badge>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="text-gray-300">
                              {createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString('ko-KR') : '-'}
                            </TableCell>
                            <TableCell className="text-gray-300">
                              {lastLoginAt && !Number.isNaN(lastLoginAt.getTime()) ? lastLoginAt.toLocaleString('ko-KR') : '-'}
                            </TableCell>
                            <TableCell className="text-right">{createdChars.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{usedChats.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{usedViews.toLocaleString()}</TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            )}

          {isUserLogsTab && (
            <div className="space-y-4">
              {/* ===== 서브탭 버튼 ===== */}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={userLogSubTab === 'traffic' ? 'default' : 'outline'}
                  className={userLogSubTab === 'traffic'
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}
                  onClick={() => setUserLogSubTab('traffic')}
                >
                  페이지 트래픽
                </Button>
                <Button
                  type="button"
                  variant={userLogSubTab === 'activity' ? 'default' : 'outline'}
                  className={userLogSubTab === 'activity'
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}
                  onClick={() => { setUserLogSubTab('activity'); setActivityPage(1); }}
                >
                  유저 활동
                </Button>
                <Button
                  type="button"
                  variant={userLogSubTab === 'ab' ? 'default' : 'outline'}
                  className={userLogSubTab === 'ab'
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}
                  onClick={() => setUserLogSubTab('ab')}
                >
                  A/B 테스트
                </Button>
              </div>

              {/* ========== 페이지 트래픽 서브탭 ========== */}
              {userLogSubTab === 'traffic' && (
                <Card className="bg-gray-800 border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-white">페이지 트래픽</CardTitle>
                    <CardDescription className="text-gray-400">
                      일별 페이지 조회(PV), 내부 이동(page_leave), 사이트 이탈(page_exit), 유니크 방문자(UV) 집계
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 필터 컨트롤 */}
                    <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                      <div className="flex flex-col sm:flex-row sm:items-end gap-3 w-full">
                        <div className="w-full sm:w-[160px]">
                          <Label className="text-gray-300">날짜(KST)</Label>
                          <Input
                            value={pageExitDay}
                            onChange={(e) => {
                              const v = String(e?.target?.value || '').replace(/[^0-9]/g, '').slice(0, 8);
                              setPageExitDay(v);
                            }}
                            placeholder="YYYYMMDD"
                            className="mt-1 bg-gray-900 border-gray-700 text-gray-100"
                            inputMode="numeric"
                          />
                          <div className="mt-1 text-[11px] text-gray-500">비우면 오늘</div>
                        </div>
                        <div className="w-full sm:flex-1">
                          <Label className="text-gray-300">검색</Label>
                          <Input
                            value={pageExitQuery}
                            onChange={(e) => setPageExitQuery(String(e?.target?.value || ''))}
                            placeholder="/characters/create, /ws/chat, 웹소설..."
                            className="mt-1 bg-gray-900 border-gray-700 text-gray-100"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button type="button" variant="outline" className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700" onClick={() => setPageExitDay('')} disabled={pageExitLoading}>오늘</Button>
                        <Button type="button" variant="outline" className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700" onClick={() => setPageExitReloadKey((k) => k + 1)} disabled={pageExitLoading}>
                          {pageExitLoading ? '...' : '새로고침'}
                        </Button>
                      </div>
                    </div>

                    {pageExitSummary ? (
                      <>
                        {/* 요약 카드 7개 */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                          {[
                            { label: '페이지 조회 (PV)', value: Number(pageExitSummary?.total_views || 0).toLocaleString() },
                            { label: '유니크 방문자 (UV)', value: Number(pageExitSummary?.total_unique_visitors || 0).toLocaleString() },
                            { label: '사이트 이탈 (탭 닫기)', value: Number(pageExitSummary?.total_exits || 0).toLocaleString() },
                            { label: '페이지 이동 (내부 전환)', value: Number(pageExitSummary?.total_leaves || 0).toLocaleString() },
                            { label: '총 이동+이탈', value: Number(pageExitSummary?.total_departures || 0).toLocaleString() },
                            { label: '날짜', value: String(pageExitSummary?.day || '-') },
                            { label: '타임존', value: String(pageExitSummary?.timezone || 'Asia/Seoul') },
                          ].map((c, i) => (
                            <div key={i} className="rounded-md border border-gray-800 bg-gray-900/30 p-3">
                              <div className="text-xs text-gray-500">{c.label}</div>
                              <div className="text-lg font-bold text-white">{c.value}</div>
                            </div>
                          ))}
                        </div>

                        {/* 차트 영역 */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* 파이차트: 그룹별 이동+이탈 비중 */}
                          {pieData.length > 0 && (
                            <div className="rounded-lg border border-gray-800 bg-gray-950/30 p-4">
                              <div className="text-sm font-semibold text-white mb-3">그룹별 이동+이탈 비중</div>
                              <ResponsiveContainer width="100%" height={260}>
                                <PieChart>
                                  <Pie
                                    data={pieData}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={90}
                                    label={({ name, percent, cx, x, y }) => (
                                      <text x={x} y={y} fill="#e5e7eb" fontSize={11} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
                                        {`${name} ${(percent * 100).toFixed(0)}%`}
                                      </text>
                                    )}
                                    labelLine={{ stroke: '#6b7280' }}
                                  >
                                    {pieData.map((_, i) => (
                                      <Cell key={i} fill={['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#3b82f6','#a3e635','#e879f9','#22d3ee'][i % 12]} />
                                    ))}
                                  </Pie>
                                  <Tooltip
                                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #4b5563', borderRadius: 8 }}
                                    itemStyle={{ color: '#e5e7eb' }}
                                    labelStyle={{ color: '#9ca3af', marginBottom: 4 }}
                                    formatter={(value, name, props) => [`${Number(value).toLocaleString()} (UV: ${Number(props?.payload?.uv || 0).toLocaleString()})`, name]}
                                  />
                                  <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} formatter={(value) => <span style={{ color: '#d1d5db' }}>{value}</span>} />
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                          )}

                          {/* 바차트: 상위 10 경로 */}
                          {barData.length > 0 && (
                            <div className="rounded-lg border border-gray-800 bg-gray-950/30 p-4">
                              <div className="text-sm font-semibold text-white mb-3">상위 10 경로 (이동+이탈 / 조회)</div>
                              <ResponsiveContainer width="100%" height={260}>
                                <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                                  <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                                  <YAxis type="category" dataKey="path" width={140} tick={{ fill: '#d1d5db', fontSize: 10 }} />
                                  <Tooltip
                                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #4b5563', borderRadius: 8 }}
                                    itemStyle={{ color: '#e5e7eb' }}
                                    labelStyle={{ color: '#9ca3af', marginBottom: 4 }}
                                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                    formatter={(value) => Number(value).toLocaleString()}
                                    labelFormatter={(label, payload) => payload?.[0]?.payload?.fullPath || label}
                                  />
                                  <Bar dataKey="departures" name="이동+이탈" fill="#6366f1" radius={[0, 4, 4, 0]} />
                                  <Bar dataKey="views" name="조회" fill="#4b5563" radius={[0, 4, 4, 0]} />
                                  <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} formatter={(value) => <span style={{ color: '#d1d5db' }}>{value}</span>} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          )}
                        </div>

                        {/* 상세 테이블 */}
                        <div className="rounded-lg border border-gray-800 bg-gray-950/30 overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow className="border-gray-800">
                                <TableHead className="text-gray-300">그룹</TableHead>
                                <TableHead className="text-gray-300">경로</TableHead>
                                <TableHead className="text-gray-300 text-right">조회</TableHead>
                                <TableHead className="text-gray-300 text-right">UV</TableHead>
                                <TableHead className="text-gray-300 text-right">이동+이탈</TableHead>
                                <TableHead className="text-gray-300 text-right">체류시간</TableHead>
                                <TableHead className="text-gray-300 text-right">이탈률</TableHead>
                                <TableHead className="text-gray-300 text-right">비중</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(filteredExitRows || []).length === 0 ? (
                                <TableRow className="border-gray-800">
                                  <TableCell colSpan={8} className="text-sm text-gray-400 py-8 text-center">
                                    데이터 없음
                                  </TableCell>
                                </TableRow>
                              ) : (
                                (filteredExitRows || []).slice(0, 200).map((r, idx) => {
                                  const views = Number(r?.views || 0);
                                  const departures = Number(r?.departures ?? r?.exits ?? 0);
                                  const uv = Number(r?.unique_visitors || 0);
                                  const dr = r?.departure_rate ?? r?.exit_rate ?? null;
                                  const ds = r?.departure_share ?? r?.exit_share ?? null;
                                  const group = String(r?.group_label || r?.group || '-');
                                  const path = String(r?.path || '-');
                                  const rateText = dr == null ? '-' : `${(Number(dr) * 100).toFixed(1)}%`;
                                  const shareText = ds == null ? '-' : `${(Number(ds) * 100).toFixed(1)}%`;

                                  // 체류시간
                                  const avgMs = Number(r?.avg_exit_duration_ms || r?.avg_leave_duration_ms || 0);
                                  let durText = '-';
                                  if (avgMs > 0) {
                                    const sec = avgMs / 1000;
                                    durText = sec >= 60 ? `${(sec / 60).toFixed(1)}분` : `${sec.toFixed(1)}초`;
                                  }

                                  return (
                                    <TableRow key={`${path}:${idx}`} className={`border-gray-800 ${idx % 2 === 0 ? 'bg-gray-900/20' : ''}`}>
                                      <TableCell className="text-gray-200 text-xs">{group}</TableCell>
                                      <TableCell className="text-gray-200 font-mono text-xs break-all max-w-[300px]">{path}</TableCell>
                                      <TableCell className="text-right text-gray-200">{views.toLocaleString()}</TableCell>
                                      <TableCell className="text-right text-blue-400">{uv.toLocaleString()}</TableCell>
                                      <TableCell className="text-right text-gray-200">{departures.toLocaleString()}</TableCell>
                                      <TableCell className="text-right text-gray-400 text-xs">{durText}</TableCell>
                                      <TableCell className="text-right text-gray-200">{rateText}</TableCell>
                                      <TableCell className="text-right text-gray-200">{shareText}</TableCell>
                                    </TableRow>
                                  );
                                })
                              )}
                            </TableBody>
                          </Table>
                        </div>

                        <div className="text-xs text-gray-500">
                          사이트 이탈 = pagehide/beforeunload (탭 닫기/새로고침), 페이지 이동 = SPA 내부 라우트 전환. 모바일/웹뷰 일부 누락 가능.
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-gray-400">
                        {pageExitLoading ? '불러오는 중...' : '데이터를 불러오지 못했습니다.'}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ========== 유저 활동 서브탭 ========== */}
              {userLogSubTab === 'activity' && (
                <Card className="bg-gray-800 border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-white">유저 활동</CardTitle>
                    <CardDescription className="text-gray-400">
                      로그인 유저의 페이지 방문/이동/이탈 이력 (DB 저장, 이메일/닉네임 검색)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 필터 */}
                    <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                      <div className="flex-1">
                        <Label className="text-gray-300">이메일/닉네임</Label>
                        <Input
                          value={activityQuery}
                          onChange={(e) => { setActivityQuery(String(e?.target?.value || '')); setActivityPage(1); }}
                          placeholder="검색어 입력..."
                          className="mt-1 bg-gray-900 border-gray-700 text-gray-100"
                        />
                      </div>
                      <div className="w-full sm:w-[130px]">
                        <Label className="text-gray-300">시작일</Label>
                        <Input
                          value={activityStartDate}
                          onChange={(e) => { setActivityStartDate(String(e?.target?.value || '').replace(/[^0-9]/g, '').slice(0, 8)); setActivityPage(1); }}
                          placeholder="YYYYMMDD"
                          className="mt-1 bg-gray-900 border-gray-700 text-gray-100"
                          inputMode="numeric"
                        />
                      </div>
                      <div className="w-full sm:w-[130px]">
                        <Label className="text-gray-300">종료일</Label>
                        <Input
                          value={activityEndDate}
                          onChange={(e) => { setActivityEndDate(String(e?.target?.value || '').replace(/[^0-9]/g, '').slice(0, 8)); setActivityPage(1); }}
                          placeholder="YYYYMMDD"
                          className="mt-1 bg-gray-900 border-gray-700 text-gray-100"
                          inputMode="numeric"
                        />
                      </div>
                      <div className="w-full sm:w-[140px]">
                        <Label className="text-gray-300">그룹</Label>
                        <select
                          value={activityPageGroup}
                          onChange={(e) => { setActivityPageGroup(e.target.value); setActivityPage(1); }}
                          className="mt-1 w-full h-9 rounded-md border border-gray-700 bg-gray-900 text-gray-100 px-2 text-sm"
                        >
                          <option value="">전체</option>
                          <option value="home">홈</option>
                          <option value="chat">채팅</option>
                          <option value="character_detail">캐릭터 상세</option>
                          <option value="character_wizard">캐릭터 생성/수정</option>
                          <option value="story_agent">스토리 에이전트</option>
                          <option value="storydive">스토리다이브</option>
                          <option value="webnovel_detail">웹소설 상세</option>
                          <option value="webnovel_reader">웹소설 뷰어</option>
                          <option value="history">대화내역</option>
                          <option value="auth">인증</option>
                          <option value="other">기타</option>
                        </select>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700 shrink-0"
                        onClick={() => setActivityReloadKey((k) => k + 1)}
                        disabled={activityLoading}
                      >
                        {activityLoading ? '...' : '새로고침'}
                      </Button>
                    </div>

                    {/* 테이블 */}
                    <div className="rounded-lg border border-gray-800 bg-gray-950/30 overflow-x-auto">
                      <Table className="min-w-[700px]">
                        <TableHeader>
                          <TableRow className="border-gray-800">
                            <TableHead className="text-gray-300 w-[110px]">시각</TableHead>
                            <TableHead className="text-gray-300 w-[130px]">유저</TableHead>
                            <TableHead className="text-gray-300 w-[52px]">이벤트</TableHead>
                            <TableHead className="text-gray-300">경로</TableHead>
                            <TableHead className="text-gray-300 w-[80px]">그룹</TableHead>
                            <TableHead className="text-gray-300 text-right w-[64px]">체류</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {!activityData || !Array.isArray(activityData?.items) || activityData.items.length === 0 ? (
                            <TableRow className="border-gray-800">
                              <TableCell colSpan={6} className="text-sm text-gray-400 py-8 text-center">
                                {activityLoading ? '불러오는 중...' : '데이터 없음'}
                              </TableCell>
                            </TableRow>
                          ) : (
                            activityData.items.map((item, idx) => {
                              const evLabel = item.event === 'page_view' ? '방문' : item.event === 'page_leave' ? '이동' : '이탈';
                              const evColor = item.event === 'page_view' ? 'text-green-400' : item.event === 'page_leave' ? 'text-yellow-400' : 'text-red-400';
                              const durMs = Number(item.duration_ms || 0);
                              let durText = '-';
                              if (durMs > 0) {
                                const sec = durMs / 1000;
                                durText = sec >= 60 ? `${(sec / 60).toFixed(1)}분` : `${sec.toFixed(0)}초`;
                              }
                              // 컴팩트 시각: MM.DD HH:mm
                              let ts = '-';
                              try {
                                if (item.created_at) {
                                  const d = new Date(item.created_at);
                                  const mm = String(d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit' })).replace(/[^0-9]/g, '').padStart(2, '0');
                                  const dd = String(d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', day: '2-digit' })).replace(/[^0-9]/g, '').padStart(2, '0');
                                  const hh = String(d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false })).replace(/[^0-9]/g, '').padStart(2, '0');
                                  const mi = String(d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', minute: '2-digit' })).replace(/[^0-9]/g, '').padStart(2, '0');
                                  ts = `${mm}.${dd} ${hh}:${mi}`;
                                }
                              } catch (_) {}

                              return (
                                <TableRow key={item.id || idx} className={`border-gray-800 ${idx % 2 === 0 ? 'bg-gray-900/20' : ''}`}>
                                  <TableCell className="text-gray-400 text-xs whitespace-nowrap">{ts}</TableCell>
                                  <TableCell className="text-gray-200 text-xs max-w-[130px]">
                                    <div className="truncate">{item.username || '-'}</div>
                                    <div className="text-gray-500 text-[10px] truncate">{item.email || ''}</div>
                                  </TableCell>
                                  <TableCell className={`text-xs font-medium ${evColor}`}>{evLabel}</TableCell>
                                  <TableCell className="text-gray-200 font-mono text-[11px] truncate max-w-[280px]" title={item.path || ''}>{item.path || '-'}</TableCell>
                                  <TableCell className="text-gray-400 text-xs">{item.page_group || '-'}</TableCell>
                                  <TableCell className="text-right text-gray-400 text-xs">{durText}</TableCell>
                                </TableRow>
                              );
                            })
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    {/* 페이지네이션 */}
                    {activityData && Number(activityData?.total || 0) > 0 && (
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-500">
                          총 {Number(activityData.total).toLocaleString()}건 (페이지 {activityData.page}/{Math.max(1, Math.ceil(Number(activityData.total) / Number(activityData.page_size || 50)))})
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                            disabled={activityPage <= 1 || activityLoading}
                            onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                          >
                            이전
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                            disabled={activityLoading || (activityData.items || []).length < Number(activityData.page_size || 50)}
                            onClick={() => setActivityPage((p) => p + 1)}
                          >
                            다음
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ========== A/B 테스트 서브탭 ========== */}
              {userLogSubTab === 'ab' && (
                <Card className="bg-gray-800 border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-white">A/B 테스트 비교</CardTitle>
                    <CardDescription className="text-gray-400">
                      메인 페이지 변형(A/B)별 조회·이탈 수를 비교합니다. 변형은 유저 브라우저에 고정 할당됩니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                      <div className="w-full sm:w-[160px]">
                        <Label className="text-gray-300">테스트</Label>
                        <select
                          value={abTestName}
                          onChange={(e) => setAbTestName(e.target.value)}
                          className="mt-1 w-full h-9 bg-gray-900 border border-gray-700 text-gray-100 rounded-md px-2 text-sm"
                        >
                          <option value="ab_home">메인 페이지</option>
                        </select>
                      </div>
                      <div className="w-full sm:w-[140px]">
                        <Label className="text-gray-300">날짜</Label>
                        <Input
                          value={abDay}
                          onChange={(e) => setAbDay(String(e?.target?.value || '').replace(/[^0-9]/g, '').slice(0, 8))}
                          placeholder="YYYYMMDD"
                          className="mt-1 bg-gray-900 border-gray-700 text-gray-100"
                          inputMode="numeric"
                        />
                      </div>
                      <Button
                        variant="outline"
                        className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700 shrink-0"
                        onClick={() => setAbReloadKey((k) => k + 1)}
                        disabled={abLoading}
                      >
                        {abLoading ? '불러오는 중...' : '새로고침'}
                      </Button>
                    </div>

                    {abData?.variants && abData.variants.length > 0 ? (
                      <>
                        <div className="rounded-lg border border-gray-800 bg-gray-950/30 overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow className="border-gray-800">
                                <TableHead className="text-gray-300">변형</TableHead>
                                <TableHead className="text-gray-300 text-right">조회(PV)</TableHead>
                                <TableHead className="text-gray-300 text-right">이탈(exit)</TableHead>
                                <TableHead className="text-gray-300 text-right">이동(leave)</TableHead>
                                <TableHead className="text-gray-300 text-right">이탈률</TableHead>
                                <TableHead className="text-gray-300 text-right">총 이탈률</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {abData.variants.map((v, idx) => (
                                <TableRow key={v.variant || idx} className={`border-gray-800 ${idx % 2 === 0 ? 'bg-gray-900/20' : ''}`}>
                                  <TableCell className="text-white font-semibold text-lg">{v.variant}</TableCell>
                                  <TableCell className="text-right text-gray-200">{Number(v.views || 0).toLocaleString()}</TableCell>
                                  <TableCell className="text-right text-gray-200">{Number(v.exits || 0).toLocaleString()}</TableCell>
                                  <TableCell className="text-right text-gray-200">{Number(v.leaves || 0).toLocaleString()}</TableCell>
                                  <TableCell className="text-right text-gray-200">
                                    {v.exit_rate != null ? `${(v.exit_rate * 100).toFixed(2)}%` : '-'}
                                  </TableCell>
                                  <TableCell className="text-right text-gray-200">
                                    {v.departure_rate != null ? `${(v.departure_rate * 100).toFixed(2)}%` : '-'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        {/* 바차트: 변형별 조회 vs 이탈 */}
                        <div className="rounded-lg border border-gray-800 bg-gray-950/30 p-4">
                          <div className="text-sm font-semibold text-white mb-3">변형별 조회 / 이탈 비교</div>
                          <div className="h-[200px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={abData.variants}>
                                <XAxis dataKey="variant" stroke="#6b7280" tick={{ fill: '#d1d5db', fontSize: 14 }} />
                                <YAxis stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#e5e7eb' }} />
                                <Legend wrapperStyle={{ color: '#d1d5db' }} />
                                <Bar dataKey="views" fill="#6366f1" name="조회(PV)" />
                                <Bar dataKey="departures" fill="#ef4444" name="이탈+이동" />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        <div className="text-xs text-gray-500">
                          날짜: {abData.day || '-'} · 테스트: {abData.test || '-'}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-gray-400">
                        {abLoading ? '불러오는 중...' : '데이터가 없습니다. AB 변형 트래픽이 쌓이면 여기에 표시됩니다.'}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* ===== 테스트 계정 생성 모달(회원관리 탭) ===== */}
          <Dialog
            open={testUserOpen}
            onOpenChange={(v) => {
              setTestUserOpen(!!v);
            }}
          >
            <DialogContent className="bg-gray-900 border-gray-700 text-white">
              <DialogHeader>
                <DialogTitle className="text-white">테스트 계정 생성</DialogTitle>
                <DialogDescription className="text-gray-400">
                  생성된 계정은 <span className="text-gray-200 font-medium">메일 인증 완료</span> 상태로 만들어져 바로 로그인할 수 있습니다.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-gray-300">성별</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className={`h-9 px-4 border-gray-700 ${testUserGender === 'male' ? 'bg-purple-600/30 text-white' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'}`}
                      onClick={() => setTestUserGender('male')}
                      disabled={testUserCreating}
                    >
                      남성
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className={`h-9 px-4 border-gray-700 ${testUserGender === 'female' ? 'bg-purple-600/30 text-white' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'}`}
                      onClick={() => setTestUserGender('female')}
                      disabled={testUserCreating}
                    >
                      여성
                    </Button>
                  </div>
                </div>

                {testUserResult ? (
                  <div className="rounded-xl border border-gray-800 bg-gray-950/30 p-4 space-y-3">
                    <div className="text-sm font-semibold text-white">생성 결과</div>

                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-gray-500">이메일</div>
                        <div className="text-sm text-gray-100 break-all">{String(testUserResult.email || '')}</div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 px-3 bg-gray-900 border-gray-700 text-gray-200 hover:bg-gray-800 shrink-0"
                        onClick={() => {
                          const v = String(testUserResult.email || '').trim();
                          if (!v) return;
                          try {
                            Promise.resolve(navigator.clipboard.writeText(v))
                              .then(() => toast.success('이메일 복사됨'))
                              .catch(() => toast.error('복사에 실패했습니다'));
                          } catch (_) {
                            toast.error('복사에 실패했습니다');
                          }
                        }}
                      >
                        <Copy className="w-4 h-4 mr-2" />
                        복사
                      </Button>
                    </div>

                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-gray-500">비밀번호</div>
                        <div className="text-sm text-gray-100 break-all">{String(testUserResult.password || '')}</div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 px-3 bg-gray-900 border-gray-700 text-gray-200 hover:bg-gray-800 shrink-0"
                        onClick={() => {
                          const v = String(testUserResult.password || '').trim();
                          if (!v) return;
                          try {
                            Promise.resolve(navigator.clipboard.writeText(v))
                              .then(() => toast.success('비밀번호 복사됨'))
                              .catch(() => toast.error('복사에 실패했습니다'));
                          } catch (_) {
                            toast.error('복사에 실패했습니다');
                          }
                        }}
                      >
                        <Copy className="w-4 h-4 mr-2" />
                        복사
                      </Button>
                    </div>

                    {testUserResult.username ? (
                      <div className="text-xs text-gray-500">
                        닉네임: <span className="text-gray-200">{String(testUserResult.username || '')}</span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-sm text-gray-400">
                    “생성”을 누르면 테스트 계정을 만들고 이메일/비밀번호를 보여줍니다.
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                  onClick={() => setTestUserOpen(false)}
                  disabled={testUserCreating}
                >
                  닫기
                </Button>
                <Button
                  type="button"
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={createTestUser}
                  disabled={testUserCreating}
                >
                  {testUserCreating ? '생성 중...' : '생성'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {isBannersTab && (
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-white">홈 배너</CardTitle>
                <CardDescription className="text-gray-400">
                  배너 이미지/링크/노출 기간을 설정할 수 있습니다. (서버 저장, 전 유저 반영)
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
                  const displayOn = String(b.displayOn || 'all').trim().toLowerCase() || 'all';
                  return (
                    <div key={b.id} className="rounded-xl border border-gray-700 bg-gray-900/30 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-semibold text-white truncate">
                              #{idx + 1} {b.title || '배너'}
                            </div>
                            <Badge className={status.className}>{status.label}</Badge>
                            {displayOn !== 'all' ? (
                              <Badge className="bg-gray-700 text-gray-200">
                                {displayOn === 'pc' ? 'PC만' : '모바일만'}
                              </Badge>
                            ) : null}
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
                            <div className="relative aspect-[2000/360]">
                              <div className="absolute inset-0 bg-gradient-to-r from-[#2a160c] via-[#15121a] to-[#0b1627]" />
                              {b.imageUrl ? (
                                <img
                                  src={withCacheBust(resolveImageUrl(b.imageUrl) || b.imageUrl, b.updatedAt || b.createdAt)}
                                  alt={b.title || '배너'}
                                  className="absolute inset-0 w-full h-full object-cover"
                                  onLoad={(e) => { try { e.currentTarget.style.display = ''; } catch (_) {} }}
                                  onError={(e) => { try { e.currentTarget.style.display = 'none'; } catch (_) {} }}
                                />
                              ) : (
                                <div className="relative w-full h-full flex items-center px-6">
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
                            <div className="relative aspect-[2000/360]">
                              <div className="absolute inset-0 bg-gradient-to-r from-[#2a160c] via-[#15121a] to-[#0b1627]" />
                              {(b.mobileImageUrl || b.imageUrl) ? (
                                <img
                                  src={withCacheBust(resolveImageUrl((b.mobileImageUrl || b.imageUrl)) || (b.mobileImageUrl || b.imageUrl), b.updatedAt || b.createdAt)}
                                  alt={b.title || '배너'}
                                  className="absolute inset-0 w-full h-full object-cover"
                                  onLoad={(e) => { try { e.currentTarget.style.display = ''; } catch (_) {} }}
                                  onError={(e) => { try { e.currentTarget.style.display = 'none'; } catch (_) {} }}
                                />
                              ) : (
                                <div className="relative w-full h-full flex items-center px-6">
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

                        {/* 노출 대상 */}
                        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white">노출 대상</div>
                              <div className="text-xs text-gray-500 leading-relaxed mt-1">
                                배너를 <span className="text-gray-200 font-medium">전체/PC만/모바일만</span> 중 선택해 노출할 수 있습니다.
                                <br />
                                모바일만 노출 배너도 지원합니다. (모바일 전용 이미지는 <span className="text-gray-300">mobileImageUrl</span>에 업로드)
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap justify-end">
                              <Button
                                type="button"
                                variant="outline"
                                className={`h-9 px-4 border-gray-700 ${displayOn === 'all' ? 'bg-purple-600/30 text-white' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'}`}
                                onClick={() => updateBanner(b.id, { displayOn: 'all' })}
                              >
                                전체
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className={`h-9 px-4 border-gray-700 ${displayOn === 'pc' ? 'bg-purple-600/30 text-white' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'}`}
                                onClick={() => updateBanner(b.id, { displayOn: 'pc' })}
                              >
                                PC만
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className={`h-9 px-4 border-gray-700 ${displayOn === 'mobile' ? 'bg-purple-600/30 text-white' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'}`}
                                onClick={() => updateBanner(b.id, { displayOn: 'mobile' })}
                              >
                                모바일만
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* PC 배너 설정 */}
                        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white">PC 배너 이미지 설정</div>
                              <div className="text-xs text-gray-500 leading-relaxed mt-1">
                                권장(PC): <span className="text-gray-300 font-medium">2000×360</span> (약 5.6:1)
                                <br />
                                참고: 화면 폭에 따라 상/하가 약간 잘릴 수 있으니(cover) 중요한 텍스트는 중앙에 배치하세요.
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
                            <Label className="text-gray-300">PC 이미지 파일 업로드(서버 저장)</Label>
                            <Input
                              type="file"
                              accept="image/*"
                              className="bg-gray-900 border-gray-700 text-white"
                              onChange={(e) => handlePickImage(b.id, e.target.files?.[0])}
                            />
                            <div className="text-xs text-gray-500">
                              파일은 서버에 업로드되며, CMS 설정에는 URL(/static/...)만 저장됩니다.
                            </div>
                          </div>
                        </div>

                        {/* 모바일 배너 설정 */}
                        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white">모바일 배너 이미지 설정</div>
                              <div className="text-xs text-gray-500 leading-relaxed mt-1">
                                권장(모바일): <span className="text-gray-300 font-medium">2000×360</span> (PC와 동일)
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
                            <Label className="text-gray-300">모바일 이미지 파일 업로드(서버 저장, 옵션)</Label>
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

          {isPopupsTab && (
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-white">홈 팝업</CardTitle>
                  <CardDescription className="text-gray-400">
                    팝업 노출 개수/이미지/링크/“N일간 안보기”/노출 기간을 설정할 수 있습니다. (서버 저장, 전 유저 반영)
                  </CardDescription>
                </div>
                <Button
                  onClick={addPopup}
                  className="bg-pink-600 hover:bg-pink-700 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  팝업 추가
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-gray-700 bg-gray-900/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">동시에(순차) 띄울 최대 개수</div>
                      <div className="text-xs text-gray-500">
                        홈 진입 시 조건을 만족하는 팝업이 여러 개면, 위에서부터 최대 N개까지 순서대로 노출합니다.
                      </div>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={Number(popupsConfig?.maxDisplayCount ?? 1)}
                      onChange={(e) => updatePopupsConfig({ maxDisplayCount: Number(e.target.value) })}
                      className="w-24 bg-gray-900 border-gray-700 text-white"
                    />
                  </div>
                </div>

                {(Array.isArray(popupsConfig?.items) ? popupsConfig.items : []).length === 0 ? (
                  <div className="text-gray-400 text-sm">팝업이 없습니다. “팝업 추가”를 눌러 등록하세요.</div>
                ) : (
                  (popupsConfig.items || []).map((p, idx) => {
                    const displayOn = String(p.displayOn || 'all').trim().toLowerCase() || 'all';
                    const href = String(p.linkUrl || '').trim();
                    const external = href && isExternalUrl(href);
                    return (
                      <div key={p.id} className="rounded-xl border border-gray-700 bg-gray-900/30 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="text-sm font-semibold text-white truncate">
                                #{idx + 1} {p.title || '팝업'}
                              </div>
                              {displayOn !== 'all' ? (
                                <Badge className="bg-gray-700 text-gray-200">
                                  {displayOn === 'pc' ? 'PC만' : '모바일만'}
                                </Badge>
                              ) : null}
                              {external && (
                                <Badge className="bg-gray-700 text-gray-200">
                                  <ExternalLink className="w-3 h-3 mr-1" />
                                  외부링크
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {p.startAt ? new Date(p.startAt).toLocaleString('ko-KR') : '상시'}
                              {' '}~{' '}
                              {p.endAt ? new Date(p.endAt).toLocaleString('ko-KR') : '상시'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Button
                              variant="outline"
                              className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                              onClick={() => movePopup(p.id, 'up')}
                              disabled={idx === 0}
                              title="위로"
                            >
                              <ArrowUp className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                              onClick={() => movePopup(p.id, 'down')}
                              disabled={idx === (popupsConfig.items.length - 1)}
                              title="아래로"
                            >
                              <ArrowDown className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              className="h-9 px-3 bg-red-600/20 border-red-500/30 text-red-200 hover:bg-red-600/30"
                              onClick={() => removePopup(p.id)}
                              title="삭제"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-white">활성화</div>
                                <div className="text-xs text-gray-500">활성화된 팝업만 노출됩니다.</div>
                              </div>
                              <Switch
                                checked={!!p.enabled}
                                onCheckedChange={(v) => updatePopupItem(p.id, { enabled: !!v })}
                              />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-2">
                                <Label className="text-gray-300">노출 대상</Label>
                                <select
                                  value={displayOn}
                                  onChange={(e) => updatePopupItem(p.id, { displayOn: e.target.value })}
                                  className="w-full h-10 rounded-md bg-gray-900 border border-gray-700 text-white px-3"
                                >
                                  <option value="all">전체</option>
                                  <option value="pc">PC만</option>
                                  <option value="mobile">모바일만</option>
                                </select>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-gray-300">N일간 안보기</Label>
                                <Input
                                  type="number"
                                  min={0}
                                  max={365}
                                  value={Number(p.dismissDays ?? 1)}
                                  onChange={(e) => updatePopupItem(p.id, { dismissDays: Number(e.target.value) })}
                                  className="bg-gray-900 border-gray-700 text-white"
                                  placeholder="예: 1"
                                />
                                <div className="text-xs text-gray-500">0이면 “이번 세션만 닫기”로 동작합니다.</div>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <Label className="text-gray-300">제목</Label>
                              <Input
                                value={p.title || ''}
                                onChange={(e) => updatePopupItem(p.id, { title: e.target.value })}
                                className="bg-gray-900 border-gray-700 text-white"
                                placeholder="예: 신규 업데이트 안내"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label className="text-gray-300">내용</Label>
                              <Textarea
                                value={p.message || ''}
                                onChange={(e) => updatePopupItem(p.id, { message: e.target.value })}
                                className="bg-gray-900 border-gray-700 text-white min-h-[90px]"
                                placeholder="팝업 본문 텍스트"
                              />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-2">
                                <Label className="text-gray-300">노출 시작(옵션)</Label>
                                <Input
                                  type="datetime-local"
                                  value={toDatetimeLocal(p.startAt)}
                                  onChange={(e) => updatePopupItem(p.id, { startAt: fromDatetimeLocal(e.target.value) })}
                                  className="bg-gray-900 border-gray-700 text-white"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-gray-300">노출 종료(옵션)</Label>
                                <Input
                                  type="datetime-local"
                                  value={toDatetimeLocal(p.endAt)}
                                  onChange={(e) => updatePopupItem(p.id, { endAt: fromDatetimeLocal(e.target.value) })}
                                  className="bg-gray-900 border-gray-700 text-white"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="space-y-2">
                              <Label className="text-gray-300">링크 URL(옵션)</Label>
                              <Input
                                value={p.linkUrl || ''}
                                onChange={(e) => updatePopupItem(p.id, { linkUrl: e.target.value })}
                                className="bg-gray-900 border-gray-700 text-white"
                                placeholder="예: /notices 또는 https://..."
                              />
                            </div>
                            <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-white">새 탭으로 열기</div>
                                <div className="text-xs text-gray-500">외부 링크는 새 탭을 권장합니다.</div>
                              </div>
                              <Switch
                                checked={!!p.openInNewTab}
                                onCheckedChange={(v) => updatePopupItem(p.id, { openInNewTab: !!v })}
                              />
                            </div>

                            <div className="rounded-lg border border-gray-800 bg-gray-950/30 overflow-hidden">
                              <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-300 flex items-center justify-between">
                                <span className="font-semibold">PC 이미지</span>
                                <span className="text-[11px] text-gray-500">imageUrl</span>
                              </div>
                              <div className="relative aspect-[16/9]">
                                <div className="absolute inset-0 bg-gradient-to-r from-[#2a160c] via-[#15121a] to-[#0b1627]" />
                                {p.imageUrl ? (
                                  <img
                                    src={withCacheBust(resolveImageUrl(p.imageUrl) || p.imageUrl, p.updatedAt || p.createdAt)}
                                    alt={p.title || '팝업'}
                                    className="absolute inset-0 w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-sm">
                                    PC 이미지 없음
                                  </div>
                                )}
                              </div>
                              <div className="p-3 flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                  onClick={() => pickPopupImage(p.id, 'pc')}
                                >
                                  <ImageIcon className="w-4 h-4 mr-2" />
                                  업로드
                                </Button>
                                <Button
                                  variant="outline"
                                  className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                  onClick={() => updatePopupItem(p.id, { imageUrl: '' })}
                                  disabled={!String(p.imageUrl || '').trim()}
                                  title="PC 이미지 제거"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  제거
                                </Button>
                              </div>
                            </div>

                            <div className="rounded-lg border border-gray-800 bg-gray-950/30 overflow-hidden">
                              <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-300 flex items-center justify-between">
                                <span className="font-semibold">모바일 이미지(옵션)</span>
                                <span className="text-[11px] text-gray-500">mobileImageUrl</span>
                              </div>
                              <div className="relative aspect-[16/9]">
                                <div className="absolute inset-0 bg-gradient-to-r from-[#2a160c] via-[#15121a] to-[#0b1627]" />
                                {(p.mobileImageUrl || p.imageUrl) ? (
                                  <img
                                    src={withCacheBust(resolveImageUrl((p.mobileImageUrl || p.imageUrl)) || (p.mobileImageUrl || p.imageUrl), p.updatedAt || p.createdAt)}
                                    alt={p.title || '팝업'}
                                    className="absolute inset-0 w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-sm">
                                    모바일 이미지 없음
                                  </div>
                                )}
                              </div>
                              <div className="p-3 flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                  onClick={() => pickPopupImage(p.id, 'mobile')}
                                >
                                  <ImageIcon className="w-4 h-4 mr-2" />
                                  업로드
                                </Button>
                                <Button
                                  variant="outline"
                                  className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                  onClick={() => updatePopupItem(p.id, { mobileImageUrl: '' })}
                                  disabled={!String(p.mobileImageUrl || '').trim()}
                                  title="모바일 이미지 제거"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  제거
                                </Button>
                              </div>
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
                {/* ✅ 보기 탭: 활성/비활성 분리 */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      type="button"
                      variant="outline"
                      className={`h-9 px-3 ${slotListTab === 'enabled' ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-700' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
                      onClick={() => setSlotListTab('enabled')}
                      title="활성화된 구좌만 보기"
                    >
                      활성화({enabledSlotsCount})
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className={`h-9 px-3 ${slotListTab === 'disabled' ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-700' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
                      onClick={() => setSlotListTab('disabled')}
                      title="비활성화된 구좌만 보기"
                    >
                      비활성화({disabledSlotsCount})
                    </Button>
                  </div>
                  <div className="text-xs text-gray-500">
                    스위치 토글 시 해당 탭으로 자동 전환됩니다. 저장을 눌러야 메인에 반영됩니다.
                  </div>
                </div>

                {(slots || []).length === 0 ? (
                  <div className="text-gray-400 text-sm">구좌가 없습니다. “구좌 추가”를 눌러 등록하세요.</div>
                ) : (visibleSlotsForTab || []).length === 0 ? (
                  <div className="text-gray-400 text-sm">
                    {slotListTab === 'disabled' ? '비활성화된 구좌가 없습니다.' : '활성화된 구좌가 없습니다.'}
                  </div>
                ) : (
                  (visibleSlotsForTab || []).map((s, idx) => {
                    const status = computeStatus(s);
                    const slotType = String(s?.slotType || (isSystemHomeSlotId(s?.id) ? 'system' : 'custom')).trim().toLowerCase();
                    const isCustomSlot = slotType === 'custom';
                    const customPicks = Array.isArray(s?.contentPicks) ? s.contentPicks : [];
                    const customSortMode = String(s?.contentSortMode || 'metric') === 'random' ? 'random' : 'metric';
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
                              disabled={idx === 0}
                              title="위로"
                            >
                              <ArrowUp className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                              onClick={() => moveSlot(s.id, 'down')}
                              disabled={idx === ((visibleSlotsForTab || []).length - 1)}
                              title="아래로"
                            >
                              <ArrowDown className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="mt-4 space-y-4">
                          {isCustomSlot && (
                            <div className="rounded-lg border border-gray-800 bg-gray-900/30 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <div className="text-sm font-semibold text-white">구좌 콘텐츠</div>
                                    <Badge className="bg-gray-700 text-gray-100 hover:bg-gray-700">
                                      {customPicks.length}개
                                    </Badge>
                                    <Badge className="bg-gray-700 text-gray-100 hover:bg-gray-700">
                                      {customSortMode === 'random' ? '랜덤' : '대화/조회순'}
                                    </Badge>
                                  </div>
                                  <div className="text-xs text-gray-400 mt-1">
                                    캐릭터/원작챗/웹소설을 다중 선택하고, 정렬 방식을 설정하세요.
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                  onClick={() => openContentPickerForSlot(s)}
                                >
                                  선택/편집
                                </Button>
                              </div>

                              <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                                <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-200">
                                  <input
                                    type="radio"
                                    name={`customSort-${s.id}`}
                                    className="accent-purple-600"
                                    checked={customSortMode === 'metric'}
                                    onChange={() => updateSlot(s.id, { contentSortMode: 'metric' })}
                                  />
                                  <span className="text-sm">대화수(조회수) 순</span>
                                </label>
                                <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-200">
                                  <input
                                    type="radio"
                                    name={`customSort-${s.id}`}
                                    className="accent-purple-600"
                                    checked={customSortMode === 'random'}
                                    onChange={() => updateSlot(s.id, { contentSortMode: 'random' })}
                                  />
                                  <span className="text-sm">랜덤 정렬(새로고침마다 변경)</span>
                                </label>
                              </div>

                              {customPicks.length === 0 ? (
                                <div className="mt-3 text-sm text-gray-300">
                                  아직 선택된 콘텐츠가 없습니다. “선택/편집”에서 추가하세요.
                                </div>
                              ) : (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {customPicks.map((p) => {
                                    const type = String(p?.type || '').trim().toLowerCase();
                                    const pid = String(p?.item?.id || '').trim();
                                    const label = type === 'story'
                                      ? String(p?.item?.title || '').trim()
                                      : String(p?.item?.name || '').trim();
                                    const img = type === 'story'
                                      ? String(p?.item?.cover_url || '').trim()
                                      : String(p?.item?.avatar_url || p?.item?.thumbnail_url || '').trim();
                                    const k = `${type}:${pid}`;
                                    const badge = type === 'story' ? '웹소설' : (p?.item?.origin_story_id ? '원작챗' : '캐릭터');
                                    return (
                                      <div
                                        key={k}
                                        className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900/40 px-2.5 py-1"
                                        title={label || k}
                                      >
                                        <Avatar className="h-6 w-6">
                                          <AvatarImage src={img} alt={label || badge} />
                                          <AvatarFallback className="bg-gray-800 text-gray-200 text-xs">
                                            {(label || badge || 'C').charAt(0)}
                                          </AvatarFallback>
                                        </Avatar>
                                        <Badge className="bg-gray-700 text-gray-100 hover:bg-gray-700 text-[10px] px-2 py-0.5">
                                          {badge}
                                        </Badge>
                                        <span className="text-xs text-gray-200 max-w-[220px] truncate">{label || k}</span>
                                        <button
                                          type="button"
                                          className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
                                          onClick={() => {
                                            const next = (customPicks || []).filter((x) => {
                                              const t2 = String(x?.type || '').trim().toLowerCase();
                                              const id2 = String(x?.item?.id || '').trim();
                                              return `${t2}:${id2}` !== k;
                                            });
                                            updateSlot(s.id, { contentPicks: next });
                                          }}
                                          aria-label="콘텐츠 제거"
                                          title="제거"
                                        >
                                          <X className="h-4 w-4" />
                                        </button>
                                      </div>
                                    );
                                  })}
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
                              onCheckedChange={(v) => {
                                updateSlot(s.id, { enabled: !!v });
                                // 토글 후 반대 탭으로 자동전환 (슬롯이 "사라진" 것처럼 보이는 혼동 방지)
                                setSlotListTab(v ? 'enabled' : 'disabled');
                              }}
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

          {isTagsTab && (
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">태그 관리</CardTitle>
                <CardDescription className="text-gray-400">
                  캐릭터 탭 / 태그 선택 모달의 노출 순서/숨김 + 태그 추가/삭제를 관리합니다. (저장 시 전 유저 반영)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 태그 추가 */}
                <div className="rounded-lg border border-gray-800 bg-gray-900/30 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">태그 추가</div>
                    {creatingTag && <div className="text-xs text-gray-500">추가 중...</div>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-gray-300">태그명</Label>
                      <Input
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        className="bg-gray-900 border-gray-700 text-white"
                        placeholder="예) 스트리머"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-gray-300">슬러그(선택)</Label>
                      <Input
                        value={newTagSlug}
                        onChange={(e) => setNewTagSlug(e.target.value)}
                        className="bg-gray-900 border-gray-700 text-white"
                        placeholder="비우면 태그명과 동일"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        className="w-full bg-pink-600 hover:bg-pink-700 text-white"
                        onClick={handleCreateTag}
                        disabled={creatingTag}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        {creatingTag ? '추가 중...' : '추가'}
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    삭제 정책: 기본 태그/사용 중 태그는 삭제할 수 없습니다. (숨김 기능을 사용하세요)
                  </div>
                </div>

                {/* 노출 순서/숨김 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-gray-800 bg-gray-900/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-white">상단 우선 노출(순서)</div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 px-2 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                          onClick={openTagOrderModal}
                          title="멀티라인 텍스트/드래그로 순서 편집"
                        >
                          <ListOrdered className="w-4 h-4 mr-1" />
                          순서 편집
                        </Button>
                      </div>
                      <Badge className="bg-gray-700 text-gray-100 hover:bg-gray-700">
                        {effectivePrioritySlugsForDisplay.length}개
                      </Badge>
                    </div>
                    <div className="mt-3 space-y-2">
                      {effectivePrioritySlugsForDisplay.length === 0 ? (
                        <div className="text-xs text-gray-500">
                          현재는 기본 우선순위(예: 판타지/SF/던전)가 적용됩니다. “순서 편집”에서 원하는 순서로 직접 지정하세요.
                        </div>
                      ) : (
                        (effectivePrioritySlugsForDisplay || []).map((slug, idx) => {
                          const label = tagNameBySlug.get(String(slug || '').trim()) || String(slug || '').trim();
                          const isFirst = idx === 0;
                          const isLast = idx === ((effectivePrioritySlugsForDisplay || []).length - 1);
                          return (
                            <div key={String(slug)} className="flex items-center justify-between gap-3 rounded-md border border-gray-800 bg-gray-950/20 px-3 py-2">
                              <div className="min-w-0">
                                <div className="text-sm text-white truncate">{label}</div>
                                <div className="text-xs text-gray-500 truncate">{String(slug || '').trim()}</div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                  onClick={() => movePrioritySlug(slug, 'up')}
                                  disabled={isFirst}
                                  title="위로"
                                >
                                  <ArrowUp className="w-4 h-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                  onClick={() => movePrioritySlug(slug, 'down')}
                                  disabled={isLast}
                                  title="아래로"
                                >
                                  <ArrowDown className="w-4 h-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                  onClick={() => removePrioritySlug(slug)}
                                  title="목록에서 제거"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <div className="mt-3 text-xs text-gray-500">
                      팁: 아래 “전체 태그”에서 태그를 선택해 우선 노출 목록에 추가할 수 있습니다.
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-900/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white">숨김 태그</div>
                      <Badge className="bg-gray-700 text-gray-100 hover:bg-gray-700">
                        {(Array.isArray(tagDisplay?.hiddenSlugs) ? tagDisplay.hiddenSlugs.length : 0)}개
                      </Badge>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(Array.isArray(tagDisplay?.hiddenSlugs) ? tagDisplay.hiddenSlugs : []).length === 0 ? (
                        <div className="text-xs text-gray-500">숨김 처리된 태그가 없습니다.</div>
                      ) : (
                        (tagDisplay.hiddenSlugs || []).map((slug) => {
                          const label = tagNameBySlug.get(String(slug || '').trim()) || String(slug || '').trim();
                          return (
                            <div key={String(slug)} className="flex items-center justify-between gap-3 rounded-md border border-gray-800 bg-gray-950/20 px-3 py-2">
                              <div className="min-w-0">
                                <div className="text-sm text-white truncate">{label}</div>
                                <div className="text-xs text-gray-500 truncate">{String(slug || '').trim()}</div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                  onClick={() => removeHiddenSlug(slug)}
                                  title="숨김 해제"
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <div className="mt-3 text-xs text-gray-500">
                      숨김은 “삭제”가 아닙니다. 캐릭터 탭/선택 모달에서만 안 보이게 합니다.
                    </div>
                  </div>
                </div>

                {/* 전체 태그 */}
                <div className="rounded-lg border border-gray-800 bg-gray-900/30 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">전체 태그</div>
                    {tagsLoading && <div className="text-xs text-gray-500">불러오는 중...</div>}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={tagListQuery}
                      onChange={(e) => setTagListQuery(e.target.value)}
                      className="bg-gray-900 border-gray-700 text-white"
                      placeholder="태그 검색 (이름/슬러그)"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                      onClick={() => setTagListQuery('')}
                    >
                      지우기
                    </Button>
                  </div>

                  <div className="max-h-80 overflow-auto rounded-lg border border-gray-800 bg-gray-950/20">
                    {(filteredTagsForManage || []).length === 0 ? (
                      <div className="p-3 text-sm text-gray-400">태그가 없습니다.</div>
                    ) : (
                      (filteredTagsForManage || []).map((t) => {
                        const slug = String(t?.slug || '').trim();
                        const name = String(t?.name || t?.slug || '').trim();
                        const isPriority = (tagDisplay?.prioritySlugs || []).includes(slug);
                        const isHidden = (tagDisplay?.hiddenSlugs || []).includes(slug);
                        const deleting = deletingTagId && String(deletingTagId) === String(t?.id);
                        return (
                          <div key={String(t?.id || slug)} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-800 last:border-b-0 hover:bg-gray-800/40">
                            <div className="min-w-0">
                              <div className="text-sm text-white truncate">{name || slug}</div>
                              <div className="text-xs text-gray-500 truncate">{slug}</div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Button
                                type="button"
                                variant="outline"
                                className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                onClick={() => (isPriority ? removePrioritySlug(slug) : addPrioritySlug(slug))}
                                title={isPriority ? '우선 노출 해제' : '우선 노출에 추가'}
                              >
                                {isPriority ? '상단해제' : '상단추가'}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-9 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                                onClick={() => (isHidden ? removeHiddenSlug(slug) : addHiddenSlug(slug))}
                                title={isHidden ? '숨김 해제' : '숨김 처리'}
                              >
                                {isHidden ? '숨김해제' : '숨김'}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-9 px-3 bg-red-900/40 border-red-800 text-red-100 hover:bg-red-900/60"
                                onClick={() => handleDeleteTag(t)}
                                disabled={!!deletingTagId || deleting}
                                title="삭제"
                              >
                                {deleting ? '삭제 중...' : '삭제'}
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="text-xs text-gray-500">
                    노출 순서/숨김 변경은 상단 “저장” 버튼을 눌러야 전 유저에게 반영됩니다.
                  </div>
                </div>

                {/* ✅ 태그 순서 편집 모달 (ISBN 입력 UX) */}
                <Dialog
                  open={tagOrderModalOpen}
                  onOpenChange={(v) => {
                    if (!v) setTagOrderModalOpen(false);
                  }}
                >
                  <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-3xl">
                    <DialogHeader>
                      <DialogTitle className="text-white">태그 순서 편집</DialogTitle>
                      <DialogDescription className="text-gray-400">
                        한 줄에 하나씩 입력하세요. 드래그로도 순서를 바꿀 수 있습니다. (오타/중복/없는 태그는 오류)
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                      {/* 모드 토글 */}
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className={`h-9 px-3 ${tagOrderMode === 'text' ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-700' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
                          onClick={() => setTagOrderMode('text')}
                        >
                          텍스트 편집
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className={`h-9 px-3 ${tagOrderMode === 'drag' ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-700' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
                          onClick={() => setTagOrderMode('drag')}
                        >
                          드래그 정렬
                        </Button>
                        <div className="text-xs text-gray-500 ml-2">
                          현재 노출 순서를 기반으로 편집합니다. (숨김 태그는 제외)
                        </div>
                      </div>

                      {tagOrderMode === 'text' ? (
                        <div className="space-y-2">
                          <Textarea
                            value={tagOrderText}
                            onChange={(e) => setTagOrderText(e.target.value)}
                            className="min-h-[320px] bg-gray-950/30 border-gray-700 text-white"
                            placeholder={'예)\n판타지\nSF\n던전'}
                          />
                          <div className="text-xs text-gray-500">
                            팁: 대소문자만 다른 입력(SF/sf)은 자동으로 정규화됩니다.
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-gray-800 bg-gray-950/20 p-2 max-h-[420px] overflow-auto">
                          {(() => {
                            const lines = _splitLines(tagOrderText);
                            const errByLine = new Map((tagOrderErrors || []).map((e) => [Number(e?.line || 0), e]));
                            if (!lines.length) {
                              return <div className="p-3 text-sm text-gray-400">표시할 태그가 없습니다. (텍스트 편집에서 입력하세요)</div>;
                            }

                            const moveLine = (fromIdx, toIdx) => {
                              try {
                                setTagOrderText((prev) => {
                                  const arr = _splitLines(prev);
                                  const f = Number(fromIdx);
                                  const t = Number(toIdx);
                                  if (!Number.isInteger(f) || !Number.isInteger(t)) return prev;
                                  if (f < 0 || t < 0 || f >= arr.length || t >= arr.length) return prev;
                                  const next = [...arr];
                                  const [it] = next.splice(f, 1);
                                  next.splice(t, 0, it);
                                  return next.join('\n');
                                });
                              } catch (_) {}
                            };

                            return lines.map((raw, idx) => {
                              const lineNo = idx + 1;
                              const err = errByLine.get(lineNo) || null;
                              const slug = _safeSlug(raw);
                              const label = tagNameBySlug.get(slug) || slug;
                              return (
                                <div
                                  key={`${lineNo}:${slug}`}
                                  className={`flex items-center gap-2 px-3 py-2 rounded-md border ${err ? 'border-red-700 bg-red-900/10' : 'border-gray-800 bg-gray-950/20'} mb-2 last:mb-0`}
                                  onDragOver={(e) => { try { e.preventDefault(); } catch (_) {} }}
                                  onDrop={(e) => {
                                    try { e.preventDefault(); } catch (_) {}
                                    const from = tagOrderDragFromRef.current;
                                    tagOrderDragFromRef.current = null;
                                    if (from === null || from === undefined) return;
                                    if (Number(from) === Number(idx)) return;
                                    moveLine(Number(from), Number(idx));
                                  }}
                                >
                                  <div
                                    className="flex items-center gap-2 cursor-grab active:cursor-grabbing text-gray-400"
                                    draggable
                                    onDragStart={() => { tagOrderDragFromRef.current = idx; }}
                                    onDragEnd={() => { tagOrderDragFromRef.current = null; }}
                                    title="드래그로 순서 변경"
                                  >
                                    <GripVertical className="w-4 h-4" />
                                    <span className="text-xs w-8 text-gray-500">{lineNo}</span>
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm text-white truncate">{label}</div>
                                    <div className="text-xs text-gray-500 truncate">{slug}</div>
                                    {err ? (
                                      <div className="text-xs text-red-300 mt-1">
                                        {err.message} ({err.value})
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      )}

                      {/* 오류 요약 */}
                      {(tagOrderErrors || []).length > 0 ? (
                        <div className="rounded-lg border border-red-900/60 bg-red-900/10 p-3 text-sm text-red-200">
                          <div className="font-semibold">유효성 오류</div>
                          <div className="mt-1 text-xs text-red-200/90">
                            {tagOrderErrors.slice(0, 6).map((e, i) => (
                              <div key={`${e.line}-${i}`}>
                                - {e.line}행: {e.message} ({e.value})
                              </div>
                            ))}
                            {tagOrderErrors.length > 6 ? (
                              <div className="mt-1 text-xs text-red-200/70">... 외 {tagOrderErrors.length - 6}개</div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                        onClick={() => setTagOrderModalOpen(false)}
                      >
                        취소
                      </Button>
                      <Button
                        type="button"
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                        onClick={applyTagOrderModal}
                      >
                        적용
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
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

          {/* 커스텀 구좌: 콘텐츠 선택 모달 */}
          <Dialog
            open={contentPickerOpen}
            onOpenChange={(v) => {
              if (!v) closeContentPicker();
            }}
          >
            {/* ✅ UX(필수): 검색 결과가 많아도 하단 버튼(취소/적용)이 항상 보이도록 모달 높이를 제한하고 본문만 스크롤 */}
            <DialogContent className="bg-gray-900 border-gray-800 text-white flex flex-col max-h-[90vh] overflow-hidden">
              <DialogHeader>
                <DialogTitle className="text-white">구좌 콘텐츠 선택</DialogTitle>
                <DialogDescription className="text-gray-400">
                  캐릭터/원작챗/웹소설을 다중 선택하고 “적용”을 누르세요.
                </DialogDescription>
              </DialogHeader>

              {/* 본문(스크롤 영역) */}
              <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
                {/* 검색/필터 */}
                <div className="rounded-lg border border-gray-800 bg-gray-950/30 p-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <div className="text-xs text-gray-400">타입</div>
                      <select
                        value={contentPickerType}
                        onChange={(e) => setContentPickerType(e.target.value)}
                        className="w-full h-10 rounded-md bg-gray-900 border border-gray-700 text-gray-100 px-3"
                      >
                        <option value="all">전체</option>
                        <option value="character">캐릭터</option>
                        <option value="origchat">원작챗</option>
                        <option value="webnovel">웹소설</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <div className="text-xs text-gray-400">검색어</div>
                      <div className="flex gap-2">
                        <Input
                          value={contentPickerQuery}
                          onChange={(e) => setContentPickerQuery(e.target.value)}
                          className="bg-gray-900 border-gray-700 text-white"
                          placeholder="이름/제목으로 검색"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              runContentSearch();
                            }
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                          onClick={runContentSearch}
                          disabled={contentSearching}
                        >
                          {contentSearching ? '검색 중...' : '검색'}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* 태그 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-white">태그</div>
                      {tagsLoading && <div className="text-xs text-gray-500">태그 불러오는 중...</div>}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {(contentPickerTags || []).length === 0 ? (
                        <div className="text-xs text-gray-500">선택하지 않아도 됩니다. (태그 없이도 검색 가능)</div>
                      ) : (
                        (contentPickerTags || []).map((slug) => {
                          const s = String(slug || '').trim();
                          const t = (Array.isArray(allTags) ? allTags : []).find((x) => String(x?.slug || '') === s);
                          const label = t?.name && t.name !== s ? `${s} · ${t.name}` : s;
                          return (
                            <Badge key={s} className="bg-gray-700 text-gray-100 hover:bg-gray-700 inline-flex items-center gap-2">
                              <span className="truncate max-w-[240px]">#{label}</span>
                              <button
                                type="button"
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-gray-800"
                                onClick={() => removeContentPickerTag(s)}
                                aria-label="태그 제거"
                                title="제거"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </Badge>
                          );
                        })
                      )}
                    </div>

                    <Input
                      value={contentPickerTagQuery}
                      onChange={(e) => setContentPickerTagQuery(e.target.value)}
                      className="bg-gray-900 border-gray-700 text-white"
                      placeholder="태그 검색/추가 (예: 로맨스, 판타지...)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          addContentPickerTag(contentPickerTagQuery);
                        }
                      }}
                    />

                    {(() => {
                      // ✅ UX: '#롤플'처럼 입력해도 추천이 뜨도록 '#'를 제거하고 매칭한다.
                      const q = String(contentPickerTagQuery || '').trim().toLowerCase().replace(/^#+/, '').trim();
                      if (!q) return null;
                      const taken = new Set((contentPickerTags || []).map((x) => String(x || '').trim()).filter(Boolean));
                      const list = (Array.isArray(allTags) ? allTags : [])
                        .filter((t) => {
                          const slug = String(t?.slug || '').toLowerCase();
                          const name = String(t?.name || '').toLowerCase();
                          if (!slug) return false;
                          if (taken.has(String(t?.slug || '').trim())) return false;
                          return slug.includes(q) || name.includes(q);
                        })
                        .slice(0, 12);
                      if (list.length === 0) return <div className="text-xs text-gray-500">추천 태그가 없습니다.</div>;
                      return (
                        <div className="max-h-32 overflow-auto rounded-md border border-gray-800 bg-gray-950/40">
                          {list.map((t) => {
                            const slug = String(t?.slug || '').trim();
                            const name = String(t?.name || '').trim();
                            return (
                              <button
                                key={slug}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800/70"
                                onClick={() => addContentPickerTag(slug)}
                              >
                                <span className="font-medium">#{slug}</span>
                                {name && name !== slug ? <span className="text-gray-400"> {' '}· {name}</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* 정렬 */}
                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-white">정렬 방식</div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-200">
                        <input
                          type="radio"
                          name="contentSortMode"
                          className="accent-purple-600"
                          checked={contentPickerSortMode === 'metric'}
                          onChange={() => setContentPickerSortMode('metric')}
                        />
                        대화수(조회수) 순
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-200">
                        <input
                          type="radio"
                          name="contentSortMode"
                          className="accent-purple-600"
                          checked={contentPickerSortMode === 'random'}
                          onChange={() => setContentPickerSortMode('random')}
                        />
                        랜덤(새로고침마다)
                      </label>
                    </div>
                  </div>
                </div>

                {/* 선택됨 */}
                <div className="rounded-lg border border-gray-800 bg-gray-950/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">선택됨</div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-gray-400">
                        {(contentSelectedKeys || []).length}/{MAX_CUSTOM_PICKS}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 px-3 bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                        onClick={clearContentPickerSelection}
                        disabled={(contentSelectedKeys || []).length === 0}
                      >
                        전체 해제
                      </Button>
                    </div>
                  </div>

                  {(contentSelectedKeys || []).length === 0 ? (
                    <div className="mt-2 text-sm text-gray-400">아직 선택된 콘텐츠가 없습니다.</div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(contentSelectedKeys || []).map((k) => {
                        const pick = contentSelectedByKey?.[k];
                        const type = String(pick?.type || '').trim().toLowerCase();
                        const label = type === 'story'
                          ? String(pick?.item?.title || '').trim()
                          : String(pick?.item?.name || '').trim();
                        const img = type === 'story'
                          ? String(pick?.item?.cover_url || '').trim()
                          : String(pick?.item?.avatar_url || pick?.item?.thumbnail_url || '').trim();
                        const badge = type === 'story' ? '웹소설' : (pick?.item?.origin_story_id ? '원작챗' : '캐릭터');
                        return (
                          <div
                            key={k}
                            className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900/40 px-2.5 py-1"
                            title={label || k}
                          >
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={img} alt={label || badge} />
                              <AvatarFallback className="bg-gray-800 text-gray-200 text-xs">
                                {(label || badge || 'C').charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <Badge className="bg-gray-700 text-gray-100 hover:bg-gray-700 text-[10px] px-2 py-0.5">
                              {badge}
                            </Badge>
                            <span className="text-xs text-gray-200 max-w-[220px] truncate">{label || k}</span>
                            <button
                              type="button"
                              className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
                              onClick={() => {
                                setContentSelectedByKey((prev) => {
                                  const next = { ...(prev || {}) };
                                  delete next[k];
                                  return next;
                                });
                                setContentSelectedKeys((prev) => (Array.isArray(prev) ? prev.filter((x) => String(x) !== String(k)) : []));
                              }}
                              aria-label="선택 제거"
                              title="제거"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 검색 결과 */}
                <div className="rounded-lg border border-gray-800 bg-gray-950/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">검색 결과</div>
                    <div className="text-xs text-gray-400">{(contentResults || []).length}개</div>
                  </div>

                  {(contentResults || []).length === 0 ? (
                    <div className="mt-2 text-sm text-gray-400">
                      검색어/태그를 입력하고 “검색”을 눌러주세요.
                    </div>
                  ) : (
                    <div className="mt-3 max-h-[360px] overflow-auto divide-y divide-gray-900">
                      {(contentResults || []).map((r) => {
                        const key = String(r?.key || '').trim();
                        const selected = !!contentSelectedByKey?.[key];
                        const type = String(r?.type || '').trim().toLowerCase();
                        const label = type === 'story'
                          ? String(r?.item?.title || '').trim()
                          : String(r?.item?.name || '').trim();
                        const img = type === 'story'
                          ? String(r?.item?.cover_url || '').trim()
                          : String(r?.item?.avatar_url || r?.item?.thumbnail_url || '').trim();
                        const badge = type === 'story' ? '웹소설' : (r?.item?.origin_story_id ? '원작챗' : '캐릭터');
                        const metric = type === 'story'
                          ? `조회수 ${Number(r?.item?.view_count || 0).toLocaleString()}`
                          : `대화수 ${Number(r?.item?.chat_count || 0).toLocaleString()}`;

                        return (
                          <div key={key} className="py-2 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <input
                                type="checkbox"
                                className="accent-purple-600"
                                checked={selected}
                                onChange={() => toggleContentPick(r)}
                              />
                              <Avatar className="h-9 w-9 flex-shrink-0">
                                <AvatarImage src={img} alt={label || badge} />
                                <AvatarFallback className="bg-gray-800 text-gray-200 text-xs">
                                  {(label || badge || 'C').charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="text-sm text-gray-100 truncate" title={label || key}>
                                  {label || key}
                                </div>
                                <div className="text-xs text-gray-500 truncate">{metric}</div>
                              </div>
                            </div>
                            <Badge className={`${selected ? 'bg-purple-700' : 'bg-gray-700'} text-white hover:${selected ? 'bg-purple-700' : 'bg-gray-700'}`}>
                              {badge}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* ✅ 하단 버튼 영역(항상 보이도록 고정) */}
              <DialogFooter className="border-t border-gray-800 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                  onClick={closeContentPicker}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={applyContentPickerToSlot}
                  disabled={!contentPickerSlotId}
                >
                  적용
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </AppLayout>
  );
};

export default CMSPage;






