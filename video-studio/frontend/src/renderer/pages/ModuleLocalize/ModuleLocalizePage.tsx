import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Wand2,
  FileVideo,
  Play,
  Volume2,
  VolumeX,
  Sliders,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Clock,
  Hourglass,
  CheckCheck,
  Sparkles,
  ArrowRight,
  Eye,
  Film,
  Download,
  Check,
  RotateCcw,
  SlidersHorizontal,
  Type,
  FileText,
  BookOpen,
  Plus,
  Trash2,
  MessageSquare,
  Zap,
  Heart,
  Target,
  Bot,
  ShoppingBag,
  Cpu,
  EyeOff,
  Layers,
  Subtitles,
  Captions,
  Languages,
  Info,
  Search,
  CheckSquare,
  Square,
  X,
  ListFilter,
  Smartphone,
  Share2,
  Bookmark,
  Music,
  Grid,
  MapPin,
  ArrowUp,
  ArrowDown,
  Maximize2,
  Lightbulb,
  Crosshair,
  Blend,
  AlignCenter,
  ChevronDown,
  ChevronUp,
  UploadCloud,
  Mic,
  Edit3,
  Save,
  Folder,
  FolderOpen,
  Settings,
  List,
  LayoutGrid,
  Scaling,
} from 'lucide-react';
import { libraryApi, localizeApi, settingsApi, editorApi, connectJobWs, LocalizePreset } from '../../api/client';
import { LocalizeSettings, DEFAULT_LOCALIZE_SETTINGS, AI_STYLES } from './types';

interface VideoItem {
  id: number;
  title: string;
  filename?: string;
  duration?: number | null;
  resolution?: string | null;
  file_size?: number | null;
  status?: string;
  thumbnail_url?: string | null;
  thumbnail_path?: string | null;
  video_url?: string | null;
  created_at?: string;
  channel_id?: number | null;
  category_id?: number | null;
  recognition_type?: string | null;
  caption?: string | null;
  has_localized?: boolean;
}

export interface BatchQueueItem {
  videoId: number;
  title: string;
  presetName?: string;
  duration?: number | null;
  thumbnailUrl?: string | null;
  status: 'waiting' | 'running' | 'done' | 'error';
  percent: number;
  message: string;
  outputUrl?: string | null;
  errorLog?: string | null;
  recognitionType?: string | null;
}

export default function ModuleLocalizePage() {
  const location = useLocation();
  const navigate = useNavigate();

  // Presets State
  const [presets, setPresets] = useState<LocalizePreset[]>([]);
  const [batchPresetId, setBatchPresetId] = useState<number | null>(null);
  const [localizeStatusFilter, setLocalizeStatusFilter] = useState<'all' | 'unlocalized' | 'localized'>('all');
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  // Đóng dropdown trạng thái khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setIsStatusDropdownOpen(false);
      }
    };
    if (isStatusDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isStatusDropdownOpen]);

  // Mapping cấu hình riêng biệt cho từng video: { [videoId]: presetId }
  const [videoPresetMap, setVideoPresetMap] = useState<Record<number, number>>({});

  // Helper: Lấy cấu hình Preset cho một video cụ thể
  const getPresetForVideo = useCallback(
    (videoId?: number): LocalizePreset | null => {
      if (!videoId) {
        return presets.find((p) => p.is_default) || presets[0] || null;
      }
      const mappedId = videoPresetMap[videoId];
      if (mappedId) {
        const found = presets.find((p) => p.id === mappedId);
        if (found) return found;
      }
      return presets.find((p) => p.is_default) || presets[0] || null;
    },
    [presets, videoPresetMap]
  );

  // Helper: Xác định badge & nhãn phương thức nhận diện dựa trên Cấu hình Preset đang chọn
  const getRecogBadgeInfo = useCallback((preset: LocalizePreset | null | undefined) => {
    const mode = preset?.settings?.recognition_mode || preset?.settings?.recognitionMode || 'voice_only';
    if (mode === 'ai_vision') {
      return {
        mode: 'ai_vision',
        label: 'AI Thị Giác',
        shortLabel: 'AI Vision',
        pillClass: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
        badgeClass: 'bg-amber-500/90 text-white border-amber-400/40',
        icon: <Sparkles size={10} className="text-amber-400 shrink-0" />,
        thumbIcon: <Sparkles size={8} className="shrink-0" />,
      };
    }
    if (mode === 'ocr_only') {
      return {
        mode: 'ocr_only',
        label: 'Quét OCR',
        shortLabel: 'Quét OCR',
        pillClass: 'bg-purple-500/15 border-purple-500/30 text-purple-300',
        badgeClass: 'bg-purple-500/90 text-white border-purple-400/40',
        icon: <Subtitles size={10} className="text-purple-400 shrink-0" />,
        thumbIcon: <Subtitles size={8} className="shrink-0" />,
      };
    }
    return {
      mode: 'voice_only',
      label: 'Whisper STT',
      shortLabel: 'Whisper STT',
      pillClass: 'bg-sky-500/15 border-sky-500/30 text-sky-300',
      badgeClass: 'bg-sky-500/90 text-white border-sky-400/40',
      icon: <Mic size={10} className="text-sky-400 shrink-0" />,
      thumbIcon: <Mic size={8} className="shrink-0" />,
    };
  }, []);

  // Video Library & Multi-Selection
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null); // Active video for preview
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const [loadingVideos, setLoadingVideos] = useState(false);

  // Search & Filters for videos
  const [searchQuery, setSearchQuery] = useState('');
  const [channels, setChannels] = useState<{ id: number; name: string; platform_source?: string }[]>([]);
  const [libraryCategories, setLibraryCategories] = useState<{ id: number; name: string; parent_id?: number | null }[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [selectedLibraryCategory, setSelectedLibraryCategory] = useState<string>('all');

  // Phone Mockup Controls
  const [phoneMockup, setPhoneMockup] = useState<'iphone16' | 'iphone_notch' | 'android_s24' | 'frameless'>('iphone16');
  const [showSafeZone, setShowSafeZone] = useState(false);
  const [isPlayingPreviewVideo, setIsPlayingPreviewVideo] = useState(false);
  const [isMutedPreview, setIsMutedPreview] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [detectedRatio, setDetectedRatio] = useState<number | null>(null);

  // Reset detected ratio and stop preview video when selected video changes
  useEffect(() => {
    setDetectedRatio(null);
    setIsPlayingPreviewVideo(false);
  }, [selectedVideo?.id]);

  // Check if video is landscape/horizontal
  const isLandscape = useMemo(() => {
    if (selectedVideo?.resolution) {
      const parts = selectedVideo.resolution.split('x');
      if (parts.length === 2) {
        const w = parseInt(parts[0], 10);
        const h = parseInt(parts[1], 10);
        if (!isNaN(w) && !isNaN(h)) return w > h;
      }
    }
    if (detectedRatio && detectedRatio > 1.05) return true;
    return false;
  }, [selectedVideo?.resolution, detectedRatio]);

  // Mặc định luôn là 'object-contain' để hiển thị 100% full đúng tỉ lệ gốc, KHÔNG BAO GIỜ bị cắt xén bất kỳ video nào
  const effectiveFit = fitMode === 'cover' ? 'object-cover' : 'object-contain';

  // View Mode: 'list' (dạng cột có ảnh preview) hoặc 'grid' (dạng lưới)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // Batch Queue & Execution State
  const [batchQueue, setBatchQueue] = useState<BatchQueueItem[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState<number>(-1);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [stepLogs, setStepLogs] = useState<string[]>([]);
  const [showResultPreview, setShowResultPreview] = useState(false);
  const [previewModalUrl, setPreviewModalUrl] = useState<string | null>(null);
  const [previewModalVideoId, setPreviewModalVideoId] = useState<number | null>(null);
  const [isSavingFinal, setIsSavingFinal] = useState(false);
  const [selectedDownloadIds, setSelectedDownloadIds] = useState<number[]>([]);
  const [savedEditorIds, setSavedEditorIds] = useState<number[]>([]);
  const [savingEditorIds, setSavingEditorIds] = useState<number[]>([]);
  const [isBatchSavingToEditor, setIsBatchSavingToEditor] = useState(false);

  const handleSaveIndividualToEditor = async (videoId: number, title?: string) => {
    try {
      setSavingEditorIds((prev) => [...prev, videoId]);
      await editorApi.saveFinal(videoId);
      setSavedEditorIds((prev) => [...new Set([...prev, videoId])]);
      setStepLogs((prev) => [
        ...prev,
        `✔ Đã lưu thành phẩm video "${title || `#${videoId}`}" vào Hậu Kỳ thành công!`,
      ]);
    } catch (err: any) {
      console.error("Lỗi lưu sang Hậu Kỳ:", err);
      setStepLogs((prev) => [
        ...prev,
        `❌ Lỗi khi lưu "${title || `#${videoId}`}" sang Hậu Kỳ: ${err.message}`,
      ]);
    } finally {
      setSavingEditorIds((prev) => prev.filter((id) => id !== videoId));
    }
  };

  const handleBatchSaveToEditor = async () => {
    const doneItems = batchQueue.filter((it) => it.status === "done");
    const target = selectedDownloadIds.length > 0
      ? doneItems.filter((it) => selectedDownloadIds.includes(it.videoId))
      : doneItems;
    if (target.length === 0) return;

    try {
      setIsBatchSavingToEditor(true);
      setStepLogs((prev) => [...prev, `📦 Đang lưu ${target.length} video sang Hậu Kỳ...`]);
      let successCount = 0;
      for (const item of target) {
        try {
          await editorApi.saveFinal(item.videoId);
          setSavedEditorIds((prev) => [...new Set([...prev, item.videoId])]);
          successCount++;
        } catch (e: any) {
          console.error(`Lỗi lưu video #${item.videoId}:`, e);
        }
      }
      setStepLogs((prev) => [
        ...prev,
        `✔ Đã lưu hoàn tất ${successCount}/${target.length} video vào Hậu Kỳ!`,
      ]);
    } finally {
      setIsBatchSavingToEditor(false);
    }
  };
  const [isDownloading, setIsDownloading] = useState(false);

  // Load Presets from Backend
  const loadPresets = async () => {
    try {
      const res = await localizeApi.getPresets();
      const pList = res.presets || [];
      setPresets(pList);
      if (pList.length > 0) {
        const def = pList.find((p) => p.is_default) || pList[0];
        setBatchPresetId(def.id);
      }
    } catch (err) {
      console.error('Lỗi khi tải danh sách cấu hình:', err);
    }
  };

  // Load Library Videos
  const loadLibraryVideos = async () => {
    try {
      setLoadingVideos(true);
      const res = await libraryApi.getVideos({ limit: 100 });
      const vList = res.videos || [];
      setVideos(vList);

      // Auto select video if passed from location state
      const targetId = (location.state as any)?.videoId;
      if (targetId) {
        const found = vList.find((v: VideoItem) => v.id === Number(targetId));
        if (found) {
          setSelectedVideo(found);
          setSelectedVideoIds(new Set([found.id]));
        }
      } else if (vList.length > 0) {
        setSelectedVideo((prev) => {
          if (prev && vList.some((v: VideoItem) => v.id === prev.id)) {
            return vList.find((v: VideoItem) => v.id === prev.id) || prev;
          }
          return vList[0];
        });
        setSelectedVideoIds((prev) => (prev.size > 0 ? prev : new Set([vList[0].id])));
      }
    } catch (err) {
      console.error('Failed to load videos:', err);
    } finally {
      setLoadingVideos(false);
    }
  };

  // Load channels and categories for library filtering
  const loadMeta = async () => {
    try {
      const [chRes, catRes] = await Promise.all([
        libraryApi.getChannels(),
        libraryApi.getCategories(),
      ]);
      setChannels(chRes.channels || []);
      setLibraryCategories(catRes.categories || []);
    } catch (err) {
      console.error('Failed to load metadata:', err);
    }
  };

  useEffect(() => {
    loadPresets();
    loadLibraryVideos();
    loadMeta();
  }, []);

  // Filtered library videos
  const filteredVideos = useMemo(() => {
    return videos.filter((v) => {
      const matchSearch =
        !searchQuery.trim() ||
        v.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (v.filename && v.filename.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchChannel =
        selectedChannel === 'all' || (v.channel_id && String(v.channel_id) === selectedChannel);

      const matchCategory =
        selectedLibraryCategory === 'all' ||
        (v.category_id && String(v.category_id) === selectedLibraryCategory);

      const matchLocalizeStatus =
        localizeStatusFilter === 'all' ||
        (localizeStatusFilter === 'localized' && Boolean(v.has_localized)) ||
        (localizeStatusFilter === 'unlocalized' && !v.has_localized);

      return matchSearch && matchChannel && matchCategory && matchLocalizeStatus;
    });
  }, [videos, searchQuery, selectedChannel, selectedLibraryCategory, localizeStatusFilter]);

  // Toggle Video Selection for Batch Processing
  const handleToggleSelectVideo = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllVideos = () => {
    const allIds = filteredVideos.map((v) => v.id);
    setSelectedVideoIds(new Set(allIds));
  };

  const handleDeselectAllVideos = () => {
    setSelectedVideoIds(new Set());
  };


  // Start Batch Localize Pipeline using Active Preset Settings
  const handleStartBatchJob = async () => {
    const idsToProcess = Array.from(selectedVideoIds);
    if (idsToProcess.length === 0) {
      if (selectedVideo) {
        idsToProcess.push(selectedVideo.id);
      } else {
        alert('Vui lòng chọn ít nhất 1 video để lồng tiếng!');
        return;
      }
    }

    // Helper build config from preset
    const buildConfigFromPreset = (preset: LocalizePreset) => {
      const st = preset.settings || {};
      const dictMap: Record<string, string> = {};
      (st.dictionaryEntries || []).forEach((e: any) => {
        if (e.original && e.replacement) dictMap[e.original] = e.replacement;
      });
      return {
        recognition_mode: st.recognition_mode || st.recognitionMode || 'voice_only',
        ai_style: st.ai_style || st.aiStyle || 'chuan_goc',
        ai_style_prompt: st.ai_style_prompt || st.custom_ai_prompt || st.customAiPrompt || '',
        voice_id: st.voice_id || st.voiceId || 'vi-VN-HoaiMyNeural',
        voice_speed: st.voice_speed !== undefined ? st.voice_speed : (st.voiceSpeed !== undefined ? st.voiceSpeed : 1.0),
        sync_mode: st.sync_mode || st.syncMode || 'keep_duration',
        volume_voiceover: st.volume_voiceover !== undefined ? st.volume_voiceover : (st.aiVoiceVolume !== undefined ? st.aiVoiceVolume : 100),
        keep_original_audio: st.keep_original_audio !== undefined ? st.keep_original_audio : (st.keepOriginalAudio !== undefined ? st.keepOriginalAudio : true),
        volume_original: st.volume_original !== undefined ? st.volume_original : (st.bgmVolume !== undefined ? st.bgmVolume : 15),
        volume_original_voice: st.volume_original_voice !== undefined ? st.volume_original_voice : (st.originalVoiceVolume !== undefined ? st.originalVoiceVolume : 0),
        cover_old_subtitle: st.cover_old_subtitle !== undefined ? st.cover_old_subtitle : (st.coverOldSub !== undefined ? st.coverOldSub : true),
        blur_amount: st.blur_amount || st.blurAmount || 25,
        blur_method: st.blur_method || st.blurMethod || 'blur',
        show_subtitles: st.show_subtitles !== undefined ? st.show_subtitles : (st.showSubtitles !== undefined ? st.showSubtitles : true),
        sub_position_mode: st.sub_position_mode || st.subPositionMode || 'by_original',
        sub_placement: st.sub_placement || st.subPlacement || 'overlay',
        auto_fit_sub_size: st.auto_fit_sub_size !== undefined ? st.auto_fit_sub_size : (st.autoFitSubSize !== undefined ? st.autoFitSubSize : true),
        sub_position_percent: st.sub_position_percent !== undefined ? st.sub_position_percent : (st.subPositionPercent !== undefined ? st.subPositionPercent : 71),
        sub_font: st.sub_font || st.subFont || 'Oswald',
        sub_font_size: st.sub_font_size || st.subFontSize || 29,
        sub_color: st.sub_color || st.subTextColor || '#FFD700',
        sub_bg_color: st.sub_bg_color || st.subBgColor || '#000000',
        sub_bg_opacity: st.sub_bg_opacity !== undefined ? st.sub_bg_opacity : (st.subBgOpacity !== undefined ? st.subBgOpacity : 82),
        sub_style_type: st.sub_style_type || st.subStyleType || 'box',
        sub_bold: st.sub_bold !== undefined ? st.sub_bold : (st.subBold !== undefined ? st.subBold : true),
        sub_italic: st.sub_italic !== undefined ? st.sub_italic : (st.subItalic !== undefined ? st.subItalic : false),
        sub_margin_v: st.sub_margin_v !== undefined ? st.sub_margin_v : (st.subMarginV !== undefined ? st.subMarginV : 25),
        keep_bgm_sfx: st.keep_bgm_sfx !== undefined ? st.keep_bgm_sfx : (st.keepBgmSfx !== undefined ? st.keepBgmSfx : false),
        multi_voice: st.multi_voice !== undefined ? st.multi_voice : (st.multiVoice !== undefined ? st.multiVoice : false),
        voice_male: st.voice_male || st.voiceMale || 'vi-VN-NamMinhNeural',
        voice_female: st.voice_female || st.voiceFemale || 'vi-VN-HoaiMyNeural',
        voice_narrator: st.voice_narrator || st.voiceNarrator || '',
        pronunciation_dict: dictMap,
      };
    };

    // Initialize Batch Queue with individually assigned presets
    const initialQueue: BatchQueueItem[] = idsToProcess.map((id) => {
      const v = videos.find((item) => item.id === id);
      const assignedPreset = getPresetForVideo(id);
      const presetRecog = assignedPreset?.settings?.recognition_mode || assignedPreset?.settings?.recognitionMode;
      return {
        videoId: id,
        title: v?.title || `Video #${id}`,
        presetName: assignedPreset?.name || 'Mặc định',
        duration: v?.duration,
        thumbnailUrl: v?.thumbnail_url,
        status: 'waiting',
        percent: 0,
        message: 'Đang xếp hàng chờ xử lý...',
        recognitionType: presetRecog || v?.recognition_type || 'voice_only',
      };
    });

    setBatchQueue(initialQueue);
    setIsBatchRunning(true);
    setSelectedDownloadIds([]);
    setOverallProgress(0);
    setStepLogs([
      `🚀 Khởi động hàng đợi xử lý cho ${idsToProcess.length} video (áp dụng cấu hình riêng cho từng video)...`,
    ]);

    // Sequential Queue Runner
    for (let i = 0; i < initialQueue.length; i++) {
      const currentItem = initialQueue[i];
      setCurrentQueueIndex(i);

      // Determine this specific video's configuration
      const assignedPreset = getPresetForVideo(currentItem.videoId);
      const itemConfig = assignedPreset
        ? buildConfigFromPreset(assignedPreset)
        : buildConfigFromPreset({ settings: DEFAULT_LOCALIZE_SETTINGS } as any);

      // Mark running
      setBatchQueue((prev) =>
        prev.map((item, idx) =>
          idx === i
            ? {
                ...item,
                status: 'running',
                percent: 5,
                message: `Đang xử lý theo cấu hình [${assignedPreset?.name || 'Mặc định'}]...`,
              }
            : item
        )
      );

      setStepLogs((prev) => [
        ...prev,
        `\n▶ [${i + 1}/${initialQueue.length}] Bắt đầu: ${currentItem.title} • Cấu hình: [${assignedPreset?.name || 'Mặc định'}]`,
      ]);

      try {
        const res = await localizeApi.submit({
          ...itemConfig,
          video_id: currentItem.videoId,
          recognition_mode: currentItem.recognitionType || 'voice_only',
        });

        // Await job completion via WebSocket / Polling
        await new Promise<void>((resolve) => {
          let isResolved = false;

          // Helper cập nhật tiến độ tổng thể mượt mà từ tiến độ của video hiện tại
          const updateProgress = (curItemPercent: number) => {
            const clamped = Math.max(0, Math.min(100, Math.round(curItemPercent)));
            if (initialQueue.length <= 1) {
              setOverallProgress(clamped);
            } else {
              const total = Math.min(99, Math.round((i * 100 + clamped) / initialQueue.length));
              setOverallProgress((prev) => Math.max(prev, total));
            }
          };

          const finishItem = (status: 'done' | 'error', finalMsg: string, outUrl?: string, err?: string) => {
            if (isResolved) return;
            isResolved = true;

            setBatchQueue((prev) =>
              prev.map((item, idx) =>
                idx === i
                  ? {
                      ...item,
                      status,
                      percent: status === 'done' ? 100 : item.percent,
                      message: finalMsg,
                      outputUrl: outUrl || item.outputUrl,
                      errorLog: err,
                    }
                  : item
              )
            );

            if (status === 'done') {
              setStepLogs((prev) => [...prev, `✔ Hoàn tất [${i + 1}/${initialQueue.length}]: ${currentItem.title}`]);
              setVideos((prev) =>
                prev.map((v) => (v.id === currentItem.videoId ? { ...v, status: 'done', has_localized: true } : v))
              );
              // Mặc định khi làm xong: tự động tick chọn video này vào danh sách sẵn sàng tải về
              setSelectedDownloadIds((prev) => Array.from(new Set([...prev, currentItem.videoId])));
            } else {
              setStepLogs((prev) => [...prev, `✖ Lỗi [${i + 1}/${initialQueue.length}]: ${finalMsg}`]);
            }

            const completedCount = i + 1;
            setOverallProgress(
              completedCount === initialQueue.length
                ? 100
                : Math.round((completedCount / initialQueue.length) * 100)
            );
            resolve();
          };

          // Khởi động tiến độ ban đầu cho item hiện tại
          updateProgress(5);

          // WebSocket listener
          try {
            connectJobWs(res.job_id, (data) => {
              if (data.percent !== undefined) {
                const p = Math.max(0, Math.min(100, Math.round(data.percent)));
                setBatchQueue((prev) =>
                  prev.map((item, idx) => (idx === i ? { ...item, percent: Math.max(item.percent, p) } : item))
                );
                updateProgress(p);
              }
              if (data.step) {
                const stepDesc = getStepDescription(data.step);
                setBatchQueue((prev) =>
                  prev.map((item, idx) => (idx === i ? { ...item, message: stepDesc } : item))
                );
                setStepLogs((prev) => [...prev, `  • [${currentItem.title}] ${stepDesc}`]);
              }
              if (data.status === 'completed' || data.status === 'done') {
                finishItem('done', 'Đã hoàn tất lồng tiếng!', data.output_url);
              } else if (data.status === 'error' || data.status === 'failed') {
                finishItem('error', data.error_log || 'Lỗi xử lý', undefined, data.error_log);
              }
            });
          } catch (wsErr) {
            console.warn('WS connect failed, falling back to polling:', wsErr);
          }

          // Fallback Polling every 1.5s
          const intervalId = setInterval(async () => {
            if (isResolved) {
              clearInterval(intervalId);
              return;
            }
            try {
              const statusRes = await localizeApi.getStatus(res.job_id);
              if (statusRes.progress_percent !== undefined) {
                const p = Math.max(0, Math.min(100, Math.round(statusRes.progress_percent)));
                setBatchQueue((prev) =>
                  prev.map((item, idx) =>
                    idx === i ? { ...item, percent: Math.max(item.percent, p) } : item
                  )
                );
                updateProgress(p);
              }
              if (statusRes.status === 'completed' || statusRes.status === 'done') {
                clearInterval(intervalId);
                finishItem('done', 'Đã hoàn tất lồng tiếng!', statusRes.output_url || undefined);
              } else if (statusRes.status === 'error' || statusRes.status === 'failed') {
                clearInterval(intervalId);
                finishItem('error', statusRes.error_log || 'Lỗi xử lý', undefined, statusRes.error_log || undefined);
              }
            } catch (pErr) {
              console.error('Polling error:', pErr);
            }
          }, 1500);
        });
      } catch (err: any) {
        console.error('Submit job failed:', err);
        setBatchQueue((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: 'error', message: err.message || 'Lỗi khi gửi yêu cầu' } : item
          )
        );
        setStepLogs((prev) => [...prev, `✖ Lỗi khởi động [${currentItem.title}]: ${err.message}`]);
      }
    }

    setIsBatchRunning(false);
    setOverallProgress(100);
    setStepLogs((prev) => [...prev, `\n🎉 Hoàn thành toàn bộ đợt lồng tiếng!`]);
  };

  const getStepDescription = (step: string) => {
    switch (step) {
      case 'extract_audio':
        return 'Tách âm thanh gốc & kiểm tra track...';
      case 'speech_to_text':
        return 'Nhận diện giọng nói Whisper (STT)...';
      case 'ocr_subtitles':
        return 'Quét OCR nhận diện phụ đề tiếng Trung...';
      case 'translate_script':
        return 'AI Gemini dịch kịch bản & tối ưu hóa...';
      case 'text_to_speech':
        return 'Lồng tiếng AI TTS đa ngữ điệu...';
      case 'sync_audio':
        return 'Cân chỉnh thời lượng hình/tiếng...';
      case 'compose_video':
        return 'Ghép phụ đề & làm mờ chữ cũ...';
      default:
        return `Đang xử lý bước: ${step}`;
    }
  };

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Helper: Tải file video về máy
  const downloadVideoFile = async (url: string, filename: string) => {
    try {
      const fullUrl = libraryApi.getMediaUrl(url);
      const res = await fetch(fullUrl);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename.endsWith('.mp4') ? filename : `${filename}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 2000);
    } catch {
      // Fallback direct link
      const fullUrl = libraryApi.getMediaUrl(url);
      const a = document.createElement('a');
      a.href = fullUrl;
      a.download = filename.endsWith('.mp4') ? filename : `${filename}.mp4`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // Tải đơn lẻ 1 video trong hàng đợi
  const handleDownloadSingle = async (item: BatchQueueItem) => {
    if (!item.outputUrl) return;
    const cleanTitle = (item.title || `video_${item.videoId}`).replace(/[\\/:*?"<>|]/g, '_');
    setStepLogs((prev) => [...prev, `📥 Đang tải xuống: ${item.title}`]);
    await downloadVideoFile(item.outputUrl, `${cleanTitle}_viet_hoa.mp4`);
  };

  // Tải tài sản rời (.srt, .mp3, .mp4) trực tiếp từ API
  const handleDownloadAsset = (videoId: number, format: 'srt' | 'mp3' | 'mp4') => {
    const url = localizeApi.getExportUrl(videoId, format);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Tải hàng loạt các video đã tick chọn
  const handleBatchDownload = async () => {
    const itemsToDownload = batchQueue.filter(
      (item) => item.status === 'done' && item.outputUrl && selectedDownloadIds.includes(item.videoId)
    );
    if (itemsToDownload.length === 0) return;

    try {
      setIsDownloading(true);
      setStepLogs((prev) => [
        ...prev,
        `📥 Bắt đầu tải xuống ${itemsToDownload.length} video đã tick chọn...`,
      ]);
      for (let idx = 0; idx < itemsToDownload.length; idx++) {
        const it = itemsToDownload[idx];
        const cleanTitle = (it.title || `video_${it.videoId}`).replace(/[\\/:*?"<>|]/g, '_');
        await downloadVideoFile(it.outputUrl!, `${cleanTitle}_viet_hoa.mp4`);
        if (idx < itemsToDownload.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      setStepLogs((prev) => [
        ...prev,
        `✔ Đã gửi yêu cầu tải xuống ${itemsToDownload.length} video hoàn tất!`,
      ]);
    } catch (err: any) {
      console.error('Lỗi khi tải video:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  // Toggle tick all các video đã hoàn tất
  const toggleSelectAllDone = () => {
    const doneIds = batchQueue
      .filter((it) => it.status === 'done' && it.outputUrl)
      .map((it) => it.videoId);

    if (doneIds.length === 0) return;

    const allSelected = doneIds.every((id) => selectedDownloadIds.includes(id));
    if (allSelected) {
      setSelectedDownloadIds((prev) => prev.filter((id) => !doneIds.includes(id)));
    } else {
      setSelectedDownloadIds((prev) => Array.from(new Set([...prev, ...doneIds])));
    }
  };

  // Toggle tick từng video trong hàng đợi
  const toggleDownloadItem = (vidId: number) => {
    setSelectedDownloadIds((prev) =>
      prev.includes(vidId) ? prev.filter((id) => id !== vidId) : [...prev, vidId]
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0f15] text-slate-100 overflow-y-auto">
      {/* ─────────────────────────────────────────────────────────────
          1. HEADER & ACTION BAR
      ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 lg:px-8 py-3.5 border-b border-slate-800/80 sticky top-0 bg-[#0d0f15]/95 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-sm shrink-0">
            <Wand2 size={18} />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              <span className="whitespace-nowrap">Studio Lồng Tiếng Video</span>
              <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 whitespace-nowrap shrink-0">
                v2.0
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">
              Chọn cấu hình riêng cho từng video, xem trước mockup cỡ lớn và xử lý hàng loạt
            </p>
          </div>
        </div>

        {/* Right Actions: Manage Presets + Big Start Localize Button + Back */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Nút Đi Tới Trang Quản Lý Cấu Hình */}
          <button
            type="button"
            onClick={() => navigate('/localize/presets')}
            className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-indigo-500/50 rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow-sm whitespace-nowrap shrink-0"
            title="Đi tới trang Quản lý danh mục & Cấu hình toàn màn hình"
          >
            <Settings size={13} className="text-indigo-400 shrink-0" />
            <span>Cấu hình</span>
          </button>

          {/* Nút Bắt Đầu Lồng Tiếng */}
          <button
            type="button"
            onClick={handleStartBatchJob}
            disabled={isBatchRunning || (selectedVideoIds.size === 0 && !selectedVideo)}
            className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-indigo-600 hover:from-indigo-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap shrink-0"
          >
            <Wand2 size={14} className="shrink-0" />
            <span>
              {isBatchRunning
                ? `Đang lồng tiếng (${overallProgress}%)`
                : selectedVideoIds.size > 1
                ? `Lồng tiếng (${selectedVideoIds.size} video)`
                : `Lồng tiếng (1 video)`}
            </span>
          </button>

          {/* Back to library */}
          <button
            onClick={() => navigate('/library')}
            className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition cursor-pointer whitespace-nowrap shrink-0"
          >
            ← Quay lại
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          3. MAIN FULL-WIDTH WORKSPACE: LARGE VIDEO PREVIEW & EXPANDED SELECTOR
      ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 p-6 lg:p-8 w-full grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-8 items-start">
        {/* ─────────────────────────────────────────────────────────────
            LEFT COLUMN (5 cols / 4 cols on 2xl): LARGE PHONE PREVIEW STUDIO
        ───────────────────────────────────────────────────────────── */}
        <div className="lg:col-span-4 xl:col-span-4 2xl:col-span-3 space-y-3 lg:sticky lg:top-20">
          <div className="bg-[#141722] border border-slate-800 rounded-3xl p-3.5 sm:p-4 shadow-lg space-y-3">
            {/* Header: Title + TikTok Safezone toggle */}
            <div className="flex items-center justify-between gap-1.5">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1 min-w-0">
                <Smartphone size={13} className="text-indigo-400 shrink-0" />
                <span className="truncate">Xem trước</span>
                {selectedVideo && (
                  <span className="text-[10px] text-indigo-400 font-mono font-normal shrink-0">#{selectedVideo.id}</span>
                )}
              </h3>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setFitMode(fitMode === 'contain' ? 'cover' : 'contain')}
                  className={`px-2 py-1 text-[10.5px] rounded-lg font-medium transition cursor-pointer flex items-center gap-1 border whitespace-nowrap shrink-0 ${
                    effectiveFit === 'object-contain'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-800/80 text-slate-400 hover:text-white border-slate-700/60'
                  }`}
                  title="Chế độ co giãn video: Giữ trọn 100% tỉ lệ video (không cắt xén) hoặc phóng to tràn viền"
                >
                  <Scaling size={11} className="shrink-0" />
                  <span>{effectiveFit === 'object-contain' ? 'Tỉ lệ gốc' : 'Tràn viền'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSafeZone(!showSafeZone)}
                  className={`px-2 py-1 text-[10.5px] rounded-lg font-medium transition cursor-pointer flex items-center gap-1 border whitespace-nowrap shrink-0 ${
                    showSafeZone
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-800/80 text-slate-400 hover:text-white border-slate-700/60'
                  }`}
                  title="Hiển thị vùng an toàn và các nút TikTok để căn phụ đề chuẩn xác"
                >
                  <Grid size={11} className="shrink-0" />
                  <span>TikTok</span>
                </button>
              </div>
            </div>

            {/* Device Model Selector Tabs */}
            <div className="grid grid-cols-4 gap-1 p-1 bg-[#0c0e14] rounded-xl border border-slate-800/80 text-[11px]">
              {[
                { id: 'iphone16', label: 'iPhone' },
                { id: 'iphone_notch', label: 'Tai thỏ' },
                { id: 'android_s24', label: 'Galaxy' },
                { id: 'frameless', label: '9:16 gốc' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPhoneMockup(m.id as any)}
                  className={`py-1 rounded-lg font-medium transition cursor-pointer text-center whitespace-nowrap px-1 ${
                    phoneMockup === m.id
                      ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* EXPANDED PHONE MOCKUP SHELL (Tăng chiều cao chuẩn tỷ lệ 9:16/9:19.5 không bị cụt) */}
            {selectedVideo ? (
              <div className="relative flex items-center justify-center p-2 sm:p-2.5 bg-[#0a0c12] border border-slate-800/80 rounded-2xl min-h-[540px] sm:min-h-[600px] xl:min-h-[660px] shadow-inner select-none">
                <div
                  className={`relative overflow-hidden transition-all duration-200 shadow-2xl ${
                    phoneMockup === 'iphone16'
                      ? 'w-[270px] sm:w-[295px] xl:w-[325px] 2xl:w-[350px] aspect-[9/18.5] max-h-[calc(100vh-230px)] bg-[#1a1b24] border-[7px] border-[#343947] rounded-[46px] ring-1 ring-white/10 p-[2px]'
                      : phoneMockup === 'iphone_notch'
                      ? 'w-[270px] sm:w-[295px] xl:w-[325px] 2xl:w-[350px] aspect-[9/18.5] max-h-[calc(100vh-230px)] bg-[#1a1b24] border-[7px] border-[#343947] rounded-[40px] ring-1 ring-white/10 p-[2px]'
                      : phoneMockup === 'android_s24'
                      ? 'w-[265px] sm:w-[290px] xl:w-[320px] 2xl:w-[345px] aspect-[9/18.5] max-h-[calc(100vh-230px)] bg-[#14161f] border-[5px] border-[#3a3e4e] rounded-[30px] ring-1 ring-white/10 p-[1px]'
                      : 'w-[270px] sm:w-[295px] xl:w-[325px] 2xl:w-[350px] aspect-[9/16] max-h-[calc(100vh-230px)] rounded-2xl border border-slate-800 bg-black p-0 shadow-lg'
                  }`}
                >
                  {/* Top Notch / Island */}
                  {phoneMockup === 'iphone16' && (
                    <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-[90px] h-[22px] bg-black rounded-full z-30 flex items-center justify-between px-2.5 border border-white/10 shadow-md pointer-events-none">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#161824] ring-1 ring-slate-800" />
                      <span className="w-2 h-2 rounded-full bg-emerald-500/80 animate-pulse" />
                    </div>
                  )}
                  {phoneMockup === 'iphone_notch' && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[110px] h-[20px] bg-black rounded-b-2xl z-30 flex items-center justify-center border-b border-x border-slate-800 pointer-events-none">
                      <span className="w-10 h-1.5 bg-slate-800 rounded-full" />
                    </div>
                  )}
                  {phoneMockup === 'android_s24' && (
                    <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-black z-30 ring-1 ring-white/20 pointer-events-none" />
                  )}

                  {/* Home indicator bar */}
                  {(phoneMockup === 'iphone16' || phoneMockup === 'iphone_notch') && (
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-28 h-1 bg-white/40 rounded-full z-30 pointer-events-none" />
                  )}

                  {/* Screen Content */}
                  <div
                    className={`w-full h-full overflow-hidden relative bg-slate-950 flex items-center justify-center ${
                      phoneMockup === 'iphone16'
                        ? 'rounded-[42px]'
                        : phoneMockup === 'iphone_notch'
                        ? 'rounded-[36px]'
                        : phoneMockup === 'android_s24'
                        ? 'rounded-[26px]'
                        : 'rounded-2xl'
                    }`}
                  >
                    {/* Video Player / Thumbnail */}
                    {isPlayingPreviewVideo && selectedVideo.video_url ? (
                      <video
                        ref={previewVideoRef}
                        src={libraryApi.getMediaUrl(selectedVideo.video_url)}
                        autoPlay
                        loop
                        muted={isMutedPreview}
                        playsInline
                        onLoadedMetadata={(e) => {
                          const el = e.currentTarget;
                          el.volume = 1.0;
                          if (el.videoWidth && el.videoHeight) {
                            setDetectedRatio(el.videoWidth / el.videoHeight);
                          }
                        }}
                        onCanPlay={(e) => {
                          const el = e.currentTarget;
                          el.muted = isMutedPreview;
                          el.volume = 1.0;
                          el.play().catch(() => {
                            // ignore autoplay restriction
                          });
                        }}
                        className={`w-full h-full transition-all duration-200 ${effectiveFit}`}
                      />
                    ) : selectedVideo.thumbnail_url ? (
                      <img
                        src={libraryApi.getMediaUrl(selectedVideo.thumbnail_url)}
                        alt={selectedVideo.title}
                        onLoad={(e) => {
                          const el = e.currentTarget;
                          if (el.naturalWidth && el.naturalHeight) {
                            setDetectedRatio(el.naturalWidth / el.naturalHeight);
                          }
                        }}
                        className={`w-full h-full transition-all duration-200 ${effectiveFit}`}
                      />
                    ) : (
                      <FileVideo size={54} className="text-slate-700" />
                    )}

                    {/* Play/Pause & Audio Toggle Top Right */}
                    {selectedVideo.video_url && (
                      <div
                        className={`absolute right-3.5 z-30 flex items-center gap-1.5 ${
                          phoneMockup === 'iphone16'
                            ? 'top-2'
                            : phoneMockup === 'iphone_notch'
                            ? 'top-1.5'
                            : phoneMockup === 'android_s24'
                            ? 'top-2'
                            : 'top-2.5'
                        }`}
                      >
                        {isPlayingPreviewVideo && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextMuted = !isMutedPreview;
                              setIsMutedPreview(nextMuted);
                              if (previewVideoRef.current) {
                                previewVideoRef.current.muted = nextMuted;
                              }
                            }}
                            title={isMutedPreview ? 'Bật âm thanh' : 'Tắt tiếng'}
                            className="p-1.5 rounded-xl bg-black/85 hover:bg-black text-white text-[10.5px] backdrop-blur border border-white/15 flex items-center justify-center transition cursor-pointer shadow-md"
                          >
                            {isMutedPreview ? (
                              <VolumeX size={12} className="text-rose-400" />
                            ) : (
                              <Volume2 size={12} className="text-emerald-400" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsPlayingPreviewVideo(!isPlayingPreviewVideo);
                          }}
                          className="px-2.5 py-1 rounded-xl bg-black/85 hover:bg-black text-white text-[10.5px] font-semibold backdrop-blur border border-white/15 flex items-center gap-1.5 transition cursor-pointer shadow-md"
                        >
                          {isPlayingPreviewVideo ? (
                            <>
                              <Square size={10} className="fill-current text-amber-400" />
                              <span>Dừng</span>
                            </>
                          ) : (
                            <>
                              <Play size={10} className="fill-current ml-0.5 text-emerald-400" />
                              <span>Phát thử</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {/* TikTok Safe Zone Simulator (Chuẩn kích thước và vị trí như Hậu kỳ) */}
                    {showSafeZone && (
                      <div
                        className={`absolute inset-x-0 pointer-events-none z-20 flex flex-col justify-between px-3.5 ${
                          phoneMockup === 'iphone16'
                            ? 'top-[38px] bottom-[52px]'
                            : phoneMockup === 'iphone_notch'
                            ? 'top-[32px] bottom-[52px]'
                            : phoneMockup === 'android_s24'
                            ? 'top-[28px] bottom-[48px]'
                            : 'top-[12px] bottom-[48px]'
                        }`}
                      >
                        {/* Safe zone bounding box */}
                        <div className="border border-dashed border-amber-400/50 rounded-xl flex-1 flex flex-col justify-between p-2.5 bg-amber-500/[0.03]">
                          {/* Top label */}
                          <div className="text-[8px] text-amber-400/70 font-mono text-center">
                            ── Vùng an toàn TikTok ──
                          </div>

                          {/* TikTok side buttons overlay */}
                          <div className="flex items-end justify-between text-white drop-shadow pb-4">
                            <div className="space-y-1 max-w-[70%] text-left">
                              <span className="text-[10px] font-bold text-white block">@shop_thanh_pham • Follow</span>
                              <p className="text-[9px] text-white/90 line-clamp-2 leading-tight">
                                {selectedVideo.title}
                              </p>
                            </div>
                            <div className="flex flex-col items-center gap-2.5 text-white pb-2">
                              <Heart size={16} className="fill-white" />
                              <span className="text-[8px] font-bold">128K</span>
                              <MessageSquare size={15} className="fill-white/80" />
                              <span className="text-[8px] font-bold">3.4K</span>
                              <Share2 size={15} />
                              <span className="text-[8px] font-bold">1.2K</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Caption thật của video - hiển thị như subtitle overlay phía dưới màn hình */}
                    {selectedVideo.caption && (
                      <div
                        className="absolute inset-x-3 flex items-center justify-center pointer-events-none text-center px-1 transition-all duration-200"
                        style={{ zIndex: 30, bottom: '18%' }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            textAlign: 'center',
                            fontFamily: 'Inter, sans-serif',
                            fontSize: '10px',
                            color: '#ffffff',
                            fontWeight: 'bold',
                            backgroundColor: 'rgba(0,0,0,0.65)',
                            padding: '4px 10px',
                            borderRadius: '8px',
                            maxWidth: '100%',
                            lineHeight: '1.4',
                            wordBreak: 'break-word',
                          }}
                          className="select-none"
                        >
                          {selectedVideo.caption}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="min-h-[500px] flex flex-col items-center justify-center p-8 bg-[#0a0c12] border border-slate-800 rounded-2xl text-slate-500 text-center">
                <Film size={44} className="opacity-30 mb-2" />
                <p className="text-xs">Chưa chọn video để xem trước</p>
              </div>
            )}
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            RIGHT COLUMN (8 cols / 9 cols on 2xl): EXPANDED VIDEO SELECTOR (FULL STUDIO)
        ───────────────────────────────────────────────────────────── */}
        <div className="lg:col-span-8 xl:col-span-8 2xl:col-span-9 space-y-5">
          {/* VIDEO SELECTOR CONTAINER */}
          <div className="bg-[#141722] border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
            {/* Header: Title + Refresh Button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Film size={18} className="text-indigo-400" />
                <h3 className="text-sm font-bold text-white">
                  Kho Video Cần Lồng Tiếng ({filteredVideos.length}/{videos.length})
                </h3>
              </div>

              <div className="flex items-center gap-2">
                {/* Nút chuyển đổi giao diện Danh sách cột / Lưới */}
                <div className="flex items-center bg-[#0b0d13] border border-slate-800 rounded-xl p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      viewMode === 'list'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Chế độ danh sách cột (dễ nhìn, dễ chọn cấu hình)"
                  >
                    <List size={13} />
                    <span>Danh sách</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      viewMode === 'grid'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Chế độ lưới ô"
                  >
                    <LayoutGrid size={13} />
                    <span>Lưới</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    loadLibraryVideos();
                    loadMeta();
                    loadPresets();
                  }}
                  className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer border border-slate-700/60"
                  title="Tải lại danh sách video"
                >
                  <RefreshCw size={13} className={loadingVideos ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Filter Bar: Search + Channel + Category + Trạng thái Lồng tiếng */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-2.5">
              {/* Search */}
              <div className="sm:col-span-2 xl:col-span-4 relative">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm theo tên video, ID, từ khóa..."
                  className="w-full pl-9 pr-3.5 py-2 text-xs bg-[#0b0d13] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              {/* Channel filter */}
              <div className="sm:col-span-1 xl:col-span-3">
                <select
                  value={selectedChannel}
                  onChange={(e) => setSelectedChannel(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#0b0d13] border border-slate-800 rounded-xl text-slate-300 focus:outline-none focus:border-indigo-500 transition cursor-pointer"
                >
                  <option value="all">Tất cả kênh ({channels.length})</option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Category filter */}
              <div className="sm:col-span-1 xl:col-span-2">
                <select
                  value={selectedLibraryCategory}
                  onChange={(e) => setSelectedLibraryCategory(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#0b0d13] border border-slate-800 rounded-xl text-slate-300 focus:outline-none focus:border-indigo-500 transition cursor-pointer"
                >
                  <option value="all">Danh mục ({libraryCategories.length})</option>
                  {libraryCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Trạng thái lồng tiếng filter (Custom Dropdown chuẩn icon vector) */}
              <div ref={statusDropdownRef} className="sm:col-span-2 xl:col-span-3 relative">
                {(() => {
                  const unlocalizedCount = videos.filter((v) => !v.has_localized).length;
                  const localizedCount = videos.filter((v) => v.has_localized).length;

                  const statusOptions = [
                    {
                      id: 'all' as const,
                      label: 'Tất cả trạng thái',
                      count: videos.length,
                      icon: <ListFilter size={13} className="text-indigo-400 shrink-0" />,
                    },
                    {
                      id: 'unlocalized' as const,
                      label: 'Cần lồng tiếng',
                      count: unlocalizedCount,
                      icon: <Clock size={13} className="text-amber-400 shrink-0" />,
                    },
                    {
                      id: 'localized' as const,
                      label: 'Đã lồng tiếng',
                      count: localizedCount,
                      icon: <CheckCheck size={14} className="text-emerald-400 shrink-0" />,
                    },
                  ];

                  const activeOption = statusOptions.find((o) => o.id === localizeStatusFilter) || statusOptions[0];

                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsStatusDropdownOpen((prev) => !prev)}
                        className={`w-full px-3 py-2 text-xs bg-[#0b0d13] border rounded-xl transition cursor-pointer flex items-center justify-between gap-1.5 ${
                          isStatusDropdownOpen
                            ? 'border-indigo-500 ring-1 ring-indigo-500/40 text-white'
                            : localizeStatusFilter !== 'all'
                            ? 'border-indigo-500/60 bg-indigo-950/20 text-indigo-200'
                            : 'border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          {activeOption.icon}
                          <span className="truncate font-medium">{activeOption.label}</span>
                          <span className="text-[11px] text-slate-400 font-mono">({activeOption.count})</span>
                        </div>
                        <ChevronDown
                          size={13}
                          className={`text-slate-400 shrink-0 transition-transform duration-150 ${
                            isStatusDropdownOpen ? 'rotate-180 text-indigo-400' : ''
                          }`}
                        />
                      </button>

                      {isStatusDropdownOpen && (
                        <div className="absolute left-0 right-0 top-full mt-1.5 bg-[#141722] border border-slate-700/80 rounded-xl shadow-2xl p-1 z-30 space-y-0.5 backdrop-blur-md">
                          {statusOptions.map((opt) => {
                            const isSelected = localizeStatusFilter === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  setLocalizeStatusFilter(opt.id);
                                  setIsStatusDropdownOpen(false);
                                }}
                                className={`w-full px-2.5 py-2 text-xs rounded-lg transition flex items-center justify-between gap-2 text-left cursor-pointer ${
                                  isSelected
                                    ? 'bg-indigo-600/20 text-indigo-300 font-semibold'
                                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  {opt.icon}
                                  <span>{opt.label}</span>
                                </div>
                                <span className="text-[11px] text-slate-400 font-mono">({opt.count})</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Multi-Selection Control Bar */}
            <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-xs flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={handleSelectAllVideos}
                  className="text-slate-400 hover:text-indigo-400 font-medium transition cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <CheckSquare size={13} className="shrink-0" />
                  <span>Chọn tất cả ({filteredVideos.length})</span>
                </button>
                {selectedVideoIds.size > 0 && (
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <button
                      type="button"
                      onClick={handleDeselectAllVideos}
                      className="text-slate-500 hover:text-slate-300 font-medium transition cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Bỏ chọn ({selectedVideoIds.size})
                    </button>
                    <span className="text-slate-700">|</span>
                    <div className="flex items-center gap-1.5 bg-indigo-950/40 border border-indigo-500/30 px-2.5 py-1 rounded-xl flex-wrap">
                      <span className="text-indigo-300 text-[11px] font-medium whitespace-nowrap">Gán nhanh:</span>
                      <select
                        value={batchPresetId || presets.find((p) => p.is_default)?.id || presets[0]?.id || ''}
                        onChange={(e) => setBatchPresetId(Number(e.target.value))}
                        className="px-2 py-0.5 text-[11px] bg-[#0b0d13] border border-indigo-500/40 rounded-lg text-indigo-200 font-semibold focus:outline-none cursor-pointer"
                      >
                        {presets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.is_default ? '⭐' : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const targetPId = batchPresetId || presets.find((p) => p.is_default)?.id || presets[0]?.id;
                          if (!targetPId) return;
                          const nextMap = { ...videoPresetMap };
                          selectedVideoIds.forEach((vid) => {
                            nextMap[vid] = targetPId;
                          });
                          setVideoPresetMap(nextMap);
                        }}
                        className="px-2.5 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition shadow cursor-pointer whitespace-nowrap shrink-0"
                        title="Gán cấu hình đã chọn cho tất cả video được đánh dấu"
                      >
                        Áp dụng
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="text-slate-400 font-mono text-[11px] whitespace-nowrap shrink-0">
                Đã chọn:{' '}
                <span className="font-bold text-indigo-400 text-xs">{selectedVideoIds.size}</span> video
              </div>
            </div>

            {/* VIDEOS LIST OR GRID CONTAINER */}
            {filteredVideos.length === 0 ? (
              <div className="py-16 text-center text-slate-500 space-y-2">
                <Film size={36} className="mx-auto opacity-30 text-slate-400" />
                <p className="text-xs">Không có video nào khớp với bộ lọc</p>
              </div>
            ) : viewMode === 'list' ? (
              /* ─── DẠNG LIST CỘT (HÀNG NGANG CÓ ẢNH PREVIEW RÕ RÀNG) ─── */
              <div className="space-y-2.5 max-h-[720px] overflow-y-auto pr-1">
                {filteredVideos.map((video, idx) => {
                  const isChecked = selectedVideoIds.has(video.id);
                  const isPreviewActive = selectedVideo?.id === video.id;

                  return (
                    <div
                      key={video.id}
                      onClick={() => setSelectedVideo(video)}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center gap-3.5 select-none group ${
                        isPreviewActive
                          ? 'bg-indigo-600/15 border-indigo-500 shadow-md shadow-indigo-500/10'
                          : isChecked
                          ? 'bg-[#181b28] border-indigo-500/50'
                          : 'bg-[#10121a] border-slate-800/80 hover:border-slate-700 hover:bg-[#151722]'
                      }`}
                    >
                      {/* Cột 1: Checkbox */}
                      <div
                        onClick={(e) => handleToggleSelectVideo(video.id, e)}
                        className="p-1 rounded-lg hover:bg-white/10 cursor-pointer transition shrink-0"
                        title={isChecked ? 'Bỏ chọn' : 'Tick chọn video này'}
                      >
                        <div
                          className={`w-5 h-5 rounded-lg border flex items-center justify-center transition ${
                            isChecked
                              ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm shadow-indigo-600/40'
                              : 'border-slate-600 bg-slate-900/80 hover:border-indigo-400'
                          }`}
                        >
                          {isChecked && <Check size={13} strokeWidth={3} />}
                        </div>
                      </div>

                      {/* Cột 2: Thumbnail Video */}
                      <div className="w-20 sm:w-28 aspect-video rounded-xl bg-slate-900 border border-slate-700/60 overflow-hidden relative shrink-0">
                        {video.thumbnail_url ? (
                          <img
                            src={libraryApi.getMediaUrl(video.thumbnail_url)}
                            alt={video.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-slate-900">
                            <FileVideo size={24} className="text-slate-700" />
                          </div>
                        )}

                        {/* Thời lượng */}
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur text-[10px] text-slate-200 font-mono">
                          {formatDuration(video.duration)}
                        </span>

                        {/* Đang xem badge */}
                        {isPreviewActive && (
                          <span className="absolute top-1 right-1 px-1.5 py-0.2 rounded-full bg-indigo-600 text-white text-[9px] font-bold flex items-center gap-0.5 shadow">
                            <Eye size={9} /> Xem
                          </span>
                        )}
                      </div>

                      {/* Cột 3: Tên video & Thông tin */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-xs sm:text-sm font-bold text-white line-clamp-2 leading-snug group-hover:text-indigo-300 transition">
                          {video.title}
                        </p>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                          <span className="truncate max-w-[180px] text-slate-400 font-medium">
                            {channels.find((c) => c.id === video.channel_id)?.name || 'Kênh mặc định'}
                          </span>
                          <span className="text-slate-600 shrink-0">•</span>
                          <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap shrink-0">STT: {idx + 1}</span>
                        </div>
                      </div>

                      {/* Cột 4: Chọn Cấu Hình (Chỉ hiển thị khi video được tick chọn) */}
                      <div className="w-44 sm:w-60 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {isChecked ? (() => {
                          const currentPreset = getPresetForVideo(video.id);
                          const currentPresetId = currentPreset?.id;
                          const recogInfo = getRecogBadgeInfo(currentPreset);
                          const dropdownId = `preset-dropdown-list-${video.id}`;

                          return (
                            <div className="space-y-1 animate-in fade-in duration-150 relative">
                              <div className="flex items-center justify-between text-[10px] font-semibold text-indigo-300 whitespace-nowrap">
                                <div className="flex items-center gap-1">
                                  <SlidersHorizontal size={11} className="text-indigo-400 shrink-0" />
                                  <span>Cấu hình:</span>
                                </div>
                                <span className={`text-[9.5px] font-bold flex items-center gap-0.5 ${recogInfo.pillClass.split(' ')[2]}`}>
                                  {recogInfo.icon} {recogInfo.shortLabel}
                                </span>
                              </div>
                              {/* Custom dropdown trigger */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const el = document.getElementById(dropdownId);
                                  if (el) el.classList.toggle('hidden');
                                }}
                                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs bg-[#0e1018] hover:bg-[#161824] border border-indigo-500/40 hover:border-indigo-400 rounded-xl text-indigo-200 font-bold transition cursor-pointer shadow-inner group"
                              >
                                <div className="flex items-center gap-2 min-w-0 truncate">
                                  {currentPreset?.is_default && <span className="text-amber-400 text-[10px]">⭐</span>}
                                  <span className="truncate">{currentPreset?.name || 'Chọn cấu hình'}</span>
                                </div>
                                <ChevronDown size={13} className="text-indigo-400 shrink-0 group-hover:text-indigo-300 transition" />
                              </button>
                              {/* Custom dropdown list */}
                              <div
                                id={dropdownId}
                                className="hidden absolute z-50 top-full mt-1 left-0 right-0 bg-[#0e1018] border border-indigo-500/40 rounded-xl shadow-2xl shadow-black/60 overflow-hidden max-h-56 overflow-y-auto"
                                style={{ minWidth: '240px' }}
                              >
                                {presets.map((p) => {
                                  const isActive = p.id === currentPresetId;
                                  const pInfo = getRecogBadgeInfo(p);
                                  return (
                                    <button
                                      key={p.id}
                                      type="button"
                                      onClick={() => {
                                        setVideoPresetMap((prev) => ({ ...prev, [video.id]: p.id }));
                                        const el = document.getElementById(dropdownId);
                                        if (el) el.classList.add('hidden');
                                      }}
                                      className={`w-full px-3 py-2 text-left transition flex items-center justify-between cursor-pointer border-b border-slate-800/60 last:border-0 ${
                                        isActive
                                          ? 'bg-indigo-600/25 text-white'
                                          : 'hover:bg-slate-800/80 text-slate-300 hover:text-white'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5 font-medium text-xs truncate mr-2">
                                        {p.is_default && <span className="text-amber-400 text-[10px]">⭐</span>}
                                        <span className="truncate">{p.name}</span>
                                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-semibold border shrink-0 ${pInfo.pillClass}`}>
                                          {pInfo.shortLabel}
                                        </span>
                                      </div>
                                      {isActive && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0 ml-2" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })() : (
                          <div className="text-right sm:text-center text-[10.5px] text-slate-500/70 italic py-1 whitespace-nowrap">
                            (Tick để gán cấu hình)
                          </div>
                        )}
                      </div>

                      {/* Cột 5: Nút Xem trước */}
                      <div className="flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setSelectedVideo(video)}
                          className={`p-2 rounded-xl transition cursor-pointer ${
                            isPreviewActive
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-white hover:bg-slate-800'
                          }`}
                          title="Xem trước trên màn hình lớn bên trái"
                        >
                          <Eye size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* ─── DẠNG GRID LƯỚI (Ô) ─── */
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-3.5 max-h-[720px] overflow-y-auto pr-1">
                {filteredVideos.map((video) => {
                  const isChecked = selectedVideoIds.has(video.id);
                  const isPreviewActive = selectedVideo?.id === video.id;

                  return (
                    <div
                      key={video.id}
                      onClick={() => setSelectedVideo(video)}
                      className={`p-3 rounded-2xl border transition cursor-pointer flex flex-col gap-2.5 relative group select-none ${
                        isPreviewActive
                          ? 'bg-indigo-600/15 border-indigo-500 shadow-md shadow-indigo-500/10'
                          : isChecked
                          ? 'bg-[#181b28] border-indigo-500/40'
                          : 'bg-[#10121a] border-slate-800/90 hover:border-slate-700 hover:bg-[#151722]'
                      }`}
                    >
                      {/* Thumbnail Container */}
                      <div className="relative aspect-[16/9] w-full rounded-xl overflow-hidden bg-black border border-slate-800/80">
                        {video.thumbnail_url ? (
                          <img
                            src={libraryApi.getMediaUrl(video.thumbnail_url)}
                            alt={video.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-slate-900">
                            <FileVideo size={32} className="text-slate-700" />
                          </div>
                        )}

                        {/* Top Left: Checkbox for batch */}
                        <div
                          onClick={(e) => handleToggleSelectVideo(video.id, e)}
                          className="absolute top-2 left-2 z-10 p-1 rounded-lg bg-black/70 hover:bg-black/90 backdrop-blur cursor-pointer transition"
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center transition ${
                              isChecked
                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                : 'border-slate-500 bg-black/40 hover:border-white'
                            }`}
                          >
                            {isChecked && <Check size={11} strokeWidth={3} />}
                          </div>
                        </div>

                        {/* Top Right: Eye preview active badge */}
                        {isPreviewActive && (
                          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center gap-1 shadow-sm">
                            <Eye size={10} /> Đang xem
                          </span>
                        )}

                        {/* Bottom Bar inside thumbnail: Duration */}
                        <div className="absolute bottom-1.5 right-1.5 text-[10px]">
                          <span className="px-1.5 py-0.5 rounded bg-black/80 backdrop-blur text-slate-200 font-mono">
                            {formatDuration(video.duration)}
                          </span>
                        </div>
                      </div>

                      {/* Video Title & Meta info */}
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-bold text-white line-clamp-2 leading-snug group-hover:text-indigo-300 transition">
                          {video.title}
                        </p>
                        <div className="flex items-center justify-between text-[10px] text-slate-400 gap-1 flex-wrap">
                          <span className="truncate max-w-[160px]">
                            {channels.find((c) => c.id === video.channel_id)?.name || 'Kênh mặc định'}
                          </span>
                        </div>
                      </div>

                      {/* CHỌN CẤU HÌNH RIÊNG BIỆT: CHỈ HIỂN THỊ KHI VIDEO ĐƯỢC TICK CHỌN */}
                      {isChecked && (() => {
                        const assignedPreset = getPresetForVideo(video.id);
                        const recogInfo = getRecogBadgeInfo(assignedPreset);
                        return (
                          <div
                            className="pt-2 border-t border-indigo-500/30 flex items-center justify-between gap-1.5 animate-in fade-in duration-150"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-[10px] text-indigo-300 font-semibold flex items-center gap-1 shrink-0">
                              <SlidersHorizontal size={10} className="text-indigo-400" />
                              <span>Cấu hình:</span>
                            </span>
                            <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border flex items-center gap-0.5 shrink-0 ${recogInfo.pillClass}`}>
                                {recogInfo.icon} {recogInfo.shortLabel}
                              </span>
                              <select
                                value={videoPresetMap[video.id] || presets.find((p) => p.is_default)?.id || presets[0]?.id || ''}
                                onChange={(e) => {
                                  const newPId = Number(e.target.value);
                                  setVideoPresetMap((prev) => ({ ...prev, [video.id]: newPId }));
                                }}
                                className="flex-1 max-w-[150px] min-w-0 px-2 py-1 text-[10.5px] bg-[#0b0d13] hover:bg-[#141620] border border-indigo-500/50 rounded-lg text-indigo-200 font-bold focus:outline-none focus:border-indigo-500 transition cursor-pointer truncate shadow-inner"
                                title="Chọn cấu hình riêng biệt cho video này"
                              >
                                {presets.map((p) => {
                                  const pInfo = getRecogBadgeInfo(p);
                                  return (
                                    <option key={p.id} value={p.id}>
                                      {p.name} {p.is_default ? '⭐' : ''} [{pInfo.shortLabel}]
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* STEP 3: EXECUTION MONITOR & BATCH QUEUE RESULTS */}
          {batchQueue.length > 0 && (
            <div className="bg-[#141722] border border-slate-800 rounded-3xl p-6 shadow-sm space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Film size={16} className="text-indigo-400" />
                  <h3 className="text-sm font-bold text-white">
                    Hàng Đợi Xử Lý ({currentQueueIndex + 1}/{batchQueue.length} video)
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono font-bold text-indigo-400">
                    {batchQueue.length > 1
                      ? `Tổng tiến độ (${batchQueue.filter((b) => b.status === 'done').length}/${batchQueue.length} video): ${overallProgress}%`
                      : `Tổng tiến độ: ${overallProgress}%`}
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-indigo-600 to-emerald-400 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>

              {/* TOOLBAR KHI CÓ VIDEO HOÀN TẤT: TICK ALL & TẢI VỀ */}
              {batchQueue.some((it) => it.status === 'done') && (
                <div className="flex items-center justify-between p-3 rounded-2xl bg-emerald-950/25 border border-emerald-500/30 flex-wrap gap-3 animate-in fade-in duration-200">
                  <div className="flex items-center gap-3">
                    {/* Checkbox Tick All các video đã làm xong */}
                    <button
                      type="button"
                      onClick={toggleSelectAllDone}
                      className="flex items-center gap-2 text-xs font-semibold text-slate-200 hover:text-white transition cursor-pointer"
                    >
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center transition ${
                          batchQueue.filter((it) => it.status === 'done').length > 0 &&
                          batchQueue
                            .filter((it) => it.status === 'done')
                            .every((it) => selectedDownloadIds.includes(it.videoId))
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : 'border-slate-600 bg-slate-900/60 hover:border-slate-400'
                        }`}
                      >
                        {batchQueue.filter((it) => it.status === 'done').length > 0 &&
                          batchQueue
                            .filter((it) => it.status === 'done')
                            .every((it) => selectedDownloadIds.includes(it.videoId)) && (
                            <Check size={11} strokeWidth={3} />
                          )}
                      </div>
                      <span>
                        Chọn tất cả ({
                          batchQueue.filter((it) => it.status === 'done' && selectedDownloadIds.includes(it.videoId)).length
                        }/{batchQueue.filter((it) => it.status === 'done').length} video xong)
                      </span>
                    </button>

                    {selectedDownloadIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedDownloadIds([])}
                        className="text-[11px] text-slate-400 hover:text-slate-200 transition cursor-pointer"
                      >
                        Bỏ chọn
                      </button>
                    )}
                  </div>

                  {/* Action buttons: Tải Về & Lưu Tất Cả sang Hậu Kỳ */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={
                        isDownloading ||
                        batchQueue.filter((it) => it.status === 'done' && selectedDownloadIds.includes(it.videoId)).length === 0
                      }
                      onClick={handleBatchDownload}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition border border-slate-700/80 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Tải về các video đã tick chọn"
                    >
                      {isDownloading ? (
                        <>
                          <RefreshCw size={13} className="animate-spin" />
                          <span>Đang tải xuống...</span>
                        </>
                      ) : (
                        <>
                          <Download size={13} />
                          <span>
                            Tải Về ({
                              batchQueue.filter((it) => it.status === 'done' && selectedDownloadIds.includes(it.videoId)).length
                            })
                          </span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={batchQueue.filter((it) => it.status === "done").length === 0 || isBatchSavingToEditor}
                      onClick={handleBatchSaveToEditor}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold transition shadow-lg shadow-emerald-950/40 border border-emerald-400/30 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Lưu các video đã hoàn tất vào Video Hoàn Chỉnh Hậu Kỳ"
                    >
                      {isBatchSavingToEditor ? (
                        <>
                          <RefreshCw size={13} className="animate-spin" />
                          <span>Đang Lưu Hậu Kỳ...</span>
                        </>
                      ) : (
                        <>
                          <Save size={13} />
                          <span>
                            Lưu Tất Cả ({
                              (() => {
                                const selectedCount = batchQueue.filter(
                                  (it) => it.status === "done" && selectedDownloadIds.includes(it.videoId)
                                ).length;
                                const totalDone = batchQueue.filter((it) => it.status === "done").length;
                                return selectedCount > 0 ? selectedCount : totalDone;
                              })()
                            } video)
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Queue Items */}
              <div className="space-y-2 pt-2">
                {batchQueue.map((item, idx) => {
                  const isCurrent = idx === currentQueueIndex && item.status === 'running';
                  return (
                    <div
                      key={item.videoId}
                      className={`p-3 rounded-2xl border transition flex items-center justify-between gap-3 ${
                        isCurrent
                          ? 'bg-indigo-600/10 border-indigo-500/50 shadow-sm'
                          : item.status === 'done'
                          ? 'bg-emerald-950/20 border-emerald-500/30'
                          : item.status === 'error'
                          ? 'bg-rose-950/20 border-rose-500/30'
                          : 'bg-[#0f1118] border-slate-800/80 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2 shrink-0">
                          {item.status === 'done' && (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleDownloadItem(item.videoId);
                              }}
                              className="p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer shrink-0"
                              title={
                                selectedDownloadIds.includes(item.videoId)
                                  ? 'Bỏ chọn tải về'
                                  : 'Tick chọn để tải về'
                              }
                            >
                              <div
                                className={`w-4 h-4 rounded border flex items-center justify-center transition ${
                                  selectedDownloadIds.includes(item.videoId)
                                    ? 'bg-emerald-600 border-emerald-500 text-white'
                                    : 'border-slate-600 bg-slate-900/60 hover:border-slate-400'
                                }`}
                              >
                                {selectedDownloadIds.includes(item.videoId) && (
                                  <Check size={11} strokeWidth={3} />
                                )}
                              </div>
                            </div>
                          )}
                          <span className="font-mono text-xs text-slate-500 w-5">#{idx + 1}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-xs font-medium text-slate-200 truncate">{item.title}</p>
                            {item.presetName && (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-semibold">
                                ⚙️ {item.presetName}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">{item.message}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {item.status === 'waiting' && (
                          <span className="px-2 py-0.5 rounded text-[10.5px] bg-slate-800 text-slate-400 border border-slate-700/50">
                            Đang chờ
                          </span>
                        )}
                        {item.status === 'running' && (
                          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10.5px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40" title="Tiến độ xử lý video này">
                            <RefreshCw size={11} className="animate-spin text-indigo-400" />
                            <span>{batchQueue.length > 1 ? `Video này: ${item.percent}%` : `${item.percent}%`}</span>
                          </span>
                        )}
                        {item.status === 'done' && (
                          <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1 px-2.5 py-0.5 rounded text-[10.5px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              <CheckCircle2 size={11} />
                              <span>Hoàn tất</span>
                            </span>
                            {item.outputUrl && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const freshUrl = item.outputUrl
                                      ? `${item.outputUrl}${item.outputUrl.includes('?') ? '&' : '?'}t=${Date.now()}`
                                      : null;
                                    setPreviewModalUrl(freshUrl);
                                    setPreviewModalVideoId(item.videoId);
                                    setShowResultPreview(true);
                                  }}
                                  className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center gap-1 transition shadow-sm cursor-pointer active:scale-95"
                                  title="Xem trước video thành phẩm"
                                >
                                  <Eye size={11} />
                                  <span>Xem</span>
                                </button>

                                <div className="flex items-center bg-slate-900/90 border border-slate-700/80 rounded-lg p-0.5 shadow-sm">
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadSingle(item)}
                                    className="px-2 py-0.5 text-[10.5px] font-semibold text-emerald-300 hover:text-white hover:bg-emerald-600/50 rounded flex items-center gap-1 transition cursor-pointer"
                                    title="Tải video MP4 hoàn chỉnh"
                                  >
                                    <Download size={11} />
                                    <span>MP4</span>
                                  </button>
                                  <div className="w-[1px] h-3 bg-slate-700/80 my-auto" />
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadAsset(item.videoId, 'srt')}
                                    className="px-2 py-0.5 text-[10.5px] font-semibold text-amber-300 hover:text-white hover:bg-amber-600/50 rounded flex items-center gap-1 transition cursor-pointer"
                                    title="Tải phụ đề tiếng Việt rời (.SRT)"
                                  >
                                    <FileText size={11} />
                                    <span>SRT</span>
                                  </button>
                                  <div className="w-[1px] h-3 bg-slate-700/80 my-auto" />
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadAsset(item.videoId, 'mp3')}
                                    className="px-2 py-0.5 text-[10.5px] font-semibold text-pink-300 hover:text-white hover:bg-pink-600/50 rounded flex items-center gap-1 transition cursor-pointer"
                                    title="Tải audio lồng tiếng Việt rời (.MP3)"
                                  >
                                    <Music size={11} />
                                    <span>MP3</span>
                                  </button>
                                </div>

                                {savedEditorIds.includes(item.videoId) ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-lg flex items-center gap-1 cursor-default opacity-95"
                                    title="Video đã được lưu vào Video Hoàn Chỉnh Hậu Kỳ"
                                  >
                                    <CheckCircle2 size={11} className="text-emerald-400" />
                                    <span>Đã Lưu</span>
                                  </button>
                                ) : savingEditorIds.includes(item.videoId) ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 rounded-lg flex items-center gap-1 opacity-75"
                                  >
                                    <RefreshCw size={11} className="animate-spin" />
                                    <span>Đang lưu...</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleSaveIndividualToEditor(item.videoId, item.title)}
                                    className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg flex items-center gap-1 transition shadow-sm cursor-pointer active:scale-95"
                                    title="Lưu video thành phẩm vào Hậu Kỳ (ở lại trang tiếp tục làm việc)"
                                  >
                                    <Save size={11} />
                                    <span>Lưu</span>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                        {item.status === 'error' && (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            <AlertCircle size={11} />
                            <span>Lỗi</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          4. RESULT PREVIEW MODAL (XEM THỬ VIDEO VIỆT HÓA HOÀN CHỈNH)
      ───────────────────────────────────────────────────────────── */}
      {showResultPreview && previewModalUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-sm bg-[#161922] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <span className="text-xs font-bold text-white">Video Đã Lồng Tiếng</span>
              <button
                onClick={() => {
                  setShowResultPreview(false);
                  setPreviewModalUrl(null);
                }}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 cursor-pointer"
              >
                ✕ Đóng
              </button>
            </div>
            <div className="aspect-[9/16] w-full bg-black flex items-center justify-center">
              <video
                key={previewModalUrl}
                src={libraryApi.getMediaUrl(previewModalUrl)}
                controls
                autoPlay
                playsInline
                preload="auto"
                className="w-full h-full object-contain"
              />
            </div>

            <div className="p-3 border-t border-slate-800 bg-[#121520] flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  if (previewModalVideoId) {
                    localStorage.setItem('editor_selected_video_id', String(previewModalVideoId));
                  }
                  setShowResultPreview(false);
                  navigate(`/localize/editor/${previewModalVideoId}`);
                }}
                className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold text-indigo-300 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Edit3 size={13} />
                <span>Chỉnh sửa</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (previewModalUrl) {
                    const cleanName = `video_${previewModalVideoId || Date.now()}_viet_hoa.mp4`;
                    downloadVideoFile(previewModalUrl, cleanName);
                  }
                }}
                className="py-2 px-3 rounded-xl text-xs font-semibold text-emerald-300 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 flex items-center justify-center gap-1.5 transition cursor-pointer"
                title="Tải video này về máy"
              >
                <Download size={13} />
                <span>Tải Về</span>
              </button>

              <button
                type="button"
                disabled={!previewModalVideoId || savingEditorIds.includes(previewModalVideoId) || (previewModalVideoId ? savedEditorIds.includes(previewModalVideoId) : false)}
                onClick={async () => {
                  if (previewModalVideoId) {
                    await handleSaveIndividualToEditor(previewModalVideoId);
                  }
                }}
                className="flex-1 py-2 px-3 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-md flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-60"
                title="Lưu video thành phẩm vào Hậu Kỳ"
              >
                {previewModalVideoId && savedEditorIds.includes(previewModalVideoId) ? (
                  <>
                    <CheckCircle2 size={13} className="text-emerald-300" />
                    <span>Đã Lưu Vào Hậu Kỳ</span>
                  </>
                ) : previewModalVideoId && savingEditorIds.includes(previewModalVideoId) ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    <span>Đang Lưu Hậu Kỳ...</span>
                  </>
                ) : (
                  <>
                    <Save size={13} />
                    <span>Lưu Hậu Kỳ</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
