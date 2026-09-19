export interface CustomAiStyle {
  id: string;
  name: string;
  desc: string;
  prompt: string;
  color?: string;
}

export interface LocalizeSettings {
  recognitionMode: 'voice_only' | 'ocr_only' | 'ai_vision';
  aiStyle: string;
  customAiPrompt?: string;
  customAiStyles?: CustomAiStyle[];
  voiceId: string;
  voiceSpeed: number;
  syncMode: 'keep_duration' | 'hybrid';
  aiVoiceVolume: number;
  keepOriginalAudio: boolean;
  bgmVolume: number;
  originalVoiceVolume: number;
  coverOldSub: boolean;
  blurAmount: number;
  blurMethod: 'blur' | 'inpaint';
  showSubtitles: boolean;
  subPositionMode: 'by_original' | 'by_height';
  subPlacement: 'overlay' | 'above' | 'below';
  autoFitSubSize: boolean;
  subPositionPercent: number;
  subFont: string;
  subFontSize: number;
  subTextColor: string;
  subBgColor: string;
  subBgOpacity: number;
  subStyleType: 'box' | 'outline' | 'shadow' | 'basic';
  subBold: boolean;
  subItalic: boolean;
  subMarginV: number;
  previewSubText: string;
  phoneMockup: 'iphone16' | 'iphone_notch' | 'android_s24' | 'frameless';
  showSafeZone: boolean;
  dictionaryEntries: { original: string; replacement: string }[];
}

export const DEFAULT_LOCALIZE_SETTINGS: LocalizeSettings = {
  recognitionMode: 'voice_only',
  aiStyle: 'chuan_goc',
  customAiPrompt: '',
  customAiStyles: [],
  voiceId: 'vi-VN-NamMinhNeural',
  voiceSpeed: 1.0,
  syncMode: 'hybrid',
  aiVoiceVolume: 100,
  keepOriginalAudio: true,
  bgmVolume: 18,
  originalVoiceVolume: 0,
  coverOldSub: false,
  blurAmount: 25,
  blurMethod: 'blur',
  showSubtitles: true,
  subPositionMode: 'by_height',
  subPlacement: 'overlay',
  autoFitSubSize: true,
  subPositionPercent: 25,
  subFont: 'Oswald',
  subFontSize: 36,
  subTextColor: '#FFFFFF',
  subBgColor: '#000000',
  subBgOpacity: 65,
  subStyleType: 'box',
  subBold: true,
  subItalic: false,
  subMarginV: 25,
  previewSubText: 'Nếu tôi thắng thì thả anh em tôi ra.',
  phoneMockup: 'iphone16',
  showSafeZone: false,
  dictionaryEntries: [
    { original: 'TikTok', replacement: 'Tíc Tốc' },
    { original: 'Affiliate', replacement: 'A-phi-li-ết' },
  ],
};

export const AI_STYLES = [
  {
    id: 'chuan_goc',
    name: 'Bám sát lời thoại gốc (Chuẩn 1:1)',
    desc: 'Dịch sát 100% từng câu thoại nhân vật như GenSubAI/CapCut, giữ nguyên cảm xúc, không chế lời',
    color: 'text-emerald-400',
  },
  {
    id: 'bán hàng',
    name: 'Bán hàng / Chốt đơn',
    desc: 'Nêu bật công năng, kích thích mua sắm & kêu gọi chốt đơn TikTok Shop',
    color: 'text-orange-400',
  },
  {
    id: 'đời thường',
    name: 'Đời thường / Tự nhiên',
    desc: 'Ngôn từ gần gũi, như bạn bè trò chuyện, tối ưu cho video mẹo vặt, gia dụng',
    color: 'text-sky-400',
  },
  {
    id: 'review phim',
    name: 'Review phim / Kịch tính',
    desc: 'Dẫn dắt gay cấn, tiết tấu dồn dập, hồi hộp, bám sát hành động nhân vật',
    color: 'text-purple-400',
  },
  {
    id: 'hoạt hình',
    name: 'Phim AI / Hoạt hình',
    desc: 'Thế giới tưởng tượng, nhân vật sinh động, hóm hỉnh, tối ưu cho video AI Sora/3D',
    color: 'text-cyan-400',
  },
  {
    id: 'hài hước',
    name: 'Hài hước / Bắt trend',
    desc: 'Dí dỏm, bắt trend TikTok, tăng tỉ lệ giữ chân người xem',
    color: 'text-amber-400',
  },
  {
    id: 'kể chuyện',
    name: 'Kể chuyện / Cảm xúc',
    desc: 'Giọng văn truyền cảm, sâu lắng, phù hợp video phong cách sống',
    color: 'text-rose-400',
  },
  {
    id: 'chuyên gia',
    name: 'Đánh giá chuyên sâu',
    desc: 'Khách quan, gãy gọn, phân tích ưu nhược điểm sản phẩm',
    color: 'text-emerald-400',
  },
  {
    id: 'nhân vật',
    name: 'Lồng tiếng nhân vật',
    desc: 'Hóa thân trực tiếp thành nhân vật trong video (ngôi thứ nhất), không dùng giọng người dẫn chuyện',
    color: 'text-pink-400',
  },
];
