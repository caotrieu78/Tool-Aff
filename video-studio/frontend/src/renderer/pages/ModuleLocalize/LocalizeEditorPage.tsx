import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Play, Pause, RotateCcw, Volume2, VolumeX, Sparkles, Sliders, Type,
  Mic, Save, Check, CheckCircle2, AlertCircle, Loader2, RefreshCw, Palette,
  Layers, Film, Clock, Edit3, ChevronRight, ChevronDown, Music, Search, Volume1, Eye,
  SlidersHorizontal, Download, FileText, User,
} from 'lucide-react';
import { localizeApi, settingsApi, libraryApi, LocalizePreset } from '../../api/client';

interface SegmentItem {
  start: number;
  end: number;
  text_zh: string;
  text_vi: string;
  speaker?: 'male' | 'female' | 'narrator' | string;
}

interface VoiceItem {
  id: string;
  name: string;
  gender: string;
  engine: string;
  preview_text?: string;
  tags?: string[];
}

function formatSubtitlePreviewText(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.includes('\n')) return trimmed;
  if (trimmed.includes('\\N')) return trimmed.replace(/\\N/g, '\n');
  const words = trimmed.split(/\s+/);
  if (trimmed.length <= 36 || words.length <= 5) return trimmed;
  if (trimmed.includes(', ')) {
    const idx = trimmed.indexOf(', ');
    const left = trimmed.slice(0, idx + 1).trim();
    const right = trimmed.slice(idx + 2).trim();
    if (left.split(/\s+/).length >= 2 && right.split(/\s+/).length >= 2) {
      return `${left}\n${right}`;
    }
  }
  const mid = Math.floor(words.length / 2);
  return `${words.slice(0, mid).join(' ')}\n${words.slice(mid).join(' ')}`;
}

export default function LocalizeEditorPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [videoData, setVideoData] = useState<any>(null);
  const [segments, setSegments] = useState<SegmentItem[]>([]);
  const [originalSegments, setOriginalSegments] = useState<SegmentItem[]>([]);
  const [activeTab, setActiveTab] = useState<'subtitles' | 'audio'>('subtitles');

  // Video playback
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [viewMode, setViewMode] = useState<'preview' | 'rendered'>('preview');
  const [originalVideoUrl, setOriginalVideoUrl] = useState<string>('');
  const [localizedVideoUrl, setLocalizedVideoUrl] = useState<string>('');
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(-1);

  // Subtitle styling configuration
  const [subFont, setSubFont] = useState('Montserrat');
  const [subFontSize, setSubFontSize] = useState(45);
  const [subColor, setSubColor] = useState('#FFE500');
  const [subBgColor, setSubBgColor] = useState('#000000');
  const [subBgOpacity, setSubBgOpacity] = useState(85);
  const [subStyleType, setSubStyleType] = useState('box');
  const [subBold, setSubBold] = useState(true);
  const [subItalic, setSubItalic] = useState(false);
  const [subPlacement, setSubPlacement] = useState('overlay');
  const [subPositionMode, setSubPositionMode] = useState('auto');
  const [subPositionPercent, setSubPositionPercent] = useState(82);
  const [blurAmount, setBlurAmount] = useState(15);
  const [blurMethod, setBlurMethod] = useState('boxblur');

  // Audio / TTS configuration
  const [voiceId, setVoiceId] = useState('vi-VN-HoaiMyNeural');
  const [originalVoiceId, setOriginalVoiceId] = useState('vi-VN-HoaiMyNeural');
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [originalVoiceSpeed, setOriginalVoiceSpeed] = useState(1.0);
  const [volumeVoiceover, setVolumeVoiceover] = useState(120);
  const [volumeOriginalBgm, setVolumeOriginalBgm] = useState(30);
  const [volumeOriginalVoice, setVolumeOriginalVoice] = useState(0);
  const [syncMode, setSyncMode] = useState('keep_video');

  // Voice list & preview
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState('');
  const [voiceEngineFilter, setVoiceEngineFilter] = useState('all');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [loadingVoiceId, setLoadingVoiceId] = useState<string | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const [videoAspect, setVideoAspect] = useState<string>('9 / 16');

  // Re-rendering state
  const [isReRendering, setIsReRendering] = useState(false);
  const [reRenderSuccess, setReRenderSuccess] = useState(false);
  const [isSavingFinal, setIsSavingFinal] = useState(false);
  const [hasUnrenderedChanges, setHasUnrenderedChanges] = useState(false);

  // Presets state
  const [presets, setPresets] = useState<LocalizePreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<number | string>('');
  const [presetNotification, setPresetNotification] = useState<string | null>(null);

  // Fetch editor data on mount
  useEffect(() => {
    if (!videoId) return;
    loadData();
    loadVoices();
    loadPresets();
  }, [videoId]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await localizeApi.getEditorData(Number(videoId));
      if (res && (res.success || res.video)) {
        setVideoData(res.video);
        setSegments(res.segments || []);
        setOriginalSegments(JSON.parse(JSON.stringify(res.segments || [])));

        const cfg = res.config || {};
        // Populate config state
        if (cfg.sub_font) setSubFont(cfg.sub_font);
        if (cfg.sub_font_size) setSubFontSize(cfg.sub_font_size);
        if (cfg.sub_color) setSubColor(cfg.sub_color);
        if (cfg.sub_bg_color) setSubBgColor(cfg.sub_bg_color);
        if (cfg.sub_bg_opacity !== undefined) setSubBgOpacity(cfg.sub_bg_opacity);
        if (cfg.sub_style_type) setSubStyleType(cfg.sub_style_type);
        if (cfg.sub_bold !== undefined) setSubBold(cfg.sub_bold);
        if (cfg.sub_italic !== undefined) setSubItalic(cfg.sub_italic);
        if (cfg.sub_placement) setSubPlacement(cfg.sub_placement);
        if (cfg.sub_position_mode) setSubPositionMode(cfg.sub_position_mode);
        if (cfg.sub_position_percent !== undefined) setSubPositionPercent(cfg.sub_position_percent);
        if (cfg.blur_amount !== undefined) setBlurAmount(cfg.blur_amount);
        if (cfg.blur_method) setBlurMethod(cfg.blur_method);

        if (cfg.voice_id) {
          setVoiceId(cfg.voice_id);
          setOriginalVoiceId(cfg.voice_id);
        }
        if (cfg.voice_speed) {
          setVoiceSpeed(cfg.voice_speed);
          setOriginalVoiceSpeed(cfg.voice_speed);
        }
        if (cfg.volume_voiceover !== undefined) setVolumeVoiceover(cfg.volume_voiceover);
        if (cfg.volume_original !== undefined) setVolumeOriginalBgm(cfg.volume_original);
        if (cfg.volume_original_voice !== undefined) setVolumeOriginalVoice(cfg.volume_original_voice);
        if (cfg.sync_mode) setSyncMode(cfg.sync_mode);

        const orig = res.video.original_video_url || '';
        const loc = res.video.localized_video_url || '';
        const resolvedOrig = orig ? (orig.startsWith('http') ? orig : libraryApi.getMediaUrl(orig)) : '';
        const resolvedLoc = loc ? (loc.startsWith('http') ? loc : libraryApi.getMediaUrl(loc)) : '';

        setOriginalVideoUrl(resolvedOrig);
        setLocalizedVideoUrl(resolvedLoc);

        // Luôn phát Video Đã Render (có tiếng lồng tiếng Việt và phụ đề hoàn chỉnh)
        const targetVideo = resolvedLoc || resolvedOrig;
        setVideoSrc(targetVideo);
        setViewMode('rendered');
      } else {
        setError('Không tìm thấy dữ liệu video hoặc chưa hoàn thành Lồng Tiếng.');
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi khi tải thông tin editor.');
    } finally {
      setLoading(false);
    }
  };

  const switchViewMode = (mode: 'preview' | 'rendered') => {
    setViewMode(mode);
    const targetUrl = mode === 'preview' ? originalVideoUrl : localizedVideoUrl;
    if (targetUrl) {
      const currentPos = videoRef.current ? videoRef.current.currentTime : 0;
      setVideoSrc(targetUrl);
      if (videoRef.current) {
        videoRef.current.src = targetUrl;
        videoRef.current.currentTime = currentPos;
        if (isPlaying) {
          videoRef.current.play().catch(() => {
            // ignore autoplay restriction
          });
        }
      }
    }
  };

  const loadVoices = async () => {
    try {
      const res = await settingsApi.getTtsVoices();
      setVoices(res.voices || []);
    } catch (err) {
      console.error('Failed to load voices:', err);
    }
  };

  const loadPresets = async () => {
    try {
      const res = await localizeApi.getPresets();
      if (res && res.presets) {
        setPresets(res.presets);
      }
    } catch (err) {
      console.error('Failed to load presets:', err);
    }
  };

  // Áp dụng toàn bộ styling & audio từ cấu hình mẫu, giữ trọn vẹn sub đã chỉnh sửa
  const handleApplyPreset = (presetIdOrStr: number | string) => {
    if (!presetIdOrStr) {
      setSelectedPresetId('');
      return;
    }
    const pId = Number(presetIdOrStr);
    const found = presets.find((p) => p.id === pId);
    if (!found || !found.settings) return;
    const s = found.settings;

    // Cấu hình cũ có thể đã bị lưu nhầm dưới key camelCase (bug đã sửa ở LocalizePresetsPage) —
    // đọc kèm fallback camelCase để các cấu hình đã lưu trước đó vẫn áp dụng đúng, không cần lưu lại.
    const subFontVal = s.sub_font ?? s.subFont;
    const subFontSizeVal = s.sub_font_size ?? s.subFontSize;
    const subColorVal = s.sub_color ?? s.subTextColor;
    const subBgColorVal = s.sub_bg_color ?? s.subBgColor;
    const subBgOpacityVal = s.sub_bg_opacity ?? s.subBgOpacity;
    const subStyleTypeVal = s.sub_style_type ?? s.subStyleType;
    const subBoldVal = s.sub_bold ?? s.subBold;
    const subItalicVal = s.sub_italic ?? s.subItalic;
    const subPlacementVal = s.sub_placement ?? s.subPlacement;
    const subPositionModeVal = s.sub_position_mode ?? s.subPositionMode;
    const subPositionPercentVal = s.sub_position_percent ?? s.subPositionPercent;
    const blurAmountVal = s.blur_amount ?? s.blurAmount;
    const blurMethodVal = s.blur_method ?? s.blurMethod;
    const voiceIdVal = s.voice_id ?? s.voiceId;
    const voiceSpeedVal = s.voice_speed ?? s.voiceSpeed;
    const syncModeVal = s.sync_mode ?? s.syncMode;
    const volumeVoiceoverVal = s.volume_voiceover ?? s.aiVoiceVolume;
    const volumeOriginalVal = s.volume_original ?? s.bgmVolume;
    const volumeOriginalVoiceVal = s.volume_original_voice ?? s.originalVoiceVolume;

    // 1. Phụ đề (Font, cỡ chữ, màu sắc, vị trí, làm mờ)
    if (subFontVal) setSubFont(subFontVal);
    if (subFontSizeVal) setSubFontSize(subFontSizeVal);
    if (subColorVal) setSubColor(subColorVal);
    if (subBgColorVal) setSubBgColor(subBgColorVal);
    if (subBgOpacityVal !== undefined) setSubBgOpacity(subBgOpacityVal);
    if (subStyleTypeVal) setSubStyleType(subStyleTypeVal);
    if (subBoldVal !== undefined) setSubBold(subBoldVal);
    if (subItalicVal !== undefined) setSubItalic(subItalicVal);
    if (subPlacementVal) setSubPlacement(subPlacementVal);
    if (subPositionModeVal) setSubPositionMode(subPositionModeVal);
    if (subPositionPercentVal !== undefined) setSubPositionPercent(subPositionPercentVal);
    if (blurAmountVal !== undefined) setBlurAmount(blurAmountVal);
    if (blurMethodVal) setBlurMethod(blurMethodVal);

    // 2. Lồng tiếng & Âm lượng
    if (voiceIdVal) setVoiceId(voiceIdVal);
    if (voiceSpeedVal !== undefined) setVoiceSpeed(voiceSpeedVal);
    if (syncModeVal) setSyncMode(syncModeVal);
    if (volumeVoiceoverVal !== undefined) setVolumeVoiceover(volumeVoiceoverVal);
    if (volumeOriginalVal !== undefined) setVolumeOriginalBgm(volumeOriginalVal);
    if (volumeOriginalVoiceVal !== undefined) setVolumeOriginalVoice(volumeOriginalVoiceVal);

    setSelectedPresetId(pId);
    setHasUnrenderedChanges(true);
    setPresetNotification(
      `✔ Đã áp dụng cấu hình "${found.name}". Kịch bản sub đã chỉnh sửa (${segments.length} câu) được giữ nguyên để render!`
    );
    setTimeout(() => setPresetNotification(null), 5000);
  };

  // Synchronize current segment with video playback time
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const cur = videoRef.current.currentTime;
    setCurrentTime(cur);

    const idx = segments.findIndex((s) => cur >= s.start && cur <= s.end);
    setActiveSegmentIndex(idx);
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      if (videoRef.current.videoWidth && videoRef.current.videoHeight) {
        setVideoAspect(`${videoRef.current.videoWidth} / ${videoRef.current.videoHeight}`);
      }
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const jumpToTime = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seconds;
    if (!isPlaying) {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSegmentTextChange = (index: number, newText: string) => {
    const updated = [...segments];
    updated[index].text_vi = newText;
    setSegments(updated);
    setHasUnrenderedChanges(true);
  };

  const handleSegmentSpeakerChange = (index: number, newSpeaker: string) => {
    const updated = [...segments];
    updated[index] = { ...updated[index], speaker: newSpeaker };
    setSegments(updated);
    setHasUnrenderedChanges(true);
  };

  const handleExportFile = (format: 'srt' | 'mp3' | 'mp4') => {
    if (!videoId) return;
    const url = localizeApi.getExportUrl(Number(videoId), format);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Preview TTS voice sample
  const handleToggleVoicePreview = async (targetVoiceId: string) => {
    if (playingVoiceId === targetVoiceId && voiceAudioRef.current) {
      voiceAudioRef.current.pause();
      setPlayingVoiceId(null);
      return;
    }

    try {
      if (voiceAudioRef.current) {
        voiceAudioRef.current.pause();
      }
      setLoadingVoiceId(targetVoiceId);
      setPlayingVoiceId(targetVoiceId);

      const res = await settingsApi.getTtsPreview(targetVoiceId);
      const audioUrl = res.audio_url.startsWith('http') ? res.audio_url : libraryApi.getMediaUrl(res.audio_url);
      const audio = new Audio(audioUrl);
      voiceAudioRef.current = audio;

      audio.onended = () => {
        setPlayingVoiceId(null);
        setLoadingVoiceId(null);
      };
      audio.onerror = () => {
        setPlayingVoiceId(null);
        setLoadingVoiceId(null);
      };
      await audio.play();
      setLoadingVoiceId(null);
    } catch (e) {
      console.error(e);
      setPlayingVoiceId(null);
      setLoadingVoiceId(null);
    }
  };

  // Re-render video with new settings
  const handleReRender = async () => {
    if (!videoId) return;
    try {
      setIsReRendering(true);
      setReRenderSuccess(false);

      // Check if text changed, speaker changed, or voice changed
      const textChanged = JSON.stringify(segments.map(s => s.text_vi)) !== JSON.stringify(originalSegments.map(s => s.text_vi));
      const speakerChanged = JSON.stringify(segments.map(s => s.speaker || 'narrator')) !== JSON.stringify(originalSegments.map(s => s.speaker || 'narrator'));
      const voiceChanged = voiceId !== originalVoiceId || voiceSpeed !== originalVoiceSpeed;
      const reSynthesize = textChanged || voiceChanged || speakerChanged;

      const configPayload = {
        sub_font: subFont,
        sub_font_size: subFontSize,
        sub_color: subColor,
        sub_bg_color: subBgColor,
        sub_bg_opacity: subBgOpacity,
        sub_style_type: subStyleType,
        sub_bold: subBold,
        sub_italic: subItalic,
        sub_placement: subPlacement,
        sub_position_mode: subPositionMode,
        sub_position_percent: subPositionPercent,
        blur_amount: blurAmount,
        blur_method: blurMethod,
        cover_old_sub: true,
        show_subtitles: true,
        voice_id: voiceId,
        voice_speed: voiceSpeed,
        volume_voiceover: volumeVoiceover,
        volume_original: volumeOriginalBgm,
        volume_original_voice: volumeOriginalVoice,
        sync_mode: syncMode,
      };

      const res = await localizeApi.reRenderEditor(Number(videoId), {
        segments,
        config: configPayload,
        re_synthesize_tts: reSynthesize,
        ...configPayload,
      });

      if (res && res.success) {
        setReRenderSuccess(true);
        setHasUnrenderedChanges(false);
        setOriginalSegments(JSON.parse(JSON.stringify(segments)));
        setOriginalVoiceId(voiceId);
        setOriginalVoiceSpeed(voiceSpeed);

        // Update video URL with cache buster to force browser refresh
        const vUrl = res.localized_video_url || res.video_url || '';
        const resolved = vUrl.startsWith('http') ? vUrl : libraryApi.getMediaUrl(vUrl);
        const freshUrl = `${resolved}${resolved.includes('?') ? '&' : '?'}t=${Date.now()}`;
        setLocalizedVideoUrl(freshUrl);
        setViewMode('rendered');
        setVideoSrc(freshUrl);
        if (videoRef.current) {
          videoRef.current.src = freshUrl;
          videoRef.current.load();
        }
      } else {
        alert('Render thất bại: ' + (res.message || 'Lỗi không xác định'));
      }
    } catch (err: any) {
      alert('Lỗi khi render lại: ' + (err.message || 'Vui lòng thử lại.'));
    } finally {
      setIsReRendering(false);
    }
  };

  // Save and proceed to Editor (Hậu Kỳ - Đang Xử Lý)
  const handleSaveAndGoToSchedule = async () => {
    if (!videoId) return;
    try {
      setIsSavingFinal(true);
      const res = await fetch(`/api/editor/video/${videoId}/save-final`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        throw new Error('Không thể lưu video thành phẩm.');
      }
      localStorage.setItem('editor_selected_video_id', String(videoId));
      localStorage.setItem('editor_open_tab', 'processing');
      navigate('/editor');
    } catch (err: any) {
      alert(err.message || 'Lỗi khi lưu video final');
    } finally {
      setIsSavingFinal(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // Selected voice detail
  const currentVoiceObj = voices.find((v) => v.id === voiceId) || {
    id: voiceId,
    name: voiceId,
    gender: 'Nữ',
    engine: 'Edge-TTS',
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0f1117] text-slate-300">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-indigo-500" size={36} />
          <p className="text-sm font-medium">Đang tải phòng dựng Lồng Tiếng Studio...</p>
        </div>
      </div>
    );
  }

  if (error || !videoData) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#0f1117] text-slate-300 p-6">
        <AlertCircle size={40} className="text-rose-500 mb-3" />
        <h2 className="text-lg font-bold text-white mb-1">Không thể mở phòng dựng</h2>
        <p className="text-xs text-slate-400 mb-4 max-w-sm text-center">{error}</p>
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition"
        >
          Quay lại
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0f15] text-slate-200 overflow-hidden select-none">
      {/* ── Top Header ────────────────────────────────────────────────────────── */}
      <header className="h-14 px-4 bg-[#121520] border-b border-slate-800/80 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700/60 transition cursor-pointer"
            title="Quay lại"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="flex items-center gap-2.5">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              Studio Lồng Tiếng
            </span>
            <h1 className="text-sm font-semibold text-white truncate max-w-[360px]" title={videoData.title}>
              {videoData.title || `Video #${videoData.id}`}
            </h1>
            <span className="text-xs text-slate-500">#{videoData.id}</span>
          </div>

          {hasUnrenderedChanges && (
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse">
              <Sparkles size={12} />
              <span>Có thay đổi chưa render</span>
            </span>
          )}

          {reRenderSuccess && !hasUnrenderedChanges && (
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <Check size={12} />
              <span>Đã cập nhật bản mới nhất</span>
            </span>
          )}
        </div>

        {/* Top Header Actions */}
        <div className="flex items-center gap-2.5">
          {selectedPresetId && (
            <span className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              <SlidersHorizontal size={11} />
              <span>Cấu hình: {presets.find((p) => p.id === Number(selectedPresetId))?.name}</span>
            </span>
          )}

          {/* Export Assets Dropdown/Group */}
          <div className="flex items-center bg-slate-900/90 border border-slate-700/70 rounded-xl p-0.5">
            <button
              type="button"
              onClick={() => handleExportFile('srt')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-300 hover:text-amber-300 hover:bg-slate-800 transition cursor-pointer"
              title="Tải tệp phụ đề tiếng Việt (.SRT)"
            >
              <FileText size={12} className="text-amber-400" />
              <span>Tải .SRT</span>
            </button>
            <div className="w-[1px] h-3.5 bg-slate-700/80 my-auto" />
            <button
              type="button"
              onClick={() => handleExportFile('mp3')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-300 hover:text-pink-300 hover:bg-slate-800 transition cursor-pointer"
              title="Tải audio lồng tiếng Việt rời (.MP3)"
            >
              <Music size={12} className="text-pink-400" />
              <span>Tải .MP3</span>
            </button>
            <div className="w-[1px] h-3.5 bg-slate-700/80 my-auto" />
            <button
              type="button"
              onClick={() => handleExportFile('mp4')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-300 hover:text-emerald-300 hover:bg-slate-800 transition cursor-pointer"
              title="Tải video thành phẩm đã ghép phụ đề & lồng tiếng (.MP4)"
            >
              <Download size={12} className="text-emerald-400" />
              <span>Tải .MP4</span>
            </button>
          </div>

          <button
            type="button"
            disabled={isReRendering}
            onClick={handleReRender}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-indigo-200 bg-indigo-600/30 hover:bg-indigo-600/45 border border-indigo-500/40 transition cursor-pointer active:scale-95 disabled:opacity-50"
            title="Áp dụng thay đổi phụ đề và lồng tiếng vào video"
          >
            <RefreshCw size={13} className={isReRendering ? 'animate-spin text-indigo-400' : 'text-indigo-300'} />
            <span>{isReRendering ? 'Đang Render Lại...' : 'Render Lại Video'}</span>
          </button>

          <button
            type="button"
            disabled={isSavingFinal || isReRendering}
            onClick={handleSaveAndGoToSchedule}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-md shadow-emerald-950/40 transition cursor-pointer active:scale-95 disabled:opacity-50"
            title="Lưu video thành phẩm và chuyển sang Hậu Kỳ"
          >
            {isSavingFinal ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Save size={13} />
            )}
            <span>Lưu</span>
          </button>
        </div>
      </header>

      {/* ── Main Studio Body (Two Columns) ────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Video Player & Studio Styling Controls */}
        <div className="w-[520px] 2xl:w-[580px] shrink-0 border-r border-slate-800/80 flex flex-col bg-[#10121a] overflow-hidden">
          {/* Top: Video Player Canvas */}
          <div className="p-3 bg-black/40 border-b border-slate-800/60 flex flex-col items-center justify-center shrink-0">
            {/* Header thông tin video thành phẩm */}
            <div className="w-full max-w-[340px] flex items-center justify-between px-1 mb-2 text-xs">
              <div className="flex items-center gap-1.5">
                <Film size={13} className="text-emerald-400" />
                <span className="font-bold text-white">Video Đã Render</span>
                <span className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Lồng tiếng
                </span>
              </div>
              {hasUnrenderedChanges ? (
                <span className="text-[10px] text-amber-400 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                  Có thay đổi chưa render
                </span>
              ) : (
                <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                  <Check size={11} />
                  Bản mới nhất
                </span>
              )}
            </div>

            {/* Video Container - Tự động thích ứng tỉ lệ 9:16 hoặc video ngang 16:9 */}
            <div
              className="relative rounded-xl overflow-hidden bg-black border border-slate-800 shadow-2xl flex items-center justify-center group mx-auto"
              style={{
                height: '420px',
                aspectRatio: videoAspect,
                width: 'auto',
                maxWidth: '100%',
              }}
            >
              <video
                ref={videoRef}
                src={videoSrc}
                playsInline
                className="w-full h-full object-contain"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                onClick={togglePlay}
              />

              {/* Play overlay button */}
              <button
                type="button"
                onClick={togglePlay}
                className={`absolute inset-0 m-auto w-12 h-12 rounded-full bg-indigo-600/80 text-white flex items-center justify-center transition-all ${
                  isPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-90 scale-100'
                } hover:scale-110 shadow-lg cursor-pointer`}
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} className="translate-x-0.5" />}
              </button>
            </div>

            {/* Video Controls Bar */}
            <div 
              className="w-full max-w-[320px] mt-2 flex items-center gap-2.5 text-[11px] text-slate-400 mx-auto"
            >
              <button
                type="button"
                onClick={togglePlay}
                className="p-1 rounded text-slate-300 hover:text-white transition cursor-pointer"
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>

              <button
                type="button"
                onClick={() => jumpToTime(0)}
                className="p-1 rounded text-slate-400 hover:text-white transition cursor-pointer"
                title="Về đầu video"
              >
                <RotateCcw size={13} />
              </button>

              {/* Scrubber slider */}
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={(e) => jumpToTime(parseFloat(e.target.value))}
                className="flex-1 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />

              <span className="font-mono text-[10.5px] tabular-nums text-slate-300">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
          </div>

          {/* Cấu Hình Mẫu Selector Banner */}
          <div className="px-3.5 py-2.5 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border-b border-slate-800 flex items-center justify-between gap-2.5 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                <SlidersHorizontal size={14} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-white tracking-wide">
                    Chọn Cấu Hình Render Lại
                  </span>
                  {selectedPresetId && (
                    <span className="px-1.5 py-0.2 rounded text-[9.5px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      Đã chọn
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 block truncate">
                  Áp dụng font, màu, giọng đọc • Giữ trọn vẹn sub đã sửa
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <select
                value={selectedPresetId}
                onChange={(e) => handleApplyPreset(e.target.value)}
                className="bg-[#141724] border border-indigo-500/40 hover:border-indigo-400 text-white rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer max-w-[200px]"
              >
                <option value="">-- Chọn cấu hình mẫu --</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.is_default ? '★ Mặc định' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => navigate('/localize/presets')}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-750 border border-slate-700/80 transition flex items-center gap-1 cursor-pointer"
                title="Quản lý và tạo cấu hình mẫu mới"
              >
                <SlidersHorizontal size={12} className="text-indigo-400" />
                <span>Cấu hình</span>
              </button>
            </div>
          </div>

          {/* Banner thông báo áp dụng thành công */}
          {presetNotification && (
            <div className="px-3.5 py-1.5 bg-emerald-500/15 border-b border-emerald-500/30 text-emerald-300 text-[11px] font-medium flex items-center gap-1.5 animate-in fade-in duration-150">
              <CheckCircle2 size={13} className="shrink-0 text-emerald-400" />
              <span className="truncate">{presetNotification}</span>
            </div>
          )}

          {/* Active Preset Summary & Re-render Action Card */}
          <div className="p-3.5 bg-[#121522] border-b border-slate-800 space-y-2.5 shrink-0">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Thông số cấu hình đang áp dụng:</span>
              <button
                type="button"
                onClick={() => navigate('/localize/presets')}
                className="text-indigo-400 hover:text-indigo-300 text-[11px] font-semibold flex items-center gap-0.5 transition"
              >
                <span>Sửa mẫu</span>
                <ChevronRight size={12} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {/* Subtitle preview tag */}
              <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center font-bold text-[10px] shrink-0 border"
                  style={{
                    backgroundColor: subStyleType === 'box' ? subBgColor : '#0f172a',
                    color: subColor,
                    borderColor: 'rgba(255,255,255,0.15)',
                  }}
                >
                  Aa
                </div>
                <div className="min-w-0">
                  <div className="text-slate-200 font-semibold truncate">{subFont} • {subFontSize}px</div>
                  <div className="text-slate-500 text-[10px] truncate">
                    {subPlacement === 'above' ? 'Bên trên sub gốc' : subPlacement === 'below' ? 'Dưới đáy' : 'Đè sub gốc'}
                  </div>
                </div>
              </div>

              {/* Voice & Audio tag */}
              <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                  <Mic size={12} />
                </div>
                <div className="min-w-0">
                  <div className="text-slate-200 font-semibold truncate">
                    {voices.find((v) => v.id === voiceId)?.name || voiceId || 'Giọng đọc'}
                  </div>
                  <div className="text-slate-500 text-[10px]">
                    {voiceSpeed}x • {syncMode === 'keep_video' ? 'Giữ độ dài gốc' : 'Khớp câu'}
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Re-render button inside column */}
            <button
              type="button"
              disabled={isReRendering}
              onClick={handleReRender}
              className="w-full py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-md shadow-indigo-950/50 transition cursor-pointer flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
            >
              <RefreshCw size={13} className={isReRendering ? 'animate-spin' : ''} />
              <span>{isReRendering ? 'Đang Render Lại Video...' : 'Render Lại Video Với Cấu Hình Này'}</span>
            </button>
          </div>

          {/* Collapsible Manual Overrides Drawer (Đóng mặc định để giao diện sạch sẽ, gọn gàng) */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <details className="group border-t border-slate-800/80">
              <summary className="px-4 py-2 bg-[#141724]/70 hover:bg-[#181c2d] text-[11px] font-semibold text-slate-400 hover:text-slate-200 cursor-pointer flex items-center justify-between select-none transition">
                <span className="flex items-center gap-1.5">
                  <SlidersHorizontal size={12} className="text-indigo-400" />
                  <span>Tùy chỉnh thủ công nâng cao (nếu không dùng mẫu)</span>
                </span>
                <ChevronDown size={13} className="text-slate-500 group-open:rotate-180 transition-transform" />
              </summary>

              {/* Tabs Header */}
              <div className="flex border-b border-slate-800 bg-[#121520] shrink-0">
                <button
                  onClick={() => setActiveTab('subtitles')}
                  className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition border-b-2 cursor-pointer ${
                    activeTab === 'subtitles'
                      ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Type size={13} />
                  <span>Kiểu Phụ Đề & Vị Trí</span>
                </button>
                <button
                  onClick={() => setActiveTab('audio')}
                  className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition border-b-2 cursor-pointer ${
                    activeTab === 'audio'
                      ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Mic size={13} />
                  <span>Lồng Tiếng & Âm Lượng</span>
                </button>
              </div>

              {/* Tab Content Area */}
              <div className="p-4 space-y-4 text-xs">
                {activeTab === 'subtitles' && (
              <div className="space-y-4">
                {/* Preset Pills */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                    Mẫu Phụ Đề Nhanh
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSubColor('#FFE500');
                        setSubBgColor('#000000');
                        setSubBgOpacity(85);
                        setSubStyleType('box');
                        setSubBold(true);
                        setHasUnrenderedChanges(true);
                      }}
                      className={`p-2 rounded-lg border text-center transition flex flex-col items-center gap-1 cursor-pointer ${
                        subColor === '#FFE500' && subStyleType === 'box'
                          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                          : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-850'
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full bg-[#FFE500]" />
                      <span className="text-[10.5px] font-medium">TikTok Vàng</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSubColor('#FFFFFF');
                        setSubBgColor('#000000');
                        setSubBgOpacity(85);
                        setSubStyleType('box');
                        setSubBold(true);
                        setHasUnrenderedChanges(true);
                      }}
                      className={`p-2 rounded-lg border text-center transition flex flex-col items-center gap-1 cursor-pointer ${
                        subColor === '#FFFFFF' && subStyleType === 'box' && subBgColor === '#000000'
                          ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300'
                          : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-850'
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full bg-white" />
                      <span className="text-[10.5px] font-medium">Hộp Đen</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSubColor('#FFFFFF');
                        setSubBgColor('#000000');
                        setSubBgOpacity(0);
                        setSubStyleType('outline');
                        setSubBold(true);
                        setHasUnrenderedChanges(true);
                      }}
                      className={`p-2 rounded-lg border text-center transition flex flex-col items-center gap-1 cursor-pointer ${
                        subStyleType === 'outline'
                          ? 'border-cyan-500 bg-cyan-500/15 text-cyan-300'
                          : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-850'
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full border border-white bg-black" />
                      <span className="text-[10.5px] font-medium">Viền Đen</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSubColor('#FFFFFF');
                        setSubBgColor('#E11D48');
                        setSubBgOpacity(90);
                        setSubStyleType('box');
                        setSubBold(true);
                        setHasUnrenderedChanges(true);
                      }}
                      className={`p-2 rounded-lg border text-center transition flex flex-col items-center gap-1 cursor-pointer ${
                        subBgColor === '#E11D48'
                          ? 'border-rose-500 bg-rose-500/15 text-rose-300'
                          : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-850'
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full bg-[#E11D48]" />
                      <span className="text-[10.5px] font-medium">Hộp Đỏ</span>
                    </button>
                  </div>
                </div>

                {/* Font & Size */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">Font Chữ</label>
                    <select
                      value={subFont}
                      onChange={(e) => {
                        setSubFont(e.target.value);
                        setHasUnrenderedChanges(true);
                      }}
                      className="w-full bg-[#161a26] border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="Montserrat">Montserrat (Chuẩn TikTok)</option>
                      <option value="Arial">Arial (Phổ biến)</option>
                      <option value="Roboto">Roboto</option>
                      <option value="Be Vietnam Pro">Be Vietnam Pro (Việt)</option>
                      <option value="Lexend">Lexend</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[11px] font-semibold text-slate-400">Cỡ Chữ (Font Size)</label>
                      <span className="text-[11px] font-mono text-indigo-400">{subFontSize}px</span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={70}
                      value={subFontSize}
                      onChange={(e) => {
                        setSubFontSize(parseInt(e.target.value));
                        setHasUnrenderedChanges(true);
                      }}
                      className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>

                {/* Colors & Opacity */}
                <div className="grid grid-cols-3 gap-2.5 items-center p-2.5 rounded-xl bg-slate-900/40 border border-slate-800/80">
                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-1">Màu Chữ</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={subColor}
                        onChange={(e) => {
                          setSubColor(e.target.value);
                          setHasUnrenderedChanges(true);
                        }}
                        className="w-7 h-7 rounded border border-slate-700 bg-transparent cursor-pointer p-0"
                      />
                      <span className="font-mono text-[10px] text-slate-300">{subColor}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10.5px] text-slate-400 mb-1">Màu Nền Hộp</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={subBgColor}
                        onChange={(e) => {
                          setSubBgColor(e.target.value);
                          setHasUnrenderedChanges(true);
                        }}
                        className="w-7 h-7 rounded border border-slate-700 bg-transparent cursor-pointer p-0"
                      />
                      <span className="font-mono text-[10px] text-slate-300">{subBgColor}</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[10.5px] text-slate-400">Độ Đậm Nền</label>
                      <span className="font-mono text-[10px] text-indigo-400">{subBgOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={subBgOpacity}
                      onChange={(e) => {
                        setSubBgOpacity(parseInt(e.target.value));
                        setHasUnrenderedChanges(true);
                      }}
                      className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>

                {/* Style Type & Formats */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">Kiểu Khung</label>
                    <div className="grid grid-cols-3 gap-1">
                      {(['box', 'outline', 'shadow'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            setSubStyleType(type);
                            setHasUnrenderedChanges(true);
                          }}
                          className={`py-1.5 rounded-lg border text-[10.5px] font-medium capitalize transition cursor-pointer ${
                            subStyleType === type
                              ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                              : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-300'
                          }`}
                        >
                          {type === 'box' ? 'Hộp Nền' : type === 'outline' ? 'Viền Chữ' : 'Đổ Bóng'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">Định Dạng</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSubBold(!subBold);
                          setHasUnrenderedChanges(true);
                        }}
                        className={`flex-1 py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${
                          subBold
                            ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                            : 'border-slate-800 bg-slate-900/60 text-slate-500'
                        }`}
                      >
                        B (In Đậm)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSubItalic(!subItalic);
                          setHasUnrenderedChanges(true);
                        }}
                        className={`flex-1 py-1.5 rounded-lg border text-xs italic transition cursor-pointer ${
                          subItalic
                            ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                            : 'border-slate-800 bg-slate-900/60 text-slate-500'
                        }`}
                      >
                        I (Nghiêng)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Subtitle Placement & Position */}
                <div className="p-2.5 rounded-xl bg-slate-900/40 border border-slate-800/80 space-y-2.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[11px] font-semibold text-slate-400">Vị Trí Phụ Đề</label>
                    <div className="flex gap-1">
                      {(['overlay', 'above', 'below'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            setSubPlacement(mode);
                            setSubPositionMode('auto');
                            setHasUnrenderedChanges(true);
                          }}
                          className={`px-2 py-0.5 rounded text-[10.5px] font-medium border transition cursor-pointer ${
                            subPlacement === mode && subPositionMode === 'auto'
                              ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                              : 'border-slate-800 bg-slate-900/60 text-slate-400'
                          }`}
                        >
                          {mode === 'overlay' ? 'Đè Lên Gốc' : mode === 'above' ? 'Ở Trên Gốc' : 'Ở Dưới Gốc'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* OCR Blur Settings */}
                  <div className="pt-2 border-t border-slate-800/60 grid grid-cols-2 gap-2.5">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[10.5px] text-slate-400">Độ Mờ Xóa Sub Gốc</label>
                        <span className="font-mono text-[10px] text-indigo-400">{blurAmount}px</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={50}
                        value={blurAmount}
                        onChange={(e) => {
                          setBlurAmount(parseInt(e.target.value));
                          setHasUnrenderedChanges(true);
                        }}
                        className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>

                    <div>
                      <label className="block text-[10.5px] text-slate-400 mb-1">Kiểu Làm Mờ</label>
                      <select
                        value={blurMethod}
                        onChange={(e) => {
                          setBlurMethod(e.target.value);
                          setHasUnrenderedChanges(true);
                        }}
                        className="w-full bg-[#161a26] border border-slate-700/80 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none"
                      >
                        <option value="boxblur">Box Blur (Nhanh, mịn)</option>
                        <option value="gaussian">Gaussian (Mượt cao cấp)</option>
                        <option value="pixelate">Pixelate (Điểm ảnh che phủ)</option>
                        <option value="solid">Solid (Khung đen tuyệt đối)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'audio' && (
              <div className="space-y-4">
                {/* Voice Selector Card */}
                <div className="p-3 rounded-xl bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-slate-900/60 border border-indigo-500/30">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">
                        Giọng Đọc Hiện Tại
                      </span>
                      <h4 className="text-sm font-bold text-white flex items-center gap-1.5 mt-0.5">
                        <Mic size={14} className="text-indigo-400" />
                        <span>{currentVoiceObj.name}</span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-normal bg-slate-800 text-slate-300 border border-slate-700">
                          {currentVoiceObj.engine}
                        </span>
                      </h4>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleVoicePreview(currentVoiceObj.id)}
                      className="p-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 transition cursor-pointer"
                      title="Nghe thử giọng"
                    >
                      {loadingVoiceId === currentVoiceObj.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : playingVoiceId === currentVoiceObj.id ? (
                        <VolumeX size={14} />
                      ) : (
                        <Volume2 size={14} />
                      )}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowVoiceModal(true)}
                    className="w-full mt-1 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/30 text-indigo-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <span>Đổi Giọng Đọc Khác (19+ Giọng AI)</span>
                    <ChevronRight size={14} />
                  </button>
                </div>

                {/* Voice Speed */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">
                    Tốc Độ Giọng Nói (Speed)
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[0.85, 1.0, 1.15, 1.25].map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        onClick={() => {
                          setVoiceSpeed(spd);
                          setHasUnrenderedChanges(true);
                        }}
                        className={`py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                          voiceSpeed === spd
                            ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                            : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-300'
                        }`}
                      >
                        {spd}x {spd === 1.0 ? '(Chuẩn)' : ''}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Audio Mixers */}
                <div className="space-y-3 p-3 rounded-xl bg-slate-900/40 border border-slate-800/80">
                  <h4 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Music size={13} className="text-indigo-400" />
                    <span>Bộ Hòa Âm (Audio Mixer)</span>
                  </h4>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[11px] text-slate-400">Âm Lượng Giọng AI (Voiceover)</span>
                      <span className="font-mono text-[11px] text-indigo-400">{volumeVoiceover}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={volumeVoiceover}
                      onChange={(e) => {
                        setVolumeVoiceover(parseInt(e.target.value));
                        setHasUnrenderedChanges(true);
                      }}
                      className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[11px] text-slate-400">Âm Lượng Âm Thanh Gốc</span>
                      <span className="font-mono text-[11px] text-indigo-400">{volumeOriginalBgm}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={volumeOriginalBgm}
                      onChange={(e) => {
                        setVolumeOriginalBgm(parseInt(e.target.value));
                        setHasUnrenderedChanges(true);
                      }}
                      className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>

                {/* Sync Mode */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">
                    Chế Độ Đồng Bộ Thời Gian
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSyncMode('keep_video');
                        setHasUnrenderedChanges(true);
                      }}
                      className={`p-2 rounded-xl border text-left transition cursor-pointer ${
                        syncMode === 'keep_video'
                          ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300'
                          : 'border-slate-800 bg-slate-900/60 text-slate-400'
                      }`}
                    >
                      <span className="block font-semibold text-xs text-slate-200">Giữ Độ Dài Gốc</span>
                      <span className="text-[10.5px] text-slate-500 leading-tight block mt-0.5">
                        Khuyên dùng: Video không bị giật, tự động co giãn giọng đọc.
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSyncMode('hybrid');
                        setHasUnrenderedChanges(true);
                      }}
                      className={`p-2 rounded-xl border text-left transition cursor-pointer ${
                        syncMode === 'hybrid'
                          ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300'
                          : 'border-slate-800 bg-slate-900/60 text-slate-400'
                      }`}
                    >
                      <span className="block font-semibold text-xs text-slate-200">Đồng Bộ Khớp Câu</span>
                      <span className="text-[10.5px] text-slate-500 leading-tight block mt-0.5">
                        Tạm dừng video ngắn khi câu dịch quá dài so với gốc.
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
              </div>
            </details>
          </div>
        </div>

        {/* Right Column: Subtitles Transcript Timeline */}
        <div className="flex-1 flex flex-col bg-[#0c0e14] overflow-hidden">
          {/* Transcript Header */}
          <div className="h-11 px-4 border-b border-slate-800/80 bg-[#121520] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Film size={14} className="text-indigo-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Kịch Bản Lời Thoại & Phụ Đề Lồng Tiếng
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10.5px] bg-slate-800 text-slate-300 font-mono">
                {segments.length} câu
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Nhấp vào timestamp để phát đoạn tương ứng • Chỉnh sửa text trực tiếp
            </p>
          </div>

          {/* Transcript Timeline List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar">
            {segments.map((seg, idx) => {
              const isActive = activeSegmentIndex === idx;
              return (
                <div
                  key={idx}
                  className={`p-3 rounded-xl border transition-all duration-150 flex flex-col gap-2 ${
                    isActive
                      ? 'border-indigo-500/80 bg-indigo-950/20 shadow-sm shadow-indigo-950/50 ring-1 ring-indigo-500/30'
                      : 'border-slate-800/80 bg-[#121520]/70 hover:border-slate-700/80 hover:bg-[#141724]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    {/* Timestamp clickable badge */}
                    <button
                      type="button"
                      onClick={() => jumpToTime(seg.start)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10.5px] font-mono transition cursor-pointer ${
                        isActive
                          ? 'bg-indigo-600 text-white font-semibold'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                      }`}
                      title="Nhấp để phát từ giây này"
                    >
                      <Play size={10} className="fill-current" />
                      <span>{formatTime(seg.start)} - {formatTime(seg.end)}</span>
                    </button>

                    <div className="flex items-center gap-2">
                      {/* Character/Speaker tag selector */}
                      <select
                        value={seg.speaker || 'narrator'}
                        onChange={(e) => handleSegmentSpeakerChange(idx, e.target.value)}
                        className={`text-[10.5px] font-semibold rounded-lg px-2 py-0.5 border cursor-pointer focus:outline-none transition ${
                          seg.speaker === 'male'
                            ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                            : seg.speaker === 'female'
                            ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        }`}
                        title="Phân loại vai / nhân vật đọc câu thoại này"
                      >
                        <option value="narrator" className="bg-[#121520] text-slate-200">🎙️ Dẫn chuyện</option>
                        <option value="male" className="bg-[#121520] text-slate-200">👤 Nhân vật 1</option>
                        <option value="female" className="bg-[#121520] text-slate-200">👥 Nhân vật 2</option>
                      </select>

                      <span className="text-[10px] font-mono text-slate-500">
                        Đoạn #{idx + 1}
                      </span>
                    </div>
                  </div>

                  {/* Chinese original text (for reference) */}
                  {seg.text_zh && (
                    <div className="text-[11.5px] text-slate-400 bg-slate-900/60 px-2.5 py-1.5 rounded-lg border border-slate-800/60 font-sans leading-relaxed">
                      <span className="text-[9.5px] uppercase font-bold text-slate-500 mr-2">Gốc:</span>
                      {seg.text_zh}
                    </div>
                  )}

                  {/* Editable Vietnamese subtitle text */}
                  <div>
                    <textarea
                      rows={2}
                      value={seg.text_vi}
                      onChange={(e) => handleSegmentTextChange(idx, e.target.value)}
                      className="w-full bg-[#171b26] border border-slate-700/80 focus:border-indigo-500 rounded-lg p-2 text-xs text-white leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 transition"
                      placeholder="Nhập nội dung phụ đề tiếng Việt..."
                    />
                  </div>
                </div>
              );
            })}

            {segments.length === 0 && (
              <div className="text-center py-12 text-slate-500 text-xs">
                Không tìm thấy phân đoạn phụ đề nào cho video này.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Voice Picker Modal ────────────────────────────────────────────────── */}
      {showVoiceModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121520] border border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Mic size={16} className="text-indigo-400" />
                  <span>Chọn Giọng Đọc Lồng Tiếng AI (TTS)</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Chọn giọng đọc phù hợp cho video: Gemini Pro hoặc Edge-TTS.
                </p>
              </div>
              <button
                onClick={() => setShowVoiceModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            {/* Modal Search & Engine Filter */}
            <div className="p-3 border-b border-slate-800 bg-[#0e111a] flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm giọng theo tên, giới tính..."
                  value={voiceSearch}
                  onChange={(e) => setVoiceSearch(e.target.value)}
                  className="w-full bg-[#161a26] border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <select
                value={voiceEngineFilter}
                onChange={(e) => setVoiceEngineFilter(e.target.value)}
                className="bg-[#161a26] border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="all">Tất cả Engine</option>
                <option value="gemini">Gemini 2.5 Pro TTS</option>
                <option value="edge-tts">Edge-TTS (Microsoft)</option>
              </select>
            </div>

            {/* Modal Voices List */}
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-2.5 custom-scrollbar">
              {voices
                .filter((v) => {
                  const matchSearch =
                    v.name.toLowerCase().includes(voiceSearch.toLowerCase()) ||
                    v.gender.toLowerCase().includes(voiceSearch.toLowerCase()) ||
                    v.id.toLowerCase().includes(voiceSearch.toLowerCase());
                  const matchEngine =
                    voiceEngineFilter === 'all' ||
                    (v.engine || '').toLowerCase() === voiceEngineFilter.toLowerCase();
                  return matchSearch && matchEngine;
                })
                .map((v) => {
                  const isSelected = voiceId === v.id;
                  const isAudioPlaying = playingVoiceId === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => {
                        setVoiceId(v.id);
                        setHasUnrenderedChanges(true);
                      }}
                      className={`p-3 rounded-xl border transition flex flex-col justify-between cursor-pointer ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-500/15 shadow-sm shadow-indigo-950'
                          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-850'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="text-xs font-bold text-white">{v.name}</h4>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="px-1.5 py-0.2 rounded text-[9.5px] bg-slate-800 text-slate-300 border border-slate-700">
                              {v.gender}
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[9.5px] bg-indigo-900/50 text-indigo-300 border border-indigo-700/50">
                              {v.engine}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleVoicePreview(v.id);
                          }}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
                          title="Nghe thử giọng"
                        >
                          {loadingVoiceId === v.id ? (
                            <Loader2 size={13} className="animate-spin text-indigo-400" />
                          ) : isAudioPlaying ? (
                            <VolumeX size={13} className="text-rose-400" />
                          ) : (
                            <Volume2 size={13} />
                          )}
                        </button>
                      </div>

                      <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10.5px]">
                        <span className="text-slate-500 font-mono truncate max-w-[150px]">{v.id}</span>
                        {isSelected && (
                          <span className="text-indigo-400 font-bold flex items-center gap-1">
                            <Check size={12} />
                            <span>Đang chọn</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-slate-800 bg-[#0e111a] flex justify-end">
              <button
                type="button"
                onClick={() => setShowVoiceModal(false)}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                Hoàn Tất
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
