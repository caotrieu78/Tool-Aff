/** Base API URL for the FastAPI backend */
const getBaseUrl = () => {
  // window.BACKEND_PORT is set by Electron main process via executeJavaScript
  const port = (window as any).BACKEND_PORT ?? 8765;
  return `http://127.0.0.1:${port}/api`;
};

export const API_BASE = getBaseUrl();

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API ${path} failed (${res.status}): ${error}`);
  }
  return res.json();
}

// ── Library ─────────────────────────────────────────────────────────────────
export const libraryApi = {
  getVideos: (params?: Record<string, string | number>) => {
    const cleanParams: Record<string, string> = {};
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          cleanParams[k] = String(v);
        }
      });
    }
    const qs = new URLSearchParams(cleanParams).toString();
    return request<{ total: number; page: number; limit: number; videos: any[] }>(`/library/videos${qs ? '?' + qs : ''}`);
  },
  deleteVideo: (id: number) => request<{ success: boolean; message: string }>(`/library/videos/${id}`, { method: 'DELETE' }),
  bulkDeleteVideos: (videoIds: number[]) =>
    request<{ success: boolean; deleted_count: number; deleted_ids: number[]; message: string }>('/library/videos/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ video_ids: videoIds }),
    }),
  updateRecognitionType: (id: number, recognition_type: string) =>
    request<{ success: boolean; video_id: number; recognition_type: string }>(`/library/videos/${id}/recognition-type`, {
      method: 'PUT',
      body: JSON.stringify({ recognition_type }),
    }),
  importVideos: async (formData: FormData) => {
    const res = await fetch(`${API_BASE}/library/import`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Import failed (${res.status}): ${error}`);
    }
    return res.json();
  },
  getChannels: () => request<{ channels: { id: number; name: string; platform_source: string }[] }>('/library/channels'),
  createChannel: (body: { name: string; platform_source?: string }) =>
    request<{ id: number; name: string; platform_source: string }>('/library/channels', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteChannel: (id: number) => request<{ success: boolean }>(`/library/channels/${id}`, { method: 'DELETE' }),
  getCategories: () => request<{ categories: { id: number; name: string; parent_id: number | null }[] }>('/library/categories'),
  createCategory: (body: { name: string; parent_id?: number | null }) =>
    request<{ id: number; name: string; parent_id: number | null }>('/library/categories', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteCategory: (id: number) => request<{ success: boolean }>(`/library/categories/${id}`, { method: 'DELETE' }),
  getMediaUrl: (path?: string) => {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    let cleanPath = path;
    if (cleanPath.startsWith('/api/storage/library/')) {
      cleanPath = cleanPath.replace('/api/storage/library/', '/api/storage/');
    }
    const base = API_BASE.replace(/\/api$/, '');
    return `${base}${cleanPath}`;
  },
};

// ── Jobs ─────────────────────────────────────────────────────────────────────
export const jobsApi = {
  list: (params?: { status?: string; video_id?: number }) =>
    request<any>('/jobs/?' + new URLSearchParams(params as any).toString()),
  get: (id: number) => request<any>(`/jobs/${id}`),
  cancel: (id: number) => request<any>(`/jobs/${id}/cancel`, { method: 'DELETE' }),
};

// ── Localize ─────────────────────────────────────────────────────────────────
export const localizeApi = {
  submit: (body: {
    video_id: number;
    ai_style?: string;
    voice_id?: string;
    voice_speed?: number;
    sync_mode?: string;
    volume_voiceover?: number;
    keep_original_audio?: boolean;
    volume_original?: number;
    volume_original_voice?: number;
    cover_old_subtitle?: boolean;
    blur_amount?: number;
    blur_method?: string;
    show_subtitles?: boolean;
    sub_position_mode?: string;
    sub_placement?: string;
    auto_fit_sub_size?: boolean;
    sub_position_percent?: number;
    sub_font?: string;
    sub_font_size?: number;
    sub_color?: string;
    sub_bg_color?: string;
    sub_bg_opacity?: number;
    sub_style_type?: string;
    sub_bold?: boolean;
    sub_italic?: boolean;
    sub_margin_v?: number;
    pronunciation_dict?: Record<string, string>;
    recognition_mode?: string;
  }) => request<{ success: boolean; job_id: number; status: string }>('/localize/submit', { method: 'POST', body: JSON.stringify(body) }),
  getStatus: (jobId: number) =>
    request<{
      job_id: number;
      video_id: number;
      module: string;
      current_step: string;
      status: string;
      progress_percent: number;
      error_log?: string | null;
      output_url?: string | null;
      created_at?: string;
      finished_at?: string;
    }>(`/localize/jobs/${jobId}/status`),
  getTranscript: (jobId: number) => request<{ job_id: number; transcript: any[] }>(`/localize/jobs/${jobId}/transcript`),
  getRecent: () => request<{ jobs: any[] }>('/localize/recent'),
  getEditorData: (videoId: number) =>
    request<{
      success: boolean;
      video: {
        id: number;
        title: string;
        source_url?: string;
        video_path?: string;
        localized_video_path?: string;
        original_video_url?: string;
        localized_video_url?: string;
        duration?: number;
      };
      segments: Array<{
        start: number;
        end: number;
        text_zh: string;
        text_vi: string;
      }>;
      config: Record<string, any>;
      job_id?: number;
    }>(`/localize/editor/${videoId}`),
  reRenderEditor: (
    videoId: number,
    body: {
      segments: Array<{ start: number; end: number; text_zh?: string; text_vi: string }>;
      config: Record<string, any>;
      re_synthesize_tts?: boolean;
    }
  ) =>
    request<{
      success: boolean;
      message: string;
      video_id: number;
      localized_video_url: string;
      video_url?: string;
    }>(`/localize/editor/${videoId}/re-render`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Presets & Categories
  getPresets: () =>
    request<{
      presets: LocalizePreset[];
      grouped: Record<string, LocalizePreset[]>;
      categories: string[];
    }>('/localize/presets'),
  getCategories: () => request<{ categories: string[] }>('/localize/categories'),
  createPreset: (body: {
    name: string;
    category?: string;
    description?: string;
    is_default?: boolean;
    settings: Record<string, any>;
  }) =>
    request<{ success: boolean; preset: LocalizePreset }>('/localize/presets', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updatePreset: (
    id: number,
    body: {
      name?: string;
      category?: string;
      description?: string;
      is_default?: boolean;
      settings?: Record<string, any>;
    }
  ) =>
    request<{ success: boolean; preset: LocalizePreset }>(`/localize/presets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deletePreset: (id: number) =>
    request<{ success: boolean; message: string }>(`/localize/presets/${id}`, {
      method: 'DELETE',
    }),
  duplicatePreset: (id: number) =>
    request<{ success: boolean; preset: LocalizePreset }>(`/localize/presets/${id}/duplicate`, {
      method: 'POST',
    }),
  setDefaultPreset: (id: number) =>
    request<{ success: boolean; preset: LocalizePreset }>(`/localize/presets/${id}/set-default`, {
      method: 'POST',
    }),
};

export interface LocalizePreset {
  id: number;
  category: string;
  name: string;
  description?: string | null;
  is_default: boolean;
  settings: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}


// ── Settings ─────────────────────────────────────────────────────────────────
export const settingsApi = {
  getGeminiKeys: () =>
    request<{
      keys: {
        id: number;
        label: string;
        provider?: 'google' | 'kie' | string;
        preferred_model?: string;
        is_default?: boolean;
        masked_key: string;
        daily_quota_used: number;
        daily_quota_limit: number;
        status: string;
        is_active: boolean;
        last_used_at?: string;
        created_at?: string;
      }[];
    }>('/settings/gemini-keys'),
  addGeminiKey: (body: { api_key: string; label: string; provider?: string; preferred_model?: string }) =>
    request<{ success: boolean; key: any; latency_ms: number }>('/settings/gemini-keys', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateKeyModel: (id: number, preferred_model: string) =>
    request<{ success: boolean; key_id: number; preferred_model: string; message: string }>(
      `/settings/gemini-keys/${id}/model`,
      {
        method: 'PATCH',
        body: JSON.stringify({ preferred_model }),
      }
    ),
  setDefaultGeminiKey: (id: number) =>
    request<{ success: boolean; message: string; key_id: number }>(`/settings/gemini-keys/${id}/default`, {
      method: 'POST',
    }),
  testGeminiKey: (id: number) =>
    request<{ valid: boolean; provider?: string; latency_ms: number; message: string; reply?: string }>(
      `/settings/gemini-keys/${id}/test`,
      { method: 'POST' }
    ),
  testAllGeminiKeys: () =>
    request<{
      success: boolean;
      total: number;
      active_count: number;
      results: { id: number; label: string; valid: boolean; status: string; message: string; latency_ms: number }[];
    }>('/settings/gemini-keys/test-all', { method: 'POST' }),
  testRawGeminiKey: (body: { api_key: string; provider?: string; model_name?: string }) =>
    request<{ valid: boolean; provider?: string; latency_ms: number; message: string; reply?: string }>(
      '/settings/gemini-keys/test-raw',
      { method: 'POST', body: JSON.stringify(body) }
    ),
  deleteGeminiKey: (id: number) =>
    request<{ success: boolean; message: string }>(`/settings/gemini-keys/${id}`, { method: 'DELETE' }),
  getKieCredit: (id: number) =>
    request<{ success: boolean; credit: number | null; error?: string }>(`/settings/gemini-keys/${id}/kie-credit`),
  getTtsVoices: () =>
    request<{
      voices: {
        id: string;
        name: string;
        gender: string;
        region: string;
        description: string;
        engine: string;
        is_default: boolean;
      }[];
    }>('/settings/tts-voices'),
  getTtsPreview: async (voiceId: string) => {
    const res = await request<{ voice_id: string; audio_url: string }>(`/settings/tts-preview/${voiceId}`);
    return {
      ...res,
      audio_url: libraryApi.getMediaUrl(res.audio_url),
    };
  },
  createCustomVoice: async (formData: FormData) => {
    const port = (window as any).BACKEND_PORT ?? 8765;
    const res = await fetch(`http://127.0.0.1:${port}/api/settings/custom-voices`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Lỗi tải lên giọng' }));
      throw new Error(err.detail || 'Không thể tạo giọng nhân bản');
    }
    return res.json();
  },
  deleteCustomVoice: (voiceId: string) =>
    request<{ success: boolean; message: string }>(`/settings/custom-voices/${voiceId}`, {
      method: 'DELETE',
    }),
  getScheduleTemplates: () => request<any>('/settings/schedule-templates'),
  updateScheduleTemplate: (channelId: number, body: any) =>
    request<any>(`/settings/schedule-templates/${channelId}`, { method: 'PUT', body: JSON.stringify(body) }),
  getTikTokOAuthUrl: (channelId: number) => request<any>(`/settings/tiktok/oauth-url/${channelId}`),
  getTikTokChannels: () =>
    request<{
      channels: {
        id: number;
        name: string;
        username?: string;
        platform_source: string;
        status?: string;
        is_active?: boolean;
        time_slots?: string[];
      }[];
    }>('/settings/tiktok-channels'),
  createTikTokChannel: (body: { name: string; username?: string; time_slots?: string[]; publish_headless?: boolean }) =>
    request<{ success: boolean; channel: any }>('/settings/tiktok-channels', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateTikTokChannel: (channelId: number, body: { name?: string; username?: string; time_slots?: string[]; is_active?: boolean; publish_headless?: boolean; linked_channel_ids?: number[]; linked_category_ids?: number[] }) =>
    request<{ success: boolean; channel: any }>(`/settings/tiktok-channels/${channelId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteTikTokChannel: (channelId: number) =>
    request<{ success: boolean; message: string }>(`/settings/tiktok-channels/${channelId}`, {
      method: 'DELETE',
    }),
};

// ── Editor & Scheduler ──────────────────────────────────────────────────────
export const editorApi = {
  saveFinal: (id: number) =>
    request<{ status: string; message: string; final_url?: string; is_new_video?: boolean; video_id?: number }>(
      `/editor/video/${id}/save-final`,
      { method: "POST" }
    ),
  getVideos: () => request<{ videos: any[] }>('/editor/videos'),
  getVideoDetail: (id: number) => request<any>(`/editor/video/${id}`),
  reRenderSubtitles: (id: number, segments: any[]) =>
    request<any>(`/editor/video/${id}/re-render`, {
      method: 'POST',
      body: JSON.stringify({ segments }),
    }),
  generateCaption: (id: number, include_hashtags: boolean, style: string = 'short', custom_prompt?: string) =>
    request<any>(`/editor/video/${id}/generate-caption`, {
      method: 'POST',
      body: JSON.stringify({ include_hashtags, style, custom_prompt }),
    }),
  batchGenerateCaptions: (video_ids: number[], include_hashtags: boolean, style: string = 'short', custom_prompt?: string) =>
    request<any>('/editor/batch-generate-captions', {
      method: 'POST',
      body: JSON.stringify({ video_ids, include_hashtags, style, custom_prompt }),
    }),
  saveAndSchedule: (id: number, body: any) =>
    request<any>(`/editor/video/${id}/save-and-schedule`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateCaption: (id: number, caption: string, hashtags: string[]) =>
    request<{ status: string; message: string; caption: string; hashtags: string[] }>(`/editor/video/${id}/caption`, {
      method: 'PUT',
      body: JSON.stringify({ caption, hashtags }),
    }),
};

// ── Publish / Scheduler ─────────────────────────────────────────────────────
export const publishApi = {
  getOverview: () =>
    request<{
      ready_videos: any[];
      scheduled_items: any[];
      channels: { id: number; name: string; platform_source: string }[];
      categories?: { id: number; name: string }[];
      stats: {
        total_ready: number;
        total_scheduled: number;
        total_channels: number;
      };
    }>('/publish/overview'),
  scheduleVideo: (body: {
    video_id: number;
    channel_ids?: number[];
    scheduled_time?: string | null;
    caption?: string;
    hashtags?: string[];
  }) =>
    request<{ status: string; message: string; count: number; base_scheduled_time: string }>('/publish/schedule', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  batchSchedule: (body: {
    video_ids: number[];
    channel_ids?: number[];
    start_time?: string | null;
    interval_hours?: number;
    use_golden_slots?: boolean;
  }) =>
    request<{ status: string; message: string; video_count: number; total_slots: number }>('/publish/batch-schedule', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteSchedule: (scheduleId: number) =>
    request<{ success: boolean; message: string }>(`/publish/schedule/${scheduleId}`, {
      method: 'DELETE',
    }),
  updateSchedule: (
    scheduleId: number,
    body: {
      scheduled_time?: string;
      caption?: string;
      hashtags?: string[];
      status?: string;
    }
  ) =>
    request<{ success: boolean; message: string }>(`/publish/schedule/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getChannelLoginStatus: (channelId: number) =>
    request<{
      channel_id: number;
      is_logged_in: boolean;
      username: string;
      avatar_url: string;
      is_logging_in?: boolean;
    }>(`/publish/channels/${channelId}/status`),
  openChannelLogin: (channelId: number) =>
    request<{ status: string; message: string }>(`/publish/channels/${channelId}/open-login`, {
      method: 'POST',
    }),
  logoutChannel: (channelId: number) =>
    request<{ success: boolean; message: string }>(`/publish/channels/${channelId}/logout`, {
      method: 'POST',
    }),
  postScheduleNow: (scheduleId: number, headless?: boolean) =>
    request<{ success: boolean; status: string; message?: string; error?: string }>(
      `/publish/schedule/${scheduleId}/post-now${headless !== undefined ? `?headless=${headless}` : ''}`,
      {
        method: 'POST',
      }
    ),
};

// ── Affiliate Studio (Module 2) ─────────────────────────────────────────────
export const affiliateApi = {
  detectScenes: (body: { video_id: number; threshold?: number; auto_highlight?: boolean; top_n?: number }) =>
    request<{ video_id: number; total_scenes: number; scenes: any[] }>('/affiliate/detect-scenes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  scrapeProduct: (url: string) =>
    request<{
      url: string;
      platform: string;
      product_name: string;
      price: string;
      description: string;
      thumbnail_url: string;
      success: boolean;
      message: string;
    }>('/affiliate/scrape', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  submit: (body: any) =>
    request<{ status: string; job_id: number; video_id: number; message: string }>('/affiliate/submit', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  submitBulk: (body: any) =>
    request<{ status: string; count: number; jobs: { job_id: number; video_id: number; title: string }[]; message: string }>(
      '/affiliate/submit-bulk',
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    ),
  getJobStatus: (jobId: number) => request<any>(`/affiliate/job/${jobId}`),
  getVideoResult: (videoId: number) => request<{
    has_result: boolean;
    job_id?: number | null;
    output_url?: string | null;
    title?: string | null;
    caption?: string | null;
    hashtags?: string[];
    versions?: any[];
  }>(`/affiliate/video/${videoId}/result`),
};

// ── WebSocket for job progress ───────────────────────────────────────────────
export function connectJobWs(jobId: number, onMessage: (data: any) => void): WebSocket {
  const port = (window as any).BACKEND_PORT ?? 8765;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/jobs/ws/${jobId}`);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  return ws;
}

// ── License (Phase 5) ─────────────────────────────────────────────────────────
export interface LicenseStatus {
  is_valid: boolean;
  status: 'active' | 'not_activated' | 'blocked' | 'expired' | 'mismatch' | 'tampered' | 'offline_grace' | 'network_error' | 'revoked' | 'error';
  customer_name: string;
  expires_at: string;
  days_left: number;
  machine_id: string;
  license_key_masked: string;
  license_key_raw?: string;
  message: string;
  contact: string;
  // NOTE: google_sheet_id và license_server_url bị ẩn chủ động ở backend
  // Không bao giờ expose 2 field này ra frontend
}

export const licenseApi = {
  getStatus: (force = false) => request<LicenseStatus>(`/license/status${force ? '?force=true' : ''}`),
  getMachineId: () => request<{ machine_id: string }>('/license/machine-id'),
  activate: (key: string) =>
    request<{ success: boolean; message: string; customer_name: string; expires_at: string; days_left: number; machine_id: string }>(
      '/license/activate',
      {
        method: 'POST',
        body: JSON.stringify({ key }),
      }
    ),
  refresh: () => request<LicenseStatus>('/license/refresh', { method: 'POST' }),
  deactivate: () => request<{ success: boolean; message: string }>('/license/deactivate', { method: 'POST' }),
};



