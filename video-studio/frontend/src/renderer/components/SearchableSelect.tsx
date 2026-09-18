import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  subLabel?: string;
  badge?: string;
  badgeColor?: string;
  dotColor?: string;
  icon?: React.ReactNode;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder: string;
  allLabel?: string;
  searchPlaceholder?: string;
  icon?: React.ReactNode;
  allowSearch?: boolean;
  className?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  allLabel = 'Tất cả',
  searchPlaceholder = 'Tìm kiếm...',
  icon,
  allowSearch = true,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen && allowSearch) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchTerm('');
    }
  }, [isOpen, allowSearch]);

  // Handle ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Filter options
  const filteredOptions = options.filter((opt) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      opt.label.toLowerCase().includes(term) ||
      (opt.subLabel && opt.subLabel.toLowerCase().includes(term)) ||
      (opt.badge && opt.badge.toLowerCase().includes(term))
    );
  });

  // Selected item
  const selectedOption = options.find((opt) => String(opt.value) === String(value));
  const isSelected = Boolean(value);

  return (
    <div ref={containerRef} className={`relative inline-block text-xs ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all select-none ${
          isOpen
            ? 'bg-[#1a1f2e] border-indigo-500 shadow-sm shadow-indigo-500/20 text-slate-100'
            : isSelected
            ? 'bg-[#181d2a] border-indigo-500/60 text-indigo-300 font-medium'
            : 'bg-[#151822] hover:bg-[#191d29] border-slate-700/60 hover:border-slate-600 text-slate-300'
        }`}
      >
        {icon && <span className="text-slate-400 shrink-0">{icon}</span>}
        
        {selectedOption?.dotColor && (
          <span className={`w-2 h-2 rounded-full shrink-0 ${selectedOption.dotColor}`} />
        )}

        <span className="truncate max-w-[160px] text-left">
          {selectedOption ? selectedOption.label : placeholder}
        </span>

        {selectedOption?.badge && (
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
              selectedOption.badgeColor || 'bg-slate-700/60 text-slate-300'
            }`}
          >
            {selectedOption.badge}
          </span>
        )}

        {isSelected && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            title="Xóa lựa chọn"
            className="ml-0.5 p-0.5 rounded hover:bg-slate-700/70 text-slate-400 hover:text-slate-200 transition"
          >
            <X size={12} />
          </span>
        )}

        <ChevronDown
          size={14}
          className={`ml-auto text-slate-400 transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180 text-indigo-400' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-64 max-w-[90vw] bg-[#161a24] border border-slate-700/80 rounded-xl shadow-2xl shadow-black/80 z-50 overflow-hidden flex flex-col backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
          {/* Search box inside dropdown */}
          {allowSearch && (
            <div className="p-2 border-b border-slate-800/80 bg-[#12151e]">
              <div className="relative flex items-center">
                <Search size={13} className="absolute left-2.5 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full bg-[#1b202d] text-slate-200 placeholder-slate-500 text-xs pl-8 pr-7 py-1.5 rounded-lg border border-slate-700/50 focus:outline-none focus:border-indigo-500 transition"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 text-slate-400 hover:text-slate-200"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Options list */}
          <div className="max-h-60 overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
            {/* "Tất cả" option */}
            {allLabel && !searchTerm && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left ${
                  !value
                    ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate">{allLabel}</span>
                </div>
                {!value && <Check size={14} className="text-indigo-400 shrink-0" />}
              </button>
            )}

            {filteredOptions.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-500">
                Không tìm thấy kết quả
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const active = String(opt.value) === String(value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left group ${
                      active
                        ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      {opt.dotColor && (
                        <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dotColor}`} />
                      )}
                      {opt.icon && <span className="text-slate-400 shrink-0">{opt.icon}</span>}
                      <div className="truncate flex flex-col">
                        <span className="truncate">{opt.label}</span>
                        {opt.subLabel && (
                          <span className="text-[10px] text-slate-500 group-hover:text-slate-400 truncate">
                            {opt.subLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {opt.badge && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                            opt.badgeColor || 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {opt.badge}
                        </span>
                      )}
                      {active && <Check size={14} className="text-indigo-400" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
