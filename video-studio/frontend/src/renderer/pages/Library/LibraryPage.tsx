import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  UploadCloud,
  Search,
  Trash2,
  Play,
  Wand2,
  ShoppingBag,
  RefreshCw,
  Clock,
  HardDrive,
  FolderPlus,
  AlertTriangle,
  CheckCircle2,
  X,
  FileVideo,
  ChevronRight,
  MoreVertical,
  Tv,
  Tag,
  ArrowUpDown,
  RotateCcw,
  Sparkles,
  Check,
  Captions,
  Mic,
} from 'lucide-react';
import { libraryApi } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
import SearchableSelect from '../../components/SearchableSelect';

interface VideoItem {
  id: number;
  title: string;
  channel_id: number | null;
  category_id: number | null;
  duration: number | null;
  resolution: string | null;
  file_size: number | null;
  status: string;
  source_type: string;
  thumbnail_url: string | null;
  video_url?: string | null;
  created_at: string | null;
  recognition_type?: string | null;
}

interface ChannelItem {
  id: number;
  name: string;
  platform_source: string;
}

interface CategoryItem {
  id: number;
  name: string;
  parent_id: number | null;
}

export default function LibraryPage() {
  const navigate = useNavigate();

  // State
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<VideoItem | null>(null);

  // Shared Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    isLoading: boolean;
    onConfirm: () => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    message: '',
    isLoading: false,
    onConfirm: async () => {},
  });

  // Filters
  const [search, setSearch] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedRecognitionType, setSelectedRecognitionType] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('newest');

  // Video Multi-selection State
  const [selectedVideoIds, setSelectedVideoIds] = useState<number[]>([]);

  // Reset all filters
  const handleResetFilters = () => {
    setSearch('');
    setSelectedChannel('');
    setSelectedCategory('');
    setSelectedRecognitionType('');
    setSortBy('newest');
  };

  const activeFilterCount =
    (search ? 1 : 0) +
    (selectedChannel ? 1 : 0) +
    (selectedCategory ? 1 : 0) +
    (selectedRecognitionType ? 1 : 0) +
    (sortBy !== 'newest' ? 1 : 0);

  // Modals
  const [showImportModal, setShowImportModal] = useState(false);
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deletingChannelId, setDeletingChannelId] = useState<number | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<number | null>(null);

  // Import State
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [importChannelId, setImportChannelId] = useState<string>('');
  const [importCategoryId, setImportCategoryId] = useState<string>('');
  const [importRecognitionType, setImportRecognitionType] = useState<'voice_only' | 'ocr_only' | 'ai_vision'>('voice_only');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: any[];
    rejected: any[];
  } | null>(null);

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearAllFiles = () => {
    setSelectedFiles([]);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|mkv|webm|avi)$/i)
      );
      if (droppedFiles.length > 0) {
        setSelectedFiles((prev) => [...prev, ...droppedFiles]);
      }
    }
  };

  // New channel/category inputs
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelPlatform, setNewChannelPlatform] = useState('douyin');
  const [newCategoryName, setNewCategoryName] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Recognition Type Helper & 1-click Toggle
  const getRecognitionBadge = (type?: string | null): {
    label: string;
    icon: React.ReactNode;
    badgeClass: string;
    desc: string;
  } => {
    switch (type) {
      case 'ocr_only':
        return {
          label: 'Có Sub (OCR)',
          icon: <Captions size={12} className="text-purple-400 shrink-0" />,
          badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/40 hover:bg-purple-500/30',
          desc: 'Có sub, không lấy lời (Quét EasyOCR, tự che sub cũ)',
        };
      case 'ai_vision':
        return {
          label: 'Không Lời/Sub (AI)',
          icon: <Sparkles size={12} className="text-amber-400 shrink-0" />,
          badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/30',
          desc: 'Không lời, không sub (AI Vision tự xem & biên kịch)',
        };
      case 'voice_only':
      default:
        return {
          label: 'Có Lời (Whisper)',
          icon: <Mic size={12} className="text-sky-400 shrink-0" />,
          badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/40 hover:bg-sky-500/30',
          desc: 'Có lời, không có sub (Whisper STT, giữ video sạch)',
        };
    }
  };

  const handleToggleRecognitionType = async (e: React.MouseEvent, video: VideoItem) => {
    e.stopPropagation();
    const current = video.recognition_type || 'voice_only';
    const cycleMap: Record<string, string> = {
      voice_only: 'ocr_only',
      ocr_only: 'ai_vision',
      ai_vision: 'voice_only',
    };
    const next = cycleMap[current] || 'voice_only';
    try {
      await libraryApi.updateRecognitionType(video.id, next);
      setVideos((prev) =>
        prev.map((v) => (v.id === video.id ? { ...v, recognition_type: next } : v))
      );
      if (previewVideo?.id === video.id) {
        setPreviewVideo((prev) => (prev ? { ...prev, recognition_type: next } : null));
      }
    } catch (err: any) {
      alert(err.message || 'Lỗi đổi phân loại video');
    }
  };

  // Load videos
  const loadVideos = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await libraryApi.getVideos({
        search,
        channel_id: selectedChannel ? Number(selectedChannel) : '',
        category_id: selectedCategory ? Number(selectedCategory) : '',
        recognition_type: selectedRecognitionType,
        sort_by: sortBy,
        limit: 50,
      });
      setVideos(res.videos || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      console.error('Failed to load videos:', err);
      setLoadError(err.message || 'Lỗi kết nối máy chủ backend');
    } finally {
      setLoading(false);
    }
  };

  // Load channels and categories
  const loadMeta = async () => {
    try {
      const [chRes, catRes] = await Promise.all([
        libraryApi.getChannels(),
        libraryApi.getCategories(),
      ]);
      const chs = chRes.channels || [];
      const cats = catRes.categories || [];
      setChannels(chs);
      setCategories(cats);
      if (chs.length > 0) {
        setImportChannelId((prev) => prev || String(chs[0].id));
      }
      if (cats.length > 0) {
        setImportCategoryId((prev) => prev || String(cats[0].id));
      }
    } catch (err) {
      console.error('Failed to load channels/categories:', err);
    }
  };

  useEffect(() => {
    loadMeta();
  }, []);

  useEffect(() => {
    loadVideos();
  }, [search, selectedChannel, selectedCategory, selectedRecognitionType, sortBy]);

  // Format helpers
  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  // Handle Video Delete Prompt
  const promptDeleteVideo = (video: VideoItem) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Xác nhận xóa video',
      message: `Bạn có chắc muốn xóa video "${video.title}" khỏi thư viện? File video gốc và thumbnail trên ổ đĩa sẽ bị xóa vĩnh viễn.`,
      isLoading: false,
      onConfirm: async () => {
        try {
          setConfirmDialog((prev) => ({ ...prev, isLoading: true }));
          await libraryApi.deleteVideo(video.id);
          setVideos((prev) => prev.filter((v) => v.id !== video.id));
          setSelectedVideoIds((prev) => prev.filter((id) => id !== video.id));
          setTotal((prev) => Math.max(0, prev - 1));
          if (previewVideo?.id === video.id) setPreviewVideo(null);
          setConfirmDialog((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        } catch (err: any) {
          alert(err.message || 'Lỗi khi xóa video');
          setConfirmDialog((prev) => ({ ...prev, isLoading: false }));
        }
      },
    });
  };

  // Video Multi-selection Handlers
  const isAllSelected = videos.length > 0 && videos.every((v) => selectedVideoIds.includes(v.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedVideoIds([]);
    } else {
      setSelectedVideoIds(videos.map((v) => v.id));
    }
  };

  const toggleSelectVideo = (id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedVideoIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const promptBulkDelete = () => {
    if (selectedVideoIds.length === 0) return;
    const count = selectedVideoIds.length;
    setConfirmDialog({
      isOpen: true,
      title: `Xác nhận xóa hàng loạt (${count} video)`,
      message: `Bạn có chắc muốn xóa ${count} video đã chọn khỏi thư viện? Tất cả file video gốc, ảnh thumbnail và tác vụ liên quan sẽ bị xóa vĩnh viễn khỏi ổ đĩa.`,
      isLoading: false,
      onConfirm: async () => {
        try {
          setConfirmDialog((prev) => ({ ...prev, isLoading: true }));
          const res = await libraryApi.bulkDeleteVideos(selectedVideoIds);
          setVideos((prev) => prev.filter((v) => !selectedVideoIds.includes(v.id)));
          setTotal((prev) => Math.max(0, prev - (res.deleted_count || count)));
          if (previewVideo && selectedVideoIds.includes(previewVideo.id)) {
            setPreviewVideo(null);
          }
          setSelectedVideoIds([]);
          setConfirmDialog((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        } catch (err: any) {
          alert(err.message || 'Lỗi khi xóa hàng loạt video');
          setConfirmDialog((prev) => ({ ...prev, isLoading: false }));
        }
      },
    });
  };

  // Handle Import Submit
  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) return;

    try {
      setImporting(true);
      setImportResult(null);
      const formData = new FormData();
      selectedFiles.forEach((file) => {
        formData.append('files', file);
      });
      if (importChannelId) formData.append('channel_id', importChannelId);
      if (importCategoryId) formData.append('category_id', importCategoryId);
      formData.append('recognition_type', importRecognitionType);

      const res = await libraryApi.importVideos(formData);
      setImportResult({
        imported: res.imported || [],
        rejected: res.rejected || [],
      });
      setSelectedFiles([]);
      loadVideos();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi import video');
    } finally {
      setImporting(false);
    }
  };

  // Handle create channel
  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    try {
      const created = await libraryApi.createChannel({
        name: newChannelName.trim(),
        platform_source: newChannelPlatform,
      });
      setChannels((prev) => [...prev, created]);
      setNewChannelName('');
    } catch (err: any) {
      alert(err.message || 'Lỗi khi tạo kênh');
    }
  };

  // Handle delete channel Prompt
  const promptDeleteChannel = (channel: ChannelItem) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Xóa kênh lưu trữ?',
      message: `Bạn có chắc muốn xóa kênh "${channel.name}" (${channel.platform_source})? Các video thuộc kênh này sẽ được tự động gỡ liên kết an toàn.`,
      isLoading: false,
      onConfirm: async () => {
        try {
          setConfirmDialog((prev) => ({ ...prev, isLoading: true }));
          await libraryApi.deleteChannel(channel.id);
          setChannels((prev) => prev.filter((c) => c.id !== channel.id));
          if (selectedChannel === String(channel.id)) setSelectedChannel('');
          loadVideos();
          setConfirmDialog((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        } catch (err: any) {
          alert(err.message || 'Lỗi khi xóa kênh');
          setConfirmDialog((prev) => ({ ...prev, isLoading: false }));
        }
      },
    });
  };

  // Handle create category
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      const created = await libraryApi.createCategory({
        name: newCategoryName.trim(),
      });
      setCategories((prev) => [...prev, created]);
      setNewCategoryName('');
    } catch (err: any) {
      alert(err.message || 'Lỗi khi tạo danh mục');
    }
  };

  // Handle delete category Prompt
  const promptDeleteCategory = (category: CategoryItem) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Xóa danh mục video?',
      message: `Bạn có chắc muốn xóa danh mục "${category.name}"? Các video thuộc danh mục này sẽ được tự động gỡ liên kết an toàn.`,
      isLoading: false,
      onConfirm: async () => {
        try {
          setConfirmDialog((prev) => ({ ...prev, isLoading: true }));
          await libraryApi.deleteCategory(category.id);
          setCategories((prev) => prev.filter((c) => c.id !== category.id));
          if (selectedCategory === String(category.id)) setSelectedCategory('');
          loadVideos();
          setConfirmDialog((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        } catch (err: any) {
          alert(err.message || 'Lỗi khi xóa danh mục');
          setConfirmDialog((prev) => ({ ...prev, isLoading: false }));
        }
      },
    });
  };

  // Searchable filter options
  const channelOptions = channels.map((ch) => ({
    value: String(ch.id),
    label: ch.name,
    badge: ch.platform_source,
    badgeColor:
      ch.platform_source === 'douyin'
        ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
        : ch.platform_source === 'tiktok'
        ? 'bg-pink-500/15 text-pink-400 border border-pink-500/30'
        : 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30',
  }));

  const categoryOptions = categories.map((cat) => ({
    value: String(cat.id),
    label: cat.name,
  }));

  const recognitionOptions = [
    { value: 'voice_only', label: 'Có lời, không sub (Whisper)' },
    { value: 'ocr_only', label: 'Có sub, không lấy lời (OCR)' },
    { value: 'ai_vision', label: 'Không lời, không sub (AI Vision)' },
  ];

  const sortOptions = [
    { value: 'newest', label: 'Mới nhất' },
    { value: 'oldest', label: 'Cũ nhất' },
    { value: 'duration_desc', label: 'Thời lượng (Dài nhất)' },
    { value: 'duration_asc', label: 'Thời lượng (Ngắn nhất)' },
    { value: 'size_desc', label: 'Dung lượng (Lớn nhất)' },
    { value: 'title_asc', label: 'Tên file (A → Z)' },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0f1117] text-slate-100 overflow-y-auto">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 sticky top-0 bg-[#0f1117]/95 backdrop-blur z-10">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-white">Thư Viện Video</h1>
            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {total} video
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Kho lưu trữ video thô, quản lý metadata, phân loại kênh & danh mục
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            onClick={() => setShowChannelModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800/90 hover:bg-slate-700 hover:text-white border border-slate-700/60 transition whitespace-nowrap shrink-0 cursor-pointer shadow-sm"
          >
            <Tv size={13} className="text-indigo-400 shrink-0" />
            <span>Kênh ({channels.length})</span>
          </button>
          <button
            onClick={() => setShowCategoryModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800/90 hover:bg-slate-700 hover:text-white border border-slate-700/60 transition whitespace-nowrap shrink-0 cursor-pointer shadow-sm"
          >
            <Tag size={13} className="text-emerald-400 shrink-0" />
            <span>Danh mục ({categories.length})</span>
          </button>
          <button
            onClick={() => loadVideos()}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 transition cursor-pointer shrink-0"
            title="Làm mới"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-indigo-400' : ''} />
          </button>
          <button
            onClick={() => {
              setImportResult(null);
              setSelectedFiles([]);
              setShowImportModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/20 transition whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload size={13} className="shrink-0" />
            <span>Import video</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="px-6 py-3 border-b border-slate-800/60 bg-[#12151e] flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative min-w-[240px] max-w-sm flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#171b26] text-xs text-slate-200 pl-9 pr-8 py-2 rounded-lg border border-slate-700/60 focus:outline-none focus:border-indigo-500 transition"
              placeholder="Tìm kiếm theo tiêu đề video..."
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Advanced Searchable Filters */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {/* Channel filter with search inside */}
            <SearchableSelect
              value={selectedChannel}
              onChange={setSelectedChannel}
              options={channelOptions}
              placeholder="Tất cả kênh"
              allLabel="Tất cả kênh"
              searchPlaceholder="Tìm kiếm tên kênh..."
              icon={<Tv size={13} />}
            />

            {/* Category filter with search inside */}
            <SearchableSelect
              value={selectedCategory}
              onChange={setSelectedCategory}
              options={categoryOptions}
              placeholder="Tất cả danh mục"
              allLabel="Tất cả danh mục"
              searchPlaceholder="Tìm kiếm danh mục..."
              icon={<Tag size={13} />}
            />

            {/* Recognition Type filter */}
            <SearchableSelect
              value={selectedRecognitionType}
              onChange={setSelectedRecognitionType}
              options={recognitionOptions}
              placeholder="Tất cả đặc tính"
              allLabel="Tất cả đặc tính"
              allowSearch={false}
              icon={<Sparkles size={13} />}
            />

            {/* Sort filter */}
            <SearchableSelect
              value={sortBy}
              onChange={setSortBy}
              options={sortOptions}
              placeholder="Sắp xếp"
              allLabel=""
              allowSearch={false}
              icon={<ArrowUpDown size={13} />}
            />

            {/* Reset all button if active filters */}
            {activeFilterCount > 0 && (
              <button
                onClick={handleResetFilters}
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition shadow-sm"
                title="Đặt lại toàn bộ bộ lọc"
              >
                <RotateCcw size={12} />
                <span>Đặt lại ({activeFilterCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* Active Filter Chips & Result summary */}
        <div className="flex items-center justify-between gap-2 text-xs flex-wrap pt-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-slate-500 font-medium">
              Tìm thấy <strong className="text-slate-300 font-semibold">{total}</strong> video
            </span>

            {/* Chips */}
            {selectedChannel && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[11px]">
                <Tv size={10} />
                Kênh: {channels.find((c) => String(c.id) === selectedChannel)?.name || selectedChannel}
                <button
                  type="button"
                  onClick={() => setSelectedChannel('')}
                  className="hover:text-white ml-0.5 cursor-pointer"
                >
                  <X size={11} />
                </button>
              </span>
            )}

            {selectedCategory && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[11px]">
                <Tag size={10} />
                Danh mục: {categories.find((c) => String(c.id) === selectedCategory)?.name || selectedCategory}
                <button
                  type="button"
                  onClick={() => setSelectedCategory('')}
                  className="hover:text-white ml-0.5 cursor-pointer"
                >
                  <X size={11} />
                </button>
              </span>
            )}

            {search && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[11px]">
                <Search size={10} />
                "{search}"
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="hover:text-white ml-0.5 cursor-pointer"
                >
                  <X size={11} />
                </button>
              </span>
            )}

            {sortBy !== 'newest' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700 text-[11px]">
                <ArrowUpDown size={10} />
                {sortOptions.find((s) => s.value === sortBy)?.label}
                <button
                  type="button"
                  onClick={() => setSortBy('newest')}
                  className="hover:text-white ml-0.5 cursor-pointer"
                >
                  <X size={11} />
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area: Video Grid or Empty State */}
      <div className="flex-1 p-6">
        {loading && videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
            <RefreshCw size={24} className="animate-spin text-indigo-500" />
            <span className="text-xs">Đang tải danh sách video...</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center text-center py-16 px-4 border border-rose-900/40 rounded-2xl bg-rose-950/20">
            <div className="w-14 h-14 rounded-2xl bg-rose-900/40 border border-rose-700/50 flex items-center justify-center mb-3 text-rose-400">
              <AlertTriangle size={28} />
            </div>
            <h3 className="text-base font-semibold text-rose-200">Không thể kết nối máy chủ Backend</h3>
            <p className="text-xs text-rose-300/80 max-w-md mt-1 mb-5">
              {loadError} (Port 8765)
            </p>
            <button
              onClick={() => {
                loadVideos();
                loadMeta();
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 shadow-md transition"
            >
              <RefreshCw size={14} />
              Thử lại kết nối
            </button>
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20 px-4 border border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
            <div className="w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700/50 flex items-center justify-center mb-4 text-indigo-400">
              <FileVideo size={30} />
            </div>
            <h3 className="text-base font-semibold text-slate-200">Kho video đang trống</h3>
            <p className="text-xs text-slate-400 max-w-sm mt-1 mb-5">
              Bấm nút bên dưới để chọn các file MP4 (tối đa 15 phút/video) nhập vào hệ thống.
            </p>
            <button
              onClick={() => {
                setImportResult(null);
                setSelectedFiles([]);
                setShowImportModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/20 transition"
            >
              <Upload size={14} />
              Import video ngay
            </button>
          </div>
        ) : (
          <div>
            {/* Selection / Batch Action Bar */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 bg-[#161922] border border-slate-800 px-4 py-2.5 rounded-xl text-xs">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-300 hover:text-white font-medium">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer accent-indigo-600"
                  />
                  <span>
                    {isAllSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'} ({videos.length} video)
                  </span>
                </label>

                {selectedVideoIds.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-[11px] font-semibold">
                    Đã chọn {selectedVideoIds.length} video
                  </span>
                )}
              </div>

              {selectedVideoIds.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedVideoIds([])}
                    className="px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition text-xs font-medium cursor-pointer"
                  >
                    Hủy chọn
                  </button>
                  <button
                    type="button"
                    onClick={promptBulkDelete}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 shadow-md shadow-rose-600/20 transition cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Xóa hàng loạt ({selectedVideoIds.length})</span>
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(185px,1fr))] gap-4">
              {videos.map((video) => {
                const channelName = channels.find((c) => c.id === video.channel_id)?.name;
                const categoryName = categories.find((c) => c.id === video.category_id)?.name;
                const thumbUrl = libraryApi.getMediaUrl(video.thumbnail_url || '');
                const isSelected = selectedVideoIds.includes(video.id);

                return (
                  <div
                    key={video.id}
                    className={`group flex flex-col bg-[#161922] border rounded-xl overflow-hidden shadow-sm transition duration-200 ${
                      isSelected
                        ? 'border-indigo-500 ring-2 ring-indigo-500/30 bg-[#171a27]'
                        : 'border-slate-800/80 hover:border-indigo-500/50 hover:shadow-md hover:shadow-indigo-500/5'
                    }`}
                  >
                    {/* Thumbnail Banner (Tỉ lệ đứng 9:16) */}
                    <div
                      onClick={() => setPreviewVideo(video)}
                      className="relative aspect-[9/16] w-full bg-slate-900 overflow-hidden flex items-center justify-center cursor-pointer"
                    >
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt={video.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          onError={(e) => {
                            // fallback if thumbnail failed
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <FileVideo size={28} className="text-slate-700" />
                      )}

                      {/* Selection Checkbox Overlay (Top-Left) */}
                      <div
                        onClick={(e) => toggleSelectVideo(video.id, e)}
                        className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-md flex items-center justify-center transition cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/50'
                            : 'bg-black/60 hover:bg-black/85 text-transparent hover:text-white border border-white/20'
                        }`}
                        title={isSelected ? 'Bỏ chọn' : 'Chọn video này'}
                      >
                        <Check size={14} className={isSelected ? 'stroke-[2.5]' : ''} />
                      </div>

                      {/* Play icon overlay on hover */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition duration-200">
                        <div className="w-11 h-11 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-xl shadow-indigo-600/40 transform scale-90 group-hover:scale-100 transition duration-200">
                          <Play size={20} className="fill-white ml-0.5" />
                        </div>
                      </div>

                      {/* Resolution badge (Bottom-Left) */}
                      {video.resolution && (
                        <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur text-[10px] font-mono text-slate-300">
                          {video.resolution}
                        </span>
                      )}

                      {/* Duration badge (Bottom-Right) */}
                      <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur text-[10px] font-mono font-medium text-white flex items-center gap-1">
                        <Clock size={10} />
                        {formatDuration(video.duration)}
                      </span>


                    </div>

                  {/* Body Content */}
                  <div className="flex-1 p-3 flex flex-col justify-between">
                    <div>
                      <h4
                        onClick={() => setPreviewVideo(video)}
                        className="text-xs font-semibold text-slate-200 line-clamp-2 leading-relaxed hover:text-indigo-400 cursor-pointer transition"
                        title={video.title}
                      >
                        {video.title}
                      </h4>

                      {/* Tags */}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {channelName && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-indigo-300 border border-slate-700/40">
                            {channelName}
                          </span>
                        )}
                        {categoryName && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 border border-slate-700/40">
                            {categoryName}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-500 ml-auto">
                          {formatFileSize(video.file_size)}
                        </span>
                      </div>

                      {/* Recognition Mode Badge (1-click cycle) */}
                      {(() => {
                        const badge = getRecognitionBadge(video.recognition_type);
                        return (
                          <div className="mt-2.5">
                            <button
                              type="button"
                              onClick={(e) => handleToggleRecognitionType(e, video)}
                              title={`${badge.desc} • Bấm để đổi loại nhận diện`}
                              className={`w-full px-2 py-1 rounded-md text-[10.5px] font-medium border flex items-center justify-between transition cursor-pointer ${badge.badgeClass}`}
                            >
                              <span className="flex items-center gap-1.5 truncate">
                                <span>{badge.icon}</span>
                                <span className="truncate">{badge.label}</span>
                              </span>
                              <RotateCcw size={10} className="opacity-60 hover:opacity-100 shrink-0 ml-1" />
                            </button>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Action Bar */}
                    <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => navigate('/localize', { state: { videoId: video.id } })}
                          className="p-1.5 rounded-md hover:bg-indigo-600/20 hover:text-indigo-400 text-slate-400 transition text-[11px] flex items-center gap-1"
                          title="Chuyển sang Module: Lồng Tiếng"
                        >
                          <Wand2 size={13} />
                          <span>Lồng Tiếng</span>
                        </button>
                        <button
                          onClick={() => navigate('/affiliate', { state: { videoId: video.id } })}
                          className="p-1.5 rounded-md hover:bg-emerald-600/20 hover:text-emerald-400 text-slate-400 transition text-[11px] flex items-center gap-1"
                          title="Chuyển sang Module 2: Affiliate"
                        >
                          <ShoppingBag size={13} />
                          <span>Affiliate</span>
                        </button>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          promptDeleteVideo(video);
                        }}
                        disabled={confirmDialog.isLoading}
                        className="p-1.5 rounded-md hover:bg-rose-500/20 hover:text-rose-400 text-slate-500 transition"
                        title="Xóa video"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>

      {/* ── MODAL: XEM TRƯỚC VIDEO (PREVIEW MODAL) ───────────────────────── */}
      {previewVideo && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-[#151923] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5 overflow-hidden">
                <FileVideo size={18} className="text-indigo-400 shrink-0" />
                <h3 className="text-sm font-semibold text-white truncate" title={previewVideo.title}>
                  {previewVideo.title}
                </h3>
                {previewVideo.resolution && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-indigo-300 shrink-0 border border-slate-700/50">
                    {previewVideo.resolution}
                  </span>
                )}
                <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-400 shrink-0 border border-slate-700/50">
                  {formatDuration(previewVideo.duration)}
                </span>
              </div>
              <button
                onClick={() => setPreviewVideo(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Video Player Area */}
            <div className="relative bg-black flex items-center justify-center max-h-[60vh] overflow-hidden">
              <video
                src={libraryApi.getMediaUrl(previewVideo.video_url || `/api/storage/${previewVideo.id}/original.mp4`)}
                controls
                autoPlay
                className="w-full max-h-[60vh] object-contain shadow-2xl"
              />
            </div>

            {/* Modal Footer & Actions */}
            <div className="p-4 bg-[#11141c] border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span>Dung lượng: <strong className="text-slate-200">{formatFileSize(previewVideo.file_size)}</strong></span>
                <span>•</span>
                <span>Trạng thái: <strong className="text-indigo-400 uppercase">{previewVideo.status}</strong></span>
                <span>•</span>
                {(() => {
                  const badge = getRecognitionBadge(previewVideo.recognition_type);
                  return (
                    <button
                      type="button"
                      onClick={(e) => handleToggleRecognitionType(e, previewVideo)}
                      title={`${badge.desc} • Bấm để đổi loại nhận diện`}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium border flex items-center gap-1.5 transition cursor-pointer ${badge.badgeClass}`}
                    >
                      <span>{badge.icon}</span>
                      <span>{badge.label}</span>
                      <RotateCcw size={10} className="opacity-60 hover:opacity-100 ml-0.5" />
                    </button>
                  );
                })()}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const id = previewVideo.id;
                    setPreviewVideo(null);
                    navigate('/localize', { state: { videoId: id } });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/20 transition"
                >
                  <Wand2 size={13} />
                  Lồng Tiếng Video Này
                </button>
                <button
                  onClick={() => {
                    const id = previewVideo.id;
                    setPreviewVideo(null);
                    navigate('/affiliate', { state: { videoId: id } });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/20 transition"
                >
                  <ShoppingBag size={13} />
                  Dựng Affiliate
                </button>
                <button
                  onClick={() => promptDeleteVideo(previewVideo)}
                  className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                  title="Xóa video này"
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={() => setPreviewVideo(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: IMPORT HÀNG LOẠT ────────────────────────────────────────── */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="w-full max-w-4xl xl:max-w-5xl bg-[#131622] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] my-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 sm:px-8 py-5 border-b border-slate-800/80 bg-slate-900/60">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                  <UploadCloud size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-wide">Import Video Hàng Loạt</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Tải video vào hệ thống để tự động phân tích âm thanh, quét nhận diện phụ đề và đưa vào kho dữ liệu
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleImportSubmit} className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6">
              {/* Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                className={`relative border-2 border-dashed rounded-2xl py-10 px-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center select-none ${
                  isDragging
                    ? 'border-indigo-400 bg-indigo-950/30 scale-[0.99] shadow-inner'
                    : 'border-slate-700/80 hover:border-indigo-500/70 bg-slate-900/40 hover:bg-indigo-950/10'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="video/mp4,video/quicktime,video/x-matroska,video/webm"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      const newFiles = Array.from(e.target.files);
                      setSelectedFiles((prev) => [...prev, ...newFiles]);
                    }
                  }}
                />
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-3 shadow-lg shadow-indigo-500/5 transition-transform hover:scale-105">
                  <FileVideo size={32} />
                </div>
                <p className="text-base font-bold text-slate-100">
                  Kéo thả file video vào đây hoặc <span className="text-indigo-400 underline underline-offset-4 hover:text-indigo-300">bấm để duyệt file từ máy tính</span>
                </p>
                <p className="text-xs text-slate-400 mt-2 max-w-lg mx-auto leading-relaxed">
                  Hỗ trợ các định dạng phổ biến: <span className="text-slate-300 font-medium">MP4, MOV, MKV, WebM</span>. Tối đa 15 phút/video. Chọn hoặc kéo cùng lúc nhiều file video.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-400">
                  <span className="bg-slate-800/80 px-3 py-1 rounded-full border border-slate-700/60">⚡ Tự động quét FPS & độ phân giải</span>
                  <span className="bg-slate-800/80 px-3 py-1 rounded-full border border-slate-700/60">📁 Không giới hạn số lượng video</span>
                </div>
              </div>

              {/* Selected Files List */}
              {selectedFiles.length > 0 && (
                <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">Danh sách file đã chọn:</span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                        {selectedFiles.length} video
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        ({formatFileSize(selectedFiles.reduce((acc, f) => acc + f.size, 0))})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearAllFiles}
                      className="text-xs text-rose-400 hover:text-rose-300 hover:underline flex items-center gap-1.5 transition"
                    >
                      <Trash2 size={13} />
                      Xóa tất cả ({selectedFiles.length})
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-52 overflow-y-auto pr-1">
                    {selectedFiles.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-slate-800/70 border border-slate-700/60 text-slate-200 hover:border-slate-600 transition"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <FileVideo size={16} className="text-indigo-400 shrink-0" />
                          <span className="truncate font-medium text-slate-200" title={f.name}>
                            {f.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-slate-400 font-mono">
                            {formatFileSize(f.size)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(i)}
                            className="text-slate-400 hover:text-rose-400 p-1 rounded-md hover:bg-slate-700/50 transition"
                            title="Bỏ chọn file này"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Channel and Category Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl bg-slate-900/40 border border-slate-800/80 p-3.5">
                  <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Tv size={14} className="text-indigo-400" />
                    Gán Kênh (Tùy chọn)
                  </label>
                  <select
                    value={importChannelId}
                    onChange={(e) => setImportChannelId(e.target.value)}
                    className="w-full bg-[#171b26] text-sm text-slate-200 border border-slate-700/70 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-indigo-500 transition"
                  >
                    <option value="">Không gán kênh</option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.platform_source})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl bg-slate-900/40 border border-slate-800/80 p-3.5">
                  <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Tag size={14} className="text-indigo-400" />
                    Gán Danh Mục (Tùy chọn)
                  </label>
                  <select
                    value={importCategoryId}
                    onChange={(e) => setImportCategoryId(e.target.value)}
                    className="w-full bg-[#171b26] text-sm text-slate-200 border border-slate-700/70 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-indigo-500 transition"
                  >
                    <option value="">Không gán danh mục</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Phân loại đặc tính video nguồn (3 Trạng thái) */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-amber-400" />
                    Phân loại đặc tính video nguồn <span className="text-rose-400">*</span>
                  </label>
                  <p className="text-xs text-slate-400 mt-1">
                    Chọn đúng định dạng video gốc để Module Lồng Tiếng tự động kích hoạt chuẩn quy trình (quét OCR / nghe Whisper / AI Vision):
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  {/* Trạng thái 1: Có lời, không có sub */}
                  <div
                    onClick={() => setImportRecognitionType('voice_only')}
                    className={`p-4 sm:p-5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between select-none relative ${
                      importRecognitionType === 'voice_only'
                        ? 'bg-sky-500/15 border-sky-400 ring-2 ring-sky-500/50 shadow-lg shadow-sky-500/10'
                        : 'bg-[#151822] border-slate-700/60 hover:border-slate-600 hover:bg-slate-800/40 opacity-80 hover:opacity-100'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                          <Mic size={18} />
                        </div>
                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                          importRecognitionType === 'voice_only'
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {importRecognitionType === 'voice_only' ? '✓ Đang chọn' : 'Chọn loại này'}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-white mb-1.5">Có lời, không sub</div>
                      <p className="text-xs leading-relaxed text-slate-300">
                        Whisper STT nghe giọng tiếng Trung, dịch & lồng tiếng Việt. Video gốc sạch không làm mờ.
                      </p>
                    </div>
                    <div className="mt-3.5 pt-2.5 border-t border-slate-700/50 text-[11px] font-mono text-sky-400 flex items-center justify-between">
                      <span className="font-semibold">Mã quy trình:</span>
                      <span className="bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/60">voice_only</span>
                    </div>
                  </div>

                  {/* Trạng thái 2: Có sub, không lấy lời */}
                  <div
                    onClick={() => setImportRecognitionType('ocr_only')}
                    className={`p-4 sm:p-5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between select-none relative ${
                      importRecognitionType === 'ocr_only'
                        ? 'bg-purple-500/15 border-purple-400 ring-2 ring-purple-500/50 shadow-lg shadow-purple-500/10'
                        : 'bg-[#151822] border-slate-700/60 hover:border-slate-600 hover:bg-slate-800/40 opacity-80 hover:opacity-100'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                          <Captions size={18} />
                        </div>
                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                          importRecognitionType === 'ocr_only'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {importRecognitionType === 'ocr_only' ? '✓ Đang chọn' : 'Chọn loại này'}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-white mb-1.5">Có sub, không lời</div>
                      <p className="text-xs leading-relaxed text-slate-300">
                        EasyOCR quét chữ cứng trên màn hình, dịch, tự động làm mờ sub cũ và dán phụ đề mới.
                      </p>
                    </div>
                    <div className="mt-3.5 pt-2.5 border-t border-slate-700/50 text-[11px] font-mono text-purple-400 flex items-center justify-between">
                      <span className="font-semibold">Mã quy trình:</span>
                      <span className="bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800/60">ocr_only</span>
                    </div>
                  </div>

                  {/* Trạng thái 3: Không lời, không sub */}
                  <div
                    onClick={() => setImportRecognitionType('ai_vision')}
                    className={`p-4 sm:p-5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between select-none relative ${
                      importRecognitionType === 'ai_vision'
                        ? 'bg-amber-500/15 border-amber-400 ring-2 ring-amber-500/50 shadow-lg shadow-amber-500/10'
                        : 'bg-[#151822] border-slate-700/60 hover:border-slate-600 hover:bg-slate-800/40 opacity-80 hover:opacity-100'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                          <Sparkles size={18} />
                        </div>
                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                          importRecognitionType === 'ai_vision'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {importRecognitionType === 'ai_vision' ? '✓ Đang chọn' : 'Chọn loại này'}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-white mb-1.5">Không lời & sub (AI)</div>
                      <p className="text-xs leading-relaxed text-slate-300">
                        AI Multimodal Vision tự xem video, hiểu thao tác sản phẩm và tự biên kịch lời thuyết minh.
                      </p>
                    </div>
                    <div className="mt-3.5 pt-2.5 border-t border-slate-700/50 text-[11px] font-mono text-amber-400 flex items-center justify-between">
                      <span className="font-semibold">Mã quy trình:</span>
                      <span className="bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/60">ai_vision</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Import Results Notification */}
              {importResult && (
                <div className="space-y-2 pt-2">
                  {importResult.imported.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2.5 text-xs text-emerald-300">
                      <CheckCircle2 size={18} className="shrink-0 text-emerald-400 mt-0.5" />
                      <div>
                        <div className="font-bold text-sm">
                          Thành công import {importResult.imported.length} video!
                        </div>
                        <div className="text-[11px] text-emerald-400/90 mt-0.5">
                          Các video đã được lưu vào thư viện và sẵn sàng cho quá trình lồng tiếng / hậu kì.
                        </div>
                      </div>
                    </div>
                  )}

                  {importResult.rejected.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-rose-400">
                        <AlertTriangle size={16} />
                        Có {importResult.rejected.length} video bị từ chối:
                      </div>
                      {importResult.rejected.map((rej, i) => (
                        <div key={i} className="text-xs text-rose-300/90 pl-5">
                          • <span className="font-semibold">{rej.filename}</span>: {rej.reason}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Modal Footer Buttons */}
              <div className="flex items-center justify-between pt-5 border-t border-slate-800">
                <div className="text-xs text-slate-400">
                  {selectedFiles.length > 0 ? (
                    <span>
                      Đã chọn <strong className="text-indigo-300 font-semibold">{selectedFiles.length}</strong> video sẵn sàng import
                    </span>
                  ) : (
                    <span>Chưa có file nào được chọn</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowImportModal(false)}
                    className="px-5 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition"
                  >
                    Đóng
                  </button>
                  <button
                    type="submit"
                    disabled={selectedFiles.length === 0 || importing}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-600/25 transition active:scale-95"
                  >
                    {importing ? (
                      <>
                        <RefreshCw size={15} className="animate-spin" />
                        Đang phân tích & import...
                      </>
                    ) : (
                      <>
                        <UploadCloud size={16} />
                        Bắt đầu import ({selectedFiles.length})
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: QUẢN LÝ KÊNH LƯU TRỮ ─────────────────────────────────── */}
      {showChannelModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#151923] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Tv size={18} className="text-indigo-400" />
                <div>
                  <h3 className="text-sm font-semibold text-white">Quản Lý Kênh Lưu Trữ</h3>
                  <p className="text-[11px] text-slate-400">Kênh nguồn video (Douyin, TikTok, Shorts...)</p>
                </div>
              </div>
              <button
                onClick={() => setShowChannelModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-md"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              {/* Form thêm kênh */}
              <form onSubmit={handleCreateChannel} className="space-y-2.5 p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80">
                <label className="block text-xs font-medium text-slate-300">Thêm kênh mới</label>
                <input
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="Tên kênh (VD: Kênh Review Douyin)"
                  className="w-full bg-[#1b202d] text-xs text-slate-200 border border-slate-700/60 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                />
                <div className="flex gap-2">
                  <select
                    value={newChannelPlatform}
                    onChange={(e) => setNewChannelPlatform(e.target.value)}
                    className="bg-[#1b202d] text-xs text-slate-200 border border-slate-700/60 rounded-lg px-2.5 py-1.5 focus:outline-none flex-1"
                  >
                    <option value="douyin">Douyin</option>
                    <option value="tiktok">TikTok</option>
                    <option value="youtube">YouTube Shorts</option>
                    <option value="other">Khác</option>
                  </select>
                  <button
                    type="submit"
                    disabled={!newChannelName.trim()}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold disabled:opacity-40 shadow-sm"
                  >
                    Thêm Kênh
                  </button>
                </div>
              </form>

              {/* Danh sách kênh */}
              <div>
                <div className="text-xs font-semibold text-slate-400 mb-2">
                  Danh sách kênh ({channels.length})
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {channels.map((ch) => (
                    <div
                      key={ch.id}
                      className="flex items-center justify-between text-xs px-3.5 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/40 hover:border-slate-600 transition"
                    >
                      <div>
                        <span className="font-semibold text-slate-200">{ch.name}</span>
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] uppercase font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          {ch.platform_source}
                        </span>
                      </div>
                      <button
                        onClick={() => promptDeleteChannel(ch)}
                        disabled={confirmDialog.isLoading}
                        className="text-slate-400 hover:text-rose-400 p-1.5 rounded-md hover:bg-rose-500/10 transition"
                        title="Xóa kênh"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {channels.length === 0 && (
                    <p className="text-xs text-slate-500 italic text-center py-4">Chưa có kênh nào.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: QUẢN LÝ DANH MỤC VIDEO ───────────────────────────────── */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#151923] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Tag size={18} className="text-emerald-400" />
                <div>
                  <h3 className="text-sm font-semibold text-white">Quản Lý Danh Mục Video</h3>
                  <p className="text-[11px] text-slate-400">Phân loại ngành hàng, chủ đề sản phẩm</p>
                </div>
              </div>
              <button
                onClick={() => setShowCategoryModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-md"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              {/* Form thêm danh mục */}
              <form onSubmit={handleCreateCategory} className="space-y-2.5 p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80">
                <label className="block text-xs font-medium text-slate-300">Thêm danh mục mới</label>
                <div className="flex gap-2">
                  <input
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="Tên danh mục (VD: Đồ gia dụng, Thời trang...)"
                    className="flex-1 bg-[#1b202d] text-xs text-slate-200 border border-slate-700/60 rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    disabled={!newCategoryName.trim()}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold disabled:opacity-40 shadow-sm"
                  >
                    Thêm
                  </button>
                </div>
              </form>

              {/* Danh sách danh mục */}
              <div>
                <div className="text-xs font-semibold text-slate-400 mb-2">
                  Danh sách danh mục ({categories.length})
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {categories.map((cat) => (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between text-xs px-3.5 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/40 hover:border-slate-600 transition"
                    >
                      <span className="font-semibold text-slate-200">{cat.name}</span>
                      <button
                        onClick={() => promptDeleteCategory(cat)}
                        disabled={confirmDialog.isLoading}
                        className="text-slate-400 hover:text-rose-400 p-1.5 rounded-md hover:bg-rose-500/10 transition"
                        title="Xóa danh mục"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {categories.length === 0 && (
                    <p className="text-xs text-slate-500 italic text-center py-4">Chưa có danh mục nào.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SHARED CONFIRMATION POPUP ───────────────────────────────────── */}
      <ConfirmModal
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        isLoading={confirmDialog.isLoading}
        onConfirm={confirmDialog.onConfirm}
        onClose={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
