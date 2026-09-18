import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Key,
  Mic,
  Share2,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  Square,
  CheckSquare,
  ExternalLink,
  ShieldCheck,
  Eye,
  EyeOff,
  Cpu,
  Zap,
  Sparkles,
  User,
  UploadCloud,
  Check,
  ToggleLeft,
  ToggleRight,
  Star,
  Tv,
  Tag,
  Edit3,
  Save,
  Coins,
  Globe,
} from 'lucide-react';
import { settingsApi, libraryApi, publishApi } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';

interface GeminiKeyItem {
  id: number;
  label: string;
  provider?: 'google' | 'kie' | string;
  is_default?: boolean;
  masked_key: string;
  daily_quota_used: number;
  daily_quota_limit: number;
  status: string;
  is_active: boolean;
  last_used_at?: string;
  created_at?: string;
}

interface TtsVoiceItem {
  id: string;
  name: string;
  gender: string;
  region: string;
  description: string;
  engine: string;
  is_default: boolean;
  is_custom?: boolean;
}

// Nhãn hiển thị + màu badge cho từng engine TTS. Engine chưa có trong map (vd engine mới thêm
// sau này ở backend) vẫn hiển thị đúng tên thay vì bị gán nhầm sang engine khác.
const ENGINE_DISPLAY: Record<string, { label: string; badgeClass: string }> = {
  gemini: { label: 'Gemini', badgeClass: 'bg-amber-500/15 border-amber-500/30 text-amber-300' },
  'edge-tts': { label: 'Edge-TTS', badgeClass: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' },
  vieneu: { label: 'VieNeu-TTS', badgeClass: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' },
};

function getEngineDisplay(engine: string): { label: string; badgeClass: string } {
  return (
    ENGINE_DISPLAY[engine] || {
      label: engine,
      badgeClass: 'bg-slate-500/10 border-slate-500/30 text-slate-300',
    }
  );
}

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as 'gemini' | 'tts' | 'tiktok') || 'gemini';
  const [activeTab, setActiveTab] = useState<'gemini' | 'tts' | 'tiktok'>(initialTab);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'tts' || tab === 'gemini' || tab === 'tiktok') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // Gemini state
  const [keys, setKeys] = useState<GeminiKeyItem[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
    const [showKeyText, setShowKeyText] = useState(false);
  const [addingKey, setAddingKey] = useState(false);
  const [testingKeyId, setTestingKeyId] = useState<number | null>(null);
  const [keyAlert, setKeyAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [kieCredits, setKieCredits] = useState<Record<number, number | 'loading' | 'error'>>({});
  const [syncingCreditId, setSyncingCreditId] = useState<number | null>(null);

  // Confirm Modal state
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

  // TTS state
  const [voices, setVoices] = useState<TtsVoiceItem[]>([]);
  const [selectedVoice, setSelectedVoice] = useState(() => {
    return localStorage.getItem('video_studio_default_voice') || 'vi-VN-HoaiMyNeural';
  });
  const [enabledVoiceIds, setEnabledVoiceIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('video_studio_enabled_voices');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return [];
  });

  const [selectedEngine, setSelectedEngine] = useState<string>('all');
  const [selectedGender, setSelectedGender] = useState<'all' | 'Female' | 'Male'>('all');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [loadingVoiceId, setLoadingVoiceId] = useState<string | null>(null);
  const [audioPlayer, setAudioPlayer] = useState<HTMLAudioElement | null>(null);

  // Voice Clone Creation State in Settings
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneGender, setCloneGender] = useState<'Female' | 'Male'>('Female');
  const [cloneRefText, setCloneRefText] = useState('');
  const [cloneAudioFile, setCloneAudioFile] = useState<File | null>(null);
  const [cloneAudioPreviewUrl, setCloneAudioPreviewUrl] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneAlert, setCloneAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);


  // TikTok Channels State in Settings
  interface TikTokChannelConfig {
    id: number;
    name: string;
    username?: string;
    platform_source: string;
    status?: string;
    is_active?: boolean;
    time_slots?: string[];
    is_logged_in?: boolean;
    avatar_url?: string;
    is_logging_in?: boolean;
    linked_channel_ids?: number[];
    linked_category_ids?: number[];
  }

  const [tiktokChannels, setTiktokChannels] = useState<TikTokChannelConfig[]>([]);
  const [loadingTiktokChannels, setLoadingTiktokChannels] = useState(false);
  const [savingChannelId, setSavingChannelId] = useState<number | null>(null);
  const [libraryChannels, setLibraryChannels] = useState<{ id: number; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);

  const loadTiktokChannels = async () => {
    try {
      setLoadingTiktokChannels(true);
      const [chRes, libRes, catRes] = await Promise.all([
        settingsApi.getTikTokChannels(),
        libraryApi.getChannels().catch(() => ({ channels: [] })),
        libraryApi.getCategories().catch(() => ({ categories: [] })),
      ]);
      setTiktokChannels(chRes.channels || []);
      setLibraryChannels(libRes.channels || []);
      setCategories(catRes.categories || []);
    } catch (err: any) {
      console.error('Failed to load TikTok channels:', err);
    } finally {
      setLoadingTiktokChannels(false);
    }
  };

  const handleOpenTikTokLogin = async (id: number) => {
    try {
      setKeyAlert({
        type: 'success',
        message: `Đang mở trình duyệt Chromium đăng nhập TikTok cho Kênh #${id}. Vui lòng mở điện thoại quét mã QR!`,
      });
      await publishApi.openChannelLogin(id);
      let count = 0;
      const interval = setInterval(async () => {
        count++;
        try {
          const res = await publishApi.getChannelLoginStatus(id);
          if (res.is_logged_in) {
            clearInterval(interval);
            setKeyAlert({
              type: 'success',
              message: `Đã kết nối thành công Kênh #${id} với tài khoản TikTok ${res.username || ''}!`,
            });
            await loadTiktokChannels();
          }
        } catch {
          // ignore
        }
        if (count > 30) clearInterval(interval);
      }, 3000);
    } catch (err: any) {
      setKeyAlert({ type: 'error', message: err.message || 'Không thể mở cửa sổ đăng nhập' });
    }
  };

  const handleLogoutTikTok = async (id: number) => {
    try {
      await publishApi.logoutChannel(id);
      setKeyAlert({ type: 'success', message: `Đã đăng xuất tài khoản TikTok Kênh #${id}!` });
      await loadTiktokChannels();
    } catch (err: any) {
      setKeyAlert({ type: 'error', message: err.message || 'Không thể đăng xuất' });
    }
  };

  const handleCheckTikTokStatus = async (id: number) => {
    try {
      const res = await publishApi.getChannelLoginStatus(id);
      if (res.is_logged_in) {
        setKeyAlert({
          type: 'success',
          message: `Kênh #${id} đã kết nối hợp lệ (Tài khoản: ${res.username || 'TikTok'})`,
        });
      } else {
        setKeyAlert({
          type: 'error',
          message: `Kênh #${id} chưa đăng nhập hoặc phiên làm việc đã hết hạn.`,
        });
      }
      await loadTiktokChannels();
    } catch (err: any) {
      setKeyAlert({ type: 'error', message: err.message || 'Lỗi kiểm tra' });
    }
  };

  const handleUpdateTiktokChannel = async (
    id: number,
    name: string,
    username: string,
    linked_channel_ids?: number[],
    linked_category_ids?: number[],
    publish_headless?: boolean
  ) => {
    try {
      setSavingChannelId(id);
      await settingsApi.updateTikTokChannel(id, {
        name,
        username,
        linked_channel_ids,
        linked_category_ids,
        publish_headless,
      });
      setKeyAlert({ type: 'success', message: `Đã cập nhật cấu hình ${name} thành công!` });
      await loadTiktokChannels();
    } catch (err: any) {
      setKeyAlert({ type: 'error', message: err.message || 'Lỗi khi cập nhật kênh' });
    } finally {
      setSavingChannelId(null);
    }
  };

  const handleAddTiktokChannel = async () => {
    try {
      await settingsApi.createTikTokChannel({
        name: `Kênh TikTok #${tiktokChannels.length + 1}`,
        username: `@kenh${tiktokChannels.length + 1}`,
        time_slots: ['11:00', '14:00', '19:00', '21:30'],
      });
      setKeyAlert({ type: 'success', message: 'Đã thêm kênh TikTok mới vào cấu hình!' });
      await loadTiktokChannels();
    } catch (err: any) {
      setKeyAlert({ type: 'error', message: err.message || 'Lỗi khi thêm kênh' });
    }
  };

  const handleDeleteTiktokChannel = (id: number, name: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Xác nhận xóa kênh',
      message: `Bạn có chắc muốn xóa kênh "${name}"? Hành động này không thể hoàn tác.`,
      isLoading: false,
      onConfirm: async () => {
        try {
          setConfirmDialog((prev) => ({ ...prev, isLoading: true }));
          await settingsApi.deleteTikTokChannel(id);
          setKeyAlert({ type: 'success', message: `Đã xóa kênh "${name}" thành công!` });
          setTiktokChannels((prev) => prev.filter((c) => c.id !== id));
          setConfirmDialog((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        } catch (err: any) {
          setKeyAlert({ type: 'error', message: err.message || 'Lỗi khi xóa kênh' });
          setConfirmDialog((prev) => ({ ...prev, isLoading: false }));
        }
      },
    });
  };

  // Auto-sync credit cho tất cả Kie.ai keys
  const syncAllKieCredits = async (keyList: GeminiKeyItem[]) => {
    const kieKeys = keyList.filter((k) => k.provider === 'kie');
    if (kieKeys.length === 0) return;
    await Promise.allSettled(
      kieKeys.map(async (k) => {
        try {
          setKieCredits((prev) => ({ ...prev, [k.id]: 'loading' }));
          const res = await settingsApi.getKieCredit(k.id);
          if (res.success && res.credit !== null) {
            setKieCredits((prev) => ({ ...prev, [k.id]: res.credit as number }));
          } else {
            setKieCredits((prev) => ({ ...prev, [k.id]: 'error' }));
          }
        } catch {
          setKieCredits((prev) => ({ ...prev, [k.id]: 'error' }));
        }
      })
    );
  };

  // Load Gemini Keys
  const loadKeys = async () => {
    try {
      setLoadingKeys(true);
      const res = await settingsApi.getGeminiKeys();
      const keyList = res.keys || [];
      setKeys(keyList);
      // Tự động sync credit sau khi load keys
      syncAllKieCredits(keyList);
    } catch (err: any) {
      console.error('Failed to load keys:', err);
    } finally {
      setLoadingKeys(false);
    }
  };

  // Load TTS Voices
  const loadVoices = async () => {
    try {
      const res = await settingsApi.getTtsVoices();
      const vList = res.voices || [];
      setVoices(vList);

      // Nếu chưa có config enabledVoiceIds thì mặc định bật tất cả; nếu có rồi thì tự động gộp
      // mọi giọng mới xuất hiện (bất kể engine nào — Gemini, Edge-TTS, VieNeu-TTS, hay engine mới
      // thêm sau này) để người dùng cũ không bị "mất" giọng mới do chưa từng lưu trong localStorage.
      const saved = localStorage.getItem('video_studio_enabled_voices');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const allIds = vList.map((v: TtsVoiceItem) => v.id);
            const missingIds = allIds.filter((id: string) => !parsed.includes(id));
            if (missingIds.length > 0) {
              const merged = [...parsed, ...missingIds];
              setEnabledVoiceIds(merged);
              localStorage.setItem('video_studio_enabled_voices', JSON.stringify(merged));
            } else {
              setEnabledVoiceIds(parsed);
            }
          }
        } catch (e) {}
      } else if (vList.length > 0) {
        const allIds = vList.map((v: TtsVoiceItem) => v.id);
        setEnabledVoiceIds(allIds);
        localStorage.setItem('video_studio_enabled_voices', JSON.stringify(allIds));
      }
    } catch (err: any) {
      console.error('Failed to load TTS voices:', err);
    }
  };

  useEffect(() => {
    loadKeys();
    loadVoices();
    loadTiktokChannels();
    // Auto-refresh credit Kie.ai mỗi 60 giây
    const interval = setInterval(() => {
      setKeys((current) => {
        syncAllKieCredits(current);
        return current;
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Tải lại dữ liệu kênh TikTok mỗi khi chuyển sang tab tiktok
  useEffect(() => {
    if (activeTab === 'tiktok') {
      loadTiktokChannels();
    }
  }, [activeTab]);


  // Voice Output / Visibility Handlers
  const handleToggleVoiceVisibility = (voiceId: string) => {
    setEnabledVoiceIds((prev) => {
      let next: string[];
      if (prev.includes(voiceId)) {
        if (voiceId === selectedVoice) {
          alert('Giọng này đang là giọng mặc định được chọn. Hãy chọn giọng khác làm mặc định trước khi tắt hiển thị!');
          return prev;
        }
        next = prev.filter((id) => id !== voiceId);
      } else {
        next = [...prev, voiceId];
      }
      localStorage.setItem('video_studio_enabled_voices', JSON.stringify(next));
      return next;
    });
  };



  const handleSetDefaultVoice = (voiceId: string) => {
    setSelectedVoice(voiceId);
    localStorage.setItem('video_studio_default_voice', voiceId);
    if (!enabledVoiceIds.includes(voiceId)) {
      const next = [...enabledVoiceIds, voiceId];
      setEnabledVoiceIds(next);
      localStorage.setItem('video_studio_enabled_voices', JSON.stringify(next));
    }
  };

  // Handle Add Gemini Key
  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;

    try {
      setAddingKey(true);
      setKeyAlert(null);
      const defaultLabel = `Gemini Key #${keys.length + 1}`;
      const res = await settingsApi.addGeminiKey({
        api_key: newKey.trim(),
        label: newLabel.trim() || defaultLabel,
        provider: 'auto',
      });
      const provName = res.key?.provider === 'kie' ? 'Gemini Flash (Server VIP)' : 'Google AI Studio';
      setKeyAlert({
        type: 'success',
        message: `Đã xác thực key thành công qua ${provName} (Độ trễ phản hồi: ${res.latency_ms}ms)`,
      });
      setNewKey('');
      setNewLabel('');
      loadKeys();
    } catch (err: any) {
      setKeyAlert({
        type: 'error',
        message: err.message || 'Lỗi khi kiểm tra hoặc thêm API key',
      });
    } finally {
      setAddingKey(false);
    }
  };

  const [isTestingAll, setIsTestingAll] = useState(false);

  // Handle Set Default Key
  const handleSetDefaultKey = async (id: number) => {
    try {
      setKeyAlert(null);
      const res = await settingsApi.setDefaultGeminiKey(id);
      setKeyAlert({ type: 'success', message: res.message });
      loadKeys();
    } catch (err: any) {
      setKeyAlert({ type: 'error', message: err.message || 'Lỗi khi đặt key mặc định' });
    }
  };

  // Handle Sync Kie.ai Credit
  const handleSyncKieCredit = async (id: number) => {
    try {
      setSyncingCreditId(id);
      setKieCredits((prev) => ({ ...prev, [id]: 'loading' }));
      const res = await settingsApi.getKieCredit(id);
      if (res.success && res.credit !== null) {
        setKieCredits((prev) => ({ ...prev, [id]: res.credit as number }));
      } else {
        setKieCredits((prev) => ({ ...prev, [id]: 'error' }));
        setKeyAlert({ type: 'error', message: `Không lấy được credit: ${res.error || 'Lỗi không xác định'}` });
      }
    } catch (err: any) {
      setKieCredits((prev) => ({ ...prev, [id]: 'error' }));
      setKeyAlert({ type: 'error', message: err.message || 'Lỗi khi đồng bộ credit' });
    } finally {
      setSyncingCreditId(null);
    }
  };

  // Handle Test Existing Key
  const handleTestKey = async (id: number) => {
    try {
      setTestingKeyId(id);
      setKeyAlert(null);
      const res = await settingsApi.testGeminiKey(id);
      if (res.valid) {
        setKeyAlert({
          type: 'success',
          message: `${res.message} (Độ trễ: ${res.latency_ms}ms)`,
        });
      } else {
        setKeyAlert({
          type: 'error',
          message: `Key #${id}: ${res.message}`,
        });
      }
      loadKeys();
    } catch (err: any) {
      setKeyAlert({ type: 'error', message: err.message || 'Lỗi kiểm tra key' });
    } finally {
      setTestingKeyId(null);
    }
  };

  // Handle Test & Reactivate All Keys
  const handleTestAllKeys = async () => {
    try {
      setIsTestingAll(true);
      setKeyAlert(null);
      const res = await settingsApi.testAllGeminiKeys();
      setKeyAlert({
        type: res.active_count > 0 ? 'success' : 'error',
        message: `Đã kiểm tra ${res.total} key trong pool: ${res.active_count}/${res.total} key sẵn sàng hoạt động!`,
      });
      loadKeys();
    } catch (err: any) {
      setKeyAlert({ type: 'error', message: err.message || 'Lỗi kiểm tra toàn bộ key' });
    } finally {
      setIsTestingAll(false);
    }
  };

  // Prompt Delete Key
  const promptDeleteKey = (keyItem: GeminiKeyItem) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Xác nhận xóa API Key',
      message: `Bạn có chắc muốn xóa key "${keyItem.label}" (${keyItem.masked_key}) khỏi pool? Hệ thống sẽ không thể sử dụng key này cho các tác vụ dịch kịch bản tiếp theo.`,
      isLoading: false,
      onConfirm: async () => {
        try {
          setConfirmDialog((prev) => ({ ...prev, isLoading: true }));
          await settingsApi.deleteGeminiKey(keyItem.id);
          setKeys((prev) => prev.filter((k) => k.id !== keyItem.id));
          setConfirmDialog((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        } catch (err: any) {
          alert(err.message || 'Lỗi khi xóa key');
          setConfirmDialog((prev) => ({ ...prev, isLoading: false }));
        }
      },
    });
  };

  // Handle Play Voice Sample
  const handlePlayVoicePreview = async (voiceId: string) => {
    if (playingVoiceId === voiceId && audioPlayer) {
      audioPlayer.pause();
      setPlayingVoiceId(null);
      return;
    }

    try {
      if (audioPlayer) {
        audioPlayer.pause();
      }
      setLoadingVoiceId(voiceId);
      setPlayingVoiceId(voiceId);
      const res = await settingsApi.getTtsPreview(voiceId);
      const audioUrl = res.audio_url.startsWith('http') ? res.audio_url : libraryApi.getMediaUrl(res.audio_url);
      const audio = new Audio(audioUrl);
      audio.onended = () => {
        setPlayingVoiceId(null);
        setLoadingVoiceId(null);
      };
      audio.onerror = (e) => {
        console.error('Audio preview error on url:', audioUrl, e);
        setPlayingVoiceId(null);
        setLoadingVoiceId(null);
      };
      setAudioPlayer(audio);
      await audio.play();
    } catch (err) {
      console.error('Failed to play preview:', err);
      setPlayingVoiceId(null);
    } finally {
      setLoadingVoiceId(null);
    }
  };

  const handleAudioFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCloneAudioFile(file);
    if (!cloneName.trim()) {
      const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
      setCloneName(`Giọng ${baseName.slice(0, 20)}`);
    }
    const url = URL.createObjectURL(file);
    setCloneAudioPreviewUrl(url);
  };

  const handleCreateCloneVoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneAudioFile) {
      setCloneAlert({ type: 'error', message: 'Vui lòng chọn 1 file âm thanh mẫu (mp3, wav, m4a từ 3s - 20s)' });
      return;
    }
    if (!cloneName.trim()) {
      setCloneAlert({ type: 'error', message: 'Vui lòng nhập tên cho giọng đọc' });
      return;
    }

    try {
      setIsCloning(true);
      setCloneAlert(null);
      const formData = new FormData();
      formData.append('name', cloneName.trim());
      formData.append('gender', cloneGender);
      if (cloneRefText.trim()) {
        formData.append('ref_text', cloneRefText.trim());
      }
      formData.append('ref_audio', cloneAudioFile);

      const res = await settingsApi.createCustomVoice(formData);
      if (res.success && res.voice) {
        setCloneAlert({
          type: 'success',
          message: `Nhân bản giọng "${res.voice.name}" thành công! Giọng đã sẵn sàng sử dụng.`,
        });
        setCloneName('');
        setCloneRefText('');
        setCloneAudioFile(null);
        setCloneAudioPreviewUrl(null);
        setShowCloneForm(false);

        // Tự động bật hiện giọng vừa tạo
        const createdId = res.voice.id;
        setEnabledVoiceIds((prev) => {
          const next = prev.includes(createdId) ? prev : [...prev, createdId];
          localStorage.setItem('video_studio_enabled_voices', JSON.stringify(next));
          return next;
        });

        loadVoices();
      }
    } catch (err: any) {
      setCloneAlert({
        type: 'error',
        message: err.message || 'Không thể tạo giọng nhân bản. Vui lòng thử lại.',
      });
    } finally {
      setIsCloning(false);
    }
  };

  const promptDeleteCustomVoice = (voiceItem: TtsVoiceItem) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Xác nhận xóa giọng nhân bản',
      message: `Bạn có chắc muốn xóa giọng "${voiceItem.name}" không? File âm thanh mẫu và dữ liệu nhân bản sẽ bị xóa hoàn toàn.`,
      isLoading: false,
      onConfirm: async () => {
        try {
          setConfirmDialog((prev) => ({ ...prev, isLoading: true }));
          await settingsApi.deleteCustomVoice(voiceItem.id);
          setVoices((prev) => prev.filter((v) => v.id !== voiceItem.id));
          setEnabledVoiceIds((prev) => {
            const next = prev.filter((id) => id !== voiceItem.id);
            localStorage.setItem('video_studio_enabled_voices', JSON.stringify(next));
            return next;
          });
          if (selectedVoice === voiceItem.id) {
            setSelectedVoice('vi-VN-HoaiMyNeural');
            localStorage.setItem('video_studio_default_voice', 'vi-VN-HoaiMyNeural');
          }
          setConfirmDialog((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        } catch (err: any) {
          alert(err.message || 'Lỗi khi xóa giọng');
          setConfirmDialog((prev) => ({ ...prev, isLoading: false }));
        }
      },
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#0f1117] text-slate-100 overflow-y-auto">
      {/* Shared Confirm Modal */}
      <ConfirmModal
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText="Xác nhận xóa"
        cancelText="Hủy"
        isDanger={true}
        isLoading={confirmDialog.isLoading}
        onConfirm={confirmDialog.onConfirm}
        onClose={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 lg:px-10 py-5 border-b border-slate-800/80 sticky top-0 bg-[#0f1117]/95 backdrop-blur z-10">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Cài Đặt Hệ Thống</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Quản lý Pool API Key Gemini, cấu hình giọng đọc TTS và tài khoản xuất bản
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-[#161a24] p-1 rounded-xl border border-slate-800 overflow-x-auto shrink-0">
          <button
            onClick={() => setActiveTab('gemini')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'gemini'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Key size={13} />
            <span>Gemini Key Pool</span>
            <span className="px-1.5 py-0.2 rounded-full bg-black/30 text-[10px]">
              {keys.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('tts')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'tts'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Mic size={13} />
            <span>Giọng Đọc & TTS</span>
          </button>

          <button
            onClick={() => setActiveTab('tiktok')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'tiktok'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Share2 size={13} />
            <span>Tài Khoản TikTok Đăng Bài</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Alert Notification */}
        {keyAlert && (
          <div
            className={`p-4 rounded-xl border flex items-center justify-between text-xs animate-in fade-in duration-200 ${
              keyAlert.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {keyAlert.type === 'success' ? (
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle size={16} className="text-rose-400 shrink-0" />
              )}
              <span>{keyAlert.message}</span>
            </div>
            <button
              onClick={() => setKeyAlert(null)}
              className="text-slate-400 hover:text-slate-200 text-xs px-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* TAB 1: GEMINI API KEY POOL */}
        {activeTab === 'gemini' && (
          <div className="space-y-6">
            {/* Add Key Card */}
            <div className="bg-[#161922] border border-slate-800 rounded-2xl p-6 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Key size={15} className="text-indigo-400" />
                    Thêm API Key
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Tự động xoay vòng key và cân bằng tải khi dịch thuật.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs border border-slate-700/60 transition shrink-0"
                  >
                    <ExternalLink size={12} />
                    Google AI Studio
                  </a>
                </div>
              </div>

              <form onSubmit={handleAddKey} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-1">
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Tên gợi nhớ
                    </label>
                    <input
                      type="text"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="VD: Key 1, Studio..."
                      className="w-full bg-[#12151e] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      API Key <span className="text-rose-400">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showKeyText ? 'text' : 'password'}
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        placeholder="Nhập API Key..."
                        required
                        className="w-full bg-[#12151e] border border-slate-700/80 rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 transition"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKeyText(!showKeyText)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                      >
                        {showKeyText ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={addingKey || !newKey.trim()}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-600/30 transition"
                  >
                    {addingKey ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" />
                        Đang kiểm tra...
                      </>
                    ) : (
                      <>
                        <Plus size={14} />
                        Thêm Key
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>

            {/* Key List Card */}
            <div className="bg-[#161922] border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Danh Sách Key ({keys.length})
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Tự động xoay vòng key khi dịch thuật
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTestAllKeys}
                    disabled={isTestingAll || keys.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition disabled:opacity-50"
                    title="Kiểm tra và tự động khôi phục toàn bộ key về trạng thái Sẵn sàng"
                  >
                    <RefreshCw size={12} className={isTestingAll ? 'animate-spin' : ''} />
                    <span>{isTestingAll ? 'Đang kiểm tra...' : 'Kiểm tra tất cả'}</span>
                  </button>
                  <button
                    onClick={loadKeys}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                    title="Tải lại danh sách"
                  >
                    <RefreshCw size={14} className={loadingKeys ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {loadingKeys && keys.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  <RefreshCw size={20} className="animate-spin text-indigo-500 mx-auto mb-2" />
                  Đang tải danh sách key...
                </div>
              ) : keys.length === 0 ? (
                <div className="py-12 text-center">
                  <ShieldCheck size={36} className="text-slate-700 mx-auto mb-3" />
                  <p className="text-sm font-medium text-slate-300">Chưa có API Key nào trong Pool</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    Vui lòng nhập ít nhất 1 Gemini API Key ở ô bên trên để kích hoạt tính năng dịch tự động.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/60">
                  {keys.map((k) => {
                    const isTesting = testingKeyId === k.id;
                    return (
                      <div
                        key={k.id}
                        className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#191d29] transition"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-10 h-10 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-indigo-400 shrink-0">
                            <Key size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-slate-100 truncate">
                                {k.label}
                              </span>
                              {k.provider === 'kie' ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                                  <Zap size={9} className="shrink-0" />
                                  <span>Server VIP</span>
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                                  Google AI
                                </span>
                              )}
                              {k.is_default && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shadow-sm">
                                  <Star size={10} className="fill-amber-400 text-amber-400" />
                                  <span>Mặc định</span>
                                </span>
                              )}
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                                  k.status === 'active'
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : k.status === 'exhausted'
                                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                    : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                }`}
                              >
                                {k.status === 'active'
                                  ? 'Sẵn sàng'
                                  : k.status === 'exhausted'
                                  ? 'Hết quota'
                                  : 'Lỗi key'}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-400 font-mono mt-1">
                              <span>{k.masked_key}</span>
                              {k.last_used_at && (
                                <>
                                  <span className="text-slate-600">•</span>
                                  <span className="text-slate-500 flex items-center gap-1 font-sans">
                                    <Clock size={11} />
                                    Dùng: {new Date(k.last_used_at).toLocaleTimeString('vi-VN')}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* KHỐI HIỂN THỊ CREDIT PHÓNG TO, BẤM VÀO ĐỂ ĐỒNG BỘ */}
                        {k.provider === 'kie' && (() => {
                          const cr = kieCredits[k.id];
                          const isSyncing = syncingCreditId === k.id || cr === 'loading';
                          return (
                            <div
                              onClick={() => !isSyncing && handleSyncKieCredit(k.id)}
                              className={`px-4 py-2 rounded-2xl bg-gradient-to-r from-purple-950/70 via-[#1a142e] to-indigo-950/70 border border-purple-500/50 shadow-md shadow-purple-950/40 flex items-center gap-3 transition group shrink-0 ${
                                isSyncing
                                  ? 'opacity-80 cursor-wait'
                                  : 'cursor-pointer hover:border-purple-400 hover:shadow-purple-900/40 active:scale-95'
                              }`}
                              title="Bấm vào thẻ này để đồng bộ lại số dư Credits"
                            >
                              <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400 group-hover:scale-105 transition shrink-0">
                                {isSyncing ? (
                                  <RefreshCw size={16} className="animate-spin text-purple-300" />
                                ) : (
                                  <Coins size={18} />
                                )}
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                                  <span>Số Dư</span>
                                  <span className="text-[9px] text-purple-400/70 font-normal">
                                    (sync)
                                  </span>
                                </span>
                                <div className="flex items-baseline gap-1.5">
                                  {isSyncing ? (
                                    <span className="text-xs text-purple-300 animate-pulse flex items-center gap-1 font-semibold">
                                      Đang đồng bộ...
                                    </span>
                                  ) : cr === 'error' ? (
                                    <span className="text-xs text-rose-400 font-bold">⚠ Lỗi credit</span>
                                  ) : typeof cr === 'number' ? (
                                    <>
                                      <span className="text-xl sm:text-2xl font-black font-mono text-white tracking-tight leading-none">
                                        {cr.toLocaleString()}
                                      </span>
                                      <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">
                                        cr
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-xs text-slate-500">Chưa đồng bộ</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          {!k.is_default && (
                            <button
                              onClick={() => handleSetDefaultKey(k.id)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-amber-300 hover:bg-amber-500/10 border border-slate-700/60 transition"
                              title="Đặt làm key ưu tiên gọi đầu tiên"
                            >
                              <Star size={12} className="text-slate-400" />
                              <span>Mặc định</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleTestKey(k.id)}
                            disabled={isTesting}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 transition disabled:opacity-50"
                          >
                            <RefreshCw size={12} className={isTesting ? 'animate-spin' : ''} />
                            <span>Kiểm tra</span>
                          </button>
                          <button
                            onClick={() => promptDeleteKey(k)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                            title="Xóa key"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: TTS & VOICES */}
        {activeTab === 'tts' && (
          <div className="space-y-6">
            {/* Engine Picker Cards */}
            <div className="bg-[#161922] border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Cpu size={16} className="text-indigo-400" />
                    <span>Công Nghệ Lồng Tiếng</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Lọc danh sách giọng đọc theo động cơ TTS
                  </p>
                </div>
                <div className="flex items-center gap-1 bg-[#10131d] p-1 border border-slate-800 rounded-xl text-xs flex-wrap">
                  <button
                    type="button"
                    onClick={() => setSelectedEngine('all')}
                    className={`px-2.5 py-1 rounded-lg transition font-medium cursor-pointer ${
                      selectedEngine === 'all'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Tất cả ({voices.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedEngine('gemini')}
                    className={`px-2.5 py-1 rounded-lg transition font-medium cursor-pointer flex items-center gap-1.5 ${
                      selectedEngine === 'gemini'
                        ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                        : 'text-slate-400 hover:text-amber-300'
                    }`}
                  >
                    <Sparkles size={12} className={selectedEngine === 'gemini' ? 'text-slate-950' : 'text-amber-400'} />
                    <span>Gemini ({voices.filter(v => v.engine === 'gemini').length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedEngine('edge-tts')}
                    className={`px-2.5 py-1 rounded-lg transition font-medium cursor-pointer ${
                      selectedEngine === 'edge-tts'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Edge-TTS ({voices.filter(v => v.engine === 'edge-tts').length})
                  </button>
                  {voices.some(v => v.engine === 'vieneu') && (
                    <button
                      type="button"
                      onClick={() => setSelectedEngine('vieneu')}
                      className={`px-2.5 py-1 rounded-lg transition font-medium cursor-pointer ${
                        selectedEngine === 'vieneu'
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-emerald-300'
                      }`}
                    >
                      VieNeu-TTS ({voices.filter(v => v.engine === 'vieneu').length})
                    </button>
                  )}
                  {/* Bất kỳ engine mới nào khác (thêm sau này ở backend) tự động có filter chip riêng */}
                  {Array.from(new Set(voices.map(v => v.engine)))
                    .filter(eng => eng !== 'gemini' && eng !== 'edge-tts' && eng !== 'vieneu')
                    .map(eng => (
                      <button
                        key={eng}
                        type="button"
                        onClick={() => setSelectedEngine(eng)}
                        className={`px-2.5 py-1 rounded-lg transition font-medium cursor-pointer ${
                          selectedEngine === eng
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {getEngineDisplay(eng).label} ({voices.filter(v => v.engine === eng).length})
                      </button>
                    ))}
                  {voices.some(v => v.is_custom) && (
                    <button
                      type="button"
                      onClick={() => setSelectedEngine('custom')}
                      className={`px-2.5 py-1 rounded-lg transition font-medium cursor-pointer ${
                        selectedEngine === 'custom'
                          ? 'bg-rose-600 text-white'
                          : 'text-slate-400 hover:text-rose-300'
                      }`}
                    >
                      Của tôi ({voices.filter(v => v.is_custom).length})
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                {/* Gemini 2.5 Pro TTS Card */}
                <div
                  onClick={() => setSelectedEngine(selectedEngine === 'gemini' ? 'all' : 'gemini')}
                  className={`p-3.5 rounded-xl border-2 transition cursor-pointer flex flex-col justify-between ${
                    selectedEngine === 'gemini'
                      ? 'border-amber-500/80 bg-amber-500/10 shadow-sm'
                      : 'border-slate-800 bg-[#12151e] opacity-80 hover:opacity-100'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles size={13} className="text-amber-400" />
                        Gemini Pro
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-semibold">
                        Studio AI
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-normal">
                      30 giọng phòng thu cao cấp từ Google Cloud.
                    </p>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-amber-300 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 size={12} />
                      Google Cloud
                    </span>
                    <span className="font-semibold text-slate-400">30 giọng</span>
                  </div>
                </div>

                {/* Edge-TTS Card */}
                <div
                  onClick={() => setSelectedEngine(selectedEngine === 'edge-tts' ? 'all' : 'edge-tts')}
                  className={`p-3.5 rounded-xl border-2 transition cursor-pointer flex flex-col justify-between ${
                    selectedEngine === 'edge-tts'
                      ? 'border-indigo-500/80 bg-indigo-500/10 shadow-sm'
                      : 'border-slate-800 bg-[#12151e] opacity-80 hover:opacity-100'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                        <Zap size={13} className="text-indigo-400" />
                        Edge-TTS
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold">
                        Sẵn sàng
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-normal">
                      Tốc độ tức thì, phát âm tự nhiên chuẩn Bắc.
                    </p>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-indigo-300 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 size={12} />
                      Microsoft Cloud
                    </span>
                    <span className="font-semibold text-slate-400">2 giọng</span>
                  </div>
                </div>

                {/* VieNeu-TTS Card — chỉ hiện khi backend đã cài & liệt kê được preset (pip install vieneu) */}
                {voices.some(v => v.engine === 'vieneu') && (
                  <div
                    onClick={() => setSelectedEngine(selectedEngine === 'vieneu' ? 'all' : 'vieneu')}
                    className={`p-3.5 rounded-xl border-2 transition cursor-pointer flex flex-col justify-between ${
                      selectedEngine === 'vieneu'
                        ? 'border-emerald-500/80 bg-emerald-500/10 shadow-sm'
                        : 'border-slate-800 bg-[#12151e] opacity-80 hover:opacity-100'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                          <Mic size={13} className="text-emerald-400" />
                          VieNeu-TTS
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold">
                          Offline
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 leading-normal">
                        Mã nguồn mở, chạy local, hỗ trợ emotion cues như [cười], [thở dài].
                      </p>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-emerald-300 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 size={12} />
                        VieNeu-TTS
                      </span>
                      <span className="font-semibold text-slate-400">
                        {voices.filter(v => v.engine === 'vieneu').length} giọng
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Voices List Card */}
            <div className="bg-[#161922] border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Mic size={16} className="text-indigo-400" />
                      <span>Kho Giọng Đọc</span>
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-[11px]">
                      {enabledVoiceIds.length} / {voices.length} giọng
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Bật / tắt các giọng hiển thị trong Studio
                  </p>
                </div>

                {/* Gender Filters */}
                <div className="flex items-center gap-2 flex-wrap">

                  {/* Gender Filters */}
                  <div className="flex items-center gap-1 bg-[#10131d] p-1 border border-slate-800 rounded-xl text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedGender('all')}
                      className={`px-2.5 py-1 rounded-lg transition font-medium cursor-pointer ${
                        selectedGender === 'all'
                          ? 'bg-slate-700 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Tất cả
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedGender('Female')}
                      className={`px-2.5 py-1 rounded-lg transition font-medium cursor-pointer flex items-center gap-1.5 ${
                        selectedGender === 'Female'
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-rose-300'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                      <span>Nữ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedGender('Male')}
                      className={`px-2.5 py-1 rounded-lg transition font-medium cursor-pointer flex items-center gap-1.5 ${
                        selectedGender === 'Male'
                          ? 'bg-sky-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-sky-300'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                      <span>Nam</span>
                    </button>
                  </div>
                </div>
              </div>

              {(() => {
                const filtered = voices
                  .filter((v) => {
                    if (selectedEngine === 'custom') return !!v.is_custom;
                    if (selectedEngine === 'gemini') return v.engine === 'gemini';
                    if (selectedEngine !== 'all') return v.engine === selectedEngine && !v.is_custom;
                    return true;
                  })
                  .filter((v) => selectedGender === 'all' || v.gender === selectedGender);

                const femaleList = filtered.filter((v) => v.gender === 'Female');
                const maleList = filtered.filter((v) => v.gender === 'Male');

                const renderVoiceItem = (v: TtsVoiceItem) => {
                  const isPlaying = playingVoiceId === v.id;
                  const isLoading = loadingVoiceId === v.id;
                  const isSelected = selectedVoice === v.id;
                  const isEnabled = enabledVoiceIds.includes(v.id);

                  return (
                    <div
                      key={v.id}
                      className={`px-5 py-3 flex items-center justify-between gap-3 transition ${
                        isSelected
                          ? 'bg-indigo-600/5'
                          : isEnabled
                          ? 'hover:bg-[#191d29]'
                          : 'opacity-60 bg-[#10121a]/60 hover:opacity-90'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => handlePlayVoicePreview(v.id)}
                          disabled={isLoading}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition shadow-sm shrink-0 cursor-pointer ${
                            isPlaying
                              ? 'bg-amber-500 text-black animate-pulse'
                              : v.is_custom
                              ? 'bg-gradient-to-br from-rose-500 to-pink-600 text-white'
                              : v.engine === 'gemini'
                              ? 'bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-bold'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          }`}
                          title={isPlaying ? 'Dừng phát' : 'Nghe thử mẫu giọng'}
                        >
                          {isLoading ? (
                            <RefreshCw size={13} className="animate-spin text-white" />
                          ) : isPlaying ? (
                            <Square size={13} className="fill-current" />
                          ) : (
                            <Play size={13} className="fill-current ml-0.5" />
                          )}
                        </button>

                        <div className="min-w-0 flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-200">
                            {v.name}
                          </span>

                          {/* Engine Tag */}
                          {v.is_custom ? (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold border bg-rose-500/15 border-rose-500/30 text-rose-300">
                              Clone
                            </span>
                          ) : (
                            <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold border ${getEngineDisplay(v.engine).badgeClass}`}>
                              {getEngineDisplay(v.engine).label}
                            </span>
                          )}

                          {/* Region Tag */}
                          <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 text-[10px] font-medium">
                            {v.region}
                          </span>

                          {/* Visibility Tag */}
                          {isEnabled ? (
                            <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold flex items-center gap-0.5">
                              <Check size={9} className="stroke-[3]" />
                              <span>Hiện</span>
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.2 rounded bg-slate-800/80 text-slate-500 border border-slate-700/60 text-[10px] font-medium flex items-center gap-0.5">
                              <EyeOff size={9} />
                              <span>Ẩn</span>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {/* Toggle Export Button */}
                        <button
                          type="button"
                          onClick={() => handleToggleVoiceVisibility(v.id)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                            isEnabled
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                              : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                          title={isEnabled ? 'Bấm để ẩn giọng này' : 'Bấm để hiện giọng này'}
                        >
                          {isEnabled ? (
                            <>
                              <CheckCircle2 size={12} className="text-emerald-400" />
                              <span>Đang hiện</span>
                            </>
                          ) : (
                            <>
                              <EyeOff size={12} />
                              <span>Đang ẩn</span>
                            </>
                          )}
                        </button>

                        {v.is_custom && (
                          <button
                            type="button"
                            onClick={() => promptDeleteCustomVoice(v)}
                            className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/15 transition cursor-pointer"
                            title="Xóa giọng nhân bản này"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleSetDefaultVoice(v.id)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                            isSelected
                              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                          }`}
                        >
                          {isSelected ? 'Mặc định' : 'Đặt mặc định'}
                        </button>
                      </div>
                    </div>
                  );
                };

                return (
                  <div className="divide-y divide-slate-800/60">
                    {/* FEMALE VOICES SECTION */}
                    {femaleList.length > 0 && (
                      <div>
                        {selectedGender === 'all' && (
                          <div className="px-5 py-2 bg-[#12151f] border-b border-slate-800/80 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.6)]" />
                              <span className="text-xs font-bold text-rose-300 uppercase tracking-wider">
                                Giọng Nữ
                              </span>
                              <span className="px-1.5 py-0.2 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[10px] font-medium">
                                {femaleList.length}
                              </span>
                            </div>
                          </div>
                        )}
                        <div className="divide-y divide-slate-800/60">
                          {femaleList.map(renderVoiceItem)}
                        </div>
                      </div>
                    )}

                    {/* MALE VOICES SECTION */}
                    {maleList.length > 0 && (
                      <div>
                        {selectedGender === 'all' && (
                          <div className="px-5 py-2 bg-[#12151f] border-b border-t border-slate-800/80 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
                              <span className="text-xs font-bold text-sky-300 uppercase tracking-wider">
                                Giọng Nam
                              </span>
                              <span className="px-1.5 py-0.2 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-medium">
                                {maleList.length}
                              </span>
                            </div>
                          </div>
                        )}
                        <div className="divide-y divide-slate-800/60">
                          {maleList.map(renderVoiceItem)}
                        </div>
                      </div>
                    )}

                    {filtered.length === 0 && (
                      <div className="py-12 text-center text-xs text-slate-500">
                        Không tìm thấy giọng đọc phù hợp với bộ lọc hiện tại
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* TAB 3: TIKTOK CHANNELS */}
        {activeTab === 'tiktok' && (
          <div className="space-y-4">
            <div className="bg-[#161922] border border-slate-800 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Share2 size={15} className="text-pink-400" />
                    <span>Tài khoản TikTok đăng bài</span>
                  </h3>
                  <p className="text-[11.5px] text-slate-400 mt-0.5">
                    Quản lý tài khoản xuất bản và phạm vi video phụ trách
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddTiktokChannel}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                >
                  <Plus size={13} />
                  <span>Thêm tài khoản</span>
                </button>
              </div>

              {loadingTiktokChannels ? (
                <div className="py-12 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
                  <RefreshCw size={15} className="animate-spin text-indigo-400" />
                  <span>Đang tải danh sách...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {tiktokChannels.map((ch) => (
                    <TiktokChannelCard
                      key={ch.id}
                      channel={ch}
                      libraryChannels={libraryChannels}
                      categories={categories}
                      isSaving={savingChannelId === ch.id}
                      onSave={handleUpdateTiktokChannel}
                      onDelete={handleDeleteTiktokChannel}
                      onOpenLogin={handleOpenTikTokLogin}
                      onLogout={handleLogoutTikTok}
                      onCheckStatus={handleCheckTikTokStatus}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ChannelCardProps {
  channel: {
    id: number;
    name: string;
    username?: string;
    platform_source: string;
    status?: string;
    is_active?: boolean;
    publish_headless?: boolean;
    time_slots?: string[];
    is_logged_in?: boolean;
    avatar_url?: string;
    is_logging_in?: boolean;
    linked_channel_ids?: number[];
    linked_category_ids?: number[];
  };
  libraryChannels: { id: number; name: string }[];
  categories: { id: number; name: string }[];
  isSaving: boolean;
  onSave: (
    id: number,
    name: string,
    username: string,
    linked_channel_ids?: number[],
    linked_category_ids?: number[],
    publish_headless?: boolean
  ) => Promise<void>;
  onDelete: (id: number, name: string) => void;
  onOpenLogin: (id: number) => void;
  onLogout: (id: number) => void;
  onCheckStatus: (id: number) => void;
}

function TiktokChannelCard({
  channel,
  libraryChannels,
  categories,
  isSaving,
  onSave,
  onDelete,
  onOpenLogin,
  onLogout,
  onCheckStatus,
}: ChannelCardProps) {
  const [name, setName] = useState(channel.name);
  const [username, setUsername] = useState(channel.username || '');
  const [linkedChannelIds, setLinkedChannelIds] = useState<number[]>(channel.linked_channel_ids || []);
  const [linkedCategoryIds, setLinkedCategoryIds] = useState<number[]>(channel.linked_category_ids || []);
  const [publishHeadless, setPublishHeadless] = useState(channel.publish_headless !== false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setName(channel.name);
    setUsername(channel.username || '');
    setLinkedChannelIds(channel.linked_channel_ids || []);
    setLinkedCategoryIds(channel.linked_category_ids || []);
    setPublishHeadless(channel.publish_headless !== false);
    setHasChanges(false);
  }, [channel]);

  const toggleChannel = (id: number) => {
    const next = linkedChannelIds.includes(id)
      ? linkedChannelIds.filter((x) => x !== id)
      : [...linkedChannelIds, id];
    setLinkedChannelIds(next);
    onSave(channel.id, name, username, next, linkedCategoryIds, publishHeadless);
  };

  const toggleCategory = (id: number) => {
    const next = linkedCategoryIds.includes(id)
      ? linkedCategoryIds.filter((x) => x !== id)
      : [...linkedCategoryIds, id];
    setLinkedCategoryIds(next);
    onSave(channel.id, name, username, linkedChannelIds, next, publishHeadless);
  };

  const handleSave = () => {
    onSave(channel.id, name, username, linkedChannelIds, linkedCategoryIds, publishHeadless);
    setHasChanges(false);
  };

  return (
    <div className="p-3.5 rounded-2xl bg-[#12151e] border border-slate-800/80 flex flex-col justify-between space-y-3 hover:border-slate-700/80 transition">
      <div className="space-y-2.5">
        {/* Header kênh */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-pink-400 bg-pink-950/40 border border-pink-500/25 px-2 py-0.5 rounded">
              #{channel.id}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full border text-[10px] font-medium flex items-center gap-1.5 ${
                channel.is_logged_in
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-950/40 text-amber-400 border-amber-500/30'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  channel.is_logged_in ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              <span>{channel.is_logged_in ? 'Đã kết nối' : 'Chưa kết nối'}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => onDelete(channel.id, name)}
            className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
            title="Xóa kênh"
          >
            <Trash2 size={13} />
          </button>
        </div>

        {/* Khối Kết Nối */}
        <div
          className={`p-2 rounded-xl border ${
            channel.is_logged_in
              ? 'bg-emerald-950/15 border-emerald-500/20'
              : 'bg-slate-900/50 border-slate-800'
          }`}
        >
          {channel.is_logged_in ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 overflow-hidden min-w-0">
                {channel.avatar_url ? (
                  <img
                    src={channel.avatar_url}
                    alt="avatar"
                    className="w-5 h-5 rounded-full object-cover border border-emerald-500/40 shrink-0"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-emerald-900/60 flex items-center justify-center text-[9px] font-bold text-emerald-300 shrink-0">
                    TT
                  </div>
                )}
                <span className="text-xs font-mono text-emerald-300 truncate font-medium">
                  {channel.username || `@kenh_${channel.id}`}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onOpenLogin(channel.id)}
                  className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium transition cursor-pointer"
                >
                  Đăng nhập lại
                </button>
                <button
                  type="button"
                  onClick={() => onLogout(channel.id)}
                  className="px-2 py-0.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/30 text-[10px] font-medium transition cursor-pointer"
                >
                  Đăng xuất
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onOpenLogin(channel.id)}
                className="flex-1 py-1 px-2.5 rounded-lg bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white text-[11px] font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <ExternalLink size={12} />
                <span>Đăng nhập (Quét QR)</span>
              </button>
              <button
                type="button"
                onClick={() => onCheckStatus(channel.id)}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
                title="Kiểm tra trạng thái"
              >
                <RefreshCw size={11} />
              </button>
            </div>
          )}
        </div>

        {/* Tùy chọn Đăng ngầm */}
        <div className="flex items-center justify-between p-2 rounded-xl bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className={publishHeadless ? 'text-emerald-400' : 'text-slate-500'} />
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-slate-200">Đăng ngầm trong nền</span>
              <span className="text-[9.5px] text-slate-500">Không mở cửa sổ trình duyệt</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !publishHeadless;
              setPublishHeadless(next);
              onSave(channel.id, name, username, linkedChannelIds, linkedCategoryIds, next);
            }}
            className="cursor-pointer transition"
            title={publishHeadless ? 'Đang bật đăng ngầm (Bấm để chuyển sang mở cửa sổ)' : 'Đang mở cửa sổ (Bấm để chuyển sang đăng ngầm)'}
          >
            {publishHeadless ? (
              <ToggleRight size={24} className="text-emerald-400" />
            ) : (
              <ToggleLeft size={24} className="text-slate-600" />
            )}
          </button>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-medium text-slate-400 block mb-0.5">Tên kênh</label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setHasChanges(true);
              }}
              placeholder="Tên kênh..."
              className="w-full px-2 py-1 bg-[#0a0c13] border border-slate-800 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-[10px] font-medium text-slate-400 block mb-0.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setHasChanges(true);
              }}
              placeholder="@username"
              className="w-full px-2 py-1 bg-[#0a0c13] border border-slate-800 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Nguồn Video Được Phép Đăng */}
        <div className="bg-slate-900/30 rounded-xl p-2.5 border border-slate-800/60 space-y-2">
          <div className="flex items-center justify-between text-[10.5px]">
            <span className="font-medium text-slate-400">Nguồn video:</span>
            <span className="text-[10px] text-slate-500">
              {linkedChannelIds.length === 0 && linkedCategoryIds.length === 0 ? 'Tất cả' : 'Đã lọc'}
            </span>
          </div>

          {/* Kênh nguồn */}
          {libraryChannels.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-cyan-400/80 block">Kênh</span>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {libraryChannels.map((c) => {
                  const isChecked = linkedChannelIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleChannel(c.id)}
                      className={`px-2 py-0.5 rounded text-[10px] transition flex items-center gap-1 cursor-pointer border ${
                        isChecked
                          ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40 font-medium'
                          : 'bg-slate-900/60 text-slate-500 border-slate-800/80 hover:text-slate-300'
                      }`}
                    >
                      {isChecked ? <CheckSquare size={10} className="text-cyan-400" /> : <Square size={10} />}
                      <span>{c.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Danh mục */}
          {categories.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-amber-400/80 block">Danh mục</span>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {categories.map((cat) => {
                  const isChecked = linkedCategoryIds.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => toggleCategory(cat.id)}
                      className={`px-2 py-0.5 rounded text-[10px] transition flex items-center gap-1 cursor-pointer border ${
                        isChecked
                          ? 'bg-amber-600/20 text-amber-300 border-amber-500/40 font-medium'
                          : 'bg-slate-900/60 text-slate-500 border-slate-800/80 hover:text-slate-300'
                      }`}
                    >
                      {isChecked ? <CheckSquare size={10} className="text-amber-400" /> : <Square size={10} />}
                      <span>{cat.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Nút lưu khi có thay đổi */}
      {hasChanges && (
        <button
          type="button"
          disabled={isSaving}
          onClick={handleSave}
          className="w-full py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/25 transition cursor-pointer"
        >
          {isSaving ? (
            <>
              <RefreshCw size={11} className="animate-spin" />
              <span>Đang lưu...</span>
            </>
          ) : (
            <>
              <Save size={11} />
              <span>Lưu thay đổi</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
