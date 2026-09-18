import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Copy,
  Star,
  Check,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  Subtitles,
  EyeOff,
  BookOpen,
  Search,
  FolderPlus,
  Folder,
  Layers,
  CheckCircle2,
  Save,
  Play,
  Square,
  RefreshCw,
  ShoppingBag,
  MessageSquare,
  Film,
  Bot,
  Zap,
  Heart,
  Target,
  ChevronRight,
  ExternalLink,
  Info,
  Sliders,
  CheckSquare,
  X,
  Smartphone,
  Mic,
  Type,
  Database,
} from 'lucide-react';
import { localizeApi, settingsApi, libraryApi, LocalizePreset } from '../../api/client';
import { LocalizeSettings, DEFAULT_LOCALIZE_SETTINGS, AI_STYLES } from './types';

export default function LocalizePresetsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [presets, setPresets] = useState<LocalizePreset[]>([]);
  const [grouped, setGrouped] = useState<Record<string, LocalizePreset[]>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Active preset being edited
  const [editingPreset, setEditingPreset] = useState<LocalizePreset | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('TikTok Shop Affiliate');
  const [formDescription, setFormDescription] = useState('');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [formSettings, setFormSettings] = useState<LocalizeSettings>(DEFAULT_LOCALIZE_SETTINGS);

  // Subtitle custom text preview
  const [previewSubText, setPreviewSubText] = useState('Ốp lưng gấu Miffy siêu xinh xắn!');

  // Active config tab
  const [activeTab, setActiveTab] = useState<'prompt' | 'voice' | 'audio' | 'ocr' | 'sub' | 'dict' | 'all'>('all');

  // Voices list for selector
  const [voices, setVoices] = useState<any[]>([]);
  const [voiceSearch, setVoiceSearch] = useState('');
  const [voiceEngineFilter, setVoiceEngineFilter] = useState<string>('all');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [loadingVoiceId, setLoadingVoiceId] = useState<string | null>(null);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);

  // Dictionary temp input
  const [newOriginalWord, setNewOriginalWord] = useState('');
  const [newReplacementWord, setNewReplacementWord] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Load presets & categories from API
  const loadPresets = async () => {
    try {
      setLoading(true);
      const res = await localizeApi.getPresets();
      setPresets(res.presets || []);
      setGrouped(res.grouped || {});
      setCategories(res.categories || []);

      // If no editing preset yet, select default or first (or target from location state)
      if (res.presets && res.presets.length > 0) {
        setEditingPreset((prev) => {
          const targetId = (location.state as any)?.presetId;
          if (targetId) {
            const matched = res.presets.find((p) => p.id === Number(targetId));
            if (matched) {
              selectPresetForEdit(matched);
              return matched;
            }
          }
          if (prev) {
            const updated = res.presets.find((p) => p.id === prev.id);
            if (updated) {
              selectPresetForEdit(updated);
              return updated;
            }
          }
          let target = res.presets.find((p) => p.is_default) || res.presets[0];
          selectPresetForEdit(target);
          return target;
        });
      }
    } catch (err: any) {
      console.error('Lỗi khi tải danh sách cấu hình:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load voices for selector
  const loadVoices = async () => {
    try {
      const res = await settingsApi.getTtsVoices();
      setVoices(res.voices || []);
    } catch (err) {
      console.error('Lỗi khi tải giọng đọc:', err);
    }
  };

  useEffect(() => {
    loadPresets();
    loadVoices();
    return () => {
      if (previewAudio) {
        previewAudio.pause();
        setPlayingVoiceId(null);
      }
    };
  }, []);

  const selectPresetForEdit = (preset: LocalizePreset) => {
    const s = preset.settings || {};
    setEditingPreset(preset);
    setFormName(preset.name);
    setFormCategory(preset.category || 'Mặc định');
    setFormDescription(preset.description || '');
    setFormIsDefault(Boolean(preset.is_default));
    setFormSettings({
      ...DEFAULT_LOCALIZE_SETTINGS,
      ...s,
      syncMode: s.sync_mode || s.syncMode || DEFAULT_LOCALIZE_SETTINGS.syncMode,
    });
  };

  // Voice Preview toggle
  const handleToggleVoicePreview = async (vId: string) => {
    if (playingVoiceId === vId && previewAudio) {
      previewAudio.pause();
      setPlayingVoiceId(null);
      return;
    }
    try {
      if (previewAudio) previewAudio.pause();
      setLoadingVoiceId(vId);
      setPlayingVoiceId(vId);
      const res = await settingsApi.getTtsPreview(vId);
      const audioUrl = res.audio_url.startsWith('http') ? res.audio_url : libraryApi.getMediaUrl(res.audio_url);
      const audio = new Audio(audioUrl);
      audio.onended = () => {
        setPlayingVoiceId(null);
        setLoadingVoiceId(null);
      };
      audio.onerror = () => {
        setPlayingVoiceId(null);
        setLoadingVoiceId(null);
      };
      setPreviewAudio(audio);
      await audio.play();
    } catch (err) {
      console.error('Lỗi phát giọng:', err);
      setPlayingVoiceId(null);
    } finally {
      setLoadingVoiceId(null);
    }
  };

  // Save current preset changes
  const handleSaveCurrentPreset = async () => {
    if (!editingPreset) return;
    if (!formName.trim()) {
      showToast('⚠️ Vui lòng nhập tên cấu hình!');
      return;
    }

    try {
      setLoading(true);
      const settingsToSave = {
        ...formSettings,
        sync_mode: formSettings.syncMode,
      };
      const res = await localizeApi.updatePreset(editingPreset.id, {
        name: formName.trim(),
        category: formCategory.trim() || 'Mặc định',
        description: formDescription.trim(),
        is_default: formIsDefault,
        settings: settingsToSave,
      });

      showToast('✅ Đã lưu cấu hình thành công!');
      await loadPresets();
      setEditingPreset(res.preset);
    } catch (err: any) {
      showToast(`❌ Lỗi: ${err.message || 'Không thể lưu'}`);
    } finally {
      setLoading(false);
    }
  };

  // Create brand new preset
  const handleCreateNewPreset = async () => {
    const defaultCat = selectedCategory !== 'all' ? selectedCategory : categories[0] || 'TikTok Shop Affiliate';
    const newName = `Cấu hình mới ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;

    try {
      setLoading(true);
      const res = await localizeApi.createPreset({
        name: newName,
        category: defaultCat,
        description: 'Tùy chỉnh riêng cho định dạng video mới',
        is_default: false,
        settings: { ...DEFAULT_LOCALIZE_SETTINGS },
      });

      showToast('✨ Đã tạo cấu hình mới!');
      await loadPresets();
      selectPresetForEdit(res.preset);
    } catch (err: any) {
      showToast(`❌ Lỗi tạo cấu hình: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Duplicate preset
  const handleDuplicatePreset = async (presetId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setLoading(true);
      const res = await localizeApi.duplicatePreset(presetId);
      showToast('📋 Đã nhân bản cấu hình!');
      await loadPresets();
      selectPresetForEdit(res.preset);
    } catch (err: any) {
      showToast(`❌ Lỗi nhân bản: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Delete preset
  const handleDeletePreset = async (presetId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Bạn có chắc chắn muốn xóa cấu hình này không?')) return;
    try {
      setLoading(true);
      await localizeApi.deletePreset(presetId);
      showToast('🗑️ Đã xóa cấu hình!');
      const remaining = presets.filter((p) => p.id !== presetId);
      await loadPresets();
      if (editingPreset?.id === presetId) {
        if (remaining.length > 0) {
          selectPresetForEdit(remaining[0]);
        } else {
          setEditingPreset(null);
        }
      }
    } catch (err: any) {
      showToast(`❌ Lỗi xóa: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Set default preset
  const handleSetDefault = async (presetId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setLoading(true);
      await localizeApi.setDefaultPreset(presetId);
      showToast('⭐ Đã đặt làm cấu hình mặc định!');
      await loadPresets();
      if (editingPreset?.id === presetId) {
        setFormIsDefault(true);
      }
    } catch (err: any) {
      showToast(`❌ Lỗi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Apply and navigate back to /localize (Lưu trực tiếp vào Database SQLite trên máy)
  const handleApplyAndBack = async () => {
    if (editingPreset) {
      try {
        await localizeApi.setDefaultPreset(editingPreset.id);
      } catch (err) {
        console.warn('Không thể đặt mặc định:', err);
      }
    }
    navigate('/localize');
  };

  // Filtered presets (Tìm theo tên cấu hình)
  const filteredPresets = useMemo(() => {
    return presets.filter((p) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q));
    });
  }, [presets, searchQuery]);

  // Filtered voices in voice tab
  const filteredVoices = useMemo(() => {
    return voices.filter((v) => {
      const matchSearch =
        !voiceSearch.trim() ||
        v.name.toLowerCase().includes(voiceSearch.toLowerCase()) ||
        v.id.toLowerCase().includes(voiceSearch.toLowerCase()) ||
        (v.description && v.description.toLowerCase().includes(voiceSearch.toLowerCase()));
      const matchEngine = voiceEngineFilter === 'all' || v.engine === voiceEngineFilter;
      return matchSearch && matchEngine;
    });
  }, [voices, voiceSearch, voiceEngineFilter]);

  // Helper dictionary item add
  const handleAddDictWord = () => {
    if (!newOriginalWord.trim() || !newReplacementWord.trim()) return;
    const current = formSettings.dictionaryEntries || [];
    setFormSettings({
      ...formSettings,
      dictionaryEntries: [
        ...current,
        { original: newOriginalWord.trim(), replacement: newReplacementWord.trim() },
      ],
    });
    setNewOriginalWord('');
    setNewReplacementWord('');
  };

  const handleRemoveDictWord = (index: number) => {
    const current = [...(formSettings.dictionaryEntries || [])];
    current.splice(index, 1);
    setFormSettings({ ...formSettings, dictionaryEntries: current });
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0f15] text-slate-100 overflow-hidden select-none">
      {/* ─────────────────────────────────────────────────────────────
          1. TOP NAVIGATION HEADER
      ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800/80 bg-[#12151e] shrink-0">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/localize')}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition border border-slate-700 cursor-pointer shadow-sm"
          >
            <ArrowLeft size={14} />
            <span>Quay lại Lồng Tiếng</span>
          </button>

          <div className="h-5 w-px bg-slate-800" />

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-sm">
              <SlidersHorizontal size={17} />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Quản Lý Cấu Hình Video Studio</span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                  <Database size={10} /> Đã lưu vào ổ đĩa máy ({presets.length} mẫu)
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">
                Lưu trữ vĩnh viễn trong cơ sở dữ liệu SQLite trên máy tính — Tự động lưu và áp dụng cho từng video
              </p>
            </div>
          </div>
        </div>

        {/* Right action & Toast */}
        <div className="flex items-center gap-3">
          {toastMessage && (
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 animate-in fade-in duration-200">
              {toastMessage}
            </span>
          )}

          <button
            type="button"
            onClick={handleApplyAndBack}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-600 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/25 transition cursor-pointer active:scale-95"
          >
            <Check size={14} />
            <span>Áp dụng cấu hình & Trở về Studio</span>
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. FULL-SCREEN 2-COLUMN WORKSPACE
      ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* ─────────────────────────────────────────────────────────────
            LEFT COLUMN: Danh Mục & Danh Sách Cấu Hình (To rõ, thoáng đãng)
        ───────────────────────────────────────────────────────────── */}
        <div className="lg:col-span-5 xl:col-span-4 border-r border-slate-800/80 flex flex-col bg-[#12141d] overflow-hidden">
          {/* Action Bar */}
          <div className="p-4 border-b border-slate-800/80 space-y-3 bg-[#151722]">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm kiếm cấu hình..."
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-[#0b0d13] border border-slate-700/80 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
              <button
                type="button"
                onClick={handleCreateNewPreset}
                className="px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition shrink-0 cursor-pointer"
                title="Tạo cấu hình mới"
              >
                <Plus size={16} />
                <span>Tạo mới</span>
              </button>
            </div>

            {/* Category Filter Pills đã được loại bỏ theo yêu cầu: chỉ quản lý theo tên cấu hình */}
          </div>

          {/* Presets Header */}
          <div className="px-4 py-2 bg-[#10121a] border-b border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-300">Danh sách cấu hình</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[11px] font-bold text-indigo-300">
              {filteredPresets.length} mẫu
            </span>
          </div>

          {/* Presets List */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
            {filteredPresets.length === 0 ? (
              <div className="py-16 text-center text-slate-500 space-y-2">
                <SlidersHorizontal size={36} className="mx-auto opacity-30 text-slate-400" />
                <p className="text-xs">Không tìm thấy cấu hình phù hợp</p>
                <button
                  type="button"
                  onClick={handleCreateNewPreset}
                  className="text-xs text-indigo-400 hover:underline font-semibold"
                >
                  + Tạo cấu hình mới ngay
                </button>
              </div>
            ) : (
              filteredPresets.map((preset) => {
                const isSelected = editingPreset?.id === preset.id;
                const st = preset.settings || {};
                return (
                  <div
                    key={preset.id}
                    onClick={() => selectPresetForEdit(preset)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2.5 group select-none ${
                      isSelected
                        ? 'bg-indigo-600/15 border-indigo-500 shadow-lg shadow-indigo-500/10 scale-[1.01]'
                        : 'bg-[#151722] border-slate-800/80 hover:border-slate-700 hover:bg-[#191c28]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-white truncate group-hover:text-indigo-300 transition">
                            {preset.name}
                          </span>
                          {preset.is_default && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold flex items-center gap-1">
                              <Star size={10} className="fill-amber-400" /> Mặc định
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons (Duplicate, Delete, Set Default) */}
                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
                        {!preset.is_default && (
                          <button
                            type="button"
                            onClick={(e) => handleSetDefault(preset.id, e)}
                            className="p-2 rounded-xl text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                            title="Đặt làm cấu hình mặc định"
                          >
                            <Star size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => handleDuplicatePreset(preset.id, e)}
                          className="p-2 rounded-xl text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition"
                          title="Nhân bản cấu hình này"
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeletePreset(preset.id, e)}
                          className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                          title="Xóa cấu hình"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Summary Badges (Icon Vector chuẩn sắc nét) */}
                    <div className="flex items-center gap-1.5 flex-wrap text-xs pt-0.5">
                      <span className="px-2 py-1 rounded-lg bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-mono truncate max-w-[160px] font-medium flex items-center gap-1.5">
                        <Volume2 size={12} className="text-indigo-400 shrink-0" />
                        <span>{st.voice_id ? st.voice_id.replace('gemini-', '').replace('vi-VN-', '') : 'Hoài My'}</span>
                      </span>
                      <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium flex items-center gap-1.5">
                        <Sparkles size={12} className="text-amber-400 shrink-0" />
                        <span>{st.ai_style || 'Bán hàng'}</span>
                      </span>
                      <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-medium flex items-center gap-1.5">
                        <Type size={12} className="text-emerald-400 shrink-0" />
                        <span>{st.sub_font || 'Oswald'} ({st.sub_font_size || 29}px)</span>
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            RIGHT COLUMN: Bảng Cấu Hình Chi Tiết Rộng Rãi
        ───────────────────────────────────────────────────────────── */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col bg-[#0f1117] overflow-hidden">
          {editingPreset ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Preset Meta Header Bar */}
              <div className="p-5 border-b border-slate-800/80 bg-[#141620] space-y-4">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  {/* Tên cấu hình mẫu */}
                  <div className="flex-1 min-w-0">
                    <label className="text-xs font-bold text-slate-300 block mb-1.5 flex items-center gap-1.5">
                      <span>Tên cấu hình mẫu</span>
                      <span className="text-slate-500 font-normal truncate">(Đặt tên gợi nhớ để áp dụng nhanh cho video)</span>
                    </label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="VD: Tin Tức Đời Thường (Nam Minh Quang - Tự Nhiên)..."
                      className="w-full px-4 py-2.5 text-sm bg-[#0b0d13] border border-slate-700/80 rounded-xl text-white font-semibold placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition shadow-inner"
                    />
                  </div>

                  {/* Nút Lưu cấu hình nhanh trên header */}
                  <div className="flex items-center gap-3 shrink-0 pb-0.5">
                    {editingPreset.is_default && (
                      <span className="text-[11px] px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold flex items-center gap-1 select-none">
                        <Star size={11} className="fill-amber-400 text-amber-400" />
                        <span>Mặc định</span>
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={handleSaveCurrentPreset}
                      disabled={loading}
                      className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-md shadow-indigo-600/25 whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Save size={14} />
                      <span className="whitespace-nowrap">{loading ? 'Đang lưu...' : 'Lưu cấu hình'}</span>
                    </button>
                  </div>
                </div>

                {/* 6 Tabs Configuration Bar (Exact as original screenshot) */}
                <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-slate-800/80 text-xs">
                  {[
                    { id: 'prompt', label: '1. Kịch Bản AI', icon: Sparkles },
                    { id: 'voice', label: '2. Giọng Đọc & TTS', icon: Volume2 },
                    { id: 'audio', label: '3. Âm Thanh & BGM', icon: SlidersHorizontal },
                    { id: 'ocr', label: '4. Làm Mờ OCR', icon: EyeOff },
                    { id: 'sub', label: '5. Phụ Đề & Font', icon: Subtitles },
                    { id: 'dict', label: '6. Từ Điển Phát Âm', icon: BookOpen },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                          isActive
                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                            : 'bg-transparent text-slate-400 hover:text-white hover:bg-slate-800/60'
                        }`}
                      >
                        <Icon size={14} className={isActive ? 'text-white' : 'text-slate-400'} />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}

                  <div className="h-4 w-px bg-slate-800 mx-1 shrink-0" />

                  <button
                    type="button"
                    onClick={() => setActiveTab('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1 shrink-0 ${
                      activeTab === 'all'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
                    }`}
                  >
                    <span>Xem tất cả</span>
                  </button>
                </div>
              </div>

              {/* All Configuration Sections Displayed Continuously (Toàn bộ hiện ra trực quan) */}
              <div className="flex-1 overflow-y-auto p-6 space-y-7 scroll-smooth">
                {/* ─────────────────────────────────────────────────────────────
                    SECTION 1: PHONG CÁCH KỊCH BẢN DỊCH (GEMINI AI)
                ───────────────────────────────────────────────────────────── */}
                {(activeTab === 'all' || activeTab === 'prompt') && (
                  <div
                    id="section-prompt"
                    className="bg-[#141620] border border-slate-800/90 rounded-3xl p-6 shadow-sm space-y-4"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <label className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                        <Sparkles size={16} className="text-amber-400" />
                        <span>1. Phong Cách Kịch Bản Dịch (Gemini AI)</span>
                      </label>
                      <span className="text-xs text-slate-400">
                        AI tự động biên soạn lại kịch bản cuốn hút theo phong cách đã chọn
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5 pt-1">
                      {AI_STYLES.map((style) => {
                        const active = formSettings.aiStyle === style.id;
                        return (
                          <div
                            key={style.id}
                            onClick={() => setFormSettings({ ...formSettings, aiStyle: style.id })}
                            className={`p-4 rounded-2xl border cursor-pointer transition select-none flex flex-col justify-between min-h-[110px] ${
                              active
                                ? 'bg-indigo-600/15 border-indigo-500 shadow-md shadow-indigo-500/10'
                                : 'bg-[#0f1118] border-slate-800 hover:border-slate-700 hover:bg-[#161824]'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-white">{style.name}</span>
                              {active && (
                                <div className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse" />
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 leading-relaxed">{style.desc}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ─────────────────────────────────────────────────────────────
                    SECTION 2: GIỌNG ĐỌC LỒNG TIẾNG (TTS)
                ───────────────────────────────────────────────────────────── */}
                {(activeTab === 'all' || activeTab === 'voice') && (
                  <div
                    id="section-voice"
                  className="bg-[#141620] border border-slate-800/90 rounded-3xl p-6 shadow-sm space-y-5"
                >
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <label className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                      <Volume2 size={16} className="text-indigo-400" />
                      <span>2. Giọng Đọc Lồng Tiếng (TTS AI)</span>
                    </label>
                    <span className="text-xs text-slate-400">
                      Kho 30 giọng Google Gemini 2.5 Pro + Edge TTS + Kokoro, phát thử tức thì
                    </span>
                  </div>

                  {/* Current Voice Selected Banner */}
                  <div className="p-4 rounded-2xl bg-[#0f1118] border border-slate-800 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <button
                        type="button"
                        onClick={() => handleToggleVoicePreview(formSettings.voiceId)}
                        className="w-11 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition shadow-md shrink-0 cursor-pointer"
                        title="Nghe thử giọng hiện tại"
                      >
                        {loadingVoiceId === formSettings.voiceId ? (
                          <RefreshCw size={17} className="animate-spin text-white" />
                        ) : playingVoiceId === formSettings.voiceId ? (
                          <Square size={15} className="fill-current text-amber-300" />
                        ) : (
                          <Play size={17} className="fill-current ml-0.5" />
                        )}
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">
                            {formSettings.voiceId.replace('gemini-', 'Gemini ').replace('vi-VN-', '')}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                            Đang chọn cho cấu hình này
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {voices.find((v) => v.id === formSettings.voiceId)?.description ||
                            'Giọng đọc AI tự nhiên, phát âm chuẩn xác'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-medium">Tốc độ đọc:</span>
                      <div className="flex items-center gap-1 bg-slate-900 border border-slate-700/80 rounded-xl p-0.5">
                        {[0.85, 1.0, 1.15, 1.25].map((speed) => (
                          <button
                            key={speed}
                            type="button"
                            onClick={() => setFormSettings({ ...formSettings, voiceSpeed: speed })}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                              formSettings.voiceSpeed === speed
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {speed}x
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Filter Voices */}
                  <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                      <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        value={voiceSearch}
                        onChange={(e) => setVoiceSearch(e.target.value)}
                        placeholder="Tìm kiếm giọng đọc (Gemini, Hoài My, Nam Minh, Despina, Enceladus...)"
                        className="w-full pl-9 pr-3.5 py-2 text-xs bg-[#0b0d13] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      {['all', 'gemini', 'edge-tts', 'kokoro'].map((eng) => (
                        <button
                          key={eng}
                          type="button"
                          onClick={() => setVoiceEngineFilter(eng)}
                          className={`px-3 py-1.5 rounded-xl font-semibold transition cursor-pointer ${
                            voiceEngineFilter === eng
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-800/60 text-slate-400 hover:text-white'
                          }`}
                        >
                          {eng === 'all'
                            ? 'Tất cả'
                            : eng === 'gemini'
                            ? 'Gemini 2.5 Pro (30 giọng)'
                            : eng}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Voices Grid (Kéo dài hiển thị toàn bộ, không bị giới hạn chiều cao hay cắt cụt thẻ) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filteredVoices.map((v) => {
                      const isSelected = formSettings.voiceId === v.id;
                      const isPlaying = playingVoiceId === v.id;
                      const isLoading = loadingVoiceId === v.id;
                      return (
                        <div
                          key={v.id}
                          onClick={() => setFormSettings({ ...formSettings, voiceId: v.id })}
                          className={`p-3.5 rounded-xl border transition cursor-pointer flex items-center justify-between gap-2.5 select-none ${
                            isSelected
                              ? 'bg-indigo-600/20 border-indigo-500 shadow-sm'
                              : 'bg-[#0f1118] border-slate-800 hover:border-slate-700 hover:bg-[#161824]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-white truncate">{v.name}</span>
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded-full font-semibold ${
                                  v.gender === 'Female'
                                    ? 'bg-rose-500/15 text-rose-300'
                                    : 'bg-sky-500/15 text-sky-300'
                                }`}
                              >
                                {v.gender === 'Female' ? 'Nữ' : 'Nam'}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 truncate mt-0.5">{v.description}</p>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleVoicePreview(v.id);
                            }}
                            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition shrink-0 cursor-pointer"
                            title="Nghe thử giọng"
                          >
                            {isLoading ? (
                              <RefreshCw size={13} className="animate-spin text-indigo-400" />
                            ) : isPlaying ? (
                              <Square size={11} className="fill-amber-400 text-amber-400" />
                            ) : (
                              <Play size={13} className="fill-current ml-0.5" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

                {/* ─────────────────────────────────────────────────────────────
                    SECTION 3: ÂM THANH & BGM
                ───────────────────────────────────────────────────────────── */}
                {(activeTab === 'all' || activeTab === 'audio') && (
                  <div
                    id="section-audio"
                    className="bg-[#141620] border border-slate-800/90 rounded-3xl p-6 shadow-sm space-y-5"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <label className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                        <SlidersHorizontal size={16} className="text-indigo-400" />
                        <span>3. Âm Thanh & Nhạc Nền (BGM & Giọng Gốc)</span>
                      </label>
                      <span className="text-xs text-slate-400">
                        Tùy chỉnh cân bằng âm lượng hình/tiếng, giữ nguyên nhạc nền gốc
                      </span>
                    </div>

                    <div className="space-y-4">
                      {/* Slider Giọng Đọc AI */}
                      <div className="p-5 rounded-2xl bg-[#0f1118] border border-slate-800 space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-white flex items-center gap-2">
                            <Volume2 size={16} className="text-indigo-400" />
                            Âm lượng giọng đọc AI
                          </label>
                          <span className="text-xs font-mono font-bold text-indigo-400">
                            {formSettings.aiVoiceVolume}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="200"
                          step="5"
                          value={formSettings.aiVoiceVolume}
                          onChange={(e) =>
                            setFormSettings({ ...formSettings, aiVoiceVolume: Number(e.target.value) })
                          }
                          className="w-full accent-indigo-500 cursor-pointer"
                        />
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>0% (Tắt)</span>
                          <span>100% (Mặc định)</span>
                          <span>200% (Tối đa)</span>
                        </div>
                      </div>

                      {/* Giữ âm gốc */}
                      <div className="p-5 rounded-2xl bg-[#0f1118] border border-slate-800 space-y-4">
                        <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-white select-none">
                          <input
                            type="checkbox"
                            checked={formSettings.keepOriginalAudio}
                            onChange={(e) =>
                              setFormSettings({ ...formSettings, keepOriginalAudio: e.target.checked })
                            }
                            className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700"
                          />
                          <span>Giữ lại âm thanh / nhạc nền gốc của video</span>
                        </label>

                        {formSettings.keepOriginalAudio && (
                          <div className="space-y-4 pt-1">
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-300 font-medium">Âm lượng nhạc nền gốc (BGM):</span>
                                <span className="font-mono font-bold text-amber-400">
                                  {formSettings.bgmVolume}%
                                </span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                step="2"
                                value={formSettings.bgmVolume}
                                onChange={(e) =>
                                  setFormSettings({ ...formSettings, bgmVolume: Number(e.target.value) })
                                }
                                className="w-full accent-amber-500 cursor-pointer"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-300 font-medium">
                                  Âm lượng giọng nói gốc (tiếng Trung/Anh):
                                </span>
                                <span className="font-mono font-bold text-rose-400">
                                  {formSettings.originalVoiceVolume}%
                                </span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                step="2"
                                value={formSettings.originalVoiceVolume}
                                onChange={(e) =>
                                  setFormSettings({
                                    ...formSettings,
                                    originalVoiceVolume: Number(e.target.value),
                                  })
                                }
                                className="w-full accent-rose-500 cursor-pointer"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ─────────────────────────────────────────────────────────────
                    SECTION 4: LÀM MỜ OCR
                ───────────────────────────────────────────────────────────── */}
                {(activeTab === 'all' || activeTab === 'ocr') && (
                  <div
                    id="section-ocr"
                    className="bg-[#141620] border border-slate-800/90 rounded-3xl p-6 shadow-sm space-y-5"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <label className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                        <EyeOff size={16} className="text-amber-400" />
                        <span>4. Xử Lý Làm Mờ Phụ Đề Gốc (OCR)</span>
                      </label>
                      <span className="text-xs text-slate-400">
                        Tự động quét và che mờ phụ đề tiếng Trung cũ trước khi chèn phụ đề tiếng Việt
                      </span>
                    </div>

                    <div className="p-5 rounded-2xl bg-[#0f1118] border border-slate-800 space-y-4">
                      <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-white select-none">
                        <input
                          type="checkbox"
                          checked={formSettings.coverOldSub}
                          onChange={(e) =>
                            setFormSettings({ ...formSettings, coverOldSub: e.target.checked })
                          }
                          className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700"
                        />
                        <span>Tự động làm mờ phụ đề gốc (Che chữ tiếng Trung cũ)</span>
                      </label>

                      {formSettings.coverOldSub && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pl-4 border-l-2 border-indigo-500/40">
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-300 font-medium">Độ đậm của vùng làm mờ:</span>
                              <span className="font-mono font-bold text-indigo-400">
                                {formSettings.blurAmount}px
                              </span>
                            </div>
                            <input
                              type="range"
                              min="5"
                              max="60"
                              step="1"
                              value={formSettings.blurAmount}
                              onChange={(e) =>
                                setFormSettings({ ...formSettings, blurAmount: Number(e.target.value) })
                              }
                              className="w-full accent-indigo-500 cursor-pointer"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <span className="text-xs text-slate-400 block">Phương pháp che chữ:</span>
                            <div className="flex items-center gap-3 text-xs pt-1">
                              <button
                                type="button"
                                onClick={() => setFormSettings({ ...formSettings, blurMethod: 'blur' })}
                                className={`px-3.5 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                                  formSettings.blurMethod === 'blur'
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                Làm mờ Gaussian Blur
                              </button>
                              <button
                                type="button"
                                onClick={() => setFormSettings({ ...formSettings, blurMethod: 'inpaint' })}
                                className={`px-3.5 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                                  formSettings.blurMethod === 'inpaint'
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                Xóa vùng lân cận (Inpaint)
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ─────────────────────────────────────────────────────────────
                    SECTION 5: PHỤ ĐỀ & FONT CHỮ
                ───────────────────────────────────────────────────────────── */}
                {(activeTab === 'all' || activeTab === 'sub') && (
                  <div
                    id="section-sub"
                    className="bg-[#141620] border border-slate-800/90 rounded-3xl p-6 shadow-sm space-y-6"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <label className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                        <Subtitles size={16} className="text-indigo-400" />
                        <span>5. Kiểu Dáng & Định Dạng Phụ Đề (Subtitles & Fonts)</span>
                      </label>
                      <span className="text-xs text-slate-400">
                        Tùy biến phông chữ, cỡ chữ, màu sắc và hộp viền hiển thị chuẩn nét TikTok/Reels
                      </span>
                    </div>

                    {/* Live Preview Box */}
                    <div className="p-6 rounded-2xl bg-black border border-slate-800 flex flex-col items-center justify-center min-h-[120px] relative overflow-hidden">
                      <span className="absolute top-2 left-3 text-[10px] text-slate-500 font-mono">
                        XEM TRƯỚC PHỤ ĐỀ TRỰC QUAN
                      </span>
                      <span
                        style={{
                          fontFamily: formSettings.subFont,
                          fontSize: `${formSettings.subFontSize}px`,
                          color: formSettings.subTextColor,
                          fontWeight: formSettings.subBold ? 'bold' : 'normal',
                          fontStyle: formSettings.subItalic ? 'italic' : 'normal',
                          backgroundColor:
                            formSettings.subStyleType === 'box'
                              ? `${formSettings.subBgColor}${Math.round(
                                  (formSettings.subBgOpacity / 100) * 255
                                )
                                  .toString(16)
                                  .padStart(2, '0')}`
                              : 'transparent',
                          padding: formSettings.subStyleType === 'box' ? '4px 16px' : '0',
                          borderRadius: '8px',
                          textShadow:
                            formSettings.subStyleType === 'outline'
                              ? `-2px -2px 0 ${formSettings.subBgColor}, 2px -2px 0 ${formSettings.subBgColor}, -2px 2px 0 ${formSettings.subBgColor}, 2px 2px 0 ${formSettings.subBgColor}`
                              : formSettings.subStyleType === 'shadow'
                              ? `2px 2px 4px ${formSettings.subBgColor}`
                              : 'none',
                        }}
                        className="transition-all duration-150 select-none text-center"
                      >
                        {previewSubText}
                      </span>
                    </div>

                    {/* Quick Presets */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-400 font-medium">Mẫu nhanh:</span>
                      {[
                        { label: 'TikTok Vàng', color: '#FFD700', bg: '#000000', style: 'box' },
                        { label: 'Hộp Đen', color: '#FFFFFF', bg: '#000000', style: 'box' },
                        { label: 'Viền Đen', color: '#FFFFFF', bg: '#000000', style: 'outline' },
                        { label: 'Hộp Đỏ', color: '#FFFFFF', bg: '#E11D48', style: 'box' },
                      ].map((m, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            setFormSettings({
                              ...formSettings,
                              subTextColor: m.color,
                              subBgColor: m.bg,
                              subStyleType: m.style as any,
                            })
                          }
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer font-medium"
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>

                    {/* TỰ ĐỘNG NHẬN DIỆN VỊ TRÍ PHỤ ĐỀ GỐC & ĐÈ LÊN CHÍNH XÁC */}
                    <div className="p-4 sm:p-5 rounded-2xl bg-[#0e111a] border border-indigo-500/40 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Target size={16} className="text-indigo-400" />
                          <span className="text-xs font-bold text-white uppercase tracking-wider">
                            Vị Trí & Tự Động Đè Lên Phụ Đề Gốc (Computer Vision OCR)
                          </span>
                        </div>
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1">
                          <Check size={10} /> Quét toạ độ tự động
                        </span>
                      </div>

                      {/* Chọn chế độ định vị */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div
                          onClick={() => setFormSettings({ ...formSettings, subPositionMode: 'by_original' })}
                          className={`p-4 rounded-xl border cursor-pointer transition select-none flex flex-col justify-between ${
                            formSettings.subPositionMode === 'by_original'
                              ? 'bg-indigo-600/15 border-indigo-500 shadow-md shadow-indigo-500/10'
                              : 'bg-[#0a0c12] border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold text-white flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${formSettings.subPositionMode === 'by_original' ? 'bg-indigo-400' : 'bg-slate-600'}`} />
                              Tự động nhận diện & Đè lên sub gốc
                            </span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
                              Khuyên dùng
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            OCR tự động quét toạ độ dòng chữ tiếng Trung/Anh và đặt phụ đề tiếng Việt đè chính xác 100% lên vị trí cũ.
                          </p>
                        </div>

                        <div
                          onClick={() => setFormSettings({ ...formSettings, subPositionMode: 'by_height' })}
                          className={`p-4 rounded-xl border cursor-pointer transition select-none flex flex-col justify-between ${
                            formSettings.subPositionMode === 'by_height'
                              ? 'bg-indigo-600/15 border-indigo-500 shadow-md shadow-indigo-500/10'
                              : 'bg-[#0a0c12] border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold text-white flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${formSettings.subPositionMode === 'by_height' ? 'bg-indigo-400' : 'bg-slate-600'}`} />
                              Cố định theo % chiều cao video
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            Tự do đặt phụ đề ở vị trí cố định theo tỷ lệ % khung hình (ví dụ: đáy 84%, giữa 50%...).
                          </p>
                        </div>
                      </div>

                      {/* Tùy chỉnh chi tiết theo chế độ đã chọn */}
                      {formSettings.subPositionMode === 'by_original' ? (
                        <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-slate-300 font-semibold">Cách đè phụ đề:</span>
                            <div className="flex items-center gap-1.5 bg-[#0a0c12] p-1 rounded-xl border border-slate-800">
                              {[
                                { id: 'overlay', label: 'Đè trực tiếp (Che sub cũ)' },
                                { id: 'above', label: 'Nằm phía trên' },
                                { id: 'below', label: 'Nằm phía dưới' },
                              ].map((opt) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => setFormSettings({ ...formSettings, subPlacement: opt.id as any })}
                                  className={`px-3 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer ${
                                    formSettings.subPlacement === opt.id
                                      ? 'bg-indigo-600 text-white shadow-sm'
                                      : 'text-slate-400 hover:text-white'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 select-none font-medium">
                            <input
                              type="checkbox"
                              checked={formSettings.autoFitSubSize}
                              onChange={(e) => setFormSettings({ ...formSettings, autoFitSubSize: e.target.checked })}
                              className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700"
                            />
                            <span>Tự động ôm khít kích thước chữ gốc</span>
                          </label>
                        </div>
                      ) : (
                        <div className="pt-3 border-t border-slate-800/80 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-300 font-semibold">Vị trí tính từ đỉnh video:</span>
                            <span className="font-mono font-bold text-indigo-400">{formSettings.subPositionPercent}%</span>
                          </div>
                          <input
                            type="range"
                            min="20"
                            max="95"
                            value={formSettings.subPositionPercent}
                            onChange={(e) => setFormSettings({ ...formSettings, subPositionPercent: Number(e.target.value) })}
                            className="w-full accent-indigo-500 cursor-pointer"
                          />
                        </div>
                      )}
                    </div>

                    {/* Form Controls */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      <div>
                        <label className="text-xs font-semibold text-slate-300 block mb-1">
                          Phông chữ (Font)
                        </label>
                        <select
                          value={formSettings.subFont}
                          onChange={(e) => setFormSettings({ ...formSettings, subFont: e.target.value })}
                          className="w-full px-3.5 py-2 text-xs bg-[#0f1118] border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                        >
                          {['Oswald', 'Montserrat', 'Roboto', 'Quicksand', 'Inter', 'Be Vietnam Pro'].map(
                            (f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            )
                          )}
                        </select>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1">
                          <span>Cỡ chữ:</span>
                          <span className="font-mono text-indigo-400">{formSettings.subFontSize}px</span>
                        </div>
                        <input
                          type="range"
                          min="18"
                          max="80"
                          value={formSettings.subFontSize}
                          onChange={(e) =>
                            setFormSettings({ ...formSettings, subFontSize: Number(e.target.value) })
                          }
                          className="w-full accent-indigo-500 cursor-pointer"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-300 block mb-1">
                          Kiểu hiển thị
                        </label>
                        <select
                          value={formSettings.subStyleType}
                          onChange={(e) =>
                            setFormSettings({ ...formSettings, subStyleType: e.target.value as any })
                          }
                          className="w-full px-3.5 py-2 text-xs bg-[#0f1118] border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                        >
                          <option value="box">Hộp màu nền (Box)</option>
                          <option value="outline">Viền chữ nét (Outline)</option>
                          <option value="shadow">Đổ bóng chữ (Shadow)</option>
                          <option value="basic">Chữ trơn không nền</option>
                        </select>
                      </div>
                    </div>

                    {/* Colors */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 items-center">
                      <div>
                        <label className="text-xs font-semibold text-slate-300 block mb-1">Màu chữ</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={formSettings.subTextColor}
                            onChange={(e) =>
                              setFormSettings({ ...formSettings, subTextColor: e.target.value })
                            }
                            className="w-9 h-9 rounded-lg border-0 bg-transparent cursor-pointer"
                          />
                          <span className="text-xs font-mono text-white">{formSettings.subTextColor}</span>
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-300 block mb-1">
                          Màu nền / viền
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={formSettings.subBgColor}
                            onChange={(e) =>
                              setFormSettings({ ...formSettings, subBgColor: e.target.value })
                            }
                            className="w-9 h-9 rounded-lg border-0 bg-transparent cursor-pointer"
                          />
                          <span className="text-xs font-mono text-white">{formSettings.subBgColor}</span>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1">
                          <span>Độ mờ nền:</span>
                          <span className="font-mono text-indigo-400">{formSettings.subBgOpacity}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={formSettings.subBgOpacity}
                          onChange={(e) =>
                            setFormSettings({ ...formSettings, subBgOpacity: Number(e.target.value) })
                          }
                          className="w-full accent-indigo-500 cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center gap-4 pt-4">
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-white select-none">
                          <input
                            type="checkbox"
                            checked={formSettings.subBold}
                            onChange={(e) =>
                              setFormSettings({ ...formSettings, subBold: e.target.checked })
                            }
                            className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700"
                          />
                          <span>Đậm (Bold)</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer text-xs font-italic text-white select-none">
                          <input
                            type="checkbox"
                            checked={formSettings.subItalic}
                            onChange={(e) =>
                              setFormSettings({ ...formSettings, subItalic: e.target.checked })
                            }
                            className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700"
                          />
                          <span>Nghiêng (Italic)</span>
                        </label>
                      </div>
                    </div>

                    {/* THUẬT TOÁN ĐỒNG BỘ & TỰ ĐỘNG GIÃN VIDEO VỪA VẶN VỚI SUB (TRÁNH CẮT GIỮA CHỪNG) */}
                    <div className="p-5 rounded-2xl bg-[#0e111a] border border-indigo-500/40 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Zap size={16} className="text-amber-400" />
                          <span className="text-xs font-bold text-white uppercase tracking-wider">
                            Thuật Toán Đồng Bộ & Tự Động Giãn Video Vừa Sub (Tránh Bị Cắt Giữa Chừng)
                          </span>
                        </div>
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-semibold flex items-center gap-1">
                          ⚡ AI & FFmpeg Hybrid Sync
                        </span>
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed">
                        Khi dịch và lồng tiếng Việt, câu thoại thường dài hơn video gốc tiếng Trung. Lựa chọn thuật toán xử lý để đảm bảo phụ đề và câu nói không bao giờ bị cắt cụt giữa chừng:
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        {/* Option 1: Hybrid - Tự động giãn video */}
                        <div
                          onClick={() => setFormSettings({ ...formSettings, syncMode: 'hybrid' })}
                          className={`p-4 rounded-xl border cursor-pointer transition select-none flex flex-col justify-between ${
                            formSettings.syncMode === 'hybrid'
                              ? 'bg-indigo-600/15 border-indigo-500 ring-2 ring-indigo-500/50 shadow-md shadow-indigo-500/10'
                              : 'bg-[#0a0c12] border-slate-800 hover:border-slate-700 opacity-80 hover:opacity-100'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-white flex items-center gap-2">
                                <span className={`w-2.5 h-2.5 rounded-full ${formSettings.syncMode === 'hybrid' ? 'bg-indigo-400 shadow-sm shadow-indigo-400' : 'bg-slate-600'}`} />
                                Tự động giãn video vừa với Sub (Khuyên dùng)
                              </span>
                              <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                                Không bị cắt câu
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-300 leading-relaxed">
                              Thuật toán FFmpeg tự động kéo giãn nhẹ timeline video và giữ frame cuối để giọng đọc và phụ đề phát trọn vẹn 100%, <strong>tuyệt đối không bị ngắt quãng hay mất chữ giữa chừng</strong>.
                            </p>
                          </div>
                          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-indigo-400">
                            <span>Chế độ:</span>
                            <span className="bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-800/50">hybrid (auto stretch video)</span>
                          </div>
                        </div>

                        {/* Option 2: Keep duration - Giữ nguyên thời lượng gốc */}
                        <div
                          onClick={() => setFormSettings({ ...formSettings, syncMode: 'keep_duration' })}
                          className={`p-4 rounded-xl border cursor-pointer transition select-none flex flex-col justify-between ${
                            formSettings.syncMode === 'keep_duration'
                              ? 'bg-indigo-600/15 border-indigo-500 ring-2 ring-indigo-500/50 shadow-md shadow-indigo-500/10'
                              : 'bg-[#0a0c12] border-slate-800 hover:border-slate-700 opacity-80 hover:opacity-100'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-white flex items-center gap-2">
                                <span className={`w-2.5 h-2.5 rounded-full ${formSettings.syncMode === 'keep_duration' ? 'bg-indigo-400 shadow-sm shadow-indigo-400' : 'bg-slate-600'}`} />
                                Cố định đúng thời lượng video gốc
                              </span>
                              <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">
                                Time-stretch giọng
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-300 leading-relaxed">
                              Giữ cố định 100% thời lượng của video gốc, tự động tăng tốc giọng đọc tiếng Việt để nén vừa vặn vào khung thời gian ban đầu.
                            </p>
                          </div>
                          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
                            <span>Chế độ:</span>
                            <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800">keep_duration</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ─────────────────────────────────────────────────────────────
                    SECTION 6: TỪ ĐIỂN PHÁT ÂM (DICTIONARY)
                ───────────────────────────────────────────────────────────── */}
                {(activeTab === 'all' || activeTab === 'dict') && (
                  <div
                    id="section-dict"
                    className="bg-[#141620] border border-slate-800/90 rounded-3xl p-6 shadow-sm space-y-4"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <label className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                        <BookOpen size={16} className="text-indigo-400" />
                        <span>6. Từ Điển Phát Âm Riêng</span>
                      </label>
                      <span className="text-xs text-slate-400">
                        Cấu hình phiên âm tiếng Việt riêng cho cấu hình này (VD: thương hiệu, tên riêng, thuật ngữ khó đọc)
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={newOriginalWord}
                        onChange={(e) => setNewOriginalWord(e.target.value)}
                        placeholder="Từ gốc (VD: iPhone, TikTok, Nike...)"
                        className="flex-1 px-3.5 py-2 text-xs bg-[#0b0d13] border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                      />
                      <span className="text-slate-500 font-bold">➔</span>
                      <input
                        type="text"
                        value={newReplacementWord}
                        onChange={(e) => setNewReplacementWord(e.target.value)}
                        placeholder="Đọc thành (VD: Ai-phôn, Tíc-tóc, Nai-kì...)"
                        className="flex-1 px-3.5 py-2 text-xs bg-[#0b0d13] border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={handleAddDictWord}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition shrink-0 cursor-pointer"
                      >
                        <Plus size={14} /> Thêm
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2.5 pt-2">
                      {(formSettings.dictionaryEntries || []).map((entry, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1.5 rounded-xl bg-[#0f1118] border border-slate-800 text-xs text-slate-200 flex items-center gap-2.5 font-mono"
                        >
                          <span className="text-amber-300 font-bold">{entry.original}</span>
                          <span className="text-slate-500">➔</span>
                          <span className="text-emerald-400 font-bold">{entry.replacement}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveDictWord(idx)}
                            className="text-slate-500 hover:text-rose-400 transition ml-1"
                          >
                            <X size={13} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Action Strip (CỐ ĐỊNH Ở ĐÁY CHO TẤT CẢ CÁC TAB) */}
              <div className="p-4 px-6 bg-[#13151f] border-t border-slate-800/90 flex items-center justify-between shrink-0 shadow-2xl z-20">
                <button
                  type="button"
                  onClick={() => {
                    setFormSettings({ ...DEFAULT_LOCALIZE_SETTINGS });
                    showToast('🔄 Đã khôi phục thông số về mặc định!');
                  }}
                  className="px-3.5 py-2 text-xs text-slate-400 hover:text-amber-300 bg-slate-800/80 hover:bg-slate-800 rounded-xl border border-slate-700/60 flex items-center gap-2 transition font-medium cursor-pointer"
                >
                  <RotateCcw size={14} />
                  <span>Khôi phục mặc định</span>
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSaveCurrentPreset}
                    disabled={loading}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-2 border border-slate-700 transition cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
                  >
                    <Save size={14} className="text-indigo-400" />
                    <span>{loading ? 'Đang lưu...' : 'Lưu cấu hình này'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleApplyAndBack}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-600 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/25 transition cursor-pointer active:scale-95"
                  >
                    <Check size={15} />
                    <span>Áp dụng & Trở về Studio</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-500">
              <SlidersHorizontal size={48} className="opacity-30 mb-3" />
              <p className="text-sm font-semibold text-slate-300">Chưa có cấu hình nào được chọn</p>
              <p className="text-xs text-slate-500 mt-1">
                Chọn một cấu hình ở cột bên trái hoặc bấm "Tạo mới" để bắt đầu thiết lập.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
