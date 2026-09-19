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
  User,
  Users,
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
  Edit3,
} from 'lucide-react';
import { localizeApi, settingsApi, libraryApi, LocalizePreset } from '../../api/client';
import { LocalizeSettings, DEFAULT_LOCALIZE_SETTINGS, AI_STYLES, CustomAiStyle } from './types';

export default function LocalizePresetsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [presets, setPresets] = useState<LocalizePreset[]>([]);
  const [grouped, setGrouped] = useState<Record<string, LocalizePreset[]>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Editing state
  const [editingPreset, setEditingPreset] = useState<LocalizePreset | null>(null);
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('Mặc định');
  const [formDescription, setFormDescription] = useState('');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [formSettings, setFormSettings] = useState<LocalizeSettings>(DEFAULT_LOCALIZE_SETTINGS);

  // Active section tab for navigation
  const [activeTab, setActiveTab] = useState<string>('all');

  // Voices list for selector
  const [voices, setVoices] = useState<any[]>([]);
  const [voiceSearch, setVoiceSearch] = useState('');
  const [selectedEngine, setSelectedEngine] = useState<string>('all');
  const [selectedGender, setSelectedGender] = useState<string>('all');
  const [voiceEngineFilter, setVoiceEngineFilter] = useState<string>('all');

  // UI state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [loadingVoiceId, setLoadingVoiceId] = useState<string | null>(null);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);

  // Subtitle custom text preview
  const [previewSubText, setPreviewSubText] = useState('Ốp lưng gấu Miffy siêu xinh xắn!');

  // Dictionary temp input
  const [newOriginalWord, setNewOriginalWord] = useState('');
  const [newReplacementWord, setNewReplacementWord] = useState('');

  // Custom AI Style Modal states
  const [customStyleModalOpen, setCustomStyleModalOpen] = useState(false);
  const [editingCustomStyleId, setEditingCustomStyleId] = useState<string | null>(null);
  const [modalStyleName, setModalStyleName] = useState('');
  const [modalStyleDesc, setModalStyleDesc] = useState('');
  const [modalStylePrompt, setModalStylePrompt] = useState('');

  // Voice Picker Popup state for multi-voice roles
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [voicePickerTarget, setVoicePickerTarget] = useState<'char1' | 'char2' | 'narrator' | null>(null);
  const [voicePickerSearch, setVoicePickerSearch] = useState('');
  const [voicePickerFilter, setVoicePickerFilter] = useState<string>('all');

  const getSelectedVoice = (voiceId?: string, fallbackId = '') => {
    const id = voiceId || fallbackId;
    return voices.find((v) => v.id === id) || { id, name: id || 'Chưa chọn giọng', gender: '', engine: '' };
  };

  const filteredPickerVoices = useMemo(() => {
    return voices.filter((v) => {
      const matchSearch =
        !voicePickerSearch.trim() ||
        v.name.toLowerCase().includes(voicePickerSearch.toLowerCase()) ||
        v.id.toLowerCase().includes(voicePickerSearch.toLowerCase()) ||
        (v.description && v.description.toLowerCase().includes(voicePickerSearch.toLowerCase()));

      let matchFilter = true;
      if (voicePickerFilter === 'male') matchFilter = v.gender === 'Male';
      else if (voicePickerFilter === 'female') matchFilter = v.gender === 'Female';
      else if (voicePickerFilter === 'vieneu') matchFilter = v.engine === 'vieneu';
      else if (voicePickerFilter === 'edge') matchFilter = v.engine === 'edge-tts';
      else if (voicePickerFilter === 'gemini') matchFilter = v.engine === 'gemini';

      return matchSearch && matchFilter;
    });
  }, [voices, voicePickerSearch, voicePickerFilter]);

  const handleSelectVoiceFromPicker = (voiceId: string) => {
    if (voicePickerTarget === 'char1') {
      setFormSettings({ ...formSettings, voiceMale: voiceId });
    } else if (voicePickerTarget === 'char2') {
      setFormSettings({ ...formSettings, voiceFemale: voiceId });
    } else if (voicePickerTarget === 'narrator') {
      setFormSettings({ ...formSettings, voiceNarrator: voiceId });
    }
    setVoicePickerOpen(false);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleOpenAddCustomStyleModal = () => {
    setEditingCustomStyleId(null);
    setModalStyleName('');
    setModalStyleDesc('');
    setModalStylePrompt('');
    setCustomStyleModalOpen(true);
  };

  const handleOpenEditCustomStyleModal = (style: CustomAiStyle) => {
    setEditingCustomStyleId(style.id);
    setModalStyleName(style.name);
    setModalStyleDesc(style.desc);
    setModalStylePrompt(style.prompt);
    setCustomStyleModalOpen(true);
  };

  const handleSaveCustomStyleModal = () => {
    if (!modalStyleName.trim()) {
      showToast('⚠️ Vui lòng nhập tên phong cách!');
      return;
    }
    if (!modalStylePrompt.trim()) {
      showToast('⚠️ Vui lòng nhập hướng dẫn (Prompt) cho AI!');
      return;
    }

    const currentStyles = [...(formSettings.customAiStyles || [])];

    if (editingCustomStyleId) {
      // Cập nhật phong cách hiện có
      const updated = currentStyles.map((s) =>
        s.id === editingCustomStyleId
          ? {
              ...s,
              name: modalStyleName.trim(),
              desc: modalStyleDesc.trim() || modalStylePrompt.trim().slice(0, 80) + '...',
              prompt: modalStylePrompt.trim(),
            }
          : s
      );
      setFormSettings({
        ...formSettings,
        customAiStyles: updated,
        customAiPrompt: formSettings.aiStyle === editingCustomStyleId ? modalStylePrompt.trim() : formSettings.customAiPrompt,
      });
      showToast('✅ Đã cập nhật phong cách tùy chỉnh!');
    } else {
      // Thêm phong cách mới cho cấu hình này
      const newId = `custom_${Date.now()}`;
      const newStyle: CustomAiStyle = {
        id: newId,
        name: modalStyleName.trim(),
        desc: modalStyleDesc.trim() || modalStylePrompt.trim().slice(0, 80) + '...',
        prompt: modalStylePrompt.trim(),
      };
      setFormSettings({
        ...formSettings,
        aiStyle: newId,
        customAiPrompt: modalStylePrompt.trim(),
        customAiStyles: [...currentStyles, newStyle],
      });
      showToast('🎉 Đã thêm và chọn phong cách mới!');
    }

    setCustomStyleModalOpen(false);
  };

  const handleDeleteCustomStyle = (styleId: string) => {
    const updated = (formSettings.customAiStyles || []).filter((s) => s.id !== styleId);
    let nextAiStyle = formSettings.aiStyle;
    let nextPrompt = formSettings.customAiPrompt;

    if (formSettings.aiStyle === styleId) {
      nextAiStyle = 'bán hàng';
      nextPrompt = '';
    }

    setFormSettings({
      ...formSettings,
      aiStyle: nextAiStyle,
      customAiPrompt: nextPrompt,
      customAiStyles: updated,
    });
    showToast('🗑️ Đã xóa phong cách tùy chỉnh.');
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
          const target = res.presets.find((p) => p.is_default) || res.presets[0];
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
      recognitionMode: s.recognition_mode || s.recognitionMode || DEFAULT_LOCALIZE_SETTINGS.recognitionMode || 'voice_only',
      aiStyle: s.ai_style || s.aiStyle || DEFAULT_LOCALIZE_SETTINGS.aiStyle,
      customAiStyles: s.custom_ai_styles || s.customAiStyles || [],
      customAiPrompt: s.custom_ai_prompt || s.customAiPrompt || '',
      syncMode: s.sync_mode || s.syncMode || DEFAULT_LOCALIZE_SETTINGS.syncMode,
      keepBgmSfx: s.keep_bgm_sfx !== undefined ? Boolean(s.keep_bgm_sfx) : true,
      multiVoice: Boolean(s.multi_voice),
      voiceMale: s.voice_male || 'vi-VN-NamMinhNeural',
      voiceFemale: s.voice_female || 'vi-VN-HoaiMyNeural',
      voiceNarrator: s.voice_narrator || s.voice_id || DEFAULT_LOCALIZE_SETTINGS.voiceId,
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
      const customStyles = formSettings.customAiStyles || [];
      const currentCustom = customStyles.find((cs) => cs.id === formSettings.aiStyle);
      const isCustomStyle = Boolean(currentCustom || formSettings.aiStyle.startsWith('custom_'));
      const activePrompt = currentCustom?.prompt || formSettings.customAiPrompt || '';

      const settingsToSave = {
        ...formSettings,
        recognition_mode: formSettings.recognitionMode || 'voice_only',
        ai_style: formSettings.aiStyle,
        custom_ai_styles: customStyles,
        custom_ai_prompt: activePrompt,
        ai_style_prompt: isCustomStyle ? activePrompt : '',
        voice_id: formSettings.voiceId,
        voice_speed: formSettings.voiceSpeed,
        multi_voice: Boolean(formSettings.multiVoice),
        voice_male: formSettings.voiceMale || 'vi-VN-NamMinhNeural',
        voice_female: formSettings.voiceFemale || 'vi-VN-HoaiMyNeural',
        voice_narrator: formSettings.voiceNarrator || formSettings.voiceId,
        sync_mode: formSettings.syncMode,
        volume_voiceover: formSettings.aiVoiceVolume,
        keep_original_audio: formSettings.keepOriginalAudio,
        keep_bgm_sfx: formSettings.keepBgmSfx ?? true,
        volume_original: formSettings.bgmVolume,
        volume_original_voice: formSettings.originalVoiceVolume,
        cover_old_subtitle: formSettings.coverOldSub,
        blur_amount: formSettings.blurAmount,
        blur_method: formSettings.blurMethod,
        show_subtitles: formSettings.showSubtitles,
        sub_position_mode: formSettings.subPositionMode,
        sub_placement: formSettings.subPlacement,
        auto_fit_sub_size: formSettings.autoFitSubSize,
        sub_position_percent: formSettings.subPositionPercent,
        sub_font: formSettings.subFont,
        sub_font_size: formSettings.subFontSize,
        sub_color: formSettings.subTextColor,
        sub_bg_color: formSettings.subBgColor,
        sub_bg_opacity: formSettings.subBgOpacity,
        sub_style_type: formSettings.subStyleType,
        sub_bold: formSettings.subBold,
        sub_italic: formSettings.subItalic,
        sub_margin_v: formSettings.subMarginV,
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
                        <span>{(st.voice_id || st.voiceId) ? (st.voice_id || st.voiceId).replace('gemini-', '').replace('vi-VN-', '') : 'Hoài My'}</span>
                      </span>
                      <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium flex items-center gap-1.5 max-w-[170px] truncate">
                        <Sparkles size={12} className="text-amber-400 shrink-0" />
                        <span className="truncate">
                          {(() => {
                            const curStyleId = st.ai_style || st.aiStyle;
                            const customList = st.custom_ai_styles || st.customAiStyles || [];
                            const customMatch = customList.find((c: any) => c.id === curStyleId);
                            if (customMatch) return customMatch.name;
                            const builtIn = AI_STYLES.find((s) => s.id === curStyleId);
                            if (builtIn) return builtIn.name.split('/')[0].trim();
                            return curStyleId || 'Bán hàng';
                          })()}
                        </span>
                      </span>
                      <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-medium flex items-center gap-1.5">
                        <Type size={12} className="text-emerald-400 shrink-0" />
                        <span>{st.sub_font || st.subFont || 'Oswald'} ({st.sub_font_size || st.subFontSize || 29}px)</span>
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
                    { id: 'prompt', label: '1. Nhận Diện & Kịch Bản AI', icon: Sparkles },
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
                    SECTION 1: NHẬN DIỆN & PHONG CÁCH KỊCH BẢN (GEMINI AI / STT)
                ───────────────────────────────────────────────────────────── */}
                {(activeTab === 'all' || activeTab === 'prompt') && (
                  <div
                    id="section-prompt"
                    className="bg-[#141620] border border-slate-800/90 rounded-3xl p-6 shadow-sm space-y-5"
                  >
                    {/* ── BƯỚC 1.1: PHƯƠNG THỨC NHẬN DIỆN NGUỒN VIDEO ── */}
                    <div className="space-y-3 pb-5 border-b border-slate-800/80">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <label className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                            <Mic size={16} className="text-sky-400" />
                            <span>Phương Thức Nhận Diện Video Gốc (Nguồn Kịch Bản)</span>
                          </label>
                          <p className="text-[11px] text-slate-400 mt-1">
                            Chọn công nghệ bóc tách nội dung từ video nguồn trước khi dịch và lồng tiếng:
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                        {/* 1. Whisper STT */}
                        <div
                          onClick={() => setFormSettings({ ...formSettings, recognitionMode: 'voice_only' })}
                          className={`p-4 rounded-2xl border cursor-pointer transition select-none flex flex-col justify-between ${
                            (formSettings.recognitionMode || 'voice_only') === 'voice_only'
                              ? 'bg-sky-500/15 border-sky-400 shadow-md shadow-sky-500/10 ring-1 ring-sky-400/50'
                              : 'bg-[#0f1118] border-slate-800 hover:border-slate-700 hover:bg-[#161824]'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center">
                                  <Mic size={16} />
                                </div>
                                <span className="text-xs font-bold text-white">Whisper AI (STT)</span>
                              </div>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
                                ★ Chuẩn 100% GenSub
                              </span>
                            </div>
                            <div className="text-xs font-semibold text-sky-300 mb-1">Nhận diện giọng nói gốc</div>
                            <p className="text-[11px] text-slate-400 leading-relaxed">
                              Nghe giọng nói nhân vật trong video, bóc tách chính xác từng câu thoại theo giây, bám sát lời gốc và không chế lời.
                            </p>
                          </div>
                          <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-[10px]">
                            <span className="text-slate-500">Video có người nói</span>
                            <span className="font-mono text-sky-400 font-semibold">voice_only</span>
                          </div>
                        </div>

                        {/* 2. Quét OCR */}
                        <div
                          onClick={() => setFormSettings({ ...formSettings, recognitionMode: 'ocr_only' })}
                          className={`p-4 rounded-2xl border cursor-pointer transition select-none flex flex-col justify-between ${
                            formSettings.recognitionMode === 'ocr_only'
                              ? 'bg-purple-500/15 border-purple-400 shadow-md shadow-purple-500/10 ring-1 ring-purple-400/50'
                              : 'bg-[#0f1118] border-slate-800 hover:border-slate-700 hover:bg-[#161824]'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                                  <Subtitles size={16} />
                                </div>
                                <span className="text-xs font-bold text-white">EasyOCR AI</span>
                              </div>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                                Video có phụ đề
                              </span>
                            </div>
                            <div className="text-xs font-semibold text-purple-300 mb-1">Quét chữ phụ đề cứng</div>
                            <p className="text-[11px] text-slate-400 leading-relaxed">
                              Quét chữ Trung Quốc in cứng trên màn hình, dịch sang tiếng Việt và tự động làm mờ phụ đề cũ.
                            </p>
                          </div>
                          <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-[10px]">
                            <span className="text-slate-500">Video có sub Trung</span>
                            <span className="font-mono text-purple-400 font-semibold">ocr_only</span>
                          </div>
                        </div>

                        {/* 3. AI Vision */}
                        <div
                          onClick={() => setFormSettings({ ...formSettings, recognitionMode: 'ai_vision' })}
                          className={`p-4 rounded-2xl border cursor-pointer transition select-none flex flex-col justify-between ${
                            formSettings.recognitionMode === 'ai_vision'
                              ? 'bg-amber-500/15 border-amber-400 shadow-md shadow-amber-500/10 ring-1 ring-amber-400/50'
                              : 'bg-[#0f1118] border-slate-800 hover:border-slate-700 hover:bg-[#161824]'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                                  <Sparkles size={16} />
                                </div>
                                <span className="text-xs font-bold text-white">Gemini Vision</span>
                              </div>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                Chỉ dùng cho video câm
                              </span>
                            </div>
                            <div className="text-xs font-semibold text-amber-300 mb-1">AI Thị Giác sáng tác</div>
                            <p className="text-[11px] text-slate-400 leading-relaxed">
                              AI tự xem video, phân tích hành động để sáng tác kịch bản mới. Chỉ chọn khi video không có tiếng nói và không có sub.
                            </p>
                          </div>
                          <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-[10px]">
                            <span className="text-slate-500">Video không lời & sub</span>
                            <span className="font-mono text-amber-400 font-semibold">ai_vision</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── BƯỚC 1.2: PHONG CÁCH KỊCH BẢN DỊCH (GEMINI AI) ── */}
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 flex-wrap gap-2">
                      <label className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                        <Sparkles size={16} className="text-amber-400" />
                        <span>Phong Cách Dịch & Biên Soạn Kịch Bản</span>
                      </label>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400 hidden sm:inline">
                          AI dịch và biểu đạt kịch bản theo phong cách đã chọn
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenAddCustomStyleModal()}
                          className="px-3 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <Plus size={14} />
                          <span>+ Thêm phong cách riêng</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5 pt-1">
                      {/* 8 Phong cách mặc định có sẵn */}
                      {AI_STYLES.map((style) => {
                        const active = formSettings.aiStyle === style.id;
                        return (
                          <div
                            key={style.id}
                            onClick={() => setFormSettings({ ...formSettings, aiStyle: style.id, customAiPrompt: '' })}
                            className={`p-4 rounded-2xl border cursor-pointer transition select-none flex flex-col justify-between min-h-[110px] ${
                              active
                                ? 'bg-indigo-600/15 border-indigo-500 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500/40'
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

                      {/* Các phong cách tùy chỉnh riêng của cấu hình này */}
                      {(formSettings.customAiStyles || []).map((style) => {
                        const active = formSettings.aiStyle === style.id;
                        return (
                          <div
                            key={style.id}
                            onClick={() => setFormSettings({
                              ...formSettings,
                              aiStyle: style.id,
                              customAiPrompt: style.prompt,
                            })}
                            className={`relative p-4 rounded-2xl border cursor-pointer transition select-none flex flex-col justify-between min-h-[110px] group ${
                              active
                                ? 'bg-purple-600/20 border-purple-500 shadow-md shadow-purple-500/20 ring-1 ring-purple-500/50'
                                : 'bg-[#0f1118] border-purple-900/30 hover:border-purple-600/50 hover:bg-[#161824]'
                            }`}
                          >
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-1.5 truncate">
                                  <span className="text-xs font-bold text-white truncate">{style.name}</span>
                                  <span className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                                    Tùy chỉnh
                                  </span>
                                </div>
                                {active && (
                                  <div className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse shrink-0 ml-1.5" />
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">{style.desc || style.prompt}</p>
                            </div>

                            {/* Nút Sửa & Xóa phong cách riêng */}
                            <div className="flex items-center justify-between pt-2.5 border-t border-slate-800/80 mt-2">
                              <span className="text-[10px] text-purple-300/70 font-mono truncate max-w-[120px]">
                                {style.prompt ? 'Đã gán prompt' : 'Chưa có prompt'}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenEditCustomStyleModal(style);
                                  }}
                                  className="p-1 rounded hover:bg-purple-500/20 text-slate-400 hover:text-purple-300 transition"
                                  title="Chỉnh sửa phong cách này"
                                >
                                  <Edit3 size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteCustomStyle(style.id);
                                  }}
                                  className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition"
                                  title="Xóa phong cách tùy chỉnh này"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {/* Nút bấm Thêm phong cách riêng */}
                      <div
                        onClick={() => handleOpenAddCustomStyleModal()}
                        className="p-4 rounded-2xl border-2 border-dashed border-slate-800 hover:border-purple-500/60 hover:bg-purple-500/5 cursor-pointer transition select-none flex flex-col items-center justify-center min-h-[110px] text-center gap-2 group"
                      >
                        <div className="w-8 h-8 rounded-xl bg-slate-800 group-hover:bg-purple-500/20 text-slate-400 group-hover:text-purple-300 flex items-center justify-center transition">
                          <Plus size={18} />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-slate-300 group-hover:text-white transition block">
                            + Thêm phong cách riêng
                          </span>
                          <span className="text-[10px] text-slate-500 group-hover:text-slate-400 transition">
                            Tự viết Prompt / Yêu cầu cho AI
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Khung xem & sửa nhanh Prompt của phong cách tùy chỉnh đang chọn */}
                    {(() => {
                      const isCustom = formSettings.aiStyle.startsWith('custom_') || (formSettings.customAiStyles || []).some((s) => s.id === formSettings.aiStyle);
                      if (!isCustom) return null;
                      const curStyle = (formSettings.customAiStyles || []).find((s) => s.id === formSettings.aiStyle);
                      return (
                        <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/30 space-y-2 mt-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-purple-300 flex items-center gap-1.5">
                              <Sparkles size={14} className="text-purple-400" />
                              Hướng dẫn kịch bản (Prompt) cho phong cách "{curStyle?.name || 'Tùy chỉnh'}":
                            </span>
                            {curStyle && (
                              <button
                                type="button"
                                onClick={() => handleOpenEditCustomStyleModal(curStyle)}
                                className="text-[11px] text-purple-300 hover:text-purple-200 underline font-medium cursor-pointer"
                              >
                                Đổi tên / Chỉnh sửa
                              </button>
                            )}
                          </div>
                          <textarea
                            value={formSettings.customAiPrompt || curStyle?.prompt || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              const updatedList = (formSettings.customAiStyles || []).map((s) =>
                                s.id === formSettings.aiStyle ? { ...s, prompt: val } : s
                              );
                              setFormSettings({
                                ...formSettings,
                                customAiPrompt: val,
                                customAiStyles: updatedList,
                              });
                            }}
                            placeholder="Nhập hướng dẫn chi tiết cho AI (VD: Viết theo phong cách kịch tính, ngắn gọn, xưng hô anh em, tập trung vào công năng sản phẩm...)"
                            rows={3}
                            className="w-full bg-[#0d0f17] border border-purple-500/20 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 transition leading-relaxed resize-y font-mono"
                          />
                          <p className="text-[10px] text-slate-500">
                            💡 Mẹo: Gemini AI sẽ tuân thủ chính xác hướng dẫn này khi dịch hoặc sáng tạo kịch bản lồng tiếng cho video.
                          </p>
                        </div>
                      );
                    })()}
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
                      Kho {voices.length} giọng — Gemini, Edge-TTS{voices.some((v) => v.engine === 'vieneu') ? ', VieNeu-TTS' : ''}, phát thử tức thì
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
                            {voices.find((v) => v.id === formSettings.voiceId)?.name ||
                              formSettings.voiceId.replace('gemini-', 'Gemini ').replace('vi-VN-', '')}
                          </span>
                          {voices.find((v) => v.id === formSettings.voiceId) ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                              Đang chọn cho cấu hình này
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold">
                              Giọng không còn tồn tại — hãy chọn giọng khác bên dưới
                            </span>
                          )}
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
                    <div className="flex items-center gap-1.5 text-xs flex-wrap">
                      {['all', ...Array.from(new Set(voices.map((v) => v.engine)))].map((eng) => (
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
                            ? `Tất cả (${voices.length})`
                            : eng === 'gemini'
                            ? `Gemini 2.5 Pro (${voices.filter((v) => v.engine === 'gemini').length} giọng)`
                            : eng === 'edge-tts'
                            ? `Edge-TTS (${voices.filter((v) => v.engine === 'edge-tts').length} giọng)`
                            : eng === 'vieneu'
                            ? `VieNeu-TTS (${voices.filter((v) => v.engine === 'vieneu').length} giọng)`
                            : `${eng} (${voices.filter((v) => v.engine === eng).length} giọng)`}
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

                  {/* Tùy chọn Đa Giọng Đọc Theo Nhân Vật */}
                  <div
                    className={`mt-5 rounded-3xl border transition-all duration-300 p-5 ${
                      formSettings.multiVoice
                        ? 'bg-[#121422] border-indigo-500/40 shadow-xl shadow-indigo-950/30 ring-1 ring-indigo-500/20'
                        : 'bg-[#0f1118] border-slate-800/80 hover:border-slate-700/80'
                    }`}
                  >
                    {/* Switch Row */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
                            formSettings.multiVoice
                              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/40'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          <Users size={18} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white tracking-wide">
                              Đa Giọng Đọc Phân Vai
                            </span>
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              Multi-Voice
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Tự động phân vai kịch bản theo từng nhân vật và cố định giọng đọc suốt video.
                          </p>
                        </div>
                      </div>

                      {/* Modern Toggle Switch */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={formSettings.multiVoice ?? false}
                        onClick={() =>
                          setFormSettings({ ...formSettings, multiVoice: !formSettings.multiVoice })
                        }
                        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          formSettings.multiVoice ? 'bg-indigo-600 shadow-md shadow-indigo-600/40' : 'bg-slate-800'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                            formSettings.multiVoice ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* When Multi-Voice is Activated */}
                    {formSettings.multiVoice && (
                      <div className="pt-4 space-y-4">
                        {/* 3 Flexible Character Cards: Nhân Vật 1, Nhân Vật 2, Người Dẫn Chuyện */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
                          {/* Card 1: Nhân Vật 1 */}
                          {(() => {
                            const v1 = getSelectedVoice(formSettings.voiceMale, 'vi-VN-NamMinhNeural');
                            return (
                              <div className="p-4 rounded-2xl bg-[#0b0e17] border border-sky-500/30 flex flex-col justify-between shadow-sm relative overflow-hidden group hover:border-sky-500/50 transition">
                                <div className="space-y-2.5">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <div className="w-6 h-6 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center">
                                        <User size={13} />
                                      </div>
                                      <span className="text-xs font-bold text-sky-300 uppercase tracking-wider">
                                        Nhân Vật 1
                                      </span>
                                    </div>
                                    <span className="text-[10px] font-semibold text-sky-400/80 bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20">
                                      Vai 1
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setVoicePickerTarget('char1');
                                        setVoicePickerOpen(true);
                                      }}
                                      className="flex-1 min-w-0 bg-[#141824] hover:bg-[#1a2030] border border-sky-500/30 focus:border-sky-400 rounded-xl px-3 py-2 text-left transition cursor-pointer flex items-center justify-between gap-2 group/btn"
                                      title="Bấm để mở danh sách chọn giọng đọc"
                                    >
                                      <div className="truncate min-w-0">
                                        <div className="text-xs font-bold text-white truncate group-hover/btn:text-sky-300 transition">
                                          {v1.name}
                                        </div>
                                        <div className="text-[10px] text-slate-400 truncate">
                                          {v1.gender === 'Female' ? 'Giọng Nữ' : 'Giọng Nam'} • {v1.engine === 'vieneu' ? 'VieNeu' : v1.engine === 'gemini' ? 'Gemini' : 'Edge TTS'}
                                        </div>
                                      </div>
                                      <SlidersHorizontal size={13} className="text-sky-400 shrink-0 group-hover/btn:scale-110 transition" />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => handleToggleVoicePreview(formSettings.voiceMale || 'vi-VN-NamMinhNeural')}
                                      className="w-9 h-9 rounded-xl bg-sky-500/20 hover:bg-sky-500/35 text-sky-300 border border-sky-500/30 flex items-center justify-center transition shrink-0 cursor-pointer"
                                      title="Nghe thử giọng Nhân Vật 1"
                                    >
                                      {loadingVoiceId === (formSettings.voiceMale || 'vi-VN-NamMinhNeural') ? (
                                        <RefreshCw size={12} className="animate-spin text-sky-300" />
                                      ) : playingVoiceId === (formSettings.voiceMale || 'vi-VN-NamMinhNeural') ? (
                                        <Square size={10} className="fill-amber-400 text-amber-400" />
                                      ) : (
                                        <Play size={12} className="fill-current ml-0.5" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Card 2: Nhân Vật 2 */}
                          {(() => {
                            const v2 = getSelectedVoice(formSettings.voiceFemale, 'vi-VN-HoaiMyNeural');
                            return (
                              <div className="p-4 rounded-2xl bg-[#0b0e17] border border-pink-500/30 flex flex-col justify-between shadow-sm relative overflow-hidden group hover:border-pink-500/50 transition">
                                <div className="space-y-2.5">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <div className="w-6 h-6 rounded-lg bg-pink-500/20 text-pink-400 flex items-center justify-center">
                                        <Users size={13} />
                                      </div>
                                      <span className="text-xs font-bold text-pink-300 uppercase tracking-wider">
                                        Nhân Vật 2
                                      </span>
                                    </div>
                                    <span className="text-[10px] font-semibold text-pink-400/80 bg-pink-500/10 px-2 py-0.5 rounded-full border border-pink-500/20">
                                      Vai 2
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setVoicePickerTarget('char2');
                                        setVoicePickerOpen(true);
                                      }}
                                      className="flex-1 min-w-0 bg-[#141824] hover:bg-[#1a2030] border border-pink-500/30 focus:border-pink-400 rounded-xl px-3 py-2 text-left transition cursor-pointer flex items-center justify-between gap-2 group/btn"
                                      title="Bấm để mở danh sách chọn giọng đọc"
                                    >
                                      <div className="truncate min-w-0">
                                        <div className="text-xs font-bold text-white truncate group-hover/btn:text-pink-300 transition">
                                          {v2.name}
                                        </div>
                                        <div className="text-[10px] text-slate-400 truncate">
                                          {v2.gender === 'Female' ? 'Giọng Nữ' : 'Giọng Nam'} • {v2.engine === 'vieneu' ? 'VieNeu' : v2.engine === 'gemini' ? 'Gemini' : 'Edge TTS'}
                                        </div>
                                      </div>
                                      <SlidersHorizontal size={13} className="text-pink-400 shrink-0 group-hover/btn:scale-110 transition" />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => handleToggleVoicePreview(formSettings.voiceFemale || 'vi-VN-HoaiMyNeural')}
                                      className="w-9 h-9 rounded-xl bg-pink-500/20 hover:bg-pink-500/35 text-pink-300 border border-pink-500/30 flex items-center justify-center transition shrink-0 cursor-pointer"
                                      title="Nghe thử giọng Nhân Vật 2"
                                    >
                                      {loadingVoiceId === (formSettings.voiceFemale || 'vi-VN-HoaiMyNeural') ? (
                                        <RefreshCw size={12} className="animate-spin text-pink-300" />
                                      ) : playingVoiceId === (formSettings.voiceFemale || 'vi-VN-HoaiMyNeural') ? (
                                        <Square size={10} className="fill-amber-400 text-amber-400" />
                                      ) : (
                                        <Play size={12} className="fill-current ml-0.5" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Card 3: Người Dẫn Chuyện */}
                          {(() => {
                            const vn = getSelectedVoice(formSettings.voiceNarrator, formSettings.voiceId || 'vi-VN-NamMinhNeural');
                            return (
                              <div className="p-4 rounded-2xl bg-[#0b0e17] border border-amber-500/30 flex flex-col justify-between shadow-sm relative overflow-hidden group hover:border-amber-500/50 transition">
                                <div className="space-y-2.5">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                                        <Mic size={13} />
                                      </div>
                                      <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                                        Người Dẫn Chuyện
                                      </span>
                                    </div>
                                    <span className="text-[10px] font-semibold text-amber-400/80 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                                      Thuyết Minh
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setVoicePickerTarget('narrator');
                                        setVoicePickerOpen(true);
                                      }}
                                      className="flex-1 min-w-0 bg-[#141824] hover:bg-[#1a2030] border border-amber-500/30 focus:border-amber-400 rounded-xl px-3 py-2 text-left transition cursor-pointer flex items-center justify-between gap-2 group/btn"
                                      title="Bấm để mở danh sách chọn giọng đọc"
                                    >
                                      <div className="truncate min-w-0">
                                        <div className="text-xs font-bold text-white truncate group-hover/btn:text-amber-300 transition">
                                          {vn.name}
                                        </div>
                                        <div className="text-[10px] text-slate-400 truncate">
                                          {vn.gender === 'Female' ? 'Giọng Nữ' : 'Giọng Nam'} • {vn.engine === 'vieneu' ? 'VieNeu' : vn.engine === 'gemini' ? 'Gemini' : 'Edge TTS'}
                                        </div>
                                      </div>
                                      <SlidersHorizontal size={13} className="text-amber-400 shrink-0 group-hover/btn:scale-110 transition" />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => handleToggleVoicePreview(formSettings.voiceNarrator || formSettings.voiceId)}
                                      className="w-9 h-9 rounded-xl bg-amber-500/20 hover:bg-amber-500/35 text-amber-300 border border-amber-500/30 flex items-center justify-center transition shrink-0 cursor-pointer"
                                      title="Nghe thử giọng Người Dẫn Chuyện"
                                    >
                                      {loadingVoiceId === (formSettings.voiceNarrator || formSettings.voiceId) ? (
                                        <RefreshCw size={12} className="animate-spin text-amber-300" />
                                      ) : playingVoiceId === (formSettings.voiceNarrator || formSettings.voiceId) ? (
                                        <Square size={10} className="fill-amber-400 text-amber-400" />
                                      ) : (
                                        <Play size={12} className="fill-current ml-0.5" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Quick Pair Presets */}
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-400">
                          <span className="font-medium text-slate-400">Gợi ý phối giọng:</span>
                          <button
                            type="button"
                            onClick={() =>
                              setFormSettings({
                                ...formSettings,
                                voiceMale: 'vi-VN-NamMinhNeural',
                                voiceFemale: 'vi-VN-HoaiMyNeural',
                                voiceNarrator: 'vi-VN-NamMinhNeural',
                              })
                            }
                            className="px-2.5 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700/80 transition cursor-pointer"
                          >
                            ⭐ Nam Minh + Hoài My
                          </button>
                          {voices.some((v) => v.engine === 'vieneu') && (
                            <button
                              type="button"
                              onClick={() =>
                                setFormSettings({
                                  ...formSettings,
                                  voiceMale: 'vieneu_ba_thang',
                                  voiceFemale: 'vi-VN-HoaiMyNeural',
                                  voiceNarrator: 'vieneu_thien_tam_duc',
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-500/30 transition cursor-pointer"
                            >
                              🎙️ VieNeu (Bá Thắng + Hoài My)
                            </button>
                          )}
                          {voices.some((v) => v.engine === 'gemini') && (
                            <button
                              type="button"
                              onClick={() =>
                                setFormSettings({
                                  ...formSettings,
                                  voiceMale: 'gemini_achird',
                                  voiceFemale: 'gemini_aoede',
                                  voiceNarrator: 'gemini_alnilam',
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-indigo-950/40 hover:bg-indigo-900/50 text-indigo-300 border border-indigo-500/30 transition cursor-pointer"
                            >
                              ✨ Gemini 2.5 Pro
                            </button>
                          )}
                        </div>
                      </div>
                    )}
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

                      {/* Giữ âm gốc & Tách lời thoại giữ BGM/SFX */}
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
                            {/* Nút bật tách giọng nói gốc giữ trọn BGM & SFX */}
                            <label className="flex items-start gap-2.5 cursor-pointer text-xs font-bold text-emerald-400 select-none bg-emerald-950/20 p-3 rounded-xl border border-emerald-500/20">
                              <input
                                type="checkbox"
                                checked={formSettings.keepBgmSfx ?? true}
                                onChange={(e) =>
                                  setFormSettings({ ...formSettings, keepBgmSfx: e.target.checked })
                                }
                                className="w-4 h-4 mt-0.5 rounded text-emerald-600 bg-slate-900 border-slate-700 shrink-0"
                              />
                              <div className="flex flex-col">
                                <span className="flex items-center gap-1.5">
                                  <span>Tách giọng nói gốc — Giữ trọn vẹn Nhạc nền (BGM) & Hiệu ứng âm thanh (SFX)</span>
                                  <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/30">Khuyên dùng</span>
                                </span>
                                <span className="text-[11px] text-slate-400 font-normal mt-0.5">
                                  Triệt tiêu lời thoại tiếng Trung/Anh của nhân vật bằng bộ lọc triệt tiêu âm thanh trung tâm (Out-of-Phase Cancellation), bảo toàn trọn vẹn tiếng động kịch tính, tiếng cười, tiếng nổ và nhạc nền stereo.
                                </span>
                              </div>
                            </label>

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

      {/* Modal Thêm / Sửa Phong Cách Tùy Chỉnh Riêng Cho Cấu Hình */}
      {customStyleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg bg-[#161a24] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden text-slate-100 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-purple-400 flex items-center justify-center shadow-inner">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">
                    {editingCustomStyleId ? 'Chỉnh Sửa Phong Cách Tùy Chỉnh' : 'Thêm Phong Cách Kịch Bản Mới'}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Lưu vào cấu hình: <span className="text-purple-300 font-semibold">{formName || 'Cấu hình mẫu'}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCustomStyleModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Tên Phong Cách: <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={modalStyleName}
                  onChange={(e) => setModalStyleName(e.target.value)}
                  placeholder="VD: Bán đồ ăn vặt / Review công nghệ GenZ / ..."
                  className="w-full bg-[#0b0d14] border border-slate-700/80 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 transition font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Mô Tả Ngắn (Hiển thị tóm tắt trên thẻ):
                </label>
                <input
                  type="text"
                  value={modalStyleDesc}
                  onChange={(e) => setModalStyleDesc(e.target.value)}
                  placeholder="VD: Ngôn từ gần gũi, khơi gợi nhu cầu, kích thích chốt đơn..."
                  className="w-full bg-[#0b0d14] border border-slate-700/80 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Hướng Dẫn Kịch Bản Cho Gemini AI (Prompt): <span className="text-rose-400">*</span>
                </label>
                <textarea
                  value={modalStylePrompt}
                  onChange={(e) => setModalStylePrompt(e.target.value)}
                  placeholder="VD: Đóng vai người bạn thân thiết, nói chuyện chân thật tự nhiên. Dùng từ ngữ gần gũi, giật gân ở đầu video để giữ chân người xem. Câu từ ngắn gọn, dứt khoát dưới 15 chữ, nhịp điệu nhanh và hấp dẫn..."
                  rows={4}
                  className="w-full bg-[#0b0d14] border border-slate-700/80 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 transition leading-relaxed resize-y font-mono"
                />
                <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                  <span>Gemini AI sẽ tuân thủ nghiêm ngặt hướng dẫn này khi dịch & viết thoại.</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCustomStyleModalOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveCustomStyleModal}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/30 transition cursor-pointer"
              >
                {editingCustomStyleId ? 'Cập Nhật Phong Cách' : 'Lưu & Chọn Phong Cách Này'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal / Popup Chọn Giọng Đọc Phân Vai */}
      {voicePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-2xl bg-[#11131e] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-slate-100">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-[#151826]">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-inner ${
                    voicePickerTarget === 'char1'
                      ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                      : voicePickerTarget === 'char2'
                      ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}
                >
                  {voicePickerTarget === 'narrator' ? (
                    <Mic size={20} />
                  ) : voicePickerTarget === 'char2' ? (
                    <Users size={20} />
                  ) : (
                    <User size={20} />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">
                    Chọn Giọng Đọc Cho{' '}
                    {voicePickerTarget === 'char1'
                      ? 'Nhân Vật 1'
                      : voicePickerTarget === 'char2'
                      ? 'Nhân Vật 2'
                      : 'Người Dẫn Chuyện'}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Chọn giọng đọc và bấm biểu tượng loa để nghe thử mẫu trước khi áp dụng.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVoicePickerOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Filter & Search Bar */}
            <div className="p-4 border-b border-slate-800/80 bg-[#131622] space-y-3">
              <div className="relative">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={voicePickerSearch}
                  onChange={(e) => setVoicePickerSearch(e.target.value)}
                  placeholder="Tìm kiếm theo tên giọng đọc, vùng miền..."
                  className="w-full bg-[#0b0d14] border border-slate-700/80 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                  autoFocus
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto text-[11px]">
                {[
                  { id: 'all', label: 'Tất cả' },
                  { id: 'male', label: 'Giọng Nam' },
                  { id: 'female', label: 'Giọng Nữ' },
                  { id: 'vieneu', label: 'VieNeu Studio' },
                  { id: 'edge', label: 'Edge TTS' },
                  { id: 'gemini', label: 'Gemini AI' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setVoicePickerFilter(f.id)}
                    className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer shrink-0 ${
                      voicePickerFilter === f.id
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-800/70 text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Voice List */}
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filteredPickerVoices.map((v) => {
                const currentSelectedId =
                  voicePickerTarget === 'char1'
                    ? formSettings.voiceMale || 'vi-VN-NamMinhNeural'
                    : voicePickerTarget === 'char2'
                    ? formSettings.voiceFemale || 'vi-VN-HoaiMyNeural'
                    : formSettings.voiceNarrator || formSettings.voiceId;
                const isSelected = currentSelectedId === v.id;
                const isPlaying = playingVoiceId === v.id;
                const isLoading = loadingVoiceId === v.id;

                return (
                  <div
                    key={v.id}
                    onClick={() => handleSelectVoiceFromPicker(v.id)}
                    className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-3 group ${
                      isSelected
                        ? 'bg-indigo-600/20 border-indigo-500 ring-1 ring-indigo-500/40 shadow-sm'
                        : 'bg-[#0d0f17] border-slate-800/80 hover:border-slate-700 hover:bg-[#151825]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white truncate">{v.name}</span>
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase ${
                            v.gender === 'Female' ? 'bg-pink-500/15 text-pink-300' : 'bg-sky-500/15 text-sky-300'
                          }`}
                        >
                          {v.gender === 'Female' ? 'Nữ' : 'Nam'}
                        </span>
                        {v.engine === 'vieneu' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 font-semibold">
                            VieNeu
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 truncate mt-0.5">
                        {v.description || v.id}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleVoicePreview(v.id);
                        }}
                        className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition cursor-pointer"
                        title="Nghe thử"
                      >
                        {isLoading ? (
                          <RefreshCw size={11} className="animate-spin text-indigo-400" />
                        ) : isPlaying ? (
                          <Square size={9} className="fill-amber-400 text-amber-400" />
                        ) : (
                          <Play size={10} className="fill-current ml-0.5" />
                        )}
                      </button>

                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center ${
                          isSelected
                            ? 'bg-indigo-600 text-white'
                            : 'opacity-0 group-hover:opacity-60 text-slate-400'
                        }`}
                      >
                        <Check size={12} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-3.5 border-t border-slate-800 bg-[#131622] flex items-center justify-between text-xs text-slate-400">
              <span>Đang có {filteredPickerVoices.length} giọng đọc khả dụng</span>
              <button
                type="button"
                onClick={() => setVoicePickerOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
