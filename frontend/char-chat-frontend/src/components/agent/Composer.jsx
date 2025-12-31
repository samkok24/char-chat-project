import { useState, useRef } from "react";
import { Upload, X, Camera, Send, Loader2, Check, Type, Filter } from "lucide-react";
import { mediaAPI } from "../../lib/api";

export default function Composer({ onSend, disabled = false, hasMessages = false }) {
  const [staged, setStaged] = useState([]);
  const [showStaging, setShowStaging] = useState(true); // 스테이징 UI 표시 여부
  const [showImageTray, setShowImageTray] = useState(false);
  const [showModePicker, setShowModePicker] = useState(false); // 모드/태그 선택 트레이
  const [showEmojiPicker, setShowEmojiPicker] = useState(false); // 이모지 트레이
  const [showTextInput, setShowTextInput] = useState(true); // ✅ false → true
  const [textInput, setTextInput] = useState(""); // 텍스트 상태 유지
  const [storyMode, setStoryMode] = useState("auto"); // 'snap' | 'genre' | 'auto'
  const textInputRef = useRef(null);

  // --- helpers
  const addItem = (item) => {
    // 태그는 최대 2개까지만
    if (item.type === 'tag') {
      const tagCount = staged.filter(s => s.type === 'tag').length;
      if (tagCount >= 2) {
        // 토스트 표시
        try {
          window.dispatchEvent(new CustomEvent('toast', { 
            detail: { type: 'warning', message: '태그는 최대 2개까지만 선택 가능합니다.' } 
          }));
        } catch {}
        return;
      }
    }
    setStaged((s) => [...s, item]);
    setShowStaging(true); // 아이템 추가 시 스테이징 UI 표시
  };
  
  const removeItem = (id) => setStaged((s) => s.filter((i) => i.id !== id));
  
  // 모드 변경 시 모드 배지 업데이트 또는 생성
  const updateMode = (newMode) => {
    setStoryMode(newMode);
    
    // staged에 mode 배지가 있으면 업데이트, 없으면 추가
    const hasModeItem = staged.some(item => item.type === 'mode');
    
    if (hasModeItem) {
      // 기존 모드 배지 업데이트
      setStaged(s => s.map(item => 
        item.type === 'mode' ? { ...item, value: newMode } : item
      ));
    } else {
      // 모드 배지 생성 (맨 앞에 추가)
      setStaged(s => [
        { id: crypto.randomUUID(), type: 'mode', value: newMode },
        ...s
      ]);
    }
    
    // 모드 변경 시 스테이징 UI 표시
    setShowStaging(true);
  };

  const handleSend = async () => {
    // 모드 배지 자동 추가 (항상 맨 처음)
    if (!staged.some(s => s.type === 'mode')) {
      staged.unshift({ 
        id: crypto.randomUUID(), 
        type: "mode", 
        value: storyMode 
      });
    }
    // 텍스트 입력이 있으면 staged에 추가
    if (textInput.trim() && !staged.some(item => item.type === 'text' && item.body === textInput.trim())) {
      const textItem = {
        id: crypto.randomUUID(),
        type: 'text',
        body: textInput.trim()
      };
      staged.push(textItem);
    }
    
    if (!staged.length || disabled) return;
  
    // mode와 tag 타입 제거 후 백엔드 전송 (UI용이므로)
    const cleanStaged = staged.filter(item => item.type !== 'mode' && item.type !== 'tag');
    
    
    // 백엔드로 보낼 페이로드 구성
    const payload = { 
      mode: "micro", 
      staged: cleanStaged,
      storyMode, // 'snap' | 'genre' | 'auto'
      meta: { 
        from_agent_tab: true,
        device_ts: Date.now()
      }
    };
    
    // 전송 시작하면 즉시 초기화 (결과를 기다리지 않음)
    setStaged([]); // 즉시 스테이지 초기화
    setTextInput(""); // 텍스트도 초기화
    setShowTextInput(false); // 텍스트 입력창 닫기
    setShowModePicker(false); // 모드 트레이 닫기 추가!
    setShowEmojiPicker(false); // 이모지 트레이도 닫기 추가!
    setShowImageTray(false); // 이미지 트레이도 닫기 추가!
    
    // 부모 컴포넌트로 전달 (await 제거하여 비동기로 처리)
    if (onSend) onSend(payload);
  };

  // 텍스트 입력 토글
  const toggleTextInput = () => {
    setShowTextInput(!showTextInput);
    // 이미지 트레이만 닫기
    if (!showTextInput) {
      setShowImageTray(false);
      // 포커스 주기
      setTimeout(() => textInputRef.current?.focus(), 100);
    }
  };

  const imageCount = staged.filter(it => it.type === 'image').length;

  return (
    <div className="w-full">
      {/* 안내 문구 - 메시지 없을 때만 표시 */}
      {!hasMessages && (
        <div className="mb-4 text-center select-none">
          <div className="text-sm sm:text-base text-purple-300 font-medium drop-shadow-[0_0_12px_rgba(168,85,247,0.65)]">
            좋아하는 순간을 찍은 사진이나, 생성한 이미지를 올려보세요. 바로 거기서부터 모든 스토리가 시작됩니다.
          </div>
          <div className="mt-1 text-[11px] sm:text-xs text-gray-400">
            이모지와 텍스트를 추가하면 스토리가 더 풍부해져요.
          </div>
        </div>
      )}
      
      {/* Stage bar - 선택된 아이템 표시 */}
      <div className={`mb-3 relative flex flex-wrap items-center gap-2 rounded-2xl bg-gray-900/60 border border-purple-500/20 p-2 ${staged.length === 0 ? 'min-h-[56px] opacity-0' : ''}`}>
          {staged.length > 0 && showStaging && (
            <>
          {/* 우상단 닫기 버튼 */}
          <button
            onClick={() => setShowStaging(false)}
            className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 z-10"
            aria-label="스테이징 숨기기"
          >
            <X size={12} />
          </button>
          {/* 모드 배지는 항상 맨 앞에 표시 */}
          {(() => {
            const modeItem = staged.find(it => it.type === 'mode');
            const otherItems = staged.filter(it => it.type !== 'mode').sort((a, b) => {
              // 정렬: tag → image → text → emoji
              const order = { tag: 0, image: 1, text: 2, emoji: 3 };
              return (order[a.type] || 99) - (order[b.type] || 99);
            });
            const sortedStaged = modeItem ? [modeItem, ...otherItems] : otherItems;
            
            return sortedStaged.map((it) => (
            <div key={it.id} className="relative shrink-0">
              {it.type === "mode" ? (
                // 모드 배지 (삭제 불가, 클릭하면 트레이 열림)
                <button
                  onClick={() => setShowModePicker(true)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                    it.value === 'auto' ? 'bg-gray-600 text-white' :
                    it.value === 'snap' ? 'bg-blue-600 text-white' :
                    'bg-purple-600 text-white'
                  }`}
                >
                  {it.value === 'auto' ? '자동' : it.value === 'snap' ? '일상' : '장르'}
                </button>
              ) : it.type === "tag" ? (
                // 선택 태그 (삭제 가능)
                <div className="relative">
                  <div className="px-2 py-1 rounded-full text-xs bg-gray-800/50 text-gray-300 border border-purple-500/20">
                    #{it.value}
                  </div>
                  <button
                    onClick={() => removeItem(it.id)}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white hover:bg-red-600"
                  >
                    <X size={10} />
                  </button>
                </div>
              ) : it.type === "image" ? (
                <div className="relative">
                  <img
                    src={it.url}
                    alt=""
                    className="h-10 w-10 rounded-lg object-cover"
                  />
                  {it.caption && (
                    <div className="absolute -bottom-1 left-0 right-0 truncate rounded-b-lg bg-black/70 px-1 text-[10px] text-white">
                      {it.caption}
                    </div>
                  )}
                  <button
                    onClick={() => removeItem(it.id)}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white hover:bg-red-600"
                  >
                    <X size={10} />
                  </button>
                </div>
              ) : it.type === "emoji" ? (
                <div className="relative">
                  <div className="rounded-lg bg-gray-800 px-2 py-1 text-xl">
                    {it.items.join("")}
                  </div>
                  <button
                    onClick={() => removeItem(it.id)}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white hover:bg-red-600"
                  >
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <div className="max-w-[150px] truncate rounded-lg bg-gray-800 px-2 py-1 text-sm text-gray-200">
                    {it.body}
                  </div>
                  <button
                    onClick={() => removeItem(it.id)}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white hover:bg-red-600"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
            </div>
            ));
          })()}
            </>
          )}
      </div>

      {/* Action row - 4개 버튼 타원형 컨테이너 (텍스트 입력 시 확장) */}
      <div className="flex items-center justify-center -mt-2 h-[64px]">
        <div className={`relative inline-flex items-center gap-4 px-6 py-3 rounded-full bg-gray-900/95 border border-purple-500/30 shadow-[0_0_25px_rgba(168,85,247,0.35)] hover:shadow-[0_0_35px_rgba(168,85,247,0.45)] transition-all duration-300 z-20 ${showTextInput ? 'w-[600px]' : ''}`}>
          
          {/* 이미지 버튼 */}
          <div className="relative">
            <button
              onClick={() => { setShowEmojiPicker(false); setShowModePicker(false); setShowImageTray(v => !v); }}
              disabled={disabled}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-800/80 text-white hover:bg-gray-700 hover:scale-110 transition-all disabled:opacity-50"
              aria-label="이미지 추가"
            >
              <Camera size={20} />
            </button>
            {imageCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center shadow-md">
                {imageCount > 9 ? '9+' : imageCount}
              </span>
            )}
            {showImageTray && (
              <ImageTray
                onClose={() => setShowImageTray(false)}
                onInsert={(url, caption, style) => {
                  // 모드 배지 자동 추가 (처음에만)
                  if (!staged.some(s => s.type === 'mode')) {
                    addItem({ 
                      id: crypto.randomUUID(), 
                      type: "mode", 
                      value: storyMode 
                    });
                  }
                  addItem({ 
                    id: crypto.randomUUID(), 
                    type: "image", 
                    url, 
                    caption: caption || '',
                    style: style || 'anime'
                  });
                  setShowImageTray(false);
                }}
              />
            )}
          </div>

          {/* 텍스트 버튼 */}
          <div className="relative">
            <button
              onClick={toggleTextInput}
              disabled={disabled}
              className={`flex h-12 w-12 items-center justify-center rounded-full transition-all disabled:opacity-50 ${
                showTextInput 
                  ? 'bg-purple-600 text-white scale-110' 
                  : 'bg-gray-800/80 text-white hover:bg-gray-700 hover:scale-110'
              }`}
              aria-label="텍스트 입력"
            >
              <span className="font-bold text-lg">Aa</span>
            </button>
          </div>

          {/* 텍스트 입력 필드 - 버튼 옆에서 확장 */}
          {showTextInput && (
            <>
              <input
                ref={textInputRef}
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="스토리 아이디어를 입력하세요..."
                className="flex-1 h-10 px-4 bg-gray-800/60 rounded-full text-white placeholder-gray-400 outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                disabled={disabled}
              />
              
              {/* 이모지 버튼 - 텍스트 입력창 우측에 고정 */}
              <div className="relative">
                <button
                  onClick={() => { setShowModePicker(false); setShowEmojiPicker((v) => !v); }}
                  disabled={disabled}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-800/80 text-lg hover:bg-gray-700 hover:scale-110 transition-all disabled:opacity-50"
                  aria-label="이모지"
                >
                  😊
                </button>
                {showEmojiPicker && (
                  <EmojiPicker
                    onClose={() => setShowEmojiPicker(false)}
                    onSelect={(emoji) => {
                      setTextInput(prev => prev + emoji);
                      textInputRef.current?.focus();
                    }}
                  />
                )}
              </div>
            </>
          )}

          {/* 모드/태그 선택 버튼 (깔대기 아이콘) - 전송 버튼 바로 왼쪽 */}
          <div className="relative">
            <button
              onClick={() => { setShowImageTray(false); setShowEmojiPicker(false); setShowModePicker(v => !v); }}
              disabled={disabled}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-800/80 text-white hover:bg-gray-700 hover:scale-110 transition-all disabled:opacity-50"
              aria-label="모드/태그 선택"
            >
              <Filter size={20} />
            </button>
            {showModePicker && (
              <ModePicker
                onClose={() => setShowModePicker(false)}
                onModeChange={(mode) => updateMode(mode)}
                onTagSelect={(tag) => {
                  addItem({ 
                    id: crypto.randomUUID(), 
                    type: "tag", 
                    value: tag 
                  });
                }}
                currentMode={storyMode}
              />
            )}
          </div>

          {/* 전송 버튼 */}
          <button
            disabled={(!staged.length && !textInput.trim()) || disabled}
            onClick={handleSend}
            className={`relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-700 hover:to-purple-600 hover:scale-110 transition-all disabled:opacity-40 shadow-[0_0_15px_rgba(168,85,247,0.5)] ${showTextInput ? '-mr-2' : ''}`}
            aria-label="전송"
          >
            {/* 모드 인디케이터 */}
            {storyMode !== 'auto' && (
              <span className="absolute -top-1 -left-1 text-xs">
                {storyMode === 'snap' ? '🌟' : '🔮'}
              </span>
            )}
            <Send size={20} />
          </button>
        </div>
      </div>

      {/* 이미지 트레이 */}
      {/* 이모지 트레이 컴포넌트 아래에 정의 */}
    </div>
  );
}

// 모드/태그 선택 트레이
function ModePicker({ onClose, onModeChange, onTagSelect, currentMode = 'auto' }) {
  const [mode, setMode] = useState(currentMode); // 'snap' | 'genre' | 'auto'
  
  // 자동: 태그 없음
  // 일상: 일상 태그
  // 장르: 장르 태그
  const snapTags = ['위트있게', '빵터지게', '밈스럽게', '따뜻하게', '힐링이되게', '잔잔하게', '여운있게'];
  const genreTags = ['남성향판타지', '로맨스', '로코', '성장물', '미스터리', '추리', '스릴러', '호러', '느와르'];
  
  const handleModeChange = (newMode) => {
    setMode(newMode);
    if (onModeChange) onModeChange(newMode);
  };
  
  const handleTagClick = (tag) => {
    if (onTagSelect) onTagSelect(tag);
  };
  
  return (
    <>
      {/* 오버레이 배경 (클릭 시 닫기) */}
      <div 
        className="fixed inset-0 z-40" 
        onClick={onClose}
      />
      
      {/* 트레이 */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 w-72 rounded-xl bg-gray-900/95 border border-purple-500/20 p-3 shadow-[0_0_20px_rgba(0,0,0,0.5)]">
      {/* 모드 선택 탭 */}
      <div className="flex items-center gap-1 mb-3 p-1 bg-gray-800/50 rounded-lg">
        <button
          onClick={() => handleModeChange('auto')}
          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
            mode === 'auto' 
              ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-md' 
              : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          <span>자동</span>
        </button>
        <button
          onClick={() => handleModeChange('snap')}
          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
            mode === 'snap' 
              ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-md' 
              : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          <span>일상</span>
        </button>
        <button
          onClick={() => handleModeChange('genre')}
          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
            mode === 'genre' 
              ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-md' 
              : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          <span>장르</span>
        </button>
      </div>
      
      {/* 자동 모드: 태그 없음 */}
      {mode === 'auto' && (
        <div className="text-center py-8 text-gray-400 text-sm">
          AI가 자동으로 스토리 모드를 선택합니다
        </div>
      )}
      
      {/* 일상 모드: 일상 태그 표시 (클릭 시 스테이징 추가) */}
      {mode === 'snap' && (
        <div className="flex flex-wrap gap-2">
          {snapTags.map((tag) => (
            <button
              key={tag}
              onClick={() => handleTagClick(tag)}
              className="px-3 py-1.5 rounded-full text-sm bg-gray-800/50 text-gray-300 hover:bg-purple-600/20 hover:text-purple-300 transition-all border border-purple-500/20"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
      
      {/* 장르 모드: 장르 태그 표시 (클릭 시 스테이징 추가) */}
      {mode === 'genre' && (
        <div className="flex flex-wrap gap-2">
          {genreTags.map((tag) => (
            <button
              key={tag}
              onClick={() => handleTagClick(tag)}
              className="px-3 py-1.5 rounded-full text-sm bg-gray-800/50 text-gray-300 hover:bg-purple-600/20 hover:text-purple-300 transition-all border border-purple-500/20"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
      
      <div className="mt-3 flex justify-end gap-2">
        <button 
          onClick={onClose} 
          className="rounded-lg px-3 py-1 text-gray-400 hover:text-white transition-colors"
        >
          취소
        </button>
        <button
          onClick={() => { handleModeChange(mode); onClose(); }}
          className="rounded-lg bg-gradient-to-r from-purple-600 to-purple-500 px-3 py-1 text-white hover:from-purple-700 hover:to-purple-600 transition-all"
        >
          확인
        </button>
      </div>
      </div>
    </>
  );
}

// 이모지 선택 트레이
function EmojiPicker({ onClose, onSelect }) {
  const emojis = ['😊', '😂', '😍', '🥺', '😭', '😎', '🤔', '😳', '🔥', '✨', '💕', '👍', '🎉', '🌟', '💯', '🙏', '😤', '🥰', '😱', '🤗', '😔', '😌', '🤩', '😏'];
  
  return (
    <div className="absolute bottom-14 right-0 z-50 w-64 rounded-xl bg-gray-900/95 border border-purple-500/20 p-3 shadow-[0_0_20px_rgba(0,0,0,0.5)]">
      <div className="grid grid-cols-6 gap-2">
        {emojis.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSelect(emoji)}
            className="rounded-lg p-2 text-xl hover:bg-gray-800/50 hover:scale-110 transition-all"
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        <button 
          onClick={onClose} 
          className="rounded-lg px-3 py-1 text-sm text-gray-400 hover:text-white transition-colors"
        >
          닫기
        </button>
      </div>
    </div>
  );
}

// 이미지 트레이 컴포넌트 (생성 + 업로드 + 갤러리)
function ImageTray({ onInsert, onClose }) {
  const [style, setStyle] = useState("anime");
  const [genCount, setGenCount] = useState(1);
  const [genPrompt, setGenPrompt] = useState("");
  const [gallery, setGallery] = useState([]); // 생성/업로드된 이미지들
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [etaMs, setEtaMs] = useState(0);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const etaTimerRef = useRef(null);

  // ETA 타이머
  const startEta = (count) => {
    const total = 50000 * Math.max(1, count); // 50초 * 개수
    setEtaMs(total);
    if (etaTimerRef.current) clearInterval(etaTimerRef.current);
    etaTimerRef.current = setInterval(() => {
      setEtaMs((prev) => {
        const next = Math.max(0, prev - 1000);
        if (next === 0) {
          clearInterval(etaTimerRef.current);
          etaTimerRef.current = null;
        }
        return next;
      });
    }, 1000);
  };

  const clearEta = () => {
    if (etaTimerRef.current) {
      clearInterval(etaTimerRef.current);
      etaTimerRef.current = null;
    }
    setEtaMs(0);
  };

  // 이미지 생성
  const handleGenerate = async () => {
    if (!genPrompt.trim()) return;
    
    setBusy(true);
    startEta(genCount);
    
    // 스타일별 프롬프트 보강
    let styleHint = "";
    if (style === 'anime') styleHint = ", anime style, cel shaded, vibrant colors";
    else if (style === 'photo') styleHint = ", photorealistic, high quality photography";
    else if (style === 'semi') styleHint = ", semi-realistic, digital art, detailed";
    
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      
      const res = await mediaAPI.generate({
        provider: 'gemini',
        model: 'gemini-2.5-flash-image',
        ratio: '3:4',
        count: genCount,
        prompt: genPrompt + styleHint + ", 3:4 aspect ratio, vertical composition"
      }, { signal: controller.signal });
      
      const items = res.data?.items || [];
      if (items.length > 0) {
        setGallery(prev => [...prev, ...items]);
        // 생성된 이미지 자동 선택
        const newIds = new Set(selectedIds);
        items.forEach(item => newIds.add(item.id));
        setSelectedIds(newIds);
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('Generation failed:', e);
      }
    } finally {
      setBusy(false);
      clearEta();
      abortRef.current = null;
    }
  };

  // 파일 업로드
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    
    setBusy(true);
    try {
      const res = await mediaAPI.upload(files.filter(f => f.size <= 8 * 1024 * 1024));
      const items = res.data?.items || [];
      if (items.length > 0) {
        setGallery(prev => [...prev, ...items]);
        // 업로드된 이미지 자동 선택
        const newIds = new Set(selectedIds);
        items.forEach(item => newIds.add(item.id));
        setSelectedIds(newIds);
      }
    } catch (e) {
      console.error('Upload failed:', e);
    } finally {
      setBusy(false);
    }
  };

  // 선택된 이미지 삽입
  const handleInsertSelected = () => {
    const selected = gallery.filter(g => selectedIds.has(g.id));
    if (selected.length === 0) return;
    
    selected.forEach(img => {
      onInsert(img.url, "", style);
    });
    onClose();
  };

  // 이미지 선택 토글
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteImage = (e, id) => {
    e.stopPropagation(); // 선택 토글 방지
    setGallery(prev => prev.filter(g => g.id !== id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };


  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 w-[420px] max-h-[480px] rounded-xl bg-gray-900/98 border border-purple-500/25 shadow-[0_0_30px_rgba(139,92,246,0.25)] overflow-hidden flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/60">
        <h3 className="text-white text-sm font-medium">이미지 추가</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-0.5">
          <X size={16} />
        </button>
      </div>

      {/* 업로드 섹션 - 가장 먼저 */}
      <div className="px-4 py-2 border-b border-gray-800/60">
        <label className="block">
          <div className="px-3 py-2 border border-dashed border-gray-700 rounded-lg text-gray-400 text-sm hover:border-purple-500/40 hover:text-gray-300 transition-colors cursor-pointer text-center">
            <Upload size={16} className="inline mr-1.5" />
            이미지 업로드 (클릭 또는 드래그)
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </label>
      </div>

      {/* 스타일 선택 */}
      <div className="px-4 py-2 flex gap-1.5 border-b border-gray-800/60">
        {[
          { key: 'anime', label: '애니메이션' },
          { key: 'photo', label: '실사' },
          { key: 'semi', label: '반실사' }
        ].map(s => (
          <button
            key={s.key}
            onClick={() => setStyle(s.key)}
            className={`px-3 py-1 rounded-full text-xs transition-all ${
              style === s.key 
                ? 'bg-purple-600/80 text-white shadow-[0_0_8px_rgba(139,92,246,0.4)]' 
                : 'bg-gray-800/60 text-gray-400 hover:bg-gray-700/60'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 생성 섹션 */}
      <div className="px-4 py-3 space-y-2 border-b border-gray-800/60">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="생성할 이미지 설명..."
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            disabled={busy}
            className="flex-1 px-3 py-1.5 bg-gray-800/60 rounded-lg text-white text-sm placeholder-gray-500 outline-none focus:ring-1 focus:ring-purple-500/40"
          />
          <select
            value={genCount}
            onChange={(e) => setGenCount(Number(e.target.value))}
            disabled={busy}
            className="px-2 py-1.5 bg-gray-800/60 rounded-lg text-white text-sm outline-none focus:ring-1 focus:ring-purple-500/40"
          >
            {[1,2,3,4].map(n => (
              <option key={n} value={n}>{n}개</option>
            ))}
          </select>
          <button
            onClick={handleGenerate}
            disabled={busy || !genPrompt.trim()}
            className="px-3 py-1.5 bg-purple-600 rounded-lg text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-40 transition-colors"
          >
            생성
          </button>
        </div>
        
        {/* 진행 상태 */}
        {busy && etaMs > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>생성 중...</span>
              <span>{Math.ceil(etaMs / 1000)}초</span>
            </div>
            <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-purple-600 to-purple-500 transition-all duration-1000"
                style={{ width: `${100 - (etaMs / (50000 * genCount)) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 갤러리 */}
      <div className="flex-1 overflow-y-auto p-4">
        {gallery.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-12">
            생성하거나 업로드한 이미지가<br/>여기에 표시됩니다
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {gallery.map((img) => (
              <button
                key={img.id}
                onClick={() => toggleSelect(img.id)}
                className={`relative group rounded-lg overflow-hidden border-2 transition-all ${
                  selectedIds.has(img.id) 
                    ? 'border-purple-500 shadow-[0_0_8px_rgba(139,92,246,0.3)]' 
                    : 'border-transparent hover:border-gray-700'
                }`}
              >
                <img 
                  src={img.url} 
                  alt="" 
                  className="w-full h-24 object-cover"
                />
                {/* 삭제 버튼 추가 */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleDeleteImage(e, img.id)}   // handleDeleteImage 내부에 e.stopPropagation() 이미 있음
                  onKeyDown={(e) => { if (e.key === 'Enter') handleDeleteImage(e, img.id); }}
                  className="absolute top-1 left-1 w-5 h-5 bg-red-500/90 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10 cursor-pointer"
                  aria-label="삭제"
                >
                  <X size={12} className="text-white" />
                </div>
                
                {selectedIds.has(img.id) && (
                  <div className="absolute inset-0 bg-purple-600/20">
                    <div className="absolute top-1 right-1 w-5 h-5 bg-purple-600 rounded-full flex items-center justify-center">
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 하단 액션 */}
      <div className="px-4 py-2.5 border-t border-gray-800/60 flex justify-between items-center">
        <span className="text-xs text-gray-400">
          {selectedIds.size > 0 ? `${selectedIds.size}개 선택` : '이미지를 선택하세요'}
        </span>
        <button
          onClick={handleInsertSelected}
          disabled={selectedIds.size === 0}
          className="px-4 py-1.5 bg-purple-600 rounded-lg text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-40 transition-colors"
        >
          삽입
        </button>
      </div>
    </div>
  );
}

