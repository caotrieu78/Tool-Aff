import React, { useState, useEffect, useMemo } from 'react';
import SearchableSelect from '../../components/SearchableSelect';
import {
  Globe,
  Calendar,
  CalendarPlus,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Trash2,
  Play,
  
  Edit3,
  Save,
  RefreshCw,
  Tv,
  Tag,
  Search,
  Hash,
  Eye,
  CheckSquare,
  Square,
  X,
  FileText,
  Send,
  Sliders,
  Check,
  ArrowRight,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Plus,
  Settings,
  Star,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { publishApi, editorApi, libraryApi } from '../../api/client';

export const GOLDEN_TIME_SLOTS = [
  { label: 'video 1', time: '11:00', hour: 11, minute: 0, period: 'Trưa', isStar: false },
  { label: 'video 2', time: '14:00', hour: 14, minute: 0, period: 'Chiều', isStar: false },
  { label: 'video 3', time: '19:00', hour: 19, minute: 0, period: 'Tối vàng', isStar: true },
  { label: 'video 4', time: '21:30', hour: 21, minute: 30, period: 'Đêm vàng', isStar: true },
];

export const getNextGoldenSlotDateTime = (): string => {
  const now = new Date();
  for (const slot of GOLDEN_TIME_SLOTS) {
    const candidate = new Date(now);
    candidate.setHours(slot.hour, slot.minute, 0, 0);
    if (candidate.getTime() > now.getTime() + 5 * 60 * 1000) {
      return new Date(candidate.getTime() - candidate.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    }
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(11, 0, 0, 0);
  return new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

interface VideoScheduleBadge {
  id: number;
  channel_id: number;
  channel_name: string;
  channel_username?: string;
  status: string;
  scheduled_time?: string | null;
  post_url?: string | null;
}

interface ReadyVideo {
  id: number;
  title: string;
  duration: number;
  thumbnail_url: string | null;
  video_url: string;
  has_final: boolean;
  has_schedule: boolean;
  caption: string;
  hashtags: string[];
  schedules: VideoScheduleBadge[];
  channel_id?: number | null;
  channel_name?: string | null;
  category_id?: number | null;
  category_name?: string | null;
  updated_at: string | null;
}

interface ScheduledItem {
  id: number;
  video_id: number;
  video_title: string;
  thumbnail_url: string | null;
  video_url: string;
  channel_id: number;
  channel_name: string;
  platform: string;
  scheduled_time: string | null;
  status: string;
  caption: string;
  hashtags: string[];
  is_manual_override: boolean;
  rejection_reason?: string | null;
  created_at: string | null;
  channel_username?: string | null;
  tiktok_post_id?: string | null;
  post_url?: string | null;
}

interface ChannelItem {
  id: number;
  name: string;
  platform_source: string;
  is_logged_in?: boolean;
  username?: string;
  avatar_url?: string;
  linked_channel_ids?: number[];
  linked_category_ids?: number[];
}

export default function SchedulerPage() {
  const navigate = useNavigate();

  // State nạp dữ liệu
  const [loading, setLoading] = useState(true);
  const [readyVideos, setReadyVideos] = useState<ReadyVideo[]>([]);
  const [scheduledItems, setScheduledItems] = useState<ScheduledItem[]>([]);
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [stats, setStats] = useState({ total_ready: 0, total_scheduled: 0, total_channels: 0 });

  // Tab Kênh đang chọn: ID của kênh hoặc 'all'
  const [selectedChannelId, setSelectedChannelId] = useState<number>(0);
  // Lọc theo trạng thái của kênh hiện tại
  const [channelFilterStatus, setChannelFilterStatus] = useState<'all' | 'unposted' | 'scheduled' | 'posted'>('all');

  // Quy mô lịch: 'day' (ngày) | 'week' (tuần) | 'month' (tháng)
  const [calendarScale, setCalendarScale] = useState<'day' | 'week' | 'month'>('day');
  // Ngày đang duyệt trong lịch
  const [currentCalendarDate, setCurrentCalendarDate] = useState<Date>(() => new Date());
  // Danh sách danh mục video
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [libraryChannels, setLibraryChannels] = useState<{ id: number; name: string }[]>([]);

  // Modal chọn video khi bấm "+ Hẹn Giờ" trên một ô ngày
  const [calendarPickDate, setCalendarPickDate] = useState<Date | null>(null);
  // Bộ lọc cho popup chọn video lên lịch
  const [modalFilterChannel, setModalFilterChannel] = useState<string>('all');
  const [modalFilterCategory, setModalFilterCategory] = useState<string>('all');
  const [modalSearchKeyword, setModalSearchKeyword] = useState<string>('');

  // Bulk select
  const [selectedVideoIds, setSelectedVideoIds] = useState<number[]>([]);

  // Toast thông báo
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Modal Preview Video
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [previewVideoTitle, setPreviewVideoTitle] = useState<string>('');

  // Modal Sửa Caption
  const [editingCaptionVideo, setEditingCaptionVideo] = useState<ReadyVideo | null>(null);
  const [modalCaptionText, setModalCaptionText] = useState('');
  const [modalHashtags, setModalHashtags] = useState<string[]>([]);
  const [modalTagInput, setModalTagInput] = useState('');
  const [isSavingCaption, setIsSavingCaption] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  // Modal Lên Lịch Đăng (Đơn hoặc Hàng loạt)
  const [schedulingVideo, setSchedulingVideo] = useState<ReadyVideo | null>(null);
  const [isBatchScheduleModal, setIsBatchScheduleModal] = useState(false);
  const [selectedChannelIds, setSelectedChannelIds] = useState<number[]>([]);
  const [customDateTime, setCustomDateTime] = useState<string>(() => getNextGoldenSlotDateTime());
  const [intervalHours, setIntervalHours] = useState<number>(2);
  const [useGoldenSlots, setUseGoldenSlots] = useState<boolean>(true);
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false);

  // Chọn khung giờ vàng mẫu (11:00, 14:00, 19:00 ⭐, 21:30 ⭐)
  const handleSelectGoldenSlot = (hour: number, minute: number) => {
    let baseDate = new Date();
    if (customDateTime) {
      const parsed = new Date(customDateTime);
      if (!isNaN(parsed.getTime())) {
        baseDate = parsed;
      }
    }
    const target = new Date(baseDate);
    target.setHours(hour, minute, 0, 0);

    const now = new Date();
    const isToday =
      target.getFullYear() === now.getFullYear() &&
      target.getMonth() === now.getMonth() &&
      target.getDate() === now.getDate();

    // Nếu chọn hôm nay mà giờ này đã trôi qua rồi, tự động chuyển sang ngày mai
    if (isToday && target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    const localStr = new Date(target.getTime() - target.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setCustomDateTime(localStr);
  };


  const [postingScheduleId, setPostingScheduleId] = useState<number | null>(null);

  // 1. Tải dữ liệu từ backend
  const loadData = async () => {
    try {
      setLoading(true);
      const [res, libRes] = await Promise.all([
        publishApi.getOverview(),
        libraryApi.getChannels().catch(() => ({ channels: [] })),
      ]);
      const loadedChannels = res.channels || [];
      setReadyVideos(res.ready_videos || []);
      setScheduledItems(res.scheduled_items || []);
      setChannels(loadedChannels);
      if (libRes.channels) {
        setLibraryChannels(libRes.channels);
      }
      if (res.categories) {
        setCategories(res.categories);
      }
      setStats(res.stats || { total_ready: 0, total_scheduled: 0, total_channels: 0 });

      // Chọn kênh đầu tiên nếu chưa chọn hoặc kênh cũ không tồn tại
      if (loadedChannels.length > 0) {
        setSelectedChannelId((prev) => {
          if (prev && loadedChannels.some((c: any) => c.id === prev)) {
            return prev;
          }
          return loadedChannels[0].id;
        });
      }
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi tải dữ liệu lịch đăng', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Thông tin kênh đang chọn
  const selectedChannel = useMemo(() => {
    return channels.find((c) => c.id === selectedChannelId) || channels[0] || null;
  }, [channels, selectedChannelId]);

  // Kiểm tra tài khoản TikTok hiện tại đã cấu hình nguồn video (kênh thư viện hoặc danh mục) chưa
  const isChannelConfigured = useMemo(() => {
    if (!selectedChannel) return false;
    const linkedChs = selectedChannel.linked_channel_ids || [];
    const linkedCats = selectedChannel.linked_category_ids || [];
    return linkedChs.length > 0 || linkedCats.length > 0;
  }, [selectedChannel]);

  // Danh sách video hiển thị theo kênh và bộ lọc trạng thái
  const displayedVideos = useMemo(() => {
    // Nếu tài khoản TikTok chưa cấu hình nguồn video nào -> Không hiển thị video nào
    if (!isChannelConfigured) {
      return [];
    }

    let list = readyVideos;
    const chId = selectedChannel?.id;

    // Lọc theo các kênh thư viện và danh mục đã cấu hình cho tài khoản TikTok này
    if (selectedChannel) {
      const linkedChs = (selectedChannel.linked_channel_ids || []).map(Number);
      const linkedCats = (selectedChannel.linked_category_ids || []).map(Number);
      list = list.filter((v) => {
        const matchChannel = v.channel_id != null && linkedChs.includes(Number(v.channel_id));
        const matchCategory = v.category_id != null && linkedCats.includes(Number(v.category_id));
        return matchChannel || matchCategory;
      });
    }

    if (chId) {
      if (channelFilterStatus === "posted") {
        list = list.filter((v) => v.schedules?.some((s) => s.channel_id === chId && s.status === "posted"));
      } else if (channelFilterStatus === "scheduled") {
        list = list.filter((v) => v.schedules?.some((s) => s.channel_id === chId && s.status !== "posted"));
      } else if (channelFilterStatus === "unposted") {
        list = list.filter((v) => !v.schedules?.some((s) => s.channel_id === chId));
      }
    }
    return list;
  }, [readyVideos, selectedChannel, isChannelConfigured, channelFilterStatus]);

  // Chọn / Bỏ chọn tất cả
  const handleSelectAllDisplayed = () => {
    if (selectedVideoIds.length === displayedVideos.length) {
      setSelectedVideoIds([]);
    } else {
      setSelectedVideoIds(displayedVideos.map((v) => v.id));
    }
  };

  const handleToggleSelectVideo = (videoId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedVideoIds((prev) =>
      prev.includes(videoId) ? prev.filter((id) => id !== videoId) : [...prev, videoId]
    );
  };

  // Mở modal sửa Caption
  const openCaptionModal = (video: ReadyVideo, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingCaptionVideo(video);
    setModalCaptionText(video.caption || '');
    setModalHashtags(video.hashtags || []);
    setModalTagInput('');
  };

  const closeCaptionModal = () => {
    setEditingCaptionVideo(null);
    setModalCaptionText('');
    setModalHashtags([]);
    setModalTagInput('');
  };

  const handleAddHashtag = () => {
    const raw = modalTagInput.trim();
    if (!raw) return;
    const tag = raw.startsWith('#') ? raw : `#${raw}`;
    if (!modalHashtags.includes(tag)) {
      setModalHashtags([...modalHashtags, tag]);
    }
    setModalTagInput('');
  };

  const handleRemoveHashtag = (tagToRemove: string) => {
    setModalHashtags(modalHashtags.filter((t) => t !== tagToRemove));
  };

  const handleSaveCaptionModal = async () => {
    if (!editingCaptionVideo) return;
    try {
      setIsSavingCaption(true);
      await editorApi.updateCaption(editingCaptionVideo.id, modalCaptionText, modalHashtags);
      showToast('Đã lưu Caption video thành công!', 'success');
      closeCaptionModal();
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi lưu Caption', 'error');
    } finally {
      setIsSavingCaption(false);
    }
  };

  const handleAiRegenerateCaption = async () => {
    if (!editingCaptionVideo) return;
    try {
      setIsAiGenerating(true);
      const res = await editorApi.generateCaption(editingCaptionVideo.id, true, 'Gợi tò mò, kích thích click');
      setModalCaptionText(res.caption || '');
      setModalHashtags(res.hashtags || []);
      showToast('AI đã tạo xong Caption mới!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Lỗi tạo Caption AI', 'error');
    } finally {
      setIsAiGenerating(false);
    }
  };

  // Mở modal lên lịch cho 1 video
  const openScheduleSingleModal = (video: ReadyVideo) => {
    setSchedulingVideo(video);
    setIsBatchScheduleModal(false);
    setCustomDateTime(getNextGoldenSlotDateTime());
    const chId = selectedChannel?.id || (channels.length > 0 ? channels[0].id : 0);
    setSelectedChannelIds(chId ? [chId] : []);
  };

  // Mở modal lên lịch hàng loạt
  const openScheduleBatchModal = () => {
    if (selectedVideoIds.length === 0) {
      showToast('Vui lòng tích chọn ít nhất 1 video để lên lịch hàng loạt', 'error');
      return;
    }
    setSchedulingVideo(null);
    setIsBatchScheduleModal(true);
    setUseGoldenSlots(true);
    setCustomDateTime(getNextGoldenSlotDateTime());
    const chId = selectedChannel?.id || (channels.length > 0 ? channels[0].id : 0);
    setSelectedChannelIds(chId ? [chId] : []);
  };

  const closeScheduleModal = () => {
    setSchedulingVideo(null);
    setIsBatchScheduleModal(false);
  };

  // Thực hiện lưu lên lịch
  const handleExecuteSchedule = async () => {
    const chId = selectedChannel?.id || (channels.length > 0 ? channels[0].id : 0);
    const targetChannelIds = chId ? [chId] : selectedChannelIds;
    if (targetChannelIds.length === 0) {
      showToast('Vui lòng chọn ít nhất 1 kênh TikTok để lên lịch đăng', 'error');
      return;
    }

    try {
      setIsSubmittingSchedule(true);
      const targetTime = customDateTime ? new Date(customDateTime).toISOString() : new Date().toISOString();

      if (isBatchScheduleModal) {
        const res = await publishApi.batchSchedule({
          video_ids: selectedVideoIds,
          channel_ids: targetChannelIds,
          start_time: targetTime,
          interval_hours: intervalHours,
          use_golden_slots: useGoldenSlots,
        });
        showToast(res.message, 'success');
        setSelectedVideoIds([]);
      } else if (schedulingVideo) {
        const res = await publishApi.scheduleVideo({
          video_id: schedulingVideo.id,
          channel_ids: targetChannelIds,
          scheduled_time: targetTime,
          caption: schedulingVideo.caption,
          hashtags: schedulingVideo.hashtags,
        });
        showToast(res.message, 'success');
      }

      closeScheduleModal();
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi lên lịch đăng', 'error');
    } finally {
      setIsSubmittingSchedule(false);
    }
  };

  // Mở link bài đăng trên TikTok
  const openPostedLink = (sched: { channel_id: number; channel_username?: string; post_url?: string | null }) => {
    const matchedChannel = channels.find((c) => c.id === sched.channel_id);
    const rawUser = sched.channel_username || matchedChannel?.username || '';
    const cleanUser = rawUser.replace(/^@/, '');
    const url =
      sched.post_url ||
      (cleanUser ? `https://www.tiktok.com/@${cleanUser}` : 'https://www.tiktok.com/tiktokstudio/content');
    window.open(url, '_blank');
  };

  // Hủy hoặc xóa lịch đăng
  const handleDeleteSchedule = async (scheduleId: number) => {
    if (!confirm('Bạn có chắc muốn xóa lịch đăng này?')) return;
    try {
      await publishApi.deleteSchedule(scheduleId);
      showToast('Đã xóa lịch đăng thành công', 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi xóa lịch đăng', 'error');
    }
  };

  // Options cho bộ lọc trong popup
  const modalChannelOptions = useMemo(() => {
    const list = libraryChannels.length > 0 ? libraryChannels : channels;
    return list.map((c) => ({
      value: String(c.id),
      label: c.name,
    }));
  }, [libraryChannels, channels]);

  const modalCategoryOptions = useMemo(() => {
    return categories.map((cat) => ({
      value: String(cat.id),
      label: cat.name,
    }));
  }, [categories]);

  // Danh sách video lọc được trong popup lên lịch (tự động theo kênh/danh mục đã cấu hình cho tài khoản TikTok)
  const modalFilteredVideos = useMemo(() => {
    // Nếu kênh TikTok chưa cấu hình nguồn video nào -> không có video nào được phép lên lịch
    if (!isChannelConfigured) {
      return [];
    }

    return readyVideos.filter((v) => {
      // 1. Phải thỏa mãn kênh/danh mục đã cấu hình cho tài khoản TikTok hiện tại
      if (selectedChannel) {
        const linkedChs = (selectedChannel.linked_channel_ids || []).map(Number);
        const linkedCats = (selectedChannel.linked_category_ids || []).map(Number);
        const matchChannel = v.channel_id != null && linkedChs.includes(Number(v.channel_id));
        const matchCategory = v.category_id != null && linkedCats.includes(Number(v.category_id));
        if (!matchChannel && !matchCategory) return false;
      }

      // 2. Lọc từ khóa
      if (modalSearchKeyword.trim()) {
        const q = modalSearchKeyword.toLowerCase().trim();
        const matchTitle = v.title.toLowerCase().includes(q);
        const matchId = String(v.id) === q || `#${v.id}` === q;
        if (!matchTitle && !matchId) return false;
      }

      return true;
    });
  }, [readyVideos, selectedChannel, isChannelConfigured, modalSearchKeyword]);

  // Helper format giờ cho thẻ input time (HH:mm)
  const formatTimeValue = (isoStr?: string | null) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    } catch {
      return '';
    }
  };

  // Đổi giờ đăng trực tiếp trên card (không cần popup)
  const handleInlineChangeScheduleTime = async (item: ScheduledItem, newTimeStr: string) => {
    if (!newTimeStr) return;
    try {
      const [hours, minutes] = newTimeStr.split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) return;

      let targetDate = item.scheduled_time ? new Date(item.scheduled_time) : new Date(currentCalendarDate);
      if (isNaN(targetDate.getTime())) {
        targetDate = new Date(currentCalendarDate);
      }
      targetDate.setHours(hours, minutes, 0, 0);
      const newIso = targetDate.toISOString();

      // Cập nhật optimistic cho state tức thì
      setScheduledItems((prev) =>
        prev.map((s) => (s.id === item.id ? { ...s, scheduled_time: newIso } : s))
      );
      setReadyVideos((prev) =>
        prev.map((v) => ({
          ...v,
          schedules: v.schedules?.map((s) => (s.id === item.id ? { ...s, scheduled_time: newIso } : s)),
        }))
      );

      // Lưu xuống backend
      await publishApi.updateSchedule(item.id, { scheduled_time: newIso });
      showToast(`Đã lưu giờ đăng mới: ${newTimeStr}`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi cập nhật giờ đăng', 'error');
      await loadData();
    }
  };



  // Đăng video ngay lập tức cho mục đã có lịch
  const handlePostNow = async (scheduleId: number, title: string, channelName: string) => {
    try {
      setPostingScheduleId(scheduleId);
      showToast(`Đang chạy ngầm đăng video "${title}" lên ${channelName}...`, 'success');
      const res = await publishApi.postScheduleNow(scheduleId);
      if (res.success && res.status === 'posted') {
        showToast(`Đã xuất bản thành công "${title}" lên ${channelName}!`, 'success');
      } else {
        showToast(res.error || res.message || 'Lệnh đăng ngầm đã được gửi tới bot', 'success');
      }
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi kích hoạt đăng video', 'error');
    } finally {
      setPostingScheduleId(null);
    }
  };

  // Đăng ngay cho video chưa có lịch trên kênh này
  const handleDirectPostToChannel = async (video: ReadyVideo, targetChannelId: number) => {
    const ch = channels.find((c) => c.id === targetChannelId);
    const chName = ch?.name || `Kênh #${targetChannelId}`;
    try {
      setPostingScheduleId(video.id);
      showToast(`Đang lên lịch và chạy ngầm đăng video "${video.title}" lên ${chName}...`, 'success');
      await publishApi.scheduleVideo({
        video_id: video.id,
        channel_ids: [targetChannelId],
        scheduled_time: new Date().toISOString(),
        caption: video.caption,
        hashtags: video.hashtags,
      });

      const overviewRes = await publishApi.getOverview();
      const createdSched = (overviewRes.scheduled_items || []).find(
        (s: any) => s.video_id === video.id && s.channel_id === targetChannelId
      );
      if (createdSched) {
        const postRes = await publishApi.postScheduleNow(createdSched.id);
        if (postRes.success && postRes.status === 'posted') {
          showToast(`Đã xuất bản thành công "${video.title}" lên ${chName}!`, 'success');
        } else {
          showToast(postRes.error || postRes.message || `Lệnh đăng ngầm đã được gửi lên ${chName}`, 'success');
        }
      }
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi đăng video', 'error');
    } finally {
      setPostingScheduleId(null);
    }
  };

  // Format thời gian
  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return 'Chưa gán giờ';
    try {
      const d = new Date(isoString);
      return d.toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // ─── CÁC HÀM TIỆN ÍCH CHO XỬ LÝ LỊCH THEO NGÀY / TUẦN / THÁNG ───
  const formatDateKey = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const parseScheduleDate = (str?: string | null): Date | null => {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  };

  const isSameDay = (d1: Date, d2: Date): boolean => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  const isTodayDate = (d: Date): boolean => {
    return isSameDay(d, new Date());
  };

  const getMonday = (d: Date): Date => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  };

  const getWeekDays = (monday: Date): Date[] => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const next = new Date(monday);
      next.setDate(monday.getDate() + i);
      days.push(next);
    }
    return days;
  };

  const getMonthGrid = (targetDate: Date): { date: Date; isCurrentMonth: boolean }[] => {
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const firstDay = new Date(year, month, 1);
    let firstDayIndex = firstDay.getDay() - 1;
    if (firstDayIndex === -1) firstDayIndex = 6;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: { date: Date; isCurrentMonth: boolean }[] = [];
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      cells.push({ date: new Date(year, month, -i), isCurrentMonth: false });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }
    const remaining = (7 - (cells.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      cells.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
    return cells;
  };

  const navigateCalendarPrev = () => {
    setCurrentCalendarDate((prev) => {
      const d = new Date(prev);
      if (calendarScale === 'day') {
        d.setDate(d.getDate() - 1);
      } else if (calendarScale === 'week') {
        d.setDate(d.getDate() - 7);
      } else {
        d.setMonth(d.getMonth() - 1);
      }
      return d;
    });
  };

  const navigateCalendarNext = () => {
    setCurrentCalendarDate((prev) => {
      const d = new Date(prev);
      if (calendarScale === 'day') {
        d.setDate(d.getDate() + 1);
      } else if (calendarScale === 'week') {
        d.setDate(d.getDate() + 7);
      } else {
        d.setMonth(d.getMonth() + 1);
      }
      return d;
    });
  };

  const navigateCalendarToday = () => {
    setCurrentCalendarDate(new Date());
  };

  const calendarPeriodLabel = useMemo(() => {
    const d = currentCalendarDate;
    if (calendarScale === 'day') {
      const weekdays = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
      const dayName = weekdays[d.getDay()];
      const dayStr = String(d.getDate()).padStart(2, '0');
      const monthStr = String(d.getMonth() + 1).padStart(2, '0');
      return `${dayName}, ${dayStr}/${monthStr}/${d.getFullYear()}`;
    } else if (calendarScale === 'week') {
      const mon = getMonday(d);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      const monStr = `${String(mon.getDate()).padStart(2, '0')}/${String(mon.getMonth() + 1).padStart(2, '0')}`;
      const sunStr = `${String(sun.getDate()).padStart(2, '0')}/${String(sun.getMonth() + 1).padStart(2, '0')}/${sun.getFullYear()}`;
      return `Tuần ${monStr} - ${sunStr}`;
    } else {
      const monthStr = String(d.getMonth() + 1).padStart(2, '0');
      return `Tháng ${monthStr}, ${d.getFullYear()}`;
    }
  }, [currentCalendarDate, calendarScale]);

  // Scheduled items lọc theo kênh đang chọn
  const channelScheduledList = useMemo(() => {
    if (!selectedChannel) return [];
    return scheduledItems.filter((s) => s.channel_id === selectedChannel.id);
  }, [scheduledItems, selectedChannel]);

  // Gom theo ngày (key YYYY-MM-DD)
  const scheduledItemsByDate = useMemo(() => {
    const map: Record<string, ScheduledItem[]> = {};
    for (const item of channelScheduledList) {
      const d = parseScheduleDate(item.scheduled_time);
      if (d) {
        const key = formatDateKey(d);
        if (!map[key]) map[key] = [];
        map[key].push(item);
      }
    }
    for (const k in map) {
      map[k].sort((a, b) => {
        const ta = new Date(a.scheduled_time || 0).getTime();
        const tb = new Date(b.scheduled_time || 0).getTime();
        return ta - tb;
      });
    }
    return map;
  }, [channelScheduledList]);

  // Mở modal lên lịch với ngày được chọn sẵn
  const handleOpenScheduleForDate = (targetDate: Date, video?: ReadyVideo) => {
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}T09:00`;

    if (video) {
      setCustomDateTime(dateStr);
      openScheduleSingleModal(video);
      setCalendarPickDate(null);
    } else {
      setCalendarPickDate(targetDate);
    }
  };

  const WEEKDAY_SHORT = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d0f17] text-slate-100 overflow-hidden select-none">
      {/* TOAST THÔNG BÁO */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-2xl shadow-xl border flex items-center gap-2.5 animate-in slide-in-from-top duration-300 ${
            notification.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/50 text-rose-200'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle size={16} className="text-rose-400 shrink-0" />
          )}
          <span className="text-xs font-medium">{notification.message}</span>
        </div>
      )}

      {/* HEADER: TIÊU ĐỀ & TABS CÁC KÊNH TIKTOK */}
      <div className="px-6 pt-5 pb-3 border-b border-slate-800/80 bg-[#121420] shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-violet-600/30 shrink-0">
              <Calendar size={20} />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-wide">
                Lịch Đăng Video TikTok Theo Kênh
              </h1>
              <p className="text-xs text-slate-400">
                Chọn kênh TikTok để quản lý danh sách video và xuất bản theo đúng từng kênh
              </p>
            </div>
          </div>

          {/* THỐNG KÊ TỔNG QUAN */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-semibold">{stats.total_ready}</span>
              <span className="text-slate-400 text-[11px]">Video Thành Phẩm</span>
            </div>

            <div className="px-3 py-1.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-300 flex items-center gap-2 text-xs">
              <Clock size={13} className="text-violet-400" />
              <span className="font-semibold">{stats.total_scheduled}</span>
              <span className="text-slate-400 text-[11px]">Lượt Đăng</span>
            </div>

            {/* Huy hiệu chế độ đăng ngầm */}
            <div
              className="px-3 py-1.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 flex items-center gap-1.5 text-xs font-medium shadow-sm"
              title="Toàn bộ tác vụ xuất bản video TikTok được chạy ngầm trong nền, không mở cửa sổ làm gián đoạn màn hình"
            >
              <ShieldCheck size={14} className="text-indigo-400" />
              <span>Chạy ngầm (Headless)</span>
            </div>

            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 text-slate-300 hover:text-white transition cursor-pointer disabled:opacity-50"
              title="Tải lại danh sách"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* CÁC TAB CỦA CÁC KÊNH TIKTOK (THAY THẾ TOÀN BỘ CÁC TAB CŨ) */}
        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-800/60 overflow-x-auto">
          <div className="flex items-center gap-1.5 p-1 bg-[#0a0c13] border border-slate-800/80 rounded-2xl shrink-0">


            {/* Các Tab Kênh TikTok Được Cấu Hình */}
            {channels.map((ch) => {
              const isSelected = selectedChannelId === ch.id;

              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => {
                    setSelectedChannelId(ch.id);
                    setSelectedVideoIds([]);
                    setChannelFilterStatus('all');
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
                    isSelected
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-950/40'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
                >
                  <Tv size={14} className={isSelected ? 'text-white' : 'text-violet-400'} />
                  <span>{ch.name}</span>
                  {ch.username && (
                    <span className={`text-[10px] font-mono ${isSelected ? 'text-violet-200' : 'text-slate-500'}`}>
                      {ch.username}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Quản lý cấu hình kênh */}
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 text-xs font-medium transition cursor-pointer flex items-center gap-1.5 shrink-0"
            title="Thêm hoặc cấu hình kênh TikTok trong Cài Đặt"
          >
            <Sliders size={13} />
            <span>Quản Lý Kênh</span>
          </button>
        </div>

        {/* Cảnh báo nếu tài khoản TikTok chưa được cấu hình nguồn video */}
        {selectedChannel && !isChannelConfigured && (
          <div className="flex items-center justify-between p-3.5 px-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs shadow-sm">
            <div className="flex items-center gap-2.5">
              <span className="text-base">⚠️</span>
              <span>
                Kênh <b>{selectedChannel.name}</b> chưa được phân quyền tick chọn <b>Kênh Thư Viện Nguồn</b> hoặc <b>Danh Mục Video Phụ Trách</b> nào trong Cài Đặt.
              </span>
            </div>
            <button
              type="button"
              onClick={() => navigate("/settings?tab=tiktok")}
              className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold transition border border-amber-500/30 cursor-pointer flex items-center gap-1 shrink-0"
            >
              <span>Cấu hình phân quyền ngay</span>
              <span>→</span>
            </button>
          </div>
        )}
      </div>

      {/* NỘI DUNG CHÍNH: DANH SÁCH TẤT CẢ VIDEO THEO KÊNH ĐANG CHỌN */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-slate-500">
            <RefreshCw size={28} className="animate-spin text-violet-500" />
            <p className="text-xs">Đang tải danh sách video và lịch đăng...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {channels.length === 0 && (
              <div className="p-8 rounded-2xl bg-slate-900/50 border border-slate-800 text-center space-y-2">
                <p className="text-xs text-slate-400">Chưa có kênh TikTok nào trong hệ thống.</p>
                <button
                  type="button"
                  onClick={() => navigate('/settings')}
                  className="px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
                >
                  Vào Cài Đặt Thêm Kênh
                </button>
              </div>
            )}

            {/* THANH ĐIỀU KHIỂN LỊCH ĐĂNG (NGÀY / TUẦN / THÁNG) */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3.5 bg-[#111420] border border-slate-800 rounded-2xl shadow-sm">
              {/* Chọn quy mô: Ngày / Tuần / Tháng */}
              <div className="flex items-center gap-1 p-1 bg-[#0a0c13] border border-slate-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => setCalendarScale('day')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    calendarScale === 'day'
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-950/40'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
                >
                  Theo Ngày
                </button>
                <button
                  type="button"
                  onClick={() => setCalendarScale('week')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    calendarScale === 'week'
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-950/40'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
                >
                  Theo Tuần
                </button>
                <button
                  type="button"
                  onClick={() => setCalendarScale('month')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    calendarScale === 'month'
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-950/40'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
                >
                  Theo Tháng
                </button>
              </div>

              {/* Điều hướng lịch & Nút Lên lịch */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center gap-1.5 bg-[#0a0c13] border border-slate-800 p-1 rounded-xl text-xs">
                  <button
                    type="button"
                    onClick={navigateCalendarPrev}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                    title="Lùi lại"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={navigateCalendarToday}
                    className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-violet-300 hover:text-white font-semibold transition cursor-pointer"
                  >
                    Hôm Nay
                  </button>
                  <button
                    type="button"
                    onClick={navigateCalendarNext}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                    title="Tiếp theo"
                  >
                    <ChevronRight size={15} />
                  </button>
                  <span className="px-3 font-bold text-white border-l border-slate-800/80 text-xs min-w-36 text-center">
                    {calendarPeriodLabel}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleOpenScheduleForDate(currentCalendarDate)}
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-violet-950/40"
                  title="Chọn video để lên lịch vào thời gian đang xem"
                >
                  <CalendarPlus size={14} />
                  <span>Lên Lịch Video</span>
                </button>
              </div>
            </div>

            {/* DẠNG LỊCH: THEO TUẦN / THEO THÁNG / THEO NGÀY */}
            <div className="space-y-4">
                {/* ── 1. THEO TUẦN (WEEK VIEW) ── */}
                {calendarScale === 'week' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-3">
                    {getWeekDays(getMonday(currentCalendarDate)).map((day, idx) => {
                      const dayKey = formatDateKey(day);
                      const items = scheduledItemsByDate[dayKey] || [];
                      const isToday = isTodayDate(day);
                      const dayNum = String(day.getDate()).padStart(2, '0');
                      const monthNum = String(day.getMonth() + 1).padStart(2, '0');

                      return (
                        <div
                          key={dayKey}
                          className={`rounded-2xl border flex flex-col min-h-[440px] transition ${
                            isToday
                              ? 'bg-[#121526] border-violet-500/50 shadow-lg shadow-violet-950/20 ring-1 ring-violet-500/30'
                              : 'bg-[#0e111a] border-slate-800/80 hover:border-slate-700/80'
                          }`}
                        >
                          {/* Header ngày */}
                          <div
                            className={`p-3 border-b flex items-center justify-between cursor-pointer ${
                              isToday ? 'border-violet-500/30 bg-violet-950/30' : 'border-slate-800/80 bg-slate-900/40'
                            }`}
                            onClick={() => {
                              setCurrentCalendarDate(day);
                              setCalendarScale('day');
                            }}
                            title="Nhấn để xem chi tiết mốc giờ trong ngày này"
                          >
                            <div>
                              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                                {WEEKDAY_SHORT[idx]}
                              </span>
                              <span className={`text-sm font-extrabold ${isToday ? 'text-violet-300' : 'text-white'}`}>
                                {dayNum}/{monthNum}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              {isToday && (
                                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-violet-600 text-white uppercase">
                                  Hôm nay
                                </span>
                              )}
                              {items.length > 0 && (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-800 text-slate-300">
                                  {items.length}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Danh sách video trong ngày */}
                          <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[360px]">
                            {items.length === 0 ? (
                              <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-slate-600 text-[11px] p-4 text-center">
                                <Clock size={20} className="opacity-20 mb-1" />
                                <span>Chưa có lịch</span>
                              </div>
                            ) : (
                              items.map((item) => {
                                const itemDate = parseScheduleDate(item.scheduled_time);
                                const timeStr = itemDate
                                  ? itemDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                                  : '--:--';
                                const isPosted = item.status === 'posted';

                                return (
                                  <div
                                    key={item.id}
                                    className={`p-2 rounded-xl border text-xs space-y-2 transition ${
                                      isPosted
                                        ? 'bg-emerald-950/20 border-emerald-500/30'
                                        : 'bg-slate-900/80 border-slate-800 hover:border-violet-500/50'
                                    }`}
                                  >
                                    {/* Giờ + Trạng thái */}
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="font-mono font-bold text-[11px] text-slate-200 flex items-center gap-1">
                                        <Clock size={11} className={isPosted ? 'text-emerald-400' : 'text-violet-400'} />
                                        {isPosted ? (
                                          <span>{timeStr}</span>
                                        ) : (
                                          <input
                                            type="time"
                                            value={formatTimeValue(item.scheduled_time)}
                                            onChange={(e) => handleInlineChangeScheduleTime(item, e.target.value)}
                                            className="bg-transparent border-0 text-[11px] font-bold font-mono text-purple-300 p-0 cursor-pointer [color-scheme:dark] focus:outline-none"
                                            title="Nhập giờ trực tiếp trên card"
                                          />
                                        )}
                                      </span>
                                      {isPosted ? (
                                        <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/80 px-1.5 py-0.2 rounded border border-emerald-500/30">
                                          ✓ Đã đăng
                                        </span>
                                      ) : (
                                        <span className="text-[9px] font-bold text-purple-300 bg-purple-950/80 px-1.5 py-0.5 rounded border border-purple-500/30 inline-flex items-center gap-1">
                                          <Clock size={10} className="text-purple-400" />
                                          <span>Chờ</span>
                                        </span>
                                      )}
                                    </div>

                                    {/* Thumbnail + Tiêu đề */}
                                    <div className="flex items-center gap-2">
                                      <div
                                        className="relative w-12 h-9 rounded-lg overflow-hidden bg-black shrink-0 cursor-pointer group"
                                        onClick={() => {
                                          setPreviewVideoUrl(libraryApi.getMediaUrl(item.video_url));
                                          setPreviewVideoTitle(item.video_title);
                                        }}
                                        title="Bấm để xem video"
                                      >
                                        {item.thumbnail_url ? (
                                          <img
                                            src={libraryApi.getMediaUrl(item.thumbnail_url)}
                                            alt={item.video_title}
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center text-slate-700">
                                            <Eye size={12} />
                                          </div>
                                        )}
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                                          <Play size={10} className="text-white fill-white" />
                                        </div>
                                      </div>

                                      <span className="text-[11px] font-semibold text-white line-clamp-2 leading-tight">
                                        {item.video_title}
                                      </span>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1 pt-1 border-t border-slate-800/60 justify-end">
                                      {isPosted ? (
                                        item.post_url ? (
                                          <button
                                            type="button"
                                            onClick={() => window.open(item.post_url!, '_blank')}
                                            className="px-2 py-0.5 rounded text-[10px] font-semibold text-emerald-300 hover:text-white bg-emerald-950/60 hover:bg-emerald-800 transition flex items-center gap-1 cursor-pointer"
                                            title="Xem video trên TikTok"
                                          >
                                            <ExternalLink size={10} />
                                            <span>TikTok</span>
                                          </button>
                                        ) : null
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => handlePostNow(item.id, item.video_title, item.channel_name)}
                                            disabled={postingScheduleId === item.id}
                                            className="px-2 py-0.5 rounded text-[10px] font-bold text-white bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 transition flex items-center gap-1 cursor-pointer"
                                            title="Đăng ngay lập tức"
                                          >
                                            <Send size={10} />
                                            <span>Đăng</span>
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => handleDeleteSchedule(item.id)}
                                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
                                            title="Hủy lịch"
                                          >
                                            <Trash2 size={11} />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>

                          {/* Nút thêm video cho ngày này */}
                          <div className="p-2 pt-0 border-t border-slate-800/40 mt-auto">
                            <button
                              type="button"
                              onClick={() => handleOpenScheduleForDate(day)}
                              className="w-full py-1.5 rounded-xl bg-slate-800/50 hover:bg-violet-600/20 hover:text-violet-300 text-slate-400 border border-slate-700/40 hover:border-violet-500/40 text-[11px] font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Plus size={12} />
                              <span>Hẹn Giờ</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── 2. THEO THÁNG (MONTH VIEW) ── */}
                {calendarScale === 'month' && (
                  <div className="space-y-2">
                    {/* Hàng tên thứ */}
                    <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-slate-400 uppercase tracking-wider pb-1">
                      {WEEKDAY_SHORT.map((wd) => (
                        <div key={wd} className="py-1">
                          {wd}
                        </div>
                      ))}
                    </div>

                    {/* Lưới các ngày trong tháng */}
                    <div className="grid grid-cols-7 gap-2">
                      {getMonthGrid(currentCalendarDate).map(({ date: day, isCurrentMonth }, idx) => {
                        const dayKey = formatDateKey(day);
                        const items = scheduledItemsByDate[dayKey] || [];
                        const isToday = isTodayDate(day);
                        const dayNum = day.getDate();

                        return (
                          <div
                            key={`${dayKey}-${idx}`}
                            className={`min-h-[110px] p-2 rounded-2xl border transition flex flex-col justify-between group ${
                              !isCurrentMonth
                                ? 'bg-[#0a0c13]/60 border-slate-900 text-slate-600'
                                : isToday
                                ? 'bg-[#121526] border-violet-500/50 shadow-sm ring-1 ring-violet-500/30 text-white'
                                : 'bg-[#0e111a] border-slate-800/80 hover:border-slate-700 text-slate-300'
                            }`}
                          >
                            {/* Hàng trên: Số ngày + Nút hẹn giờ */}
                            <div className="flex items-center justify-between">
                              <span
                                onClick={() => {
                                  setCurrentCalendarDate(day);
                                  setCalendarScale('day');
                                }}
                                className={`text-xs font-extrabold cursor-pointer px-1.5 py-0.5 rounded-md transition ${
                                  isToday
                                    ? 'bg-violet-600 text-white'
                                    : isCurrentMonth
                                    ? 'hover:bg-slate-800 text-white'
                                    : 'text-slate-600'
                                }`}
                                title="Bấm để xem chi tiết ngày"
                              >
                                {dayNum}
                              </span>

                              <button
                                type="button"
                                onClick={() => handleOpenScheduleForDate(day)}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-violet-600/30 text-slate-400 hover:text-violet-300 transition cursor-pointer"
                                title="Lên lịch video vào ngày này"
                              >
                                <Plus size={11} />
                              </button>
                            </div>

                            {/* Các chip video */}
                            <div className="space-y-1 my-1 overflow-y-auto max-h-[70px]">
                              {items.slice(0, 3).map((it) => {
                                const itemDate = parseScheduleDate(it.scheduled_time);
                                const timeStr = itemDate
                                  ? itemDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                                  : '';
                                const isPosted = it.status === 'posted';

                                return (
                                  <div
                                    key={it.id}
                                    onClick={() => {
                                      setCurrentCalendarDate(day);
                                      setCalendarScale('day');
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[10px] truncate cursor-pointer transition flex items-center gap-1 ${
                                      isPosted
                                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                                        : 'bg-violet-950/80 text-violet-300 border border-violet-500/30'
                                    }`}
                                    title={`${timeStr} - ${it.video_title}`}
                                  >
                                    <span className="font-mono font-bold text-[9px]">{timeStr}</span>
                                    <span className="truncate">{it.video_title}</span>
                                  </div>
                                );
                              })}
                              {items.length > 3 && (
                                <div
                                  onClick={() => {
                                    setCurrentCalendarDate(day);
                                    setCalendarScale('day');
                                  }}
                                  className="text-[9px] text-slate-400 text-center cursor-pointer hover:text-white"
                                >
                                  +{items.length - 3} video khác
                                </div>
                              )}
                            </div>

                            {/* Badge tổng số */}
                            <div className="text-[10px] text-slate-500 flex justify-end">
                              {items.length > 0 && (
                                <span className="font-mono text-[9px] font-bold text-slate-400">
                                  {items.length} video
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── 3. THEO NGÀY (DAY VIEW) ── */}
                {calendarScale === 'day' && (() => {
                  const dayKey = formatDateKey(currentCalendarDate);
                  const items = scheduledItemsByDate[dayKey] || [];
                  const dayDate = currentCalendarDate;
                  const isToday = isTodayDate(dayDate);
                  const weekdays = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
                  const dayName = weekdays[dayDate.getDay()];
                  const dayStr = String(dayDate.getDate()).padStart(2, '0');
                  const monthStr = String(dayDate.getMonth() + 1).padStart(2, '0');

                  return (
                    <div className="space-y-4">
                      {/* Banner ngày */}
                      <div className="p-4 rounded-2xl bg-[#0e111a] border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 shrink-0">
                            <Calendar size={18} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-white">
                                {dayName}, Ngày {dayStr}/{monthStr}/{dayDate.getFullYear()}
                              </h3>
                              {isToday && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-600 text-white uppercase">
                                  Hôm nay
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                              Kênh: <b>{selectedChannel?.name}</b> • Tổng {items.length} video ({items.filter(i => i.status === 'posted').length} đã đăng, {items.filter(i => i.status !== 'posted').length} chờ đăng)
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenScheduleForDate(dayDate)}
                          className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer self-start sm:self-auto shadow-md shadow-violet-950/40"
                        >
                          <CalendarPlus size={14} />
                          <span>Lên Lịch Cho Ngày Này</span>
                        </button>
                      </div>

                      {/* Danh sách các mốc thời gian trong ngày */}
                      {items.length === 0 ? (
                        <div className="p-12 rounded-3xl bg-[#0e111a] border border-slate-800/80 text-center space-y-3">
                          <Clock size={36} className="mx-auto text-slate-600 opacity-40" />
                          <h4 className="text-sm font-bold text-slate-300">
                            Chưa có video nào được lên lịch trong ngày này
                          </h4>
                          <p className="text-xs text-slate-500 max-w-sm mx-auto">
                            Hãy chọn một video thành phẩm để lên lịch đăng tự động lên kênh <b>{selectedChannel?.name}</b>.
                          </p>
                          <button
                            type="button"
                            onClick={() => handleOpenScheduleForDate(dayDate)}
                            className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition cursor-pointer inline-flex items-center gap-2"
                          >
                            <CalendarPlus size={14} />
                            <span>Chọn Video Lên Lịch Ngay</span>
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {items.map((item) => {
                            const itemDate = parseScheduleDate(item.scheduled_time);
                            const timeStr = itemDate
                              ? itemDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                              : '--:--';
                            const isPosted = item.status === 'posted';

                            return (
                              <div
                                key={item.id}
                                className={`p-4 rounded-2xl border transition flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                                  isPosted
                                    ? 'bg-emerald-950/15 border-emerald-500/30'
                                    : 'bg-[#10131e] border-slate-800/80 hover:border-violet-500/40'
                                }`}
                              >
                                {/* Thumbnail + Thông tin */}
                                <div className="flex items-center gap-4 flex-1 min-w-0">
                                  {/* Thumbnail */}
                                  <div
                                    className="relative w-24 h-16 rounded-xl overflow-hidden bg-slate-900 shrink-0 cursor-pointer group border border-slate-800"
                                    onClick={() => {
                                      setPreviewVideoUrl(libraryApi.getMediaUrl(item.video_url));
                                      setPreviewVideoTitle(item.video_title);
                                    }}
                                    title="Bấm để xem video"
                                  >
                                    {item.thumbnail_url ? (
                                      <img
                                        src={libraryApi.getMediaUrl(item.thumbnail_url)}
                                        alt={item.video_title}
                                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                                        <Eye size={18} />
                                      </div>
                                    )}
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                      <Play size={14} className="text-white fill-white" />
                                    </div>
                                  </div>

                                  {/* Tiêu đề & Caption */}
                                  <div className="flex-1 min-w-0 space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-mono text-xs font-semibold text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded">
                                        #{item.video_id}
                                      </span>
                                      <h4 className="text-sm font-bold text-white truncate max-w-md" title={item.video_title}>
                                        {item.video_title}
                                      </h4>
                                    </div>

                                    <div className="flex items-center gap-2">
                                      {isPosted ? (
                                        <span className="text-[11px] font-bold text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30 flex items-center gap-1">
                                          <CheckCircle2 size={11} />
                                          <span>Đã xuất bản ({timeStr.slice(0, 5)})</span>
                                        </span>
                                      ) : (
                                        <span className="text-[11px] font-bold text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-500/30 flex items-center gap-1">
                                          <Clock size={11} />
                                          <span>Chờ đăng lúc {timeStr.slice(0, 5)}</span>
                                        </span>
                                      )}
                                    </div>

                                    {item.caption && (
                                      <p className="text-xs text-slate-400 italic line-clamp-1 max-w-lg">
                                        &ldquo;{item.caption}&rdquo;
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* Các nút hành động & Nhập giờ trực tiếp trên card */}
                                <div className="flex items-center gap-2.5 self-end md:self-auto shrink-0">
                                  {isPosted ? (
                                    <>
                                      {item.post_url && (
                                        <button
                                          type="button"
                                          onClick={() => window.open(item.post_url!, '_blank')}
                                          className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                                        >
                                          <ExternalLink size={12} />
                                          <span>Xem Trên TikTok</span>
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteSchedule(item.id)}
                                        className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-700/60 transition cursor-pointer"
                                        title="Xóa lịch sử"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      {/* Ô nhập giờ trực tiếp trên card (không cần popup) */}
                                      <div className="relative flex items-center" title="Nhập giờ đăng trực tiếp">
                                        <input
                                          type="time"
                                          value={formatTimeValue(item.scheduled_time)}
                                          onChange={(e) => handleInlineChangeScheduleTime(item, e.target.value)}
                                          className="px-3 py-2 bg-[#12151f] hover:bg-[#161a28] focus:bg-[#161a28] border border-slate-700/80 hover:border-slate-600 focus:border-indigo-500 rounded-xl text-xs font-mono font-bold text-white focus:outline-none transition cursor-pointer [color-scheme:dark] shadow-inner"
                                        />
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => handlePostNow(item.id, item.video_title, item.channel_name)}
                                        disabled={postingScheduleId === item.id}
                                        className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-rose-950/40 disabled:opacity-50"
                                      >
                                        <Send size={12} />
                                        <span>{postingScheduleId === item.id ? 'Đang Mở Bot...' : 'Đăng Ngay'}</span>
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => handleDeleteSchedule(item.id)}
                                        className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-700/60 transition cursor-pointer"
                                        title="Hủy lịch"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
          </div>
        )}
      </div>

      {/* ── MODAL CHỌN VIDEO LÊN LỊCH CHO NGÀY TRÊN LỊCH (PHÓNG TO 70% + BỘ LỌC) ── */}
      {calendarPickDate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => {
            setCalendarPickDate(null);
            setModalSearchKeyword('');
          }}
        >
          <div
            className="w-full max-w-5xl bg-[#141724] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[88vh] max-h-[880px] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-[#10131e]">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 shrink-0 shadow-sm">
                  <CalendarPlus size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Lên Lịch Video Vào Ngày {formatDateKey(calendarPickDate).split('-').reverse().join('/')}</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Chọn video thành phẩm để hẹn giờ xuất bản lên kênh <b>{selectedChannel?.name}</b>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCalendarPickDate(null);
                  setModalSearchKeyword('');
                }}
                className="w-9 h-9 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
                title="Đóng"
              >
                <X size={18} />
              </button>
            </div>

            {/* Thanh Tìm Kiếm & Số Lượng Video */}
            <div className="px-6 py-3 bg-[#0c0e17] border-b border-slate-800/80 flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <input
                  type="text"
                  value={modalSearchKeyword}
                  onChange={(e) => setModalSearchKeyword(e.target.value)}
                  placeholder="Tìm theo tên video hoặc #ID..."
                  className="w-full bg-[#161a28] border border-slate-700/80 rounded-xl pl-8 pr-7 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
                />
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                {modalSearchKeyword && (
                  <button
                    type="button"
                    onClick={() => setModalSearchKeyword('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <span className="text-xs text-slate-400 font-mono shrink-0 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
                {!isChannelConfigured ? (
                  <span className="text-amber-400 font-semibold flex items-center gap-1.5">
                    <span>⚠️</span>
                    <span>0 video (Chưa cấu hình kênh)</span>
                  </span>
                ) : (
                  <span>{modalFilteredVideos.length} / {readyVideos.length} video</span>
                )}
              </span>
            </div>

            {/* Danh sách video rộng rãi, dễ nhìn */}
            <div className="p-6 overflow-y-auto flex-1 space-y-3">
              {readyVideos.length === 0 ? (
                <div className="text-center py-16 text-slate-500 text-xs">
                  Chưa có video thành phẩm nào sẵn sàng.
                </div>
              ) : !isChannelConfigured ? (
                <div className="text-center py-12 px-6 space-y-3.5 bg-[#0a0c14]/90 rounded-2xl border border-dashed border-amber-500/30 max-w-lg mx-auto my-8">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto text-xl shadow-inner">
                    ⚠️
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100">
                      Tài khoản TikTok chưa được cấu hình nguồn video
                    </h4>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      Kênh <b>{selectedChannel?.name}</b> hiện chưa được phân quyền tick chọn <b>Kênh Thư Viện Nguồn</b> hoặc <b>Danh Mục Video Phụ Trách</b> nào trong Cài Đặt. Do đó không có video nào được phép lên lịch.
                    </p>
                  </div>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCalendarPickDate(null);
                        navigate("/settings?tab=tiktok");
                      }}
                      className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-2 shadow-lg shadow-violet-600/25 transition cursor-pointer active:scale-95"
                    >
                      <Settings size={14} />
                      <span>Vào Cài Đặt Kênh TikTok Để Cấu Hình</span>
                    </button>
                  </div>
                </div>
              ) : modalFilteredVideos.length === 0 ? (
                <div className="text-center py-16 space-y-2">
                  <p className="text-sm font-semibold text-slate-400">Không tìm thấy video phù hợp với bộ lọc</p>
                  {modalSearchKeyword && (
                    <button
                      type="button"
                      onClick={() => {
                        setModalSearchKeyword("");
                      }}
                      className="text-xs text-violet-400 hover:underline cursor-pointer"
                    >
                      Xóa từ khóa tìm kiếm
                    </button>
                  )}
                </div>
              ) : (
                modalFilteredVideos.map((v) => {
                  const schedInfo = v.schedules?.find((s) => s.channel_id === selectedChannel?.id);
                  const isPosted = schedInfo?.status === 'posted';
                  const isSched = schedInfo && schedInfo.status !== 'posted';

                  return (
                    <div
                      key={v.id}
                      onClick={() => handleOpenScheduleForDate(calendarPickDate, v)}
                      className="p-3.5 rounded-2xl bg-[#0e111a] border border-slate-800/80 hover:border-violet-500/60 hover:bg-slate-800/40 transition flex items-center justify-between gap-4 cursor-pointer group shadow-sm"
                    >
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        {/* Thumbnail video lớn, sắc nét */}
                        <div className="relative w-24 h-16 rounded-xl overflow-hidden bg-slate-900 shrink-0 border border-slate-800 group-hover:border-violet-500/50 transition">
                          {v.thumbnail_url ? (
                            <img
                              src={libraryApi.getMediaUrl(v.thumbnail_url)}
                              alt={v.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-600">
                              <Eye size={18} />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                            <Play size={14} className="text-white fill-white" />
                          </div>
                        </div>

                        {/* Tiêu đề & Tags */}
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <h4 className="text-sm font-bold text-white truncate max-w-2xl group-hover:text-violet-300 transition leading-snug">
                            {v.title}
                          </h4>

                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold text-slate-400 font-mono bg-slate-800/80 px-2 py-0.5 rounded">
                              #{v.id}
                            </span>

                            {v.channel_name && (
                              <span className="text-[10px] font-semibold text-cyan-300 bg-cyan-950/70 border border-cyan-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                <Tv size={10} />
                                <span>{v.channel_name}</span>
                              </span>
                            )}

                            {v.category_name && (
                              <span className="text-[10px] font-semibold text-amber-300 bg-amber-950/70 border border-amber-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                <Tag size={10} />
                                <span>{v.category_name}</span>
                              </span>
                            )}

                            {isPosted ? (
                              <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-950/70 border border-emerald-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                <CheckCircle2 size={10} />
                                <span>Đã từng đăng</span>
                              </span>
                            ) : isSched ? (
                              <span className="text-[10px] font-semibold text-purple-300 bg-purple-950/70 border border-purple-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                <Clock size={10} />
                                <span>Đang có lịch</span>
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium text-slate-400 bg-slate-800/80 px-2.5 py-0.5 rounded-full">
                                Chưa đăng
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Nút Chọn Lên Lịch */}
                      <button
                        type="button"
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 group-hover:from-violet-500 group-hover:to-indigo-500 text-white text-xs font-bold shrink-0 transition shadow-md shadow-violet-950/40"
                      >
                        Chọn Lên Lịch
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 1: XEM & SỬA CAPTION THỦ CÔNG ── */}
      {editingCaptionVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={closeCaptionModal}
        >
          <div
            className="w-full max-w-xl bg-[#141724] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-[#10131e]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
                  <Edit3 size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>Xem & Sửa Caption Video</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
                      #{editingCaptionVideo.id}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate max-w-sm">{editingCaptionVideo.title}</p>
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

            <div className="p-6 space-y-4 overflow-y-auto">
              {/* Nút Tạo lại bằng AI */}
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText size={14} className="text-violet-400" />
                  <span>Nội Dung Caption</span>
                </label>
                <button
                  type="button"
                  disabled={isAiGenerating}
                  onClick={handleAiRegenerateCaption}
                  className="px-3 py-1.5 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                >
                  <Sparkles size={12} className={isAiGenerating ? 'animate-spin' : ''} />
                  <span>{isAiGenerating ? 'AI Đang Viết...' : 'Tạo Lại Bằng AI'}</span>
                </button>
              </div>

              <textarea
                rows={4}
                value={modalCaptionText}
                onChange={(e) => setModalCaptionText(e.target.value)}
                placeholder="Nhập nội dung caption..."
                className="w-full px-4 py-3 bg-[#0e111a] border border-slate-800 rounded-2xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 transition resize-none leading-relaxed"
              />

              {/* Hashtags */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Hash size={14} className="text-indigo-400" />
                  <span>Hashtags</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={modalTagInput}
                    onChange={(e) => setModalTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddHashtag();
                      }
                    }}
                    placeholder="Nhập tag rồi Enter (vd: #xuhuong)..."
                    className="flex-1 px-3.5 py-2 bg-[#0e111a] border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
                  />
                  <button
                    type="button"
                    onClick={handleAddHashtag}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                  >
                    Thêm
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {modalHashtags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-1 rounded-lg bg-violet-600/15 border border-violet-500/30 text-violet-300 text-xs font-mono flex items-center gap-1.5 group"
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveHashtag(tag)}
                        className="hover:text-rose-400 cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-800/80 flex items-center justify-end gap-2 bg-[#10131e]">
              <button
                type="button"
                onClick={closeCaptionModal}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSavingCaption}
                onClick={handleSaveCaptionModal}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-violet-600/20 flex items-center gap-1.5 transition active:scale-95 cursor-pointer disabled:opacity-50"
              >
                <Save size={13} />
                <span>{isSavingCaption ? 'Đang Lưu...' : 'Lưu Thay Đổi'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 2: LÊN LỊCH ĐĂNG (ĐƠN HOẶC HÀNG LOẠT) ── */}
      {(schedulingVideo || isBatchScheduleModal) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={closeScheduleModal}
        >
          <div
            className="w-full max-w-xl max-h-[92vh] bg-[#141724] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-[#10131e] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
                  <Clock size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    {isBatchScheduleModal
                      ? `Lên Lịch Hàng Loạt (${selectedVideoIds.length} Video)`
                      : `Lên Lịch Video #${schedulingVideo?.id}`}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {isBatchScheduleModal
                      ? 'Chọn thời gian bắt đầu đăng cho các video đã chọn'
                      : schedulingVideo?.title}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeScheduleModal}
                className="w-8 h-8 rounded-lg bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Kênh Đăng: Tự động dùng kênh đang mở, không cần chọn lại */}
              {selectedChannel ? (
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-violet-950/40 via-[#121524] to-indigo-950/40 border border-violet-500/30 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 shrink-0">
                      <Tv size={16} />
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Đăng Lên Kênh</span>
                      <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span>{selectedChannel.name}</span>
                        {selectedChannel.username && (
                          <span className="text-[11px] text-violet-300 font-mono">
                            ({selectedChannel.username})
                          </span>
                        )}
                      </h4>
                    </div>
                  </div>
                  {selectedChannel.is_logged_in ? (
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-500/30 font-semibold">
                      ✓ Đã kết nối
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-500/30">
                      Chưa kết nối
                    </span>
                  )}
                </div>
              ) : (
                /* Chỉ hiện danh sách chọn kênh khi đang ở tab Tất Cả Kênh */
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Tv size={14} className="text-violet-400" />
                      <span>Chọn Kênh TikTok Đăng</span>
                    </label>
                    {channels.length > 1 && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const postedIds = (schedulingVideo?.schedules || [])
                              .filter((s) => s.status === 'posted')
                              .map((s) => s.channel_id);
                            const unposted = channels.filter((c) => !postedIds.includes(c.id)).map((c) => c.id);
                            setSelectedChannelIds(unposted.length > 0 ? unposted : channels.map((c) => c.id));
                          }}
                          className="text-[10px] text-violet-400 hover:text-violet-300 font-semibold cursor-pointer underline"
                        >
                          Chọn kênh chưa đăng
                        </button>
                        <span className="text-slate-600">•</span>
                        <button
                          type="button"
                          onClick={() => setSelectedChannelIds(channels.map((c) => c.id))}
                          className="text-[10px] text-slate-400 hover:text-white font-semibold cursor-pointer"
                        >
                          Chọn tất cả
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {channels.length > 0 ? (
                      channels.map((ch) => {
                        const isSel = selectedChannelIds.includes(ch.id);
                        const schedInfo = schedulingVideo?.schedules?.find((s) => s.channel_id === ch.id);
                        return (
                          <div
                            key={ch.id}
                            onClick={() => {
                              setSelectedChannelIds((prev) =>
                                prev.includes(ch.id) ? prev.filter((i) => i !== ch.id) : [...prev, ch.id]
                              );
                            }}
                            className={`p-2.5 rounded-xl border text-xs flex items-center justify-between transition cursor-pointer ${
                              isSel
                                ? 'bg-violet-600/15 border-violet-500/50 text-white'
                                : 'bg-[#0e111a] border-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-4 h-4 rounded border flex items-center justify-center ${
                                  isSel ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-600 bg-slate-900'
                                }`}
                              >
                                {isSel && <Check size={11} strokeWidth={3} />}
                              </div>
                              <span className="font-semibold">{ch.name}</span>
                              {schedInfo ? (
                                schedInfo.status === 'posted' ? (
                                  <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                                    ✓ Đã đăng
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-indigo-400 bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-500/30 inline-flex items-center gap-1">
                                    <Clock size={10} className="text-indigo-400" />
                                    <span>Đang có lịch</span>
                                  </span>
                                )
                              ) : (
                                <span className="text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
                                  Chưa đăng
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                              {ch.username || ch.platform_source}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-xs text-slate-500 p-2">Chưa có kênh TikTok nào trong hệ thống.</div>
                    )}
                  </div>
                </div>
              )}

              {/* Thời gian đăng */}
              <div className="space-y-3 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar size={14} className="text-purple-400" />
                    <span>{isBatchScheduleModal ? 'Thời Gian Bắt Đầu Đăng' : 'Thời Gian Đăng Video'}</span>
                  </label>
                  {customDateTime && (
                    <span className="text-[11px] font-mono text-purple-300 bg-purple-950/40 px-2 py-0.5 rounded border border-purple-800/40">
                      {new Date(customDateTime).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </span>
                  )}
                </div>

                <input
                  type="datetime-local"
                  value={customDateTime}
                  onChange={(e) => setCustomDateTime(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#0e111a] border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500 transition cursor-pointer font-mono"
                />

                {/* Khung giờ mặc định mẫu (Theo hình 1: 11:00, 14:00, 19:00 ⭐, 21:30 ⭐) */}
                <div className="space-y-3 p-4 rounded-2xl bg-gradient-to-b from-[#161a28] to-[#0f121d] border border-slate-700/60 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <Sparkles size={14} className="text-amber-400" />
                      <span>Khung Giờ Vàng Mẫu</span>
                    </span>
                    <span className="text-[11px] text-slate-400 font-medium">Khuyên dùng</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {GOLDEN_TIME_SLOTS.map((slot) => {
                      const isSelected = customDateTime && customDateTime.slice(11, 16) === slot.time;
                      return (
                        <button
                          key={slot.time}
                          type="button"
                          onClick={() => handleSelectGoldenSlot(slot.hour, slot.minute)}
                          className={`py-3.5 px-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition cursor-pointer relative overflow-hidden group ${
                            isSelected
                              ? 'bg-gradient-to-b from-violet-600/35 to-indigo-600/25 border-violet-400 text-white shadow-lg shadow-violet-900/40 ring-2 ring-violet-500/50'
                              : 'bg-[#0d101a] border-slate-800 text-slate-300 hover:border-slate-600 hover:bg-slate-800/50 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Clock size={14} className={isSelected ? 'text-violet-300' : 'text-slate-400'} />
                            <span className="text-sm font-bold tracking-wide font-mono">{slot.time}</span>
                            {slot.isStar && (
                              <Star size={14} className="text-amber-400 fill-amber-400 drop-shadow-sm" />
                            )}
                          </div>
                          <span className={`text-xs font-semibold capitalize tracking-wide ${
                            isSelected ? 'text-violet-200 font-bold' : 'text-slate-400 group-hover:text-slate-200'
                          }`}>
                            {slot.label}
                          </span>
                          {isSelected && (
                            <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-violet-400 animate-ping" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-2 text-[11px] text-slate-400 border-t border-slate-800/60 flex items-center gap-1.5 leading-normal">
                    <span className="text-amber-300 font-bold">Lưu ý:</span>
                    <span>Đừng đăng quá sát nhau (nên cách nhau từ 2.5h – 5h).</span>
                  </div>
                </div>


              </div>

              {/* Phân bổ lịch khi lên lịch hàng loạt */}
              {isBatchScheduleModal && (
                <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
                  <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock size={14} className="text-teal-400" />
                    <span>Quy Tắc Phân Bổ {selectedVideoIds.length} Video</span>
                  </label>

                  {/* 2 lựa chọn phân bổ */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setUseGoldenSlots(true)}
                      className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col gap-1.5 ${
                        useGoldenSlots
                          ? 'bg-violet-600/15 border-violet-500 text-white shadow-sm ring-1 ring-violet-500/40'
                          : 'bg-[#0d101a] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold flex items-center gap-1.5 text-violet-300">
                          <Sparkles size={13} className="text-amber-400" />
                          <span>4 Khung Giờ Vàng Mẫu</span>
                        </span>
                        <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          useGoldenSlots ? 'border-violet-400 bg-violet-600' : 'border-slate-600'
                        }`}>
                          {useGoldenSlots && <Check size={10} className="text-white" strokeWidth={3} />}
                        </span>
                      </div>
                      <span className="text-[10.5px] text-slate-400 leading-relaxed">
                        Tự xếp: 11:00 ➜ 14:00 ➜ 19:00 ⭐ ➜ 21:30 ⭐ (lặp lại qua ngày tiếp theo)
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setUseGoldenSlots(false)}
                      className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col gap-1.5 ${
                        !useGoldenSlots
                          ? 'bg-violet-600/15 border-violet-500 text-white shadow-sm ring-1 ring-violet-500/40'
                          : 'bg-[#0d101a] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold flex items-center gap-1.5 text-teal-300">
                          <Clock size={13} className="text-teal-400" />
                          <span>Khoảng Cách Đều (Giờ)</span>
                        </span>
                        <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          !useGoldenSlots ? 'border-violet-400 bg-violet-600' : 'border-slate-600'
                        }`}>
                          {!useGoldenSlots && <Check size={10} className="text-white" strokeWidth={3} />}
                        </span>
                      </div>
                      <span className="text-[10.5px] text-slate-400 leading-relaxed">
                        Mỗi video cách nhau cố định {intervalHours} tiếng liên tục
                      </span>
                    </button>
                  </div>

                  {/* Slider khi chọn khoảng cách đều */}
                  {!useGoldenSlots && (
                    <div className="space-y-1.5 p-3 rounded-xl bg-[#0e111a] border border-slate-800 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Khoảng cách giữa các video:</span>
                        <span className="font-bold text-violet-400 font-mono">{intervalHours} Giờ</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={12}
                        step={1}
                        value={intervalHours}
                        onChange={(e) => setIntervalHours(Number(e.target.value))}
                        className="w-full accent-violet-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>1 giờ</span>
                        <span>4 giờ</span>
                        <span>8 giờ</span>
                        <span>12 giờ</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-800/80 flex items-center justify-end gap-2 bg-[#10131e]">
              <button
                type="button"
                onClick={closeScheduleModal}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSubmittingSchedule}
                onClick={handleExecuteSchedule}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-violet-600/20 flex items-center gap-1.5 transition active:scale-95 cursor-pointer disabled:opacity-50"
              >
                <CalendarPlus size={14} />
                <span>
                  {isSubmittingSchedule
                    ? 'Đang Xử Lý...'
                    : isBatchScheduleModal
                    ? `Xác Nhận Lên Lịch (${selectedVideoIds.length} Video)`
                    : 'Xác Nhận Lên Lịch Đăng'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      

      {/* ── MODAL 4: XEM TRƯỚC VIDEO (PREVIEW PLAYER) ── */}
      {previewVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setPreviewVideoUrl(null)}
        >
          <div
            className="w-full max-w-2xl bg-[#141724] border border-slate-700 rounded-3xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-[#10131e]">
              <h3 className="text-xs font-bold text-white truncate max-w-md">{previewVideoTitle}</h3>
              <button
                type="button"
                onClick={() => setPreviewVideoUrl(null)}
                className="w-8 h-8 rounded-lg bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="bg-black flex items-center justify-center aspect-video">
              <video
                src={previewVideoUrl}
                controls
                autoPlay
                className="w-full h-full max-h-[70vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
