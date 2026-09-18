import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Film,
  Sparkles,
  Hash,
  CheckSquare,
  Square,
  Play,
  Pause,
  RotateCcw,
  Calendar,
  CalendarPlus,
  Check,
  Save,
  Clock,
  Trash2,
  Plus,
  RefreshCw,
  Layers,
  ArrowRight,
  Tv,
  CheckCircle2,
  AlertCircle,
  FileText,
  Sliders,
  Eye,
  Search,
  Edit3,
  Smartphone,
  Grid,
  Heart,
  MessageSquare,
  Share2,
  Volume2,
  VolumeX,
  SlidersHorizontal,
  ChevronRight,
  FileVideo,
  ArrowLeft,
  X,
  Tag,
  Scaling,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { editorApi, libraryApi } from '../../api/client';

interface ConfigSummary {
  preset_id?: number;
  preset_name?: string;
  sub_font?: string;
  sub_font_size?: number;
  sub_color?: string;
  sub_bg_color?: string;
  sub_style_type?: string;
  voice_id?: string;
  ai_style?: string;
  show_subtitles?: boolean;
}

interface VideoItem {
  id: number;
  title: string;
  duration: number;
  resolution?: string | null;
  thumbnail_url: string | null;
  video_url: string;
  has_final: boolean;
  has_schedule: boolean;
  has_caption: boolean;
  caption: string;
  hashtags: string[];
  config_summary?: ConfigSummary;
  presetName?: string;
  status: string;
  updated_at: string | null;
}

interface SubtitleSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  text_vi?: string;
  text_original?: string;
}

interface ChannelItem {
  id: number;
  name: string;
  platform: string;
}

interface VideoDetail {
  id: number;
  title: string;
  duration: number;
  resolution?: string | null;
  video_url: string;
  has_final: boolean;
  segments: SubtitleSegment[];
  caption: string;
  hashtags: string[];
  selected_channel_ids: number[];
  channels: ChannelItem[];
  job_config?: ConfigSummary;
}

const CAPTION_STYLES = [
  {
    id: 'short',
    label: 'Ngắn gọn',
    desc: 'Tối đa 1 câu (<80 ký tự), cấm sến súa, đi thẳng vào điểm nhấn sản phẩm',
  },
  {
    id: 'affiliate',
    label: 'Bán hàng / Deal',
    desc: 'Kêu gọi xem giỏ hàng góc trái, săn deal khuyến mãi',
  },
  {
    id: 'humorous',
    label: 'Hài hước',
    desc: 'Dí dỏm, tự nhiên, vui vẻ bắt trend TikTok',
  },
  {
    id: 'curiosity',
    label: 'Gợi tò mò',
    desc: 'Đặt câu hỏi kích thích xem hết clip & bình luận',
  },
  {
    id: 'minimal',
    label: 'Tối giản',
    desc: 'Cực ngắn (<60 ký tự), review chân thực, không emoji rườm rà',
  },
];

export default function EditorPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Danh sách video thành phẩm
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // 3 Tab trạng thái hậu kỳ: Đang xử lý (chưa có cap) | Sẵn sàng lên lịch (đã có cap) | Đã lên lịch
  const [statusTab, setStatusTab] = useState<'all' | 'processing' | 'ready' | 'scheduled'>('all');

  // Tab chuyển đổi: 'list' (Kho video thành phẩm) hoặc 'detail' (Hậu kỳ & Lên lịch)
  const [activeTab, setActiveTab] = useState<'list' | 'detail'>('list');

  // Phone Mockup Settings
  const [phoneMockup, setPhoneMockup] = useState<'iphone16' | 'iphone_notch' | 'android_s24' | 'frameless'>('iphone16');
  const [showSafeZone, setShowSafeZone] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [detectedRatio, setDetectedRatio] = useState<number | null>(null);

  // Tác vụ hàng loạt (Batch Selection)
  const [selectedBatchIds, setSelectedBatchIds] = useState<number[]>([]);
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);
  const [includeHashtags, setIncludeHashtags] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('editor_include_hashtags');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  // Chi tiết video đang chọn
  const [videoDetail, setVideoDetail] = useState<VideoDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Video player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Chỉnh sửa Subtitles
  const [subtitlesDraft, setSubtitlesDraft] = useState<SubtitleSegment[]>([]);
  const [hasSubChanges, setHasSubChanges] = useState(false);
  const [isReRendering, setIsReRendering] = useState(false);

  // Chỉnh sửa Caption & Hashtags
  const [captionDraft, setCaptionDraft] = useState('');
  const [hashtagsDraft, setHashtagsDraft] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [isGeneratingSingle, setIsGeneratingSingle] = useState(false);

  // Phong cách Caption
  const [captionStyle, setCaptionStyle] = useState<string>(() => {
    try {
      return localStorage.getItem('editor_caption_style') || 'short';
    } catch {
      return 'short';
    }
  });
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [showCustomPrompt, setShowCustomPrompt] = useState<boolean>(false);

  const handleSelectCaptionStyle = (style: string) => {
    setCaptionStyle(style);
    try {
      localStorage.setItem('editor_caption_style', style);
    } catch {}
  };

  // Kênh đăng & Thời gian
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [customDateTime, setCustomDateTime] = useState(() => {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1);
    nextHour.setMinutes(0);
    return nextHour.toISOString().slice(0, 16);
  });
  const [isSaving, setIsSaving] = useState(false);

  // Batch action state
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);
  const [batchProgressText, setBatchProgressText] = useState('');

  // Inline caption generation tracking (set of video IDs currently generating)
  const [generatingCaptionIds, setGeneratingCaptionIds] = useState<Set<number>>(new Set());

  // Modal Chỉnh Sửa Caption Thủ Công
  const [editingCaptionVideo, setEditingCaptionVideo] = useState<VideoItem | null>(null);
  const [modalCaptionText, setModalCaptionText] = useState('');
  const [modalHashtags, setModalHashtags] = useState<string[]>([]);
  const [modalTagInput, setModalTagInput] = useState('');
  const [isSavingCaptionModal, setIsSavingCaptionModal] = useState(false);
  const [isAiGeneratingInModal, setIsAiGeneratingInModal] = useState(false);

  const openCaptionModal = (video: VideoItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingCaptionVideo(video);
    setModalCaptionText(video.caption || '');
    setModalHashtags(video.hashtags ? [...video.hashtags] : []);
    setModalTagInput('');
  };

  const closeCaptionModal = () => {
    setEditingCaptionVideo(null);
  };

  const handleSaveCaptionFromModal = async () => {
    if (!editingCaptionVideo) return;
    try {
      setIsSavingCaptionModal(true);
      await editorApi.updateCaption(editingCaptionVideo.id, modalCaptionText, modalHashtags);

      setVideos((prev) =>
        prev.map((v) =>
          v.id === editingCaptionVideo.id
            ? {
                ...v,
                has_caption: Boolean(modalCaptionText.trim()),
                caption: modalCaptionText.trim(),
                hashtags: modalHashtags,
              }
            : v
        )
      );

      if (selectedVideoId === editingCaptionVideo.id) {
        setCaptionDraft(modalCaptionText.trim());
        setHashtagsDraft(modalHashtags);
      }

      showToast(`Đã cập nhật caption cho video #${editingCaptionVideo.id} thành công!`, 'success');
      closeCaptionModal();
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi lưu caption', 'error');
    } finally {
      setIsSavingCaptionModal(false);
    }
  };

  const handleModalGenerateAi = async () => {
    if (!editingCaptionVideo) return;
    try {
      setIsAiGeneratingInModal(true);
      const data = await editorApi.generateCaption(editingCaptionVideo.id, includeHashtags, captionStyle);
      setModalCaptionText(data.caption || '');
      setModalHashtags(data.hashtags || []);
      showToast('AI đã sinh lại caption mới!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi AI sinh caption', 'error');
    } finally {
      setIsAiGeneratingInModal(false);
    }
  };

  // Toast / Thông báo
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Lưu cấu hình toggle hashtags
  const handleToggleHashtags = (enabled: boolean) => {
    setIncludeHashtags(enabled);
    try {
      localStorage.setItem('editor_include_hashtags', String(enabled));
    } catch {}
  };

  // 1. Tải danh sách video thành phẩm
  const loadVideos = async (preferredId?: number, preferredTab?: 'processing' | 'ready' | 'scheduled') => {
    try {
      setLoadingVideos(true);
      const data = await editorApi.getVideos();
      const list: VideoItem[] = data.videos || [];
      setVideos(list);

      if (list.length > 0) {
        let targetV: VideoItem | undefined;
        if (preferredId && list.some((v) => v.id === preferredId)) {
          targetV = list.find((v) => v.id === preferredId);
          setSelectedVideoId(preferredId);
        } else if (!selectedVideoId || !list.some((v) => v.id === selectedVideoId)) {
          const procList = list.filter((v) => !v.has_schedule && !v.has_caption && !v.caption?.trim());
          const readyList = list.filter((v) => !v.has_schedule && (v.has_caption || Boolean(v.caption?.trim())));
          const schedList = list.filter((v) => v.has_schedule);

          const desiredTab = preferredTab || (procList.length > 0 ? 'processing' : readyList.length > 0 ? 'ready' : 'scheduled');
          const candidateList = desiredTab === 'processing' ? procList : desiredTab === 'ready' ? readyList : schedList;

          if (candidateList.length > 0) {
            targetV = candidateList[0];
            setSelectedVideoId(targetV.id);
          } else {
            targetV = list[0];
            setSelectedVideoId(list[0].id);
          }
        } else {
          targetV = list.find((v) => v.id === selectedVideoId);
        }

        if (preferredTab) {
          setStatusTab(preferredTab);
        } else if (targetV) {
          if (targetV.has_schedule) {
            setStatusTab('scheduled');
          } else if (targetV.has_caption || targetV.caption?.trim()) {
            setStatusTab('ready');
          } else {
            setStatusTab('processing');
          }
        }
      } else {
        setSelectedVideoId(null);
        setVideoDetail(null);
      }
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi nạp video', 'error');
    } finally {
      setLoadingVideos(false);
    }
  };

  useEffect(() => {
    let prefId: number | undefined;
    let prefTab: 'processing' | 'ready' | 'scheduled' | undefined;
    try {
      const saved = localStorage.getItem('editor_selected_video_id');
      if (saved) {
        prefId = parseInt(saved, 10) || undefined;
        localStorage.removeItem('editor_selected_video_id');
      }
      const savedTab = localStorage.getItem('editor_open_tab') as 'processing' | 'ready' | 'scheduled' | null;
      if (savedTab && ['processing', 'ready', 'scheduled'].includes(savedTab)) {
        prefTab = savedTab;
        localStorage.removeItem('editor_open_tab');
      }
    } catch {}
    loadVideos(prefId, prefTab);
  }, []);

  // 2. Tải chi tiết video khi selectedVideoId thay đổi
  useEffect(() => {
    if (!selectedVideoId) return;

    // Nạp ngay caption & hashtags từ danh sách video để hiển thị lập tức lên Phone Mockup
    const currentV = videos.find((v) => v.id === selectedVideoId);
    if (currentV) {
      setCaptionDraft(currentV.caption || '');
      setHashtagsDraft(currentV.hashtags || []);
    }

    const fetchDetail = async () => {
      try {
        setLoadingDetail(true);
        const data: VideoDetail = await editorApi.getVideoDetail(selectedVideoId);
        setVideoDetail(data);

        // Nạp phụ đề draft
        setSubtitlesDraft(data.segments || []);
        setHasSubChanges(false);

        // Nạp caption / hashtags từ server
        if (data.caption) setCaptionDraft(data.caption);
        if (data.hashtags && data.hashtags.length > 0) setHashtagsDraft(data.hashtags);

        // Nạp kênh
        if (data.selected_channel_ids && data.selected_channel_ids.length > 0) {
          setSelectedChannels(data.selected_channel_ids);
        } else if (data.channels && data.channels.length > 0) {
          setSelectedChannels([data.channels[0].id]);
        }
      } catch (err: any) {
        showToast(err.message || 'Lỗi nạp chi tiết video', 'error');
      } finally {
        setLoadingDetail(false);
      }
    };

    fetchDetail();
  }, [selectedVideoId]);

  // Video Time Update & Play state
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      setDuration(videoRef.current.duration || 0);
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

  const seekTo = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  // Sửa từng câu phụ đề (hỗ trợ tìm theo id hoặc index để không bao giờ bị lệch)
  const handleSubtitleTextChange = (idOrIdx: number, newText: string) => {
    setSubtitlesDraft((prev) =>
      prev.map((seg, idx) => (seg.id === idOrIdx || idx === idOrIdx ? { ...seg, text_vi: newText } : seg))
    );
    setHasSubChanges(true);
  };

  // Re-render phụ đề mới
  const handleReRenderSubtitles = async () => {
    if (!selectedVideoId || !hasSubChanges) return;
    try {
      setIsReRendering(true);
      const data = await editorApi.reRenderSubtitles(selectedVideoId, subtitlesDraft);
      showToast('Đã cập nhật phụ đề và render lại video thành công!', 'success');
      setHasSubChanges(false);

      // Cập nhật lại videoDetail & selectedVideo trong state với URL có query timestamp chống cache
      if (data.video_url) {
        const freshUrl = data.video_url.startsWith('http')
          ? `${data.video_url}${data.video_url.includes('?') ? '&' : '?'}t=${Date.now()}`
          : `${libraryApi.getMediaUrl(data.video_url)}${data.video_url.includes('?') ? '&' : '?'}t=${Date.now()}`;

        setVideoDetail((prev) =>
          prev
            ? {
                ...prev,
                video_url: data.video_url,
                segments: [...subtitlesDraft],
              }
            : null
        );

        setVideos((prev) =>
          prev.map((v) => (v.id === selectedVideoId ? { ...v, video_url: data.video_url } : v))
        );

        if (videoRef.current) {
          videoRef.current.src = freshUrl;
          videoRef.current.load();
          videoRef.current.play().catch(() => {});
          setIsPlaying(true);
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Render lại phụ đề thất bại', 'error');
    } finally {
      setIsReRendering(false);
    }
  };

  // Sinh Caption đơn lẻ
  const handleGenerateSingleCaption = async () => {
    if (!selectedVideoId) return;
    try {
      setIsGeneratingSingle(true);
      const data = await editorApi.generateCaption(
        selectedVideoId,
        includeHashtags,
        captionStyle,
        showCustomPrompt && customPrompt.trim() ? customPrompt.trim() : undefined
      );
      setCaptionDraft(data.caption || '');
      setHashtagsDraft(data.hashtags || []);
      setVideos((prev) =>
        prev.map((v) =>
          v.id === selectedVideoId
            ? {
                ...v,
                has_caption: true,
                caption: data.caption || '',
                hashtags: data.hashtags || [],
              }
            : v
        )
      );
      showToast('AI đã sinh Caption & Hashtags thành công! Video đã chuyển sang mục Sẵn Sàng Lên Lịch.', 'success');
      setStatusTab('ready');
    } catch (err: any) {
      showToast(err.message || 'Lỗi sinh caption', 'error');
    } finally {
      setIsGeneratingSingle(false);
    }
  };

  // Sinh Caption inline cho 1 video ngay trong danh sách (không cần qua trang khác)
  const handleInlineGenerateCaption = async (videoId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (generatingCaptionIds.has(videoId)) return;
    try {
      setGeneratingCaptionIds((prev) => new Set(prev).add(videoId));
      const data = await editorApi.generateCaption(
        videoId,
        includeHashtags,
        captionStyle,
        showCustomPrompt && customPrompt.trim() ? customPrompt.trim() : undefined
      );
      // Cập nhật ngay trong state videos để nút đổi thành 'Sinh lại Cap' và lưu dữ liệu
      setVideos((prev) =>
        prev.map((v) =>
          v.id === videoId
            ? {
                ...v,
                has_caption: true,
                caption: data.caption || '',
                hashtags: data.hashtags || [],
              }
            : v
        )
      );
      // Nếu video này đang được chọn, cập nhật luôn draft
      if (videoId === selectedVideoId) {
        setCaptionDraft(data.caption || '');
        setHashtagsDraft(data.hashtags || []);
      }
      showToast(`Đã sinh Caption & Hashtags cho video #${videoId}! Video đã chuyển sang mục Sẵn Sàng Lên Lịch.`, 'success');
    } catch (err: any) {
      showToast(err.message || `Lỗi sinh caption video #${videoId}`, 'error');
    } finally {
      setGeneratingCaptionIds((prev) => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
    }
  };

  // Sinh Caption hàng loạt cho các video được chọn
  const handleBatchGenerateCaptions = async () => {
    if (selectedBatchIds.length === 0) {
      showToast('Vui lòng tích chọn ít nhất 1 video để sinh hàng loạt', 'error');
      return;
    }
    try {
      setIsGeneratingBatch(true);
      setBatchProgressText(`Đang sinh Caption (${CAPTION_STYLES.find(s => s.id === captionStyle)?.label}) cho ${selectedBatchIds.length} video...`);
      const data = await editorApi.batchGenerateCaptions(
        selectedBatchIds,
        includeHashtags,
        captionStyle,
        showCustomPrompt && customPrompt.trim() ? customPrompt.trim() : undefined
      );
      const results = data.results || {};

      // Cập nhật ngay cho video đang mở nếu nằm trong batch
      if (selectedVideoId && results[String(selectedVideoId)]) {
        setCaptionDraft(results[String(selectedVideoId)].caption || '');
        setHashtagsDraft(results[String(selectedVideoId)].hashtags || []);
      }

      showToast(`Đã sinh Caption thành công cho ${Object.keys(results).length} video! Các video đã chuyển sang mục Sẵn Sàng Lên Lịch.`, 'success');
      loadVideos(selectedVideoId || undefined);
      setStatusTab('ready');
    } catch (err: any) {
      showToast(err.message || 'Lỗi sinh hàng loạt', 'error');
    } finally {
      setIsGeneratingBatch(false);
      setBatchProgressText('');
    }
  };

  // Thêm / Xóa hashtag
  const handleAddHashtag = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    const tag = newTagInput.trim();
    if (!tag) return;
    const formatted = tag.startsWith('#') ? tag : `#${tag}`;
    if (!hashtagsDraft.includes(formatted)) {
      setHashtagsDraft([...hashtagsDraft, formatted]);
    }
    setNewTagInput('');
  };

  const handleRemoveHashtag = (tagToRemove: string) => {
    setHashtagsDraft(hashtagsDraft.filter((t) => t !== tagToRemove));
  };

  // Toggle kênh
  const toggleChannelSelection = (chId: number) => {
    if (selectedChannels.includes(chId)) {
      setSelectedChannels(selectedChannels.filter((id) => id !== chId));
    } else {
      setSelectedChannels([...selectedChannels, chId]);
    }
  };

  // LƯU VIDEO FINAL & LÊN LỊCH ĐĂNG
  const handleSaveAndSchedule = async () => {
    if (!selectedVideoId) return;
    if (!captionDraft.trim()) {
      showToast('Vui lòng nhập hoặc sinh Caption trước khi lên lịch đăng', 'error');
      return;
    }
    if (selectedChannels.length === 0) {
      showToast('Vui lòng chọn ít nhất 1 kênh TikTok để lên lịch đăng', 'error');
      return;
    }

    try {
      setIsSaving(true);
      const payload = {
        caption: captionDraft,
        hashtags: hashtagsDraft,
        channel_ids: selectedChannels,
        scheduled_time: customDateTime ? new Date(customDateTime).toISOString() : null,
      };

      const data = await editorApi.saveAndSchedule(selectedVideoId, payload);
      showToast('Đã lên lịch đăng thành công! Video đã chuyển sang mục Đã Lên Lịch.', 'success');
      await loadVideos(selectedVideoId);
      setStatusTab('scheduled');
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi lưu video final', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Chọn / Bỏ chọn tất cả video trong tab hiện tại
  const toggleSelectAllBatch = () => {
    if (selectedBatchIds.length > 0 && selectedBatchIds.length === filteredVideos.length) {
      setSelectedBatchIds([]);
    } else {
      setSelectedBatchIds(filteredVideos.map((v) => v.id));
    }
  };

  const toggleBatchSelectVideo = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedBatchIds.includes(id)) {
      setSelectedBatchIds(selectedBatchIds.filter((item) => item !== id));
    } else {
      setSelectedBatchIds([...selectedBatchIds, id]);
    }
  };

  // Xóa hàng loạt video đã tick chọn
  const handleBatchDeleteVideos = async () => {
    if (selectedBatchIds.length === 0 || isDeletingBatch) return;
    const count = selectedBatchIds.length;
    const confirmMsg = `Bạn có chắc chắn muốn xóa ${count} video đã chọn không?\nMọi file video và dữ liệu liên quan sẽ bị xóa vĩnh viễn.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setIsDeletingBatch(true);
      const res = await libraryApi.bulkDeleteVideos(selectedBatchIds);
      showToast(res.message || `Đã xóa thành công ${count} video!`, 'success');

      const deletedSet = new Set(selectedBatchIds);
      const remainingVideos = videos.filter((v) => !deletedSet.has(v.id));
      setVideos(remainingVideos);
      setSelectedBatchIds([]);

      if (selectedVideoId && deletedSet.has(selectedVideoId)) {
        if (remainingVideos.length > 0) {
          setSelectedVideoId(remainingVideos[0].id);
        } else {
          setSelectedVideoId(null);
          setVideoDetail(null);
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi xóa hàng loạt video', 'error');
    } finally {
      setIsDeletingBatch(false);
    }
  };

  // Xóa đơn lẻ 1 video
  const handleDeleteSingleVideo = async (videoId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Bạn có chắc chắn muốn xóa video #${videoId} không?`)) return;
    try {
      await libraryApi.deleteVideo(videoId);
      showToast(`Đã xóa video #${videoId} thành công!`, 'success');
      const remainingVideos = videos.filter((v) => v.id !== videoId);
      setVideos(remainingVideos);
      setSelectedBatchIds((prev) => prev.filter((id) => id !== videoId));
      if (selectedVideoId === videoId) {
        if (remainingVideos.length > 0) {
          setSelectedVideoId(remainingVideos[0].id);
        } else {
          setSelectedVideoId(null);
          setVideoDetail(null);
        }
      }
    } catch (err: any) {
      showToast(err.message || `Lỗi khi xóa video #${videoId}`, 'error');
    }
  };

  // Format giây -> 00:00
  const formatSec = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 3 Tab danh sách video đã phân loại theo trạng thái
  const processingVideos = useMemo(() => videos.filter((v) => !v.has_schedule && !v.has_caption && !v.caption?.trim()), [videos]);
  const readyVideos = useMemo(() => videos.filter((v) => !v.has_schedule && (v.has_caption || Boolean(v.caption?.trim()))), [videos]);
  const scheduledVideos = useMemo(() => videos.filter((v) => v.has_schedule), [videos]);

  const filteredVideos = useMemo(() => {
    if (!searchQuery.trim()) return videos;
    const q = searchQuery.toLowerCase();
    return videos.filter((v) =>
      v.title.toLowerCase().includes(q) ||
      String(v.id).includes(q) ||
      (v.caption && v.caption.toLowerCase().includes(q))
    );
  }, [videos, searchQuery]);

  const handleSwitchStatusTab = (tab: 'processing' | 'ready' | 'scheduled') => {
    setStatusTab(tab);
    setSelectedBatchIds([]);
    const targetList = tab === 'processing' ? processingVideos : tab === 'ready' ? readyVideos : scheduledVideos;
    if (targetList.length > 0 && (!selectedVideoId || !targetList.some((v) => v.id === selectedVideoId))) {
      setSelectedVideoId(targetList[0].id);
    }
  };

  const selectedVideo = videos.find((v) => v.id === selectedVideoId) || videos[0] || null;

  // Reset detected aspect ratio when selected video changes
  useEffect(() => {
    setDetectedRatio(null);
  }, [selectedVideo?.id, videoDetail?.id]);

  // Check if video is landscape/horizontal
  const isLandscape = useMemo(() => {
    const res = videoDetail?.resolution || selectedVideo?.resolution;
    if (res) {
      const parts = res.split('x');
      if (parts.length === 2) {
        const w = parseInt(parts[0], 10);
        const h = parseInt(parts[1], 10);
        if (!isNaN(w) && !isNaN(h)) return w > h;
      }
    }
    if (detectedRatio && detectedRatio > 1.05) return true;
    return false;
  }, [videoDetail?.resolution, selectedVideo?.resolution, detectedRatio]);

  // Mặc định luôn là 'object-contain' để hiển thị 100% full đúng tỉ lệ, KHÔNG BAO GIỜ bị cắt xén bất kỳ video nào
  const effectiveFit = fitMode === 'cover' ? 'object-cover' : 'object-contain';

  return (
    <div className="flex flex-col h-full bg-[#0a0c12] text-slate-100 select-none overflow-hidden">
      {/* ── TOAST THÔNG BÁO ──────────────────────────────────── */}
      {notification && (
        <div
          className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-2xl shadow-xl border text-xs font-semibold flex items-center gap-2.5 animate-in slide-in-from-top duration-200 ${
            notification.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40'
              : 'bg-rose-950/90 text-rose-300 border-rose-500/40'
          }`}
        >
          {notification.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* ── TOP ACTION BAR ────────────────────────────────────── */}
      <div className="h-16 px-6 border-b border-slate-800/80 bg-[#12151e]/90 flex items-center justify-between shrink-0 backdrop-blur-sm z-10">
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-xl bg-violet-600/10 text-violet-400 border border-violet-500/20">
            <Film size={20} />
          </div>
          <div>
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              Chỉnh Sửa Video
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60 font-mono font-semibold">
                {videos.length} video thành phẩm
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Xem lại trên Phone Mockup, chỉnh sửa phụ đề & lên lịch đăng
            </p>
          </div>
        </div>

        {/* View Switcher Tabs & Links */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-medium text-slate-300">
            <span className="flex items-center gap-1 text-violet-300">
              <Film size={12} className="text-violet-400" />
              <span>Đang xử lý: <strong className="text-white font-mono">{processingVideos.length}</strong></span>
            </span>
            <span className="text-slate-600">•</span>
            <span className="flex items-center gap-1 text-emerald-300">
              <Calendar size={12} className="text-emerald-400" />
              <span>Đã lên lịch: <strong className="text-white font-mono">{scheduledVideos.length}</strong></span>
            </span>
          </div>

          <div className="h-5 w-px bg-slate-800" />

          {/* Chuyển nhanh sang trang Lịch Đăng */}
          <button
            type="button"
            onClick={() => navigate('/scheduler')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800/70 hover:bg-slate-800 border border-slate-700/60 transition shadow-sm cursor-pointer"
          >
            <Calendar size={14} className="text-violet-400" />
            <span>Xem Lịch Đăng</span>
            <ArrowRight size={13} className="text-slate-500" />
          </button>
        </div>
      </div>

      {/* ── BỐ CỤC 2 CỘT CHUẨN TƯƠNG ĐỒNG HÌNH 2 ───────────────── */}
      <div className="flex-1 pt-3 lg:pt-4 px-6 lg:px-8 pb-6 lg:pb-8 w-full grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-8 items-start overflow-y-auto">
        
        {/* ── CỘT 1 (3-4 cols): MÀN HÌNH ĐIỆN THOẠI PHONE MOCKUP ── */}
        <div className="lg:col-span-4 xl:col-span-4 2xl:col-span-3 space-y-4 lg:sticky lg:top-4">
          <div className="bg-[#141722] border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg space-y-4">
            
            {/* Header: Title + TikTok Safezone & Ratio toggle */}
            <div className="flex items-center justify-between gap-1.5">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1 min-w-0">
                <Smartphone size={13} className="text-violet-400 shrink-0" />
                <span className="truncate">Xem trước</span>
                {selectedVideo && (
                  <span className="text-[10px] text-violet-400 font-mono font-normal shrink-0">#{selectedVideo.id}</span>
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
                      ? 'bg-violet-600 text-white shadow-sm font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* PHONE MOCKUP SHELL (Chuẩn tỷ lệ 9:16/9:19.5 TikTok cao ráo) */}
            {selectedVideo ? (
              <div className="relative flex flex-col items-center justify-center p-3.5 bg-[#0a0c12] border border-slate-800/80 rounded-2xl min-h-[540px] sm:min-h-[600px] xl:min-h-[660px] shadow-inner select-none">
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
                    {/* Video Player */}
                    <video
                      ref={videoRef}
                      src={libraryApi.getMediaUrl(videoDetail?.video_url || selectedVideo.video_url)}
                      className={`w-full h-full transition-all duration-200 ${effectiveFit}`}
                      onLoadedMetadata={(e) => {
                        const el = e.currentTarget;
                        if (el.duration) setDuration(el.duration);
                        if (el.videoWidth && el.videoHeight) {
                          setDetectedRatio(el.videoWidth / el.videoHeight);
                        }
                      }}
                      onTimeUpdate={handleTimeUpdate}
                      onEnded={() => setIsPlaying(false)}
                      muted={isMuted}
                      playsInline
                    />

                    {/* TikTok Safe Zone Simulator */}
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
                              <p className="text-[9px] text-white/90 line-clamp-3 leading-tight">
                                {captionDraft || selectedVideo?.caption || selectedVideo?.title}
                                {(() => {
                                  const tags = (hashtagsDraft && hashtagsDraft.length > 0) ? hashtagsDraft : selectedVideo?.hashtags || [];
                                  if (tags.length === 0) return null;
                                  return (
                                    <span className="text-violet-300 font-semibold block mt-0.5">
                                      {tags.map((h: string) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
                                    </span>
                                  );
                                })()}
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

                    {/* In-phone Controls Bar */}
                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-center gap-2 z-30 opacity-95">
                      <button
                        type="button"
                        onClick={togglePlay}
                        className="p-1.5 rounded-full bg-violet-600 hover:bg-violet-500 text-white shadow transition active:scale-95 cursor-pointer shrink-0"
                      >
                        {isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
                      </button>

                      <input
                        type="range"
                        min={0}
                        max={duration || selectedVideo.duration || 1}
                        step={0.1}
                        value={currentTime}
                        onChange={(e) => seekTo(parseFloat(e.target.value))}
                        className="flex-1 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                      />

                      <span className="text-[10px] text-slate-300 font-mono shrink-0">
                        {formatSec(currentTime)} / {formatSec(duration || selectedVideo.duration)}
                      </span>

                      <button
                        type="button"
                        onClick={() => setIsMuted(!isMuted)}
                        className="p-1 text-slate-400 hover:text-white rounded cursor-pointer shrink-0"
                        title={isMuted ? 'Bật âm thanh' : 'Tắt tiếng'}
                      >
                        {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="min-h-[500px] flex flex-col items-center justify-center p-8 bg-[#0a0c12] border border-slate-800 rounded-2xl text-slate-500 text-center">
                <Film size={44} className="opacity-30 mb-2 text-slate-700" />
                <p className="text-xs">Chưa có video thành phẩm để xem trước</p>
              </div>
            )}

            {/* Cấu Hình Đã Áp Dụng cho video đang chọn (Nhấn để nhảy qua trang cấu hình) */}
            {selectedVideo && (() => {
              const cfg = selectedVideo.config_summary || (videoDetail as any)?.job_config;
              const presetName =
                cfg?.preset_name ||
                selectedVideo.presetName ||
                (cfg?.voice_id && cfg?.sub_font
                  ? `${cfg.sub_font} • ${cfg.voice_id.split('-').pop()}`
                  : 'Cấu hình chuẩn');

              return (
                <div
                  onClick={() => {
                    navigate('/localize/presets', {
                      state: { presetId: cfg?.preset_id },
                    });
                  }}
                  className="mt-3 p-3.5 bg-gradient-to-r from-[#141722] to-[#181d2f] hover:from-[#191d2c] hover:to-[#222942] border border-slate-800 hover:border-violet-500/60 rounded-2xl cursor-pointer transition-all duration-200 shadow-sm group active:scale-[0.99]"
                  title="Nhấn để mở trang Quản lý Cấu hình mẫu (Presets)"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 group-hover:scale-110 transition shrink-0">
                        <SlidersHorizontal size={15} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Cấu hình đã áp dụng
                        </div>
                        <div className="text-xs font-bold text-white group-hover:text-violet-300 transition truncate mt-0.5 flex items-center gap-1.5">
                          <span className="text-violet-400">⚙️</span>
                          <span>{presetName}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] font-semibold text-violet-400 group-hover:text-violet-300 group-hover:translate-x-0.5 transition shrink-0">
                      <span>Trang cấu hình</span>
                      <ChevronRight size={13} />
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── CỘT 2 (8-9 cols): KHÔNG GIAN LÀM VIỆC RỘNG RÃI THOÁNG ĐÃNG ── */}
        <div className="lg:col-span-8 xl:col-span-8 2xl:col-span-9 space-y-5">
          
          {/* ══════════════════════════════════════════════════════════
              TAB 1: KHO VIDEO THÀNH PHẨM (DẠNG LIST RỘNG RÃI NHƯ HÌNH 2)
          ══════════════════════════════════════════════════════════ */}
          {activeTab === 'list' && (
            <div className="space-y-5 animate-in fade-in duration-200">
              
              {/* Card Header & Search & Batch Toolbar */}
              <div className="bg-[#141722] border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
                
                {/* Search Bar & Refresh */}
                <div className="flex items-center gap-2.5">
                  <div className="relative flex-1">
                    <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Tìm theo tên video, ID, từ khóa..."
                      className="w-full pl-10 pr-10 py-2.5 bg-[#0e111a] border border-slate-800 rounded-2xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 transition shadow-inner"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => loadVideos(selectedVideoId || undefined)}
                    className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-300 hover:text-white transition cursor-pointer shadow-sm shrink-0"
                    title="Làm mới danh sách"
                  >
                    <RefreshCw size={15} className={loadingVideos ? 'animate-spin' : ''} />
                  </button>
                </div>

                {/* Batch Actions Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-800/80 text-xs">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={toggleSelectAllBatch}
                      className="flex items-center gap-2 font-medium text-slate-300 hover:text-white transition cursor-pointer"
                    >
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center transition ${
                          selectedBatchIds.length > 0 && selectedBatchIds.length === videos.length
                            ? 'bg-violet-600 border-violet-500 text-white'
                            : 'border-slate-600 bg-slate-900/60 hover:border-slate-400'
                        }`}
                      >
                        {selectedBatchIds.length > 0 && selectedBatchIds.length === videos.length && (
                          <Check size={11} strokeWidth={3} />
                        )}
                      </div>
                      <span>
                        {selectedBatchIds.length === 0
                          ? `Chọn tất cả (${videos.length})`
                          : `Đã chọn (${selectedBatchIds.length})`}
                      </span>
                    </button>

                    {selectedBatchIds.length > 0 && (
                      <div className="flex items-center gap-2 animate-in fade-in duration-150">
                        <button
                          type="button"
                          onClick={() => setSelectedBatchIds([])}
                          className="text-[11px] text-slate-500 hover:text-slate-300 transition cursor-pointer"
                        >
                          Bỏ chọn
                        </button>

                        {/* NÚT XOÁ KHI TICK CHỌN */}
                        <button
                          type="button"
                          disabled={isDeletingBatch}
                          onClick={handleBatchDeleteVideos}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600/15 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 text-xs font-bold transition shadow-sm cursor-pointer active:scale-95 disabled:opacity-50"
                          title={`Xóa ${selectedBatchIds.length} video đã tick chọn`}
                        >
                          {isDeletingBatch ? (
                            <RefreshCw size={12} className="animate-spin" />
                          ) : (
                            <Trash2 size={12} />
                          )}
                          <span>Xóa ({selectedBatchIds.length})</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Batch Actions Right: Gu & Button Sinh Caption */}
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {/* Toggle Kèm Hashtags */}
                    <button
                      type="button"
                      onClick={() => handleToggleHashtags(!includeHashtags)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition ${
                        includeHashtags
                          ? 'bg-violet-600/20 text-violet-300 border-violet-500/40'
                          : 'bg-slate-800/80 text-slate-400 border-slate-700/60'
                      }`}
                    >
                      <Hash size={12} className={includeHashtags ? 'text-violet-400' : 'text-slate-500'} />
                      <span>Hashtag: {includeHashtags ? 'BẬT' : 'TẮT'}</span>
                    </button>

                    {/* Gu Caption */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300">
                      <Sliders size={12} className="text-violet-400 shrink-0" />
                      <span className="text-[11px] text-slate-400">Gu:</span>
                      <select
                        value={captionStyle}
                        onChange={(e) => handleSelectCaptionStyle(e.target.value)}
                        className="bg-transparent text-xs font-semibold text-violet-300 focus:outline-none cursor-pointer"
                      >
                        {CAPTION_STYLES.map((st) => (
                          <option key={st.id} value={st.id} className="bg-slate-900 text-slate-200">
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Nút sinh caption hàng loạt */}
                    <button
                      type="button"
                      disabled={selectedBatchIds.length === 0 || isGeneratingBatch}
                      onClick={handleBatchGenerateCaptions}
                      className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold border transition shadow-sm cursor-pointer ${
                        selectedBatchIds.length > 0 && !isGeneratingBatch
                          ? 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white border-violet-500/40 active:scale-95'
                          : 'bg-slate-800/50 text-slate-500 border-slate-800 cursor-not-allowed'
                      }`}
                    >
                      {isGeneratingBatch ? (
                        <>
                          <RefreshCw size={13} className="animate-spin text-violet-300" />
                          <span>Đang sinh ({selectedBatchIds.length})...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={13} className="text-violet-300" />
                          <span>Sinh Caption ({selectedBatchIds.length})</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* DANH SÁCH VIDEO DẠNG HÀNG NGANG RỘNG RÃI (CHUẨN HÌNH 2) */}
              <div className="space-y-3">
                {loadingVideos ? (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-500 text-xs gap-3">
                    <RefreshCw size={24} className="animate-spin text-violet-500" />
                    <span>Đang tải danh sách video thành phẩm...</span>
                  </div>
                ) : filteredVideos.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 px-4 text-center text-slate-500 text-xs gap-3 bg-[#141722] border border-slate-800 rounded-3xl">
                    <Film size={40} className="text-slate-700" />
                    <p className="text-sm font-semibold text-slate-400">
                      {searchQuery
                        ? 'Không tìm thấy video nào khớp với từ khóa tìm kiếm.'
                        : 'Chưa có video nào trong danh sách hậu kỳ.'}
                    </p>
                    {!searchQuery && (
                      <button
                        type="button"
                        onClick={() => navigate('/localize')}
                        className="px-4 py-2 rounded-xl bg-violet-600/20 text-violet-300 border border-violet-500/30 hover:bg-violet-600/30 text-xs font-semibold transition cursor-pointer"
                      >
                        Qua trang Lồng Tiếng để tạo thêm video ➜
                      </button>
                    )}
                  </div>
                ) : (
                  filteredVideos.map((v, idx) => {
                    const isSelected = v.id === selectedVideoId;
                    const isChecked = selectedBatchIds.includes(v.id);

                    return (
                      <div
                        key={v.id}
                        onClick={() => setSelectedVideoId(v.id)}
                        className={`px-4 py-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-4 group select-none ${
                          isSelected
                            ? 'bg-violet-950/30 border-violet-500 shadow-md shadow-violet-950/30 ring-1 ring-violet-500/40'
                            : isChecked
                            ? 'bg-[#181b28] border-violet-500/40'
                            : 'bg-[#10121a] border-slate-800/90 hover:border-slate-700 hover:bg-[#151722]'
                        }`}
                      >
                        {/* Cột 1: Checkbox */}
                        <div
                          onClick={(e) => toggleBatchSelectVideo(v.id, e)}
                          className="p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer shrink-0"
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center transition ${
                              isChecked
                                ? 'bg-violet-600 border-violet-500 text-white'
                                : 'border-slate-600 bg-slate-900/60 hover:border-slate-400'
                            }`}
                          >
                            {isChecked && <Check size={11} strokeWidth={3} />}
                          </div>
                        </div>

                        {/* Cột 2: Ảnh Thumbnail 16:9 sắc nét */}
                        <div className="relative w-28 sm:w-36 aspect-[16/9] rounded-xl overflow-hidden bg-black border border-slate-800/90 shrink-0 group/thumb">
                          {v.thumbnail_url ? (
                            <img
                              src={libraryApi.getMediaUrl(v.thumbnail_url)}
                              alt={v.title}
                              className="w-full h-full object-contain bg-black group-hover/thumb:scale-105 transition duration-200"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-slate-900">
                              <FileVideo size={24} className="text-slate-700" />
                            </div>
                          )}

                          {/* Thời lượng */}
                          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur text-[10px] text-slate-200 font-mono">
                            {formatSec(v.duration)}
                          </span>

                          {/* Đang xem badge */}
                          {isSelected && (
                            <span className="absolute top-1 right-1 px-1.5 py-0.2 rounded-full bg-violet-600 text-white text-[9px] font-bold flex items-center gap-0.5 shadow">
                              <Eye size={9} /> Đang xem
                            </span>
                          )}
                        </div>

                        {/* Cột 3: Tên video, 2 chế độ (Đã lồng tiếng & Đã có cap) & Caption */}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <p className="text-xs sm:text-sm font-bold text-white line-clamp-1 leading-snug group-hover:text-violet-300 transition">
                            {v.title}
                          </p>

                          {/* 2 chế độ: Đã lồng tiếng & Đã có cap */}
                          <div className="flex items-center gap-2 text-[11px] flex-wrap">
                            <span className="font-mono text-slate-500">STT: {idx + 1}</span>
                            <span className="text-slate-600">•</span>

                            {/* Chế độ 1: Đã lồng tiếng */}
                            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold text-[10px]">
                              Đã Lồng Tiếng
                            </span>

                            {/* Chế độ 2: Đã có cap / Chưa có cap */}
                            {v.has_caption || v.caption ? (
                              <span className="px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30 font-semibold text-[10px]">
                                Đã Có Cap
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/40 text-[10px]">
                                Chưa Có Cap
                              </span>
                            )}

                            {/* Badge trạng thái lên lịch */}
                            {v.has_schedule ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium text-[10px] flex items-center gap-1">
                                <Calendar size={10} />
                                <span>Đã Lên Lịch</span>
                              </span>
                            ) : (v.has_caption || Boolean(v.caption?.trim())) ? (
                              <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-medium text-[10px] flex items-center gap-1">
                                <Sparkles size={10} />
                                <span>Sẵn Sàng Lên Lịch</span>
                              </span>
                            ) : null}
                          </div>

                          {/* Nút bấm mở Popup Xem & Sửa Caption (Gọn gàng, không tràn lan chữ) */}
                          <div className="flex items-center gap-2 pt-0.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={(e) => openCaptionModal(v, e)}
                              className="p-1.5 rounded-lg bg-violet-600/15 hover:bg-violet-600/30 text-violet-300 hover:text-white border border-violet-500/30 transition flex items-center justify-center shadow-sm active:scale-95 cursor-pointer shrink-0"
                              title={v.caption ? 'Xem & sửa caption' : 'Thêm caption'}
                            >
                              <Edit3 size={12} className="text-violet-400" />
                            </button>

                            {v.caption ? (
                              <span
                                onClick={(e) => openCaptionModal(v, e)}
                                className="text-xs text-slate-400 hover:text-slate-200 transition truncate max-w-[280px] sm:max-w-[360px] xl:max-w-[480px] cursor-pointer"
                                title="Bấm để xem và sửa caption trong popup"
                              >
                                {v.caption}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-500 italic">
                                Chưa có caption
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Cột 4: Nút Thao Tác */}
                        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setSelectedVideoId(v.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                              isSelected
                                ? 'bg-violet-600 text-white shadow-sm'
                                : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700/50'
                            }`}
                            title="Xem video trên màn hình điện thoại bên trái"
                          >
                            <Eye size={13} />
                            <span>Xem</span>
                          </button>

                          {/* Sinh Caption inline */}
                          <button
                            type="button"
                            disabled={generatingCaptionIds.has(v.id)}
                            onClick={(e) => handleInlineGenerateCaption(v.id, e)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border shadow-sm active:scale-95 ${
                              generatingCaptionIds.has(v.id)
                                ? 'bg-slate-800/50 text-slate-500 border-slate-800 cursor-wait'
                                : v.has_caption
                                ? 'bg-emerald-600/15 hover:bg-emerald-600/30 text-emerald-400 border-emerald-500/30'
                                : 'bg-amber-600/15 hover:bg-amber-600/30 text-amber-400 border-amber-500/30'
                            }`}
                            title={v.has_caption ? 'Sinh lại Caption & Hashtags' : 'Sinh Caption & Hashtags AI'}
                          >
                            {generatingCaptionIds.has(v.id) ? (
                              <>
                                <RefreshCw size={12} className="animate-spin" />
                                <span>Đang sinh...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles size={12} />
                                <span>{v.has_caption ? 'Sinh lại Cap' : 'Sinh Cap'}</span>
                              </>
                            )}
                          </button>

                          {/* Nút Chỉnh Sửa (nhảy sang trang chỉnh sửa đầy đủ /localize/editor/:videoId) */}
                          <button
                            type="button"
                            onClick={() => {
                              navigate(`/localize/editor/${v.id}`);
                            }}
                            className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-700/60 hover:border-indigo-500/40 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm active:scale-95"
                            title="Chuyển sang trang chỉnh sửa toàn diện (giọng đọc, font chữ, vị trí, hiệu ứng)"
                          >
                            <Edit3 size={13} />
                            <span>Chỉnh Sửa</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              TAB 2: LÊN LỊCH ĐĂNG & CAPTION (CHO VIDEO ĐANG CHỌN)
          ══════════════════════════════════════════════════════════ */}
          {activeTab === 'detail' && (
            <div className="space-y-5 animate-in fade-in duration-200">
              
              {/* Header Tab 2 */}
              <div className="bg-[#141722] border border-slate-800 rounded-3xl p-4 sm:p-5 flex items-center justify-between shadow-sm flex-wrap gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => setActiveTab('list')}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer shrink-0"
                    title="Quay lại danh sách video"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-white truncate">
                      Lên Lịch Đăng & Caption: {selectedVideo?.title || `Video #${selectedVideoId}`}
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      STT: #{filteredVideos.findIndex((item) => item.id === selectedVideoId) + 1 || 1} • Thời lượng: {formatSec(selectedVideo?.duration || 0)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {selectedVideoId && (
                    <button
                      type="button"
                      onClick={() => navigate(`/localize/editor/${selectedVideoId}`)}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold text-indigo-300 hover:text-white bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/30 transition cursor-pointer flex items-center gap-1.5 shadow-sm"
                      title="Chuyển sang trang chỉnh sửa đầy đủ để đổi giọng lồng tiếng, kiểu font, vị trí sub..."
                    >
                      <Edit3 size={13} />
                      <span>Mở Trình Chỉnh Sửa Đầy Đủ ➜</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveTab('list')}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition cursor-pointer"
                  >
                    ← Quay lại danh sách
                  </button>
                </div>
              </div>

              {/* 2 CỘT SONG SONG: CAPTION AI & HASHTAGS (BÊN TRÁI) - KÊNH TIKTOK & LÊN LỊCH (BÊN PHẢI) */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
                
                {/* ── CỘT 1 (6 cols): CAPTION AI & HASHTAGS ────────── */}
                <div className="xl:col-span-6 space-y-4">
                  
                  {/* Card 1: Caption AI */}
                  <div className="bg-[#141722] border border-slate-800 rounded-3xl p-5 shadow-sm space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles size={16} className="text-violet-400" />
                        <span className="text-xs font-bold text-white uppercase tracking-wider">
                          Caption Video AI
                        </span>
                      </div>

                      <button
                        type="button"
                        disabled={isGeneratingSingle}
                        onClick={handleGenerateSingleCaption}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition shadow-sm cursor-pointer disabled:opacity-50"
                      >
                        {isGeneratingSingle ? (
                          <>
                            <RefreshCw size={13} className="animate-spin" />
                            <span>Đang viết...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles size={13} />
                            <span>AI Viết Lại</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Chọn Gu Caption */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs">
                      {CAPTION_STYLES.map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => handleSelectCaptionStyle(st.id)}
                          className={`p-2 rounded-xl border text-left transition cursor-pointer ${
                            captionStyle === st.id
                              ? 'bg-violet-600/20 border-violet-500 text-violet-300 font-bold'
                              : 'bg-[#0e111a] border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          <div className="font-semibold">{st.label}</div>
                          <div className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">{st.desc}</div>
                        </button>
                      ))}
                    </div>

                    {/* Textarea Caption */}
                    <div className="space-y-1">
                      <textarea
                        rows={3}
                        value={captionDraft}
                        onChange={(e) => setCaptionDraft(e.target.value)}
                        placeholder="Nhập caption hoặc bấm 'AI Viết Lại' để Gemini tạo..."
                        className="w-full p-3 bg-[#0e111a] border border-slate-800 rounded-2xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 transition leading-relaxed resize-none shadow-inner"
                      />
                      <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
                        <span>Tự do chỉnh sửa bằng tay bất kỳ lúc nào</span>
                        <span>{captionDraft.length} ký tự</span>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Hashtags TikTok */}
                  <div className="bg-[#141722] border border-slate-800 rounded-3xl p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Hash size={16} className="text-violet-400" />
                        <span className="text-xs font-bold text-white uppercase tracking-wider">
                          Hashtags TikTok
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400">{hashtagsDraft.length} tags</span>
                    </div>

                    {/* Tags List */}
                    <div className="flex flex-wrap gap-1.5 min-h-[30px]">
                      {hashtagsDraft.length === 0 ? (
                        <span className="text-xs text-slate-500 italic">Chưa có hashtag nào</span>
                      ) : (
                        hashtagsDraft.map((tag) => (
                          <span
                            key={tag}
                            className="px-2.5 py-1 rounded-xl bg-violet-600/15 border border-violet-500/30 text-violet-300 text-xs font-mono font-medium flex items-center gap-1.5"
                          >
                            <span>{tag}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveHashtag(tag)}
                              className="text-slate-400 hover:text-rose-400"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))
                      )}
                    </div>

                    {/* Add Tag Input */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newTagInput}
                        onChange={(e) => setNewTagInput(e.target.value)}
                        onKeyDown={handleAddHashtag}
                        placeholder="Gõ hashtag rồi nhấn Enter (VD: #xuhuong, #fyp)..."
                        className="flex-1 px-3 py-2 bg-[#0e111a] border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
                      />
                      <button
                        type="button"
                        onClick={handleAddHashtag}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Card 3: Kênh TikTok & Lên Lịch Đăng */}
                  <div className="bg-[#141722] border border-slate-800 rounded-3xl p-5 shadow-sm space-y-4">
                    
                    {/* Chọn Kênh */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Tv size={16} className="text-violet-400" />
                        <span className="text-xs font-bold text-white uppercase tracking-wider">
                          Kênh TikTok Đăng Bài
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {videoDetail?.channels && videoDetail.channels.length > 0 ? (
                          videoDetail.channels.map((ch) => {
                            const isChSelected = selectedChannels.includes(ch.id);
                            return (
                              <div
                                key={ch.id}
                                onClick={() => toggleChannelSelection(ch.id)}
                                className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between text-xs ${
                                  isChSelected
                                    ? 'bg-violet-950/30 border-violet-500 text-white font-semibold'
                                    : 'bg-[#0e111a] border-slate-800 text-slate-400 hover:text-white'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <div
                                    className={`w-4 h-4 rounded border flex items-center justify-center ${
                                      isChSelected
                                        ? 'bg-violet-600 border-violet-500 text-white'
                                        : 'border-slate-600 bg-slate-900'
                                    }`}
                                  >
                                    {isChSelected && <Check size={11} strokeWidth={3} />}
                                  </div>
                                  <span>{ch.name}</span>
                                </div>
                                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                                  {ch.platform}
                                </span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-xs text-slate-500 p-2">
                            Chưa có kênh TikTok nào. Hãy thêm kênh trong Cài đặt.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Thời gian đăng */}
                    <div className="space-y-2 pt-2 border-t border-slate-800/80">
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-violet-400" />
                        <span className="text-xs font-bold text-white uppercase tracking-wider">
                          Thời Gian Đăng Video
                        </span>
                      </div>

                      <div className="space-y-2">
                        <input
                          type="datetime-local"
                          value={customDateTime}
                          onChange={(e) => setCustomDateTime(e.target.value)}
                          className="w-full px-3 py-2 bg-[#0e111a] border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500 transition font-mono"
                        />
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              const now = new Date();
                              now.setMinutes(now.getMinutes() + 10);
                              const localStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                              setCustomDateTime(localStr);
                            }}
                            className="text-[10px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                          >
                            Sau 10p
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const now = new Date();
                              now.setHours(now.getHours() + 1);
                              const localStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                              setCustomDateTime(localStr);
                            }}
                            className="text-[10px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                          >
                            Sau 1h
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const now = new Date();
                              now.setHours(20, 0, 0, 0);
                              if (now.getTime() <= Date.now()) {
                                now.setDate(now.getDate() + 1);
                              }
                              const localStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                              setCustomDateTime(localStr);
                            }}
                            className="text-[10px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                          >
                            20:00 Tối Nay
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* NÚT LƯU FINAL & LÊN LỊCH ĐĂNG */}
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={handleSaveAndSchedule}
                      className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition active:scale-98 cursor-pointer disabled:opacity-50"
                    >
                      {isSaving ? (
                        <>
                          <RefreshCw size={15} className="animate-spin" />
                          <span>Đang lưu video final & xếp lịch...</span>
                        </>
                      ) : (
                        <>
                          <CalendarPlus size={15} />
                          <span>Lưu Video Final & Lên Lịch Đăng</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* POPUP MODAL: XEM & CHỈNH SỬA CAPTION THỦ CÔNG */}
      {editingCaptionVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={closeCaptionModal}
        >
          <div
            className="w-full max-w-xl bg-[#141724] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-[#10131e]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
                  <Edit3 size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>Chỉnh Sửa Caption & Hashtags</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
                      #{editingCaptionVideo.id}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate max-w-sm">
                    {editingCaptionVideo.title || `Video #${editingCaptionVideo.id}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeCaptionModal}
                className="w-8 h-8 rounded-lg bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* AI Helper Banner */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-gradient-to-r from-violet-950/40 via-purple-950/30 to-indigo-950/40 border border-violet-500/20">
                <div className="flex items-center gap-2.5">
                  <Sparkles size={16} className="text-violet-400 shrink-0" />
                  <span className="text-xs text-slate-300">
                    Tự nhập caption hoặc nhờ AI viết lại tự động.
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isAiGeneratingInModal}
                  onClick={handleModalGenerateAi}
                  className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-xs transition flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
                >
                  {isAiGeneratingInModal ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      <span>Đang tạo...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} />
                      <span>✨ AI Viết Lại</span>
                    </>
                  )}
                </button>
              </div>

              {/* Caption Text Area */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText size={14} className="text-violet-400" />
                    <span>Nội Dung Caption</span>
                  </label>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {modalCaptionText.length} ký tự
                  </span>
                </div>
                <textarea
                  value={modalCaptionText}
                  onChange={(e) => setModalCaptionText(e.target.value)}
                  placeholder="Nhập nội dung caption thu hút người xem cho video TikTok này..."
                  rows={4}
                  className="w-full p-3.5 bg-[#0e111a] border border-slate-800 rounded-2xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/50 resize-none transition leading-relaxed"
                />
              </div>

              {/* Hashtags Section */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Hash size={14} className="text-purple-400" />
                    <span>Hashtags ({modalHashtags.length})</span>
                  </label>
                  <span className="text-[11px] text-slate-500">
                    Bấm Enter để thêm tag
                  </span>
                </div>

                {/* Tag Input */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Hash size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={modalTagInput}
                      onChange={(e) => setModalTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = modalTagInput.trim().replace(/^#+/, '');
                          if (val && !modalHashtags.includes(val)) {
                            setModalHashtags([...modalHashtags, val]);
                            setModalTagInput('');
                          }
                        }
                      }}
                      placeholder="Thêm hashtag (ví dụ: giadungthongminh) rồi bấm Enter..."
                      className="w-full pl-8 pr-3 py-2 bg-[#0e111a] border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const val = modalTagInput.trim().replace(/^#+/, '');
                      if (val && !modalHashtags.includes(val)) {
                        setModalHashtags([...modalHashtags, val]);
                        setModalTagInput('');
                      }
                    }}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-medium transition cursor-pointer shrink-0"
                  >
                    Thêm
                  </button>
                </div>

                {/* Hashtag Badges */}
                <div className="flex flex-wrap gap-1.5 p-3 rounded-2xl bg-[#0e111a] border border-slate-800/80 min-h-[48px] items-center">
                  {modalHashtags.length > 0 ? (
                    modalHashtags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-purple-500/10 border border-purple-500/20 text-purple-300 font-medium group"
                      >
                        <span>#{tag}</span>
                        <button
                          type="button"
                          onClick={() => setModalHashtags(modalHashtags.filter((_, i) => i !== idx))}
                          className="hover:text-red-400 text-purple-400/60 transition cursor-pointer p-0.5 rounded"
                          title="Xóa hashtag này"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-600 italic">
                      Chưa có hashtag nào. Hãy gõ vào ô trên rồi nhấn Enter.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="px-6 py-4 border-t border-slate-800/80 bg-[#10131e] flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={closeCaptionModal}
                disabled={isSavingCaptionModal}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 hover:text-white text-xs font-semibold transition cursor-pointer"
              >
                Hủy Bỏ
              </button>

              <button
                type="button"
                disabled={isSavingCaptionModal}
                onClick={handleSaveCaptionFromModal}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-violet-600/20 flex items-center gap-2 transition active:scale-95 cursor-pointer"
              >
                {isSavingCaptionModal ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    <span>Đang lưu...</span>
                  </>
                ) : (
                  <>
                    <Save size={13} />
                    <span>Lưu Thay Đổi</span>
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
