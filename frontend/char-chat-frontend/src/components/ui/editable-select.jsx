import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function EditableSelect({ value, onChange, options = [], placeholder = '', className = '', inputClassName = '', dropClassName = '', onEnter }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const [query, setQuery] = useState('');
  const [filterText, setFilterText] = useState('');

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    function onDocClick(e) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = (filterText || '').toLowerCase();
    if (!open || !q) return options;
    return options.filter(o => (o || '').toLowerCase().includes(q));
  }, [options, open, filterText]);

  return (
    <div ref={containerRef} className={`relative inline-flex items-center rounded-md px-1 py-0.5 hover:bg-gray-800/30 focus-within:bg-gray-800/40 transition-colors ${className}`}>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setFilterText(e.target.value); onChange?.(e.target.value); }}
        placeholder={placeholder}
        className={`h-7 px-2 pr-8 bg-transparent text-gray-200 placeholder-gray-500 outline-none border-0 focus:ring-0 ${inputClassName}`}
        onFocus={() => { /* keep as is */ }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            setOpen(false);
            onEnter?.();
            return;
          }
          if (e.key === 'ArrowDown') { setOpen(true); }
        }}
      />
      <button
        type="button"
        aria-label="열기"
        aria-expanded={open}
        className="absolute right-0.5 inline-flex items-center justify-center size-6 rounded-full border border-gray-700/70 bg-gray-900/60 text-gray-300 shadow-sm hover:text-white hover:bg-gray-800/70 hover:border-gray-600 transition-colors"
        onClick={() => { setOpen((v) => !v); setFilterText(''); }}
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className={`absolute left-0 top-[calc(100%+4px)] z-50 min-w-[8rem] max-h-56 overflow-auto rounded-md border border-gray-800 bg-gray-900/95 text-gray-200 shadow-xl backdrop-blur-sm ${dropClassName}`}>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">결과 없음</div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                className="w-full text-center px-3 py-1.5 text-sm hover:bg-gray-800/80"
                onClick={() => { onChange?.(opt); setQuery(opt); setOpen(false); }}
              >{opt}</button>
            ))
          )}
        </div>
      )}
    </div>
  );
}


