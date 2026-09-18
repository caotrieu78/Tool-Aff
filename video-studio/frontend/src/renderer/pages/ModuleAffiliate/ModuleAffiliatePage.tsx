import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ShoppingBag,
  Sparkles,
  Film,
  Scissors,
  Shuffle,
  Layers,
  Link as LinkIcon,
  Tag,
  Mic,
  Subtitles,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Copy,
  ExternalLink,
  Calendar,
  Volume2,
  Sliders,
  Check,
  Zap,
  Flame,
  Search,
  ChevronDown,
  ChevronUp,
  X,
  Plus,
  Upload,
  Camera,
  Lightbulb,
  Video as VideoIcon,
  Trash2,
  Settings2,
  VolumeX,
  CheckSquare,
  Square,
  Smartphone,
  Grid,
  Scaling,
  Heart,
  MessageSquare,
  Share2,
  SlidersHorizontal,
  Type,
  TrendingUp,
  Award,
  Download,
  ArrowRight,
  Eye,
  EyeOff,
  Save,
  Edit3,
  Info,
} from 'lucide-react';
import { libraryApi, affiliateApi, settingsApi, editorApi, connectJobWs } from '../../api/client';

interface VideoItem {
  id: number;
  title: string;
  duration?: number | null;
  resolution?: string | null;
  thumbnail_path?: string | null;
  thumbnail_url?: string | null;
  video_url?: string | null;
  file_path?: string;
  status?: string;
  channel_id?: number | null;
  category_id?: number | null;
}

interface VoiceItem {
  id: string;
  name: string;
  gender: string;
  region: string;
  description?: string;
}

export default function ModuleAffiliatePage() {
  const navigate = useNavigate();
  const location = useLocation();

  // ── 1. Video Selection & Library ──────────────────────────────────────────
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);
  const [loadingVideos, setLoadingVideos] = useState<boolean>(true);
  const [showVideoPickerModal, setShowVideoPickerModal] = useState<boolean>(false);
  const [searchLibraryVideo, setSearchLibraryVideo] = useState<string>('');
  const [uploadingFiles, setUploadingFiles] = useState<boolean>(false);

  // Phone Mockup Controls
  const [phoneMockup, setPhoneMockup] = useState<'iphone16' | 'iphone_notch' | 'android_s24' | 'frameless'>('iphone16');
  const [showSafeZone, setShowSafeZone] = useState<boolean>(false);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [isPlayingPreviewVideo, setIsPlayingPreviewVideo] = useState<boolean>(false);
  const [isMutedPreview, setIsMutedPreview] = useState<boolean>(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'product' | 'script' | 'voice' | 'subtitles'>('product');

  // ── 2. Product Info & Affiliate Link ──────────────────────────────────────
  const [productUrl, setProductUrl] = useState<string>('');
  const [scraping, setScraping] = useState<boolean>(false);
  const [scrapeMessage, setScrapeMessage] = useState<string>('');
  const [productName, setProductName] = useState<string>('');
  const [productPrice, setProductPrice] = useState<string>('');
  const [productDesc, setProductDesc] = useState<string>('');
  const [productCategory, setProductCategory] = useState<string>('Đồ gia dụng & Tiện ích');
  const [productThumb, setProductThumb] = useState<string>('');
  const [noteScript, setNoteScript] = useState<string>('');
  const [anchorText, setAnchorText] = useState<string>('');

  // ── 3. Dubbing Mode & AI Script ───────────────────────────────────────────
  // 'speech_sync' = Bám sát thoại gốc (như Việt hoá bán hàng), 'scene_sync' = Thuyết minh thị giác từng cảnh, 'creative_remix' = Sáng tạo đa phiên bản
  const [dubbingMode, setDubbingMode] = useState<'speech_sync' | 'scene_sync' | 'creative_remix'>('scene_sync');
  const [aiStyle, setAiStyle] = useState<string>('kich_tinh');
  const [aiModel, setAiModel] = useState<string>('gemini-3.8-flash');
  const [numVersions, setNumVersions] = useState<number>(1);
  const [autoHighlight, setAutoHighlight] = useState<boolean>(true);
  const [shuffleOrder, setShuffleOrder] = useState<boolean>(false);

  // ── 4. Voice & Audio Mixer ────────────────────────────────────────────────
  const [voices, setVoices] = useState<VoiceItem[]>([
    { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My', gender: 'Nữ', region: 'Miền Bắc', description: 'Giọng nữ trẻ trung, thu hút, chuyên review bán hàng TikTok' },
    { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh', gender: 'Nam', region: 'Miền Bắc', description: 'Giọng nam truyền cảm, phong thái chuyên gia công nghệ' },
    { id: 'diem_trinh', name: 'Diễm Trinh', gender: 'Nữ', region: 'Miền Nam', description: 'Giọng nữ miền Nam ngọt ngào, gần gũi, chốt đơn tự nhiên' },
    { id: 'ngoc_huyen', name: 'Ngọc Huyền', gender: 'Nữ', region: 'Miền Nam', description: 'Giọng nữ miền Nam tươi vui, năng động, bắt trend' },
    { id: 'mai_linh', name: 'Mai Linh', gender: 'Nữ', region: 'Miền Bắc', description: 'Giọng nữ nhẹ nhàng, phong cách kể chuyện đời thường' },
    { id: 'hung_thinh', name: 'Hùng Thịnh', gender: 'Nam', region: 'Miền Nam', description: 'Giọng nam nội lực, phong cách bán hàng livestream' },
    { id: 'phat_tai', name: 'Phát Tài', gender: 'Nam', region: 'Miền Nam', description: 'Giọng nam vui nhộn, hài hước, tạo thiện cảm' },
  ]);
  const [selectedVoice, setSelectedVoice] = useState<string>('vi-VN-HoaiMyNeural');
  const [voiceFilter, setVoiceFilter] = useState<'all' | 'female' | 'male' | 'north' | 'south'>('all');
  const [voiceSearch, setVoiceSearch] = useState<string>('');
  const [voiceSpeed, setVoiceSpeed] = useState<number>(1.05);
  const [voiceVolume, setVoiceVolume] = useState<number>(1.0);
  const [keepOriginalAudio, setKeepOriginalAudio] = useState<boolean>(true);
  const [bgmVolume, setBgmVolume] = useState<number>(0.15);
  const [originalVolume, setOriginalVolume] = useState<number>(0.10);
  const [autoDucking, setAutoDucking] = useState<boolean>(true);

  // Audio sample playback
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const audioSampleRef = useRef<HTMLAudioElement | null>(null);

  // ── 5. Subtitles Styling & OCR Blur ───────────────────────────────────────
  const [showSubtitles, setShowSubtitles] = useState<boolean>(true);
  const [subPreset, setSubPreset] = useState<'yellow_box' | 'black_box' | 'neon_cyan' | 'white_outline' | 'red_box'>('yellow_box');
  const [subFont, setSubFont] = useState<string>('Arial');
  const [subFontSize, setSubFontSize] = useState<number>(24);
  const [subColor, setSubColor] = useState<string>('#FFE600');
  const [subBgColor, setSubBgColor] = useState<string>('#000000');
  const [subBgOpacity, setSubBgOpacity] = useState<number>(0.85);
  const [subStyleType, setSubStyleType] = useState<'box' | 'outline' | 'shadow' | 'neon'>('box');
  const [subBold, setSubBold] = useState<boolean>(true);
  const [subItalic, setSubItalic] = useState<boolean>(false);
  const [subPositionPercent, setSubPositionPercent] = useState<number>(78);
  const [previewCustomText, setPreviewCustomText] = useState<string>('Mua ngay hôm nay để nhận ưu đãi giảm 50%!');

  // OCR Cover Old Subtitle
  const [coverOldSub, setCoverOldSub] = useState<boolean>(false);
  const [blurAmount, setBlurAmount] = useState<number>(25);
  const [blurMethod, setBlurMethod] = useState<'blur' | 'box'>('blur');

  // ── 6. Job Execution & Progress State ─────────────────────────────────────
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentJobId, setCurrentJobId] = useState<number | null>(null);
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [jobStep, setJobStep] = useState<string>('queued');
  const [jobMessage, setJobMessage] = useState<string>('Đang chuẩn bị xử lý...');
  const [completedVersions, setCompletedVersions] = useState<any[]>([]);
  const [showProgressModal, setShowProgressModal] = useState<boolean>(false);

  // ── 7. Output Video & Preview Modal (Giống bên Lồng Tiếng) ────────────────
  const [previewSource, setPreviewSource] = useState<'original' | 'output'>('original');
  const [activeVersionIndex, setActiveVersionIndex] = useState<number>(0);
  const [completedResult, setCompletedResult] = useState<{
    has_result: boolean;
    job_id?: number | null;
    output_url?: string | null;
    title?: string | null;
    caption?: string | null;
    hashtags?: string[];
    versions?: any[];
  } | null>(null);

  // Result Preview Modal
  const [showResultPreviewModal, setShowResultPreviewModal] = useState<boolean>(false);
  const [previewModalUrl, setPreviewModalUrl] = useState<string | null>(null);
  const [previewModalTitle, setPreviewModalTitle] = useState<string | null>(null);
  const [savingEditor, setSavingEditor] = useState<boolean>(false);
  const [savedEditor, setSavedEditor] = useState<boolean>(false);

  // Helper: Tải file video thành phẩm về máy
  const handleDownloadOutput = async (url?: string | null, title?: string | null) => {
    const targetUrl = url || completedResult?.output_url;
    if (!targetUrl) return;
    const cleanTitle = (title || completedResult?.title || productName || selectedVideo?.title || 'video_affiliate')
      .replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1EA0-\u1EF9]/g, '_');
    const filename = `${cleanTitle}.mp4`;
    try {
      const fullUrl = libraryApi.getMediaUrl(targetUrl);
      const res = await fetch(fullUrl);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 2000);
    } catch {
      const fullUrl = libraryApi.getMediaUrl(targetUrl);
      const a = document.createElement('a');
      a.href = fullUrl;
      a.download = filename;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // Helper: Load kết quả video thành phẩm của video đang chọn
  const loadVideoResult = async (videoId: number) => {
    try {
      const res = await affiliateApi.getVideoResult(videoId);
      if (res && res.has_result && res.output_url) {
        setCompletedResult(res);
        setCompletedVersions(res.versions || []);
        setActiveVersionIndex(0);
        setPreviewSource('output');
        if (res.title && !productName) setProductName(res.title);
        return res;
      } else {
        setCompletedResult(null);
        setPreviewSource('original');
      }
    } catch {
      setCompletedResult(null);
      setPreviewSource('original');
    }
    return null;
  };

  // ── Initial Loading ───────────────────────────────────────────────────────
  useEffect(() => {
    loadLibraryVideos();
    loadVoices();

    return () => {
      if (audioSampleRef.current) {
        audioSampleRef.current.pause();
      }
    };
  }, []);

  // Tự động kiểm tra video thành phẩm khi đổi video
  useEffect(() => {
    if (selectedVideo?.id) {
      loadVideoResult(selectedVideo.id);
    } else {
      setCompletedResult(null);
      setPreviewSource('original');
    }
  }, [selectedVideo?.id]);

  const loadLibraryVideos = async () => {
    try {
      setLoadingVideos(true);
      const res = await libraryApi.getVideos();
      const list = (res.videos || []).map((v: any) => ({
        ...v,
        video_url: v.video_url || (v.file_path ? `/api/storage/${v.id}/input.mp4` : null),
        thumbnail_url: v.thumbnail_url || (v.thumbnail_path ? `/api/storage/${v.id}/thumbnail.jpg` : null),
      }));
      setVideos(list);

      // Check query param video_id
      const queryParams = new URLSearchParams(location.search);
      const targetId = queryParams.get('video_id');
      if (targetId) {
        const found = list.find((item: VideoItem) => String(item.id) === targetId);
        if (found) {
          setSelectedVideo(found);
          return;
        }
      }

      if (list.length > 0 && !selectedVideo) {
        setSelectedVideo(list[0]);
      }
    } catch (err) {
      console.error('Lỗi khi tải danh sách video:', err);
    } finally {
      setLoadingVideos(false);
    }
  };

  const loadVoices = async () => {
    try {
      const res = await settingsApi.getTtsVoices();
      if (Array.isArray(res) && res.length > 0) {
        setVoices(res as any);
      }
    } catch (err) {
      console.warn('Dùng danh sách giọng đọc mặc định');
    }
  };

  // Play audio sample
  const handlePlayVoiceSample = async (voiceId: string) => {
    if (playingVoiceId === voiceId && audioSampleRef.current) {
      audioSampleRef.current.pause();
      setPlayingVoiceId(null);
      return;
    }

    try {
      if (audioSampleRef.current) {
        audioSampleRef.current.pause();
      }
      setPlayingVoiceId(voiceId);
      const res = await settingsApi.getTtsPreview(voiceId);
      if (res && res.audio_url) {
        const url = res.audio_url.startsWith('http') ? res.audio_url : libraryApi.getMediaUrl(res.audio_url);
        const audio = new Audio(url);
        audioSampleRef.current = audio;
        audio.onended = () => setPlayingVoiceId(null);
        audio.onerror = () => setPlayingVoiceId(null);
        await audio.play();
      } else {
        setPlayingVoiceId(null);
      }
    } catch (e) {
      console.error('Không thể phát thử giọng:', e);
      setPlayingVoiceId(null);
    }
  };

  // Scrape product info
  const handleScrapeProduct = async () => {
    if (!productUrl.trim()) {
      setScrapeMessage('⚠️ Vui lòng dán đường dẫn sản phẩm Shopee hoặc TikTok Shop');
      return;
    }

    setScraping(true);
    setScrapeMessage('⏳ Đang kết nối và cào dữ liệu từ sàn TMĐT...');
    try {
      const res = await affiliateApi.scrapeProduct(productUrl.trim());
      if (res.success) {
        if (res.product_name) setProductName(res.product_name);
        if (res.price) setProductPrice(res.price);
        if (res.description) setProductDesc(res.description);
        if (res.thumbnail_url) setProductThumb(res.thumbnail_url);
        if (!anchorText) {
          setAnchorText(res.product_name.slice(0, 28));
        }
        setScrapeMessage(`✅ Đã lấy thành công sản phẩm từ ${res.platform || 'Sàn TMĐT'}!`);
      } else {
        setScrapeMessage(`⚠️ ${res.message || 'Không thể lấy dữ liệu tự động, bạn hãy nhập thủ công bên dưới nhé!'}`);
      }
    } catch (err: any) {
      setScrapeMessage('⚠️ Có lỗi khi kết nối. Bạn có thể tự nhập tên và giá sản phẩm.');
    } finally {
      setScraping(false);
    }
  };

  // Filtered Voices by search & filter
  const filteredVoices = useMemo(() => {
    return voices.filter((v) => {
      const matchSearch =
        !voiceSearch.trim() ||
        v.name.toLowerCase().includes(voiceSearch.toLowerCase()) ||
        (v.description && v.description.toLowerCase().includes(voiceSearch.toLowerCase()));
      if (!matchSearch) return false;
      if (voiceFilter === 'female') return v.gender === 'Nữ' || v.gender === 'Female';
      if (voiceFilter === 'male') return v.gender === 'Nam' || v.gender === 'Male';
      if (voiceFilter === 'north') return (v.region || '').includes('Bắc');
      if (voiceFilter === 'south') return (v.region || '').includes('Nam');
      return true;
    });
  }, [voices, voiceFilter, voiceSearch]);

  // Helper: Lưu video vào Editor Hậu Kỳ
  const handleSaveToEditor = async (videoId: number, title?: string) => {
    try {
      setSavingEditor(true);
      await editorApi.saveFinal(videoId);
      setSavedEditor(true);
      alert(`✔ Đã lưu video "${title || `#${videoId}`}" vào Video Hoàn Chỉnh Hậu Kỳ thành công!`);
    } catch (err: any) {
      alert(`❌ Lỗi khi lưu sang Hậu Kỳ: ${err.message || err}`);
    } finally {
      setSavingEditor(false);
    }
  };

  // Preset Subtitle handler
  const handleSelectSubPreset = (presetKey: 'yellow_box' | 'black_box' | 'neon_cyan' | 'white_outline' | 'red_box') => {
    setSubPreset(presetKey);
    switch (presetKey) {
      case 'yellow_box':
        setSubFont('Arial');
        setSubFontSize(24);
        setSubColor('#FFE600');
        setSubBgColor('#000000');
        setSubBgOpacity(0.85);
        setSubStyleType('box');
        break;
      case 'black_box':
        setSubFont('Oswald');
        setSubFontSize(25);
        setSubColor('#FFFFFF');
        setSubBgColor('#000000');
        setSubBgOpacity(0.80);
        setSubStyleType('box');
        break;
      case 'neon_cyan':
        setSubFont('Montserrat');
        setSubFontSize(24);
        setSubColor('#00FFFF');
        setSubBgColor('#0a0e1a');
        setSubBgOpacity(0.85);
        setSubStyleType('neon');
        break;
      case 'white_outline':
        setSubFont('Be Vietnam Pro');
        setSubFontSize(24);
        setSubColor('#FFFFFF');
        setSubBgColor('#000000');
        setSubBgOpacity(0.0);
        setSubStyleType('outline');
        break;
      case 'red_box':
        setSubFont('Oswald');
        setSubFontSize(25);
        setSubColor('#FFFFFF');
        setSubBgColor('#E11D48');
        setSubBgOpacity(0.90);
        setSubStyleType('box');
        break;
    }
  };

  // Start Job Submission
  const handleStartAffiliateJob = async () => {
    if (!selectedVideo) {
      alert('Vui lòng chọn 1 video để tiến hành tạo video Affiliate!');
      return;
    }

    const payload = {
      video_id: selectedVideo.id,
      product_name: productName.trim() || selectedVideo.title,
      price: productPrice.trim(),
      description: productDesc.trim(),
      shopee_url: productUrl.includes('shopee') ? productUrl.trim() : '',
      tiktok_shop_url: productUrl.includes('tiktok') ? productUrl.trim() : '',
      note_script: noteScript.trim(),
      category: productCategory,
      ai_style: aiStyle,
      ai_model: aiModel,
      dubbing_mode: dubbingMode,
      anchor_text: anchorText.trim() || productName.trim() || 'Xem sản phẩm',
      auto_highlight: autoHighlight,
      shuffle_order: shuffleOrder,
      num_versions: numVersions,
      voice_id: selectedVoice,
      voice_speed: voiceSpeed,
      bgm_volume: bgmVolume,
      voice_volume: voiceVolume,
      keep_original_audio: keepOriginalAudio,
      original_volume: originalVolume,
      ducking: autoDucking,
      cover_old_sub: coverOldSub,
      blur_amount: blurAmount,
      show_subtitles: showSubtitles,
      subtitle_config: {
        font: subFont,
        size: subFontSize,
        color: subColor,
        background: subBgColor,
        opacity: subBgOpacity,
        style_type: subStyleType,
        position_percent: subPositionPercent,
        bold: subBold,
        italic: subItalic,
      },
    };

    try {
      setIsProcessing(true);
      setShowProgressModal(true);
      setJobProgress(5);
      setJobStep('queued');
      setJobMessage('Đang khởi tạo tiến trình dựng video Affiliate...');
      setCompletedVersions([]);

      const res = await affiliateApi.submit(payload);
      if (res && res.job_id) {
        setCurrentJobId(res.job_id);

        // Connect WebSocket
        const ws = connectJobWs(res.job_id, (data: any) => {
          if (data.percent !== undefined) setJobProgress(data.percent);
          if (data.step) setJobStep(data.step);
          if (data.message) setJobMessage(data.message);

          if (data.status === 'done' || data.percent >= 100) {
            setIsProcessing(false);
            setJobProgress(100);
            setJobMessage('🎉 Đã hoàn thành toàn bộ video Affiliate!');
            // Nạp video thành phẩm và tự động bật xem trước
            if (selectedVideo?.id) {
              loadVideoResult(selectedVideo.id).then((r) => {
                if (r && r.has_result) {
                  setPreviewSource('output');
                  setIsPlayingPreviewVideo(true);
                }
              });
            }
            ws.close();
          } else if (data.status === 'error') {
            setIsProcessing(false);
            setJobMessage(`❌ Lỗi: ${data.message || 'Không xác định'}`);
            ws.close();
          }
        });
      }
    } catch (err: any) {
      setIsProcessing(false);
      alert(`Lỗi khởi tạo job: ${err.message || err}`);
    }
  };

  const effectiveFit = fitMode === 'contain' ? 'object-contain' : 'object-cover';

  return (
    <div className="flex flex-col h-full bg-[#0d0f15] text-slate-100 overflow-y-auto">
      {/* ─────────────────────────────────────────────────────────────
          1. STICKY HEADER & ACTION BAR
      ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 lg:px-8 py-3.5 border-b border-slate-800/80 sticky top-0 bg-[#0d0f15]/95 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-sm">
            <ShoppingBag size={18} />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              <span>Studio Sáng Tạo Video Affiliate</span>
              <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-500/40">
                Full Studio v2.0
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">
              Lồng tiếng bán hàng bám sát video, tự động ghép cảnh và đồng bộ TikTok Shop
            </p>
          </div>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-3">
          {completedResult && (
            <button
              type="button"
              onClick={() => handleDownloadOutput()}
              className="px-3.5 py-2 text-xs font-bold text-emerald-300 hover:text-white bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/40 rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow-sm active:scale-95"
              title="Tải video thành phẩm MP4 về máy"
            >
              <Download size={14} className="text-emerald-400" />
              <span>Tải Thành Phẩm (.mp4)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              navigate('/scheduler', {
                state: completedResult
                  ? {
                      videoId: selectedVideo?.id,
                      title: completedResult.title || selectedVideo?.title,
                      caption: completedResult.caption,
                      hashtags: completedResult.hashtags,
                    }
                  : undefined,
              })
            }
            className="px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-amber-500/50 rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow-sm"
            title="Đi tới Lịch Đăng TikTok"
          >
            <Calendar size={14} className="text-amber-400" />
            <span>Lịch Đăng TikTok</span>
          </button>

          <button
            type="button"
            onClick={handleStartAffiliateJob}
            disabled={isProcessing || !selectedVideo}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-bold shadow-lg shadow-amber-500/25 flex items-center gap-2 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Sparkles size={15} />
            <span>
              {isProcessing
                ? `Đang Xử Lý... (${jobProgress}%)`
                : numVersions > 1
                ? `Bắt Đầu Tạo (${numVersions} Phiên Bản)`
                : `Bắt Đầu Tạo Video Affiliate`}
            </span>
          </button>

          <button
            onClick={() => navigate('/library')}
            className="px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition cursor-pointer"
          >
            ← Thư Viện
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. MAIN WORKSPACE (12 COLS: PHONE PREVIEW + TAB CONTROLS)
      ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 p-6 lg:p-8 w-full grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-8 items-start">
        {/* ─────────────────────────────────────────────────────────────
            LEFT COLUMN (5 cols / 4 cols on 2xl): PHONE PREVIEW STUDIO
        ───────────────────────────────────────────────────────────── */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-3 lg:sticky lg:top-20">
          <div className="bg-[#141722] border border-slate-800 rounded-3xl p-4 shadow-lg space-y-3">
            {/* Header: Title + Controls */}
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Smartphone size={14} className="text-amber-400" />
                <span>Xem Trước Video & Phụ Đề</span>
                {selectedVideo && (
                  <span className="text-[10px] text-amber-400 font-mono font-normal">#{selectedVideo.id}</span>
                )}
              </h3>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFitMode(fitMode === 'contain' ? 'cover' : 'contain')}
                  className={`px-2 py-1 text-[11px] rounded-lg font-medium transition cursor-pointer flex items-center gap-1 border ${
                    effectiveFit === 'object-contain'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-800/80 text-slate-400 hover:text-white border-slate-700/60'
                  }`}
                  title="Chế độ co giãn video"
                >
                  <Scaling size={11} />
                  <span>{effectiveFit === 'object-contain' ? 'Full Tỉ Lệ' : 'Cắt Viền'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSafeZone(!showSafeZone)}
                  className={`px-2 py-1 text-[11px] rounded-lg font-medium transition cursor-pointer flex items-center gap-1 ${
                    showSafeZone
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-slate-800/80 text-slate-400 hover:text-white border border-slate-700/60'
                  }`}
                  title="Hiển thị vùng an toàn và các nút TikTok"
                >
                  <Grid size={11} />
                  <span>Vùng TikTok</span>
                </button>
              </div>
            </div>

            {/* Device Selector Tabs */}
            <div className="grid grid-cols-4 gap-1 p-1 bg-[#0c0e14] rounded-xl border border-slate-800/80 text-xs">
              {[
                { id: 'iphone16', label: 'iPhone 16' },
                { id: 'iphone_notch', label: 'Tai Thỏ' },
                { id: 'android_s24', label: 'Galaxy S24' },
                { id: 'frameless', label: '9:16 Gốc' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPhoneMockup(m.id as any)}
                  className={`py-1 rounded-lg font-medium transition cursor-pointer text-center truncate px-1 ${
                    phoneMockup === m.id
                      ? 'bg-amber-500 text-slate-950 shadow-sm font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* PHONE MOCKUP SHELL */}
            {selectedVideo ? (
              <div className="relative flex items-center justify-center p-2 bg-[#0a0c12] border border-slate-800/80 rounded-2xl min-h-[660px] xl:min-h-[720px] shadow-inner select-none">
                <div
                  className={`relative overflow-hidden transition-all duration-200 shadow-2xl ${
                    phoneMockup === 'iphone16'
                      ? 'w-[290px] sm:w-[320px] xl:w-[340px] h-[640px] sm:h-[690px] xl:h-[720px] bg-[#1a1b24] border-[7px] border-[#343947] rounded-[50px] ring-1 ring-white/10 p-[2px]'
                      : phoneMockup === 'iphone_notch'
                      ? 'w-[290px] sm:w-[320px] xl:w-[340px] h-[640px] sm:h-[690px] xl:h-[720px] bg-[#1a1b24] border-[7px] border-[#343947] rounded-[44px] ring-1 ring-white/10 p-[2px]'
                      : phoneMockup === 'android_s24'
                      ? 'w-[285px] sm:w-[315px] xl:w-[335px] h-[640px] sm:h-[690px] xl:h-[720px] bg-[#14161f] border-[5px] border-[#3a3e4e] rounded-[32px] ring-1 ring-white/10 p-[1px]'
                      : 'w-[290px] sm:w-[320px] xl:w-[340px] aspect-[9/16] rounded-2xl border border-slate-800 bg-black p-0 shadow-lg'
                  }`}
                >
                  {/* Dynamic Island / Notch */}
                  {phoneMockup === 'iphone16' && (
                    <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-[90px] h-[22px] bg-black rounded-full z-30 flex items-center justify-between px-2.5 border border-white/10 shadow-md pointer-events-none">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#161824] ring-1 ring-slate-800" />
                      <span className="w-2 h-2 rounded-full bg-amber-500/80 animate-pulse" />
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

                  {/* Home Bar */}
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
                    {(() => {
                      const currentVideoUrl = selectedVideo.video_url;

                      return isPlayingPreviewVideo && currentVideoUrl ? (
                        <video
                          ref={previewVideoRef}
                          key={currentVideoUrl}
                          src={libraryApi.getMediaUrl(currentVideoUrl)}
                          autoPlay
                          loop
                          muted={isMutedPreview}
                          playsInline
                          className={`w-full h-full transition-all duration-200 ${effectiveFit}`}
                        />
                      ) : selectedVideo.thumbnail_url ? (
                        <img
                          src={libraryApi.getMediaUrl(selectedVideo.thumbnail_url)}
                          alt={selectedVideo.title}
                          className={`w-full h-full transition-all duration-200 ${effectiveFit}`}
                        />
                      ) : (
                        <Film size={54} className="text-slate-700" />
                      );
                    })()}

                    {/* Top Right Play & Mute Controls */}
                    {selectedVideo.video_url && (
                      <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const nextMuted = !isMutedPreview;
                            setIsMutedPreview(nextMuted);
                            if (previewVideoRef.current) previewVideoRef.current.muted = nextMuted;
                          }}
                          className="p-1.5 rounded-xl bg-black/80 hover:bg-black text-white text-[11px] backdrop-blur border border-white/15 transition cursor-pointer shadow-md"
                          title={isMutedPreview ? 'Bật âm thanh' : 'Tắt tiếng'}
                        >
                          {isMutedPreview ? <VolumeX size={12} className="text-rose-400" /> : <Volume2 size={12} className="text-emerald-400" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsPlayingPreviewVideo(!isPlayingPreviewVideo)}
                          className="px-2.5 py-1 rounded-xl bg-black/80 hover:bg-black text-white text-[11px] font-semibold backdrop-blur border border-white/15 flex items-center gap-1 transition cursor-pointer shadow-md"
                        >
                          {isPlayingPreviewVideo ? (
                            <>
                              <Square size={10} className="fill-current text-amber-400" />
                              <span>Dừng</span>
                            </>
                          ) : (
                            <>
                              <Play size={10} className="fill-current text-emerald-400" />
                              <span>Phát</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {/* TikTok Safe Zone Simulator */}
                    {showSafeZone && (
                      <div className="absolute inset-x-0 top-10 bottom-12 pointer-events-none z-20 flex flex-col justify-between px-3.5">
                        <div className="border border-dashed border-amber-400/50 rounded-xl flex-1 flex flex-col justify-between p-2.5 bg-amber-500/[0.03]">
                          <div className="text-[8px] text-amber-400/70 font-mono text-center">
                            ── Vùng an toàn TikTok ──
                          </div>
                          <div className="flex items-end justify-between text-white drop-shadow pb-4">
                            <div className="space-y-1 max-w-[70%] text-left">
                              <span className="text-[10px] font-bold text-white block">@shop_affiliate • Follow</span>
                              <p className="text-[9px] text-white/90 line-clamp-2 leading-tight">
                                {productName || selectedVideo.title}
                              </p>
                            </div>
                            <div className="flex flex-col items-center gap-2 text-white pb-1">
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

                    {/* TikTok Shop Anchor Tag Mockup (Ghim Giỏ Hàng Mẫu) */}
                    <div
                      className="absolute left-3 z-30 pointer-events-none flex items-center gap-1.5 px-2.5 py-1 bg-black/85 backdrop-blur border border-amber-400/40 rounded-lg shadow-xl"
                      style={{ bottom: '22%' }}
                    >
                      <div className="w-4 h-4 rounded bg-amber-500 flex items-center justify-center text-slate-950 font-bold text-[9px]">
                        🛍️
                      </div>
                      <div className="flex flex-col text-left">
                        <span className="text-[9.5px] font-bold text-amber-300 line-clamp-1 max-w-[150px]">
                          {anchorText || productName || 'Xem sản phẩm tại đây'}
                        </span>
                        {productPrice && (
                          <span className="text-[8px] text-white/80 font-mono">
                            {productPrice}
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] text-amber-400 font-bold ml-0.5">&gt;</span>
                    </div>

                    {/* Live Subtitle Overlay Preview */}
                    {showSubtitles && (
                      <div
                        className="absolute inset-x-3 flex items-center justify-center pointer-events-none text-center px-1 transition-all duration-200"
                        style={{
                          zIndex: 35,
                          bottom: `${100 - subPositionPercent}%`,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            textAlign: 'center',
                            fontFamily: subFont,
                            fontSize: `${Math.max(10, Math.round(subFontSize * 0.46))}px`,
                            color: subColor,
                            fontWeight: subBold ? 'bold' : 'normal',
                            fontStyle: subItalic ? 'italic' : 'normal',
                            backgroundColor:
                              subStyleType === 'box'
                                ? `${subBgColor}${Math.round(subBgOpacity * 255).toString(16).padStart(2, '0')}`
                                : 'transparent',
                            padding: subStyleType === 'box' ? '4px 10px' : '0px',
                            borderRadius: '8px',
                            maxWidth: '92%',
                            lineHeight: '1.35',
                            wordBreak: 'break-word',
                            textShadow:
                              subStyleType === 'outline'
                                ? `-1.5px -1.5px 0 ${subBgColor}, 1.5px -1.5px 0 ${subBgColor}, -1.5px 1.5px 0 ${subBgColor}, 1.5px 1.5px 0 ${subBgColor}`
                                : subStyleType === 'shadow'
                                ? `2px 2px 4px ${subBgColor}`
                                : subStyleType === 'neon'
                                ? `0 0 5px ${subColor}, 0 0 10px ${subColor}`
                                : 'none',
                          }}
                        >
                          {previewCustomText || 'Mua ngay hôm nay để nhận ưu đãi giảm 50%!'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-[500px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-800 rounded-2xl bg-[#0c0e14]">
                <Film size={40} className="text-slate-600 mb-3" />
                <p className="text-sm font-semibold text-slate-300">Chưa chọn video</p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs">
                  Vui lòng chọn một video từ thư viện hoặc tải video lên để bắt đầu xem trước
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            RIGHT COLUMN (7 cols / 8 cols on 2xl): 4 TABS CONFIGURATION
        ───────────────────────────────────────────────────────────── */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-4">
          {/* KẾT QUẢ VIDEO THÀNH PHẨM (CHUẨN ĐỒNG BỘ NHƯ LỒNG TIẾNG) */}
          {completedResult && selectedVideo && (
            <div className="p-4 rounded-3xl bg-gradient-to-r from-[#171a26] via-[#141724] to-[#121520] border border-amber-500/40 space-y-3 shadow-xl ring-1 ring-amber-500/20">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shadow-inner shrink-0">
                    <Sparkles size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-white">Video Thành Phẩm Affiliate Đã Sẵn Sàng</span>
                      <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                        <CheckCircle2 size={11} />
                        <span>Hoàn tất 100%</span>
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-lg">
                      {completedResult.versions?.[activeVersionIndex]?.title || completedResult.title || selectedVideo.title}
                    </p>
                  </div>
                </div>

                {/* Các nút hành động chính */}
                <div className="flex items-center gap-2 flex-wrap shrink-0 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => {
                      const activeUrl =
                        completedResult.versions?.[activeVersionIndex]?.output_url || completedResult.output_url;
                      const targetTitle =
                        completedResult.versions?.[activeVersionIndex]?.title || completedResult.title || selectedVideo.title;
                      setPreviewModalUrl(
                        activeUrl ? `${activeUrl}${activeUrl.includes('?') ? '&' : '?'}t=${Date.now()}` : null
                      );
                      setPreviewModalTitle(targetTitle);
                      setShowResultPreviewModal(true);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl flex items-center gap-1.5 transition shadow-sm cursor-pointer active:scale-95"
                    title="Mở trình phát xem thử video thành phẩm cỡ lớn 9:16"
                  >
                    <Eye size={13} />
                    <span>Xem Video</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadOutput(
                        completedResult.versions?.[activeVersionIndex]?.output_url || completedResult.output_url,
                        completedResult.versions?.[activeVersionIndex]?.title || completedResult.title || selectedVideo.title
                      )
                    }
                    className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl flex items-center gap-1.5 transition shadow-sm cursor-pointer active:scale-95"
                    title="Tải video này về máy"
                  >
                    <Download size={13} />
                    <span>Tải Về (.mp4)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const targetTitle =
                        completedResult.versions?.[activeVersionIndex]?.title || completedResult.title || selectedVideo.title;
                      handleSaveToEditor(selectedVideo.id, targetTitle);
                    }}
                    disabled={savingEditor}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition cursor-pointer active:scale-95 ${
                      savedEditor
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                    }`}
                    title="Lưu video vào Hậu Kỳ Video Hoàn Chỉnh"
                  >
                    {savingEditor ? (
                      <RefreshCw size={13} className="animate-spin text-amber-400" />
                    ) : savedEditor ? (
                      <CheckCircle2 size={13} className="text-emerald-400" />
                    ) : (
                      <Save size={13} className="text-indigo-400" />
                    )}
                    <span>{savingEditor ? 'Đang lưu...' : savedEditor ? 'Đã Lưu Hậu Kỳ' : 'Lưu Hậu Kỳ'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      navigate('/scheduler', {
                        state: {
                          videoId: selectedVideo.id,
                          title:
                            completedResult.versions?.[activeVersionIndex]?.title ||
                            completedResult.title ||
                            selectedVideo.title,
                          caption:
                            completedResult.versions?.[activeVersionIndex]?.caption ||
                            completedResult.caption,
                          hashtags: completedResult.hashtags,
                        },
                      });
                    }}
                    className="px-3 py-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl flex items-center gap-1.5 transition shadow-sm cursor-pointer active:scale-95"
                    title="Lên lịch đăng tự động lên TikTok"
                  >
                    <Calendar size={13} />
                    <span>Lên Lịch Đăng</span>
                  </button>
                </div>
              </div>

              {/* Danh sách phiên bản (Nếu tạo từ 2 phiên bản trở lên) */}
              {completedResult.versions && completedResult.versions.length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1">
                  <span className="text-[11px] font-semibold text-slate-400 shrink-0">Các phiên bản tạo ra:</span>
                  {completedResult.versions.map((ver: any, vIdx: number) => (
                    <button
                      key={vIdx}
                      type="button"
                      onClick={() => {
                        setActiveVersionIndex(vIdx);
                      }}
                      className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                        activeVersionIndex === vIdx
                          ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold'
                          : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span>Bản #{ver.version || vIdx + 1}</span>
                      {activeVersionIndex === vIdx && <Check size={11} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB BAR NAVIGATION */}
          <div className="flex items-center gap-1.5 p-1.5 bg-[#141722] border border-slate-800 rounded-2xl shadow-md">
            {[
              { id: 'product', label: '1. Video & Sản Phẩm', icon: ShoppingBag, color: 'text-amber-400' },
              { id: 'script', label: '2. Kịch Bản & AI Dubbing', icon: Mic, color: 'text-indigo-400' },
              { id: 'voice', label: '3. Giọng Đọc & Mixer', icon: Volume2, color: 'text-emerald-400' },
              { id: 'subtitles', label: '4. Phụ Đề & Giỏ Hàng', icon: Subtitles, color: 'text-sky-400' },
            ].map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id as any)}
                  className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                    isActive
                      ? 'bg-slate-800/90 text-white shadow-sm border border-slate-700/80'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <Icon size={14} className={isActive ? t.color : 'text-slate-500'} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* TAB 1: VIDEO & SẢN PHẨM */}
          {activeTab === 'product' && (
            <div className="bg-[#141722] border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-5 shadow-lg">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Film size={16} className="text-amber-400" />
                  <span>Chọn Video Nguồn Làm Affiliate</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Chọn video sản phẩm đã tải lên hoặc chọn trực tiếp từ kho thư viện
                </p>
              </div>

              {/* Selected Video Card */}
              {selectedVideo ? (
                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[#0c0e14] border border-slate-800/90">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-900 border border-slate-800 flex-shrink-0 flex items-center justify-center">
                      {selectedVideo.thumbnail_url ? (
                        <img src={libraryApi.getMediaUrl(selectedVideo.thumbnail_url)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Film size={22} className="text-slate-600" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-white truncate">{selectedVideo.title}</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Thời lượng: {selectedVideo.duration ? `${Math.round(selectedVideo.duration)}s` : 'Chưa rõ'} • ID #{selectedVideo.id}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowVideoPickerModal(true)}
                    className="px-3 py-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl transition cursor-pointer flex-shrink-0"
                  >
                    Đổi video khác
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowVideoPickerModal(true)}
                  className="w-full py-8 border-2 border-dashed border-slate-800 hover:border-amber-500/50 rounded-2xl bg-[#0c0e14]/60 flex flex-col items-center justify-center text-center transition cursor-pointer group"
                >
                  <Upload size={28} className="text-slate-500 group-hover:text-amber-400 mb-2 transition" />
                  <span className="text-xs font-bold text-slate-300 group-hover:text-white">Click để chọn video từ Thư Viện</span>
                  <span className="text-[11px] text-slate-500 mt-0.5">Hỗ trợ các file MP4, MOV, MKV</span>
                </button>
              )}

              {/* Product Scraper Section */}
              <div className="pt-3 border-t border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5 uppercase tracking-wider">
                    <LinkIcon size={14} className="text-amber-400" />
                    <span>Thông Tin Sản Phẩm (Shopee / TikTok Shop)</span>
                  </h4>
                  <span className="text-[11px] text-slate-500">Tự động cào dữ liệu hoặc nhập tay</span>
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={productUrl}
                      onChange={(e) => setProductUrl(e.target.value)}
                      placeholder="Dán đường dẫn sản phẩm Shopee, TikTok Shop..."
                      className="w-full px-3.5 py-2.5 bg-[#0c0e14] border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleScrapeProduct}
                    disabled={scraping}
                    className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                  >
                    {scraping ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
                    <span>{scraping ? 'Đang Cào...' : 'Cào Dữ Liệu'}</span>
                  </button>
                </div>
                {scrapeMessage && (
                  <p className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg">
                    {scrapeMessage}
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1">Tên sản phẩm (*):</label>
                    <input
                      type="text"
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      placeholder="Ví dụ: Bộ dao thép không gỉ 5 món"
                      className="w-full px-3 py-2 bg-[#0c0e14] border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500/60"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1">Giá bán / Ưu đãi:</label>
                    <input
                      type="text"
                      value={productPrice}
                      onChange={(e) => setProductPrice(e.target.value)}
                      placeholder="Ví dụ: 159.000₫ (Đang giảm 35%)"
                      className="w-full px-3 py-2 bg-[#0c0e14] border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500/60"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Mô tả tóm tắt tính năng sản phẩm:</label>
                  <textarea
                    rows={2}
                    value={productDesc}
                    onChange={(e) => setProductDesc(e.target.value)}
                    placeholder="Nhập các điểm ưu việt của món đồ: chất liệu, thiết kế thông minh, tiết kiệm thời gian..."
                    className="w-full px-3 py-2 bg-[#0c0e14] border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500/60"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Ghi chú kịch bản / Góc tiếp cận review (Tùy chọn):
                  </label>
                  <textarea
                    rows={2}
                    value={noteScript}
                    onChange={(e) => setNoteScript(e.target.value)}
                    placeholder="Ví dụ: Đánh mạnh vào sự tiện lợi khi làm bếp, kêu gọi mua hàng ở cuối video... (Có thể dùng [góc 1|góc 2] để xáo trộn)"
                    className="w-full px-3 py-2 bg-[#0c0e14] border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500/60"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: KỊCH BẢN & AI DUBBING (CORE UPGRADE) */}
          {activeTab === 'script' && (
            <div className="bg-[#141722] border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-6 shadow-lg">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Mic size={16} className="text-indigo-400" />
                  <span>3 Chế Độ Lồng Tiếng Chuyên Sâu (Chuẩn Bán Hàng)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Chọn phương pháp đồng bộ lời thoại phù hợp nhất với loại video sản phẩm của bạn
                </p>
              </div>

              {/* 3 Dubbing Mode Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  {
                    id: 'speech_sync',
                    title: 'Việt Hóa Bán Hàng',
                    badge: 'Bám Sát Thoại Gốc',
                    badgeColor: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                    desc: 'Bám sát 100% cử chỉ môi & nhịp nói của người trong video gốc (Công nghệ Module Việt Hoá), chuyển ngữ sang phong cách bán hàng chốt đơn.',
                    icon: Zap,
                    recommended: 'Thích hợp video có người nói tiếng Trung/Anh',
                  },
                  {
                    id: 'scene_sync',
                    title: 'Thuyết Minh Thị Giác',
                    badge: 'Bám Sát Cảnh Quay',
                    badgeColor: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
                    desc: 'AI quan sát từng phân cảnh chuyển động (PySceneDetect), thuyết minh chuẩn xác thao tác tay và công năng sản phẩm ở từng giây.',
                    icon: Sparkles,
                    recommended: 'Thích hợp video không lời, chèn nhạc nền',
                  },
                  {
                    id: 'creative_remix',
                    title: 'Sáng Tạo Đa Phiên Bản',
                    badge: 'Ghép Cảnh AIDA',
                    badgeColor: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
                    desc: 'Tự động lọc Highlights, xáo trộn thứ tự cảnh và viết các góc kịch bản giật tít khác nhau để nuôi nhiều kênh không lo trùng lặp.',
                    icon: Shuffle,
                    recommended: 'Thích hợp tạo 2-5 video từ cùng nguồn',
                  },
                ].map((mode) => {
                  const Icon = mode.icon;
                  const isSelected = dubbingMode === mode.id;
                  return (
                    <div
                      key={mode.id}
                      onClick={() => setDubbingMode(mode.id as any)}
                      className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-gradient-to-b from-indigo-950/40 to-slate-900 border-indigo-500/80 shadow-md ring-1 ring-indigo-500/40'
                          : 'bg-[#0c0e14] border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Icon size={18} className={isSelected ? 'text-indigo-400' : 'text-slate-500'} />
                          <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full border ${mode.badgeColor}`}>
                            {mode.badge}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-white">{mode.title}</h4>
                        <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{mode.desc}</p>
                      </div>
                      <div className="mt-3 pt-2.5 border-t border-slate-800/80">
                        <span className="text-[10px] text-slate-500 block">💡 {mode.recommended}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Script Styles Grid */}
              <div className="pt-3 border-t border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5 uppercase tracking-wider">
                    <Flame size={14} className="text-orange-400" />
                    <span>Phong Cách Kịch Bản Review Bán Hàng</span>
                  </h4>
                  <span className="text-[11px] text-slate-500">Thuật toán loại bỏ 100% văn mẫu sáo rỗng</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {[
                    { id: 'kich_tinh', name: 'Chốt Đơn Kịch Tính', desc: 'Hook 3s đầu cực mạnh, tạo cảm giác sốt sắng săn deal kẻo hết' },
                    { id: 'doi_thuong', name: 'Review Đời Thường', desc: 'Kể chuyện tự nhiên như bạn thân tâm sự, chân thật dễ tin' },
                    { id: 'hai_huoc', name: 'Hài Hước / Bắt Trend', desc: 'Dí dỏm, dùng từ ngữ giới trẻ, lôi cuốn giữ chân người xem' },
                    { id: 'boc_phot', name: 'Bóc Phốt / Nói Thẳng', desc: 'Lúc đầu nghi ngờ, dùng xong bất ngờ vì độ xịn của món đồ' },
                    { id: 'chuyen_gia', name: 'Chuyên Gia Phân Tích', desc: 'Phân tích kỹ lưỡng chất liệu, thiết kế thông minh, uy tín' },
                    { id: 'meo_vat', name: 'Mẹo Vặt Hữu Ích', desc: 'Chia sẻ như một giải pháp cứu cánh giúp tiết kiệm 50% thời gian' },
                  ].map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setAiStyle(st.id)}
                      className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                        aiStyle === st.id
                          ? 'bg-amber-500/15 border-amber-500/60 text-white'
                          : 'bg-[#0c0e14] border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800/40'
                      }`}
                    >
                      <span className={`text-xs font-bold block ${aiStyle === st.id ? 'text-amber-300' : 'text-slate-200'}`}>
                        {st.name}
                      </span>
                      <span className="text-[10px] text-slate-400 line-clamp-2 mt-1 leading-snug">{st.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Advanced Options: AI Model & Versions */}
              <div className="pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Mô hình AI viết kịch bản:</label>
                  <select
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0c0e14] border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="gemini-3.8-flash">Gemini 3.8 Flash (Khuyên dùng — Sắc bén, nhanh, chuẩn Việt)</option>
                    <option value="gemini-3.8-pro">Gemini 3.8 Pro (Phân tích kịch bản sâu, văn phong cao cấp)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Số lượng phiên bản video muốn tạo:
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={5}
                      value={numVersions}
                      onChange={(e) => setNumVersions(parseInt(e.target.value))}
                      className="flex-1 accent-amber-500 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-amber-400 w-12 text-right">{numVersions} bản</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 pt-1 text-xs">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoHighlight}
                    onChange={(e) => setAutoHighlight(e.target.checked)}
                    className="rounded border-slate-700 text-amber-500 focus:ring-0"
                  />
                  <span>Tự động chọn cảnh Highlight điểm cao</span>
                </label>
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shuffleOrder}
                    onChange={(e) => setShuffleOrder(e.target.checked)}
                    className="rounded border-slate-700 text-amber-500 focus:ring-0"
                  />
                  <span>Xáo trộn thứ tự cảnh giữa các phiên bản</span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 3: GIỌNG ĐỌC & AUDIO MIXER */}
          {activeTab === 'voice' && (
            <div className="bg-[#141722] border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-6 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Volume2 size={16} className="text-emerald-400" />
                    <span>Chọn Giọng Đọc AI & Bộ Hòa Âm (Audio Mixer)</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Nghe thử các giọng đọc bán hàng hàng đầu và cân chỉnh âm lượng nhạc nền
                  </p>
                </div>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold hidden sm:inline-block">
                  Chuẩn TikTok TTS Studio
                </span>
              </div>

              {/* Current Voice Selected Banner */}
              {(() => {
                const curVoice = voices.find((v) => v.id === selectedVoice) || voices[0];
                const isPlaying = playingVoiceId === selectedVoice;
                return (
                  <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/25 via-[#10141f] to-[#0c0e14] border border-emerald-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                    <div className="flex items-center gap-3.5">
                      <button
                        type="button"
                        onClick={() => handlePlayVoiceSample(selectedVoice)}
                        className={`w-11 h-11 rounded-xl flex items-center justify-center transition shadow-md shrink-0 cursor-pointer ${
                          isPlaying
                            ? 'bg-amber-500 text-slate-950 shadow-amber-500/30'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                        title="Nghe thử giọng hiện tại"
                      >
                        {isPlaying ? (
                          <Square size={15} className="fill-current text-slate-950" />
                        ) : (
                          <Play size={17} className="fill-current ml-0.5" />
                        )}
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{curVoice?.name || selectedVoice}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                            Đang chọn
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                            {curVoice?.gender} • {curVoice?.region}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                          {curVoice?.description || 'Giọng đọc AI tự nhiên, phát âm chuẩn xác'}
                        </p>
                      </div>
                    </div>

                    {/* Quick Speed Buttons */}
                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                      <span className="text-xs text-slate-400 font-medium">Tốc độ:</span>
                      <div className="flex items-center gap-1 bg-slate-900 border border-slate-700/80 rounded-xl p-0.5">
                        {[0.85, 1.0, 1.05, 1.15, 1.25].map((speed) => (
                          <button
                            key={speed}
                            type="button"
                            onClick={() => setVoiceSpeed(speed)}
                            className={`px-2 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                              voiceSpeed === speed
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {speed}x
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Filter & Search Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={voiceSearch}
                    onChange={(e) => setVoiceSearch(e.target.value)}
                    placeholder="Tìm giọng đọc (Hoài My, Nam Minh, Diễm Trinh...)"
                    className="w-full pl-9 pr-3.5 py-2 text-xs bg-[#0c0e14] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex items-center gap-1 overflow-x-auto text-xs pb-1 sm:pb-0">
                  {[
                    { id: 'all', label: 'Tất cả' },
                    { id: 'female', label: 'Nữ' },
                    { id: 'male', label: 'Nam' },
                    { id: 'north', label: 'Miền Bắc' },
                    { id: 'south', label: 'Miền Nam' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setVoiceFilter(f.id as any)}
                      className={`px-3 py-1.5 rounded-xl font-semibold whitespace-nowrap transition cursor-pointer ${
                        voiceFilter === f.id
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {filteredVoices.map((v) => {
                  const isSelected = selectedVoice === v.id;
                  const isPlaying = playingVoiceId === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => setSelectedVoice(v.id)}
                      className={`p-3 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-emerald-950/30 border-emerald-500/70 shadow-sm ring-1 ring-emerald-500/30'
                          : 'bg-[#0c0e14] border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-white truncate">{v.name}</span>
                            <span className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 shrink-0">
                              {v.gender} • {v.region}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-1 line-clamp-2 leading-tight">
                            {v.description || 'Giọng đọc tự nhiên, diễn cảm'}
                          </p>
                        </div>

                        {/* Play sample button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayVoiceSample(v.id);
                          }}
                          className={`p-2 rounded-xl text-xs transition cursor-pointer flex-shrink-0 ${
                            isPlaying
                              ? 'bg-emerald-500 text-slate-950 shadow-md animate-pulse'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700'
                          }`}
                          title="Nghe thử giọng đọc"
                        >
                          {isPlaying ? <Square size={12} className="fill-current" /> : <Play size={12} className="fill-current" />}
                        </button>
                      </div>

                      {isSelected && (
                        <div className="mt-2 pt-1.5 border-t border-emerald-500/20 flex items-center justify-between text-[10px] text-emerald-400 font-semibold">
                          <span>Đang chọn giọng này</span>
                          <Check size={12} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Voice Speed Slider */}
              <div className="pt-3 border-t border-slate-800/80 space-y-2">
                <div className="flex justify-between items-center text-xs font-semibold">
                  <span className="text-slate-300">Tốc độ đọc giọng AI:</span>
                  <span className="text-emerald-400 font-mono font-bold">{voiceSpeed.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.75}
                  max={1.50}
                  step={0.05}
                  value={voiceSpeed}
                  onChange={(e) => setVoiceSpeed(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>0.75x (Chậm rãi)</span>
                  <span>1.05x (Chuẩn TikTok)</span>
                  <span>1.50x (Nhanh kịch tính)</span>
                </div>
              </div>

              {/* Audio Mixer Controls */}
              <div className="pt-3 border-t border-slate-800/80 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5 uppercase tracking-wider">
                    <SlidersHorizontal size={14} className="text-emerald-400" />
                    <span>Bộ Trộn Âm Lượng (Audio Mixer)</span>
                  </h4>
                  <span className="text-[11px] text-slate-500">Cân bằng giọng đọc, nhạc nền và âm gốc</span>
                </div>

                {/* Slider Giọng Đọc AI (0% - 200%) */}
                <div className="p-4 bg-[#0c0e14] border border-slate-800 rounded-2xl space-y-2.5">
                  <div className="flex justify-between items-center text-xs font-semibold">
                    <span className="text-slate-300 flex items-center gap-1.5">
                      <Volume2 size={14} className="text-emerald-400" />
                      <span>Âm lượng Giọng đọc AI:</span>
                    </span>
                    <span className="text-emerald-400 font-mono font-bold">{Math.round(voiceVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.0}
                    max={2.0}
                    step={0.05}
                    value={voiceVolume}
                    onChange={(e) => setVoiceVolume(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>0% (Tắt tiếng)</span>
                    <span>100% (Mặc định chuẩn)</span>
                    <span>200% (Tối đa)</span>
                  </div>
                </div>

                {/* Giữ âm thanh gốc / Nhạc nền BGM */}
                <div className="p-4 bg-[#0c0e14] border border-slate-800 rounded-2xl space-y-3.5">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-white select-none">
                    <input
                      type="checkbox"
                      checked={keepOriginalAudio}
                      onChange={(e) => setKeepOriginalAudio(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-600 bg-slate-900 border-slate-700"
                    />
                    <span>Giữ lại âm thanh / nhạc nền gốc của video</span>
                  </label>

                  {keepOriginalAudio && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs font-medium">
                          <span className="text-slate-300">Âm lượng Nhạc nền (BGM):</span>
                          <span className="text-amber-400 font-mono font-bold">{Math.round(bgmVolume * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0.0}
                          max={1.0}
                          step={0.02}
                          value={bgmVolume}
                          onChange={(e) => setBgmVolume(parseFloat(e.target.value))}
                          className="w-full accent-amber-500 cursor-pointer"
                        />
                        <div className="flex justify-between text-[9.5px] text-slate-500">
                          <span>0%</span>
                          <span>15% (Khuyên dùng)</span>
                          <span>100%</span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs font-medium">
                          <span className="text-slate-300">Âm lượng Tiếng gốc video:</span>
                          <span className="text-sky-400 font-mono font-bold">{Math.round(originalVolume * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0.0}
                          max={1.0}
                          step={0.02}
                          value={originalVolume}
                          onChange={(e) => setOriginalVolume(parseFloat(e.target.value))}
                          className="w-full accent-sky-500 cursor-pointer"
                        />
                        <div className="flex justify-between text-[9.5px] text-slate-500">
                          <span>0% (Tắt)</span>
                          <span>10% (Êm dịu)</span>
                          <span>100%</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer pt-1 select-none">
                  <input
                    type="checkbox"
                    checked={autoDucking}
                    onChange={(e) => setAutoDucking(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 text-emerald-500 focus:ring-0"
                  />
                  <span>Tự động giảm nhạc nền khi có giọng đọc AI (Audio Ducking)</span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 4: PHỤ ĐỀ & NHÃN GIỎ HÀNG */}
          {activeTab === 'subtitles' && (
            <div className="bg-[#141722] border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-6 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Subtitles size={16} className="text-sky-400" />
                    <span>Cấu Hình Phụ Đề Nổi Bật & Nhãn Ghim Giỏ Hàng</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Tùy biến phông chữ, cỡ chữ, màu sắc, hộp viền chuẩn TikTok và nhãn ghim giỏ hàng
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold text-sky-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showSubtitles}
                    onChange={(e) => setShowSubtitles(e.target.checked)}
                    className="w-4 h-4 rounded text-sky-600 bg-slate-900 border-slate-700"
                  />
                  <span>Bật phụ đề</span>
                </label>
              </div>

              {showSubtitles && (
                <>
                  {/* Live Preview Box */}
                  <div className="p-5 rounded-2xl bg-black border border-slate-800 flex flex-col items-center justify-center min-h-[130px] relative overflow-hidden shadow-inner">
                    <span className="absolute top-2.5 left-3 text-[10px] text-slate-500 font-mono tracking-wider">
                      XEM TRƯỚC PHỤ ĐỀ TRỰC QUAN
                    </span>
                    <span
                      style={{
                        fontFamily: subFont,
                        fontSize: `${subFontSize}px`,
                        color: subColor,
                        fontWeight: subBold ? 'bold' : 'normal',
                        fontStyle: subItalic ? 'italic' : 'normal',
                        backgroundColor:
                          subStyleType === 'box'
                            ? `${subBgColor}${Math.round(subBgOpacity * 255).toString(16).padStart(2, '0')}`
                            : 'transparent',
                        padding: subStyleType === 'box' ? '6px 18px' : '2px 8px',
                        borderRadius: '10px',
                        textShadow:
                          subStyleType === 'outline'
                            ? `-2px -2px 0 ${subBgColor}, 2px -2px 0 ${subBgColor}, -2px 2px 0 ${subBgColor}, 2px 2px 0 ${subBgColor}`
                            : subStyleType === 'shadow'
                            ? `2px 2px 6px ${subBgColor}`
                            : subStyleType === 'neon'
                            ? `0 0 8px ${subColor}, 0 0 16px ${subColor}`
                            : 'none',
                        maxWidth: '90%',
                      }}
                      className="transition-all duration-150 select-none text-center leading-relaxed"
                    >
                      {previewCustomText || 'Mua ngay hôm nay để nhận ưu đãi giảm 50%!'}
                    </span>
                    <input
                      type="text"
                      value={previewCustomText}
                      onChange={(e) => setPreviewCustomText(e.target.value)}
                      placeholder="Gõ thử câu phụ đề để xem trước..."
                      className="mt-4 px-3 py-1.5 text-center text-xs bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 placeholder-slate-600 focus:outline-none focus:border-sky-500 w-full max-w-sm"
                    />
                  </div>

                  {/* Quick Presets */}
                  <div className="space-y-2.5">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                      Mẫu Phụ Đề Đẹp Chuẩn TikTok:
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {[
                        { id: 'yellow_box', name: 'Hộp Vàng Chữ Đen', style: 'bg-amber-400 text-slate-950 font-black' },
                        { id: 'black_box', name: 'Hộp Đen Chữ Trắng', style: 'bg-black text-white font-bold' },
                        { id: 'neon_cyan', name: 'Neon Xanh Hiện Đại', style: 'bg-slate-900 text-cyan-300 font-bold border border-cyan-400/50' },
                        { id: 'white_outline', name: 'Trắng Viền Đen', style: 'bg-transparent text-white font-black drop-shadow' },
                        { id: 'red_box', name: 'Hộp Đỏ Nổi Bật', style: 'bg-rose-600 text-white font-black' },
                      ].map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleSelectSubPreset(p.id as any)}
                          className={`py-2.5 px-2 rounded-xl border text-center transition cursor-pointer ${
                            subPreset === p.id
                              ? 'border-sky-500 ring-2 ring-sky-500/30 bg-[#0c0e14]'
                              : 'border-slate-800 hover:border-slate-700 bg-[#0c0e14]'
                          }`}
                        >
                          <span className={`text-[10.5px] px-2 py-0.5 rounded block truncate mb-1.5 ${p.style}`}>
                            Phụ đề mẫu
                          </span>
                          <span className="text-[10px] font-semibold text-slate-300 block truncate">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font, Style & Positioning */}
                  <div className="pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">Phông chữ tiếng Việt:</label>
                      <select
                        value={subFont}
                        onChange={(e) => setSubFont(e.target.value)}
                        className="w-full px-3 py-2 bg-[#0c0e14] border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500"
                      >
                        <option value="Arial">Arial (Cơ bản, chuẩn mực)</option>
                        <option value="Oswald">Oswald (Hẹp cao, đậm chất TikTok)</option>
                        <option value="Montserrat">Montserrat (Hiện đại, bo tròn sang trọng)</option>
                        <option value="Roboto">Roboto (Gọn gàng, dễ đọc)</option>
                        <option value="Be Vietnam Pro">Be Vietnam Pro (Tối ưu dấu tiếng Việt)</option>
                        <option value="Playfair Display">Playfair Display (Nghệ thuật, cao cấp)</option>
                        <option value="Lexend">Lexend (Thoáng mắt, chống mỏi)</option>
                        <option value="SVN-Avo">SVN-Avo (Bán chạy, phá cách)</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between items-center text-[11px] font-semibold text-slate-300 mb-1">
                        <span>Cỡ chữ:</span>
                        <span className="text-sky-400 font-mono font-bold">{subFontSize}px</span>
                      </div>
                      <input
                        type="range"
                        min={18}
                        max={48}
                        value={subFontSize}
                        onChange={(e) => setSubFontSize(parseInt(e.target.value))}
                        className="w-full accent-sky-500 cursor-pointer mt-1"
                      />
                      <div className="flex justify-between text-[9.5px] text-slate-500 mt-1">
                        <span>18px (Nhỏ)</span>
                        <span>24px (Chuẩn)</span>
                        <span>48px (Cực to)</span>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center text-[11px] font-semibold text-slate-300 mb-1">
                        <span>Vị trí hiển thị (% chiều cao):</span>
                        <span className="text-sky-400 font-mono font-bold">{subPositionPercent}%</span>
                      </div>
                      <input
                        type="range"
                        min={50}
                        max={90}
                        value={subPositionPercent}
                        onChange={(e) => setSubPositionPercent(parseInt(e.target.value))}
                        className="w-full accent-sky-500 cursor-pointer mt-1"
                      />
                      <div className="flex justify-between text-[9.5px] text-slate-500 mt-1">
                        <span>50% (Giữa)</span>
                        <span>78% (Chuẩn TikTok)</span>
                        <span>90% (Sát đáy)</span>
                      </div>
                    </div>
                  </div>

                  {/* Subtitle Style Type & Colors */}
                  <div className="pt-3 border-t border-slate-800/80 space-y-3">
                    <label className="text-[11px] font-semibold text-slate-300 block">Kiểu dáng hiển thị:</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      {[
                        { id: 'box', label: 'Hộp nền bo góc' },
                        { id: 'outline', label: 'Viền chữ sắc nét' },
                        { id: 'shadow', label: 'Đổ bóng nổi khối' },
                        { id: 'neon', label: 'Phát sáng Neon' },
                      ].map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setSubStyleType(st.id as any)}
                          className={`py-2 px-3 rounded-xl border font-semibold transition cursor-pointer text-center ${
                            subStyleType === st.id
                              ? 'bg-sky-600/20 border-sky-500 text-sky-300 shadow-sm'
                              : 'bg-[#0c0e14] border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>

                    {/* Colors & Bold/Italic */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
                      <div className="flex items-center gap-2 p-2 bg-[#0c0e14] border border-slate-800 rounded-xl">
                        <input
                          type="color"
                          value={subColor}
                          onChange={(e) => setSubColor(e.target.value)}
                          className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                        />
                        <div className="text-[11px]">
                          <span className="text-slate-400 block">Màu chữ:</span>
                          <span className="text-white font-mono font-bold uppercase">{subColor}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 p-2 bg-[#0c0e14] border border-slate-800 rounded-xl">
                        <input
                          type="color"
                          value={subBgColor}
                          onChange={(e) => setSubBgColor(e.target.value)}
                          className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                        />
                        <div className="text-[11px]">
                          <span className="text-slate-400 block">Màu nền/viền:</span>
                          <span className="text-white font-mono font-bold uppercase">{subBgColor}</span>
                        </div>
                      </div>

                      <div className="p-2 bg-[#0c0e14] border border-slate-800 rounded-xl space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-slate-400">Độ mờ nền:</span>
                          <span className="text-sky-400 font-mono font-bold">{Math.round(subBgOpacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0.0}
                          max={1.0}
                          step={0.05}
                          value={subBgOpacity}
                          onChange={(e) => setSubBgOpacity(parseFloat(e.target.value))}
                          className="w-full accent-sky-500 cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center justify-around p-2 bg-[#0c0e14] border border-slate-800 rounded-xl text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={subBold}
                            onChange={(e) => setSubBold(e.target.checked)}
                            className="rounded border-slate-700 text-sky-500"
                          />
                          <span className="font-bold text-white">In đậm</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={subItalic}
                            onChange={(e) => setSubItalic(e.target.checked)}
                            className="rounded border-slate-700 text-sky-500"
                          />
                          <span className="italic text-slate-300">In nghiêng</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* OCR COVER OLD SUBTITLE (LÀM MỜ PHỤ ĐỀ GỐC TIẾNG TRUNG) */}
                  <div className="pt-3 border-t border-slate-800/80 space-y-3">
                    <div className="p-4 rounded-2xl bg-[#0c0e14] border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-white select-none">
                          <input
                            type="checkbox"
                            checked={coverOldSub}
                            onChange={(e) => setCoverOldSub(e.target.checked)}
                            className="w-4 h-4 rounded text-sky-600 bg-slate-900 border-slate-700"
                          />
                          <EyeOff size={15} className="text-amber-400" />
                          <span>Tự động làm mờ phụ đề gốc (Che chữ tiếng Trung cũ)</span>
                        </label>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                          Công nghệ OCR
                        </span>
                      </div>

                      {coverOldSub && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs font-medium">
                              <span className="text-slate-300">Độ đậm của vùng làm mờ:</span>
                              <span className="text-sky-400 font-mono font-bold">{blurAmount}px</span>
                            </div>
                            <input
                              type="range"
                              min={5}
                              max={60}
                              step={1}
                              value={blurAmount}
                              onChange={(e) => setBlurAmount(parseInt(e.target.value))}
                              className="w-full accent-sky-500 cursor-pointer"
                            />
                            <div className="flex justify-between text-[9.5px] text-slate-500">
                              <span>5px (Nhẹ)</span>
                              <span>25px (Chuẩn)</span>
                              <span>60px (Rất mờ)</span>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <span className="text-xs text-slate-400 block">Phương pháp che chữ:</span>
                            <div className="flex items-center gap-2 text-xs pt-1">
                              <button
                                type="button"
                                onClick={() => setBlurMethod('blur')}
                                className={`flex-1 py-1.5 rounded-lg font-medium transition cursor-pointer text-center ${
                                  blurMethod === 'blur'
                                    ? 'bg-sky-600 text-white shadow-sm'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                Gaussian Blur
                              </button>
                              <button
                                type="button"
                                onClick={() => setBlurMethod('box')}
                                className={`flex-1 py-1.5 rounded-lg font-medium transition cursor-pointer text-center ${
                                  blurMethod === 'box'
                                    ? 'bg-sky-600 text-white shadow-sm'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                Hộp làm mờ (Box Blur)
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* TikTok Shop Product Anchor Tag Config */}
              <div className="pt-3 border-t border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5 uppercase tracking-wider">
                    <Tag size={14} className="text-amber-400" />
                    <span>Nhãn Ghim Giỏ Hàng TikTok Shop (Anchor Tag)</span>
                  </h4>
                  <span className="text-[10px] text-amber-400 font-mono">Tối đa 30 ký tự</span>
                </div>

                <div>
                  <input
                    type="text"
                    maxLength={30}
                    value={anchorText}
                    onChange={(e) => setAnchorText(e.target.value)}
                    placeholder="Ví dụ: Mua ngay giá ưu đãi, Bộ dao thép 5 món..."
                    className="w-full px-3.5 py-2.5 bg-[#0c0e14] border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    💡 Nhãn này xuất hiện ở góc dưới bên trái màn hình mockup, giúp người xem bấm thẳng vào giỏ hàng tiếp thị.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          3. MODAL: CHỌN VIDEO TỪ THƯ VIỆN
      ───────────────────────────────────────────────────────────── */}
      {showVideoPickerModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#141722] border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Film size={16} className="text-amber-400" />
                <span>Chọn Video Từ Thư Viện</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowVideoPickerModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 border-b border-slate-800/80">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-3 text-slate-500" />
                <input
                  type="text"
                  value={searchLibraryVideo}
                  onChange={(e) => setSearchLibraryVideo(e.target.value)}
                  placeholder="Tìm kiếm theo tên video hoặc ID..."
                  className="w-full pl-9 pr-4 py-2 bg-[#0c0e14] border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {videos
                .filter((v) => !searchLibraryVideo || v.title.toLowerCase().includes(searchLibraryVideo.toLowerCase()))
                .map((v) => {
                  const isSelected = selectedVideo?.id === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => {
                        setSelectedVideo(v);
                        setShowVideoPickerModal(false);
                      }}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition cursor-pointer ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-500 text-white'
                          : 'bg-[#0c0e14] border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden flex-shrink-0 flex items-center justify-center">
                          {v.thumbnail_url ? (
                            <img src={libraryApi.getMediaUrl(v.thumbnail_url)} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Film size={18} className="text-slate-600" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-white truncate">{v.title}</h4>
                          <span className="text-[11px] text-slate-400">
                            {v.duration ? `${Math.round(v.duration)}s` : 'Chưa rõ'} • ID #{v.id}
                          </span>
                        </div>
                      </div>
                      {isSelected && <Check size={16} className="text-amber-400 flex-shrink-0" />}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          4. MODAL: TIẾN TRÌNH XỬ LÝ & KẾT QUẢ
      ───────────────────────────────────────────────────────────── */}
      {showProgressModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#141722] border border-slate-800 rounded-3xl w-full max-w-xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles size={16} className="text-amber-400" />
                <span>Tiến Trình Tạo Video Affiliate</span>
              </h3>
              {!isProcessing && (
                <button
                  type="button"
                  onClick={() => setShowProgressModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-300">{jobMessage}</span>
                <span className="text-amber-400 font-mono font-bold">{jobProgress}%</span>
              </div>
              <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 transition-all duration-300"
                  style={{ width: `${jobProgress}%` }}
                />
              </div>
            </div>

            {/* Process Steps */}
            <div className="grid grid-cols-4 gap-2 pt-2 text-center text-[10.5px]">
              {[
                { key: 'highlight', label: '1. Phân Tích Cảnh', done: jobProgress >= 25 },
                { key: 'script', label: '2. Kịch Bản AI', done: jobProgress >= 45 },
                { key: 'tts', label: '3. Thu Âm TTS', done: jobProgress >= 70 },
                { key: 'compose', label: '4. Ghép Video', done: jobProgress >= 100 },
              ].map((st) => (
                <div
                  key={st.key}
                  className={`p-2 rounded-xl border ${
                    st.done
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 font-semibold'
                      : 'bg-slate-900 border-slate-800 text-slate-500'
                  }`}
                >
                  <span>{st.label}</span>
                </div>
              ))}
            </div>

            {/* Completed Results List */}
            {completedVersions.length > 0 && (
              <div className="pt-4 border-t border-slate-800/80 space-y-3">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  🎉 Video Thành Phẩm Đã Sẵn Sàng:
                </h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {completedVersions.map((ver, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-[#0c0e14] border border-slate-800 rounded-2xl flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <h5 className="text-xs font-bold text-white truncate">
                          {ver.title || `Bản #${ver.version || idx + 1}`}
                        </h5>
                        <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                          {ver.caption || 'Kịch bản bán hàng tối ưu chuyển đổi cao'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {ver.output_url && (
                          <button
                            type="button"
                            onClick={() => {
                              const activeUrl = ver.output_url;
                              const freshUrl = activeUrl ? `${activeUrl}${activeUrl.includes('?') ? '&' : '?'}t=${Date.now()}` : null;
                              setPreviewModalUrl(freshUrl);
                              setPreviewModalTitle(ver.title || `Bản #${ver.version || idx + 1}`);
                              setShowResultPreviewModal(true);
                            }}
                            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs transition cursor-pointer"
                            title="Xem video thành phẩm"
                          >
                            <Eye size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setShowProgressModal(false);
                            navigate('/scheduler', {
                              state: {
                                videoId: selectedVideo?.id,
                                title: ver.title,
                                caption: ver.caption,
                                hashtags: ver.hashtags,
                              },
                            });
                          }}
                          className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow"
                        >
                          <Calendar size={13} />
                          <span>Đặt Lịch Đăng</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. RESULT PREVIEW MODAL (XEM THỬ VIDEO THÀNH PHẨM 9:16 CỠ LỚN - CHUẨN LỒNG TIẾNG) */}
      {showResultPreviewModal && previewModalUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-sm bg-[#161922] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-[#121520]">
              <div className="min-w-0 pr-2">
                <span className="text-xs font-bold text-white block truncate">
                  {previewModalTitle || 'Video Affiliate Đã Hoàn Thành'}
                </span>
                <span className="text-[10px] text-amber-400 block font-medium">
                  Chuẩn tỉ lệ 9:16 TikTok / Reels / Shorts
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowResultPreviewModal(false);
                  setPreviewModalUrl(null);
                }}
                className="text-slate-400 hover:text-white text-xs px-2.5 py-1 rounded-lg hover:bg-slate-800 transition cursor-pointer shrink-0"
              >
                ✕ Đóng
              </button>
            </div>

            <div className="aspect-[9/16] w-full bg-black flex items-center justify-center relative">
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

            <div className="p-3 border-t border-slate-800 bg-[#121520] grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (previewModalUrl) {
                    handleDownloadOutput(
                      previewModalUrl,
                      previewModalTitle || selectedVideo?.title || 'video_affiliate_pro.mp4'
                    );
                  }
                }}
                className="py-2 px-2.5 rounded-xl text-xs font-semibold text-emerald-300 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 flex items-center justify-center gap-1.5 transition cursor-pointer"
                title="Tải video này về máy (.mp4)"
              >
                <Download size={13} />
                <span>Tải Về</span>
              </button>

              <button
                type="button"
                disabled={savingEditor}
                onClick={async () => {
                  if (selectedVideo) {
                    await handleSaveToEditor(
                      selectedVideo.id,
                      previewModalTitle || selectedVideo.title || 'Video Affiliate'
                    );
                  }
                }}
                className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-60 ${
                  savedEditor
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
                title="Lưu video thành phẩm vào Hậu Kỳ"
              >
                {savedEditor ? (
                  <>
                    <CheckCircle2 size={13} className="text-emerald-400" />
                    <span>Đã Lưu</span>
                  </>
                ) : savingEditor ? (
                  <>
                    <RefreshCw size={13} className="animate-spin text-amber-400" />
                    <span>Đang Lưu...</span>
                  </>
                ) : (
                  <>
                    <Save size={13} className="text-indigo-400" />
                    <span>Lưu Hậu Kỳ</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowResultPreviewModal(false);
                  navigate('/scheduler', {
                    state: {
                      videoId: selectedVideo?.id,
                      title: previewModalTitle || completedResult?.title || selectedVideo?.title,
                      caption:
                        completedResult?.versions?.[activeVersionIndex]?.caption ||
                        completedResult?.caption,
                      hashtags: completedResult?.hashtags,
                    },
                  });
                }}
                className="py-2 px-2.5 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 shadow flex items-center justify-center gap-1.5 transition cursor-pointer"
                title="Lên lịch đăng tự động lên TikTok"
              >
                <Calendar size={13} />
                <span>Lịch Đăng</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
