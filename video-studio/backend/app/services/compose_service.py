import logging
import os
import re
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)


def format_srt_time(seconds: float) -> str:
    """Chuyển số giây float sang định dạng SRT timestamp: HH:MM:SS,mmm"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def format_ass_time(seconds: float) -> str:
    """Chuyển số giây float sang định dạng ASS timestamp: H:MM:SS.cc"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    centis = int(round((seconds - int(seconds)) * 100))
    if centis >= 100:
        centis = 99
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def srt_time_to_seconds(time_str: str) -> float:
    """Chuyển định dạng SRT timestamp HH:MM:SS,mmm thành số giây float."""
    time_str = time_str.strip().replace(",", ".")
    parts = time_str.split(":")
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    elif len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    return 0.0


def split_segment_into_cues(
    text: str,
    start: float,
    end: float,
    max_words: int = 10,
    max_chars: int = 44,
    min_words: int = 3,
) -> List[Dict[str, Any]]:
    """
    Chia nhỏ một đoạn phụ đề dài thành các câu/cụm ngắn gọn chuẩn TikTok (1-2 dòng).
    Tự động phân bổ mốc thời gian (start -> end) tỷ lệ thuận theo số từ/ký tự.
    """
    text = text.strip()
    words = text.split()
    total_dur = max(0.6, end - start)

    # Nếu câu đã ngắn gọn và số từ ít, giữ nguyên
    if len(words) <= max_words and len(text) <= max_chars:
        return [{"start": start, "end": end, "text": text}]

    # 1. Thử ngắt theo dấu câu chính: chấm, chấm phẩy, hai chấm, chấm than, hỏi chấm
    splits = []
    punct_parts = re.split(r"(?<=[.!?;:\n])\s+", text)
    if len(punct_parts) >= 2 and all(len(p.strip().split()) >= min_words for p in punct_parts):
        splits = [p.strip() for p in punct_parts if p.strip()]
    else:
        # Ngắt theo dấu phẩy thông minh (tránh tách rời từ mở đầu quá ngắn)
        comma_parts = re.split(r",\s+", text)
        if len(comma_parts) >= 2:
            grouped = []
            curr = ""
            for p in comma_parts:
                if not curr:
                    curr = p
                elif len(curr.split()) < min_words:
                    curr += ", " + p
                elif len(p.split()) < min_words:
                    curr += ", " + p
                else:
                    grouped.append(curr + ",")
                    curr = p
            if curr:
                grouped.append(curr)
            if len(grouped) >= 2 and all(len(g.split()) >= min_words for g in grouped):
                splits = grouped

    if not splits:
        # Thử ngắt theo liên từ thông dụng nếu câu dài
        for conj in [" rồi ", " và ", " nhưng ", " để ", " hoặc ", " khi ", " mà "]:
            if conj in text:
                idx = text.find(conj)
                left = text[:idx].strip()
                right = text[idx:].strip()
                if len(left.split()) >= min_words and len(right.split()) >= min_words:
                    splits = [left, right]
                    break

    # 2. Nếu không có dấu câu hoặc liên từ phù hợp, ngắt đôi tại khoảng trắng giữa câu
    if not splits:
        mid = len(words) // 2
        splits = [" ".join(words[:mid]), " ".join(words[mid:])]

    # Tính toán thời lượng tỉ lệ thuận theo số từ
    total_words = sum(max(1, len(s.split())) for s in splits)
    cues = []
    curr_start = start

    for i, part in enumerate(splits):
        p_words = max(1, len(part.split()))
        p_dur = total_dur * (p_words / total_words)
        p_end = round(curr_start + p_dur, 2)
        if i == len(splits) - 1:
            p_end = end

        # Nếu đoạn con vẫn quá dài (> max_words hoặc > max_chars), đệ quy chia tiếp
        if len(part.split()) > max_words or len(part) > max_chars:
            sub_cues = split_segment_into_cues(part, curr_start, p_end, max_words, max_chars, min_words)
            cues.extend(sub_cues)
        else:
            cues.append({"start": curr_start, "end": p_end, "text": part.rstrip(",")})

        curr_start = p_end

    return cues


def format_subtitle_text(text: str, max_chars: int = 36) -> str:
    r"""
    Format dòng chữ phụ đề cho video dọc:
    - Nếu câu có sẵn ngắt dòng (\n hoặc \N): giữ nguyên ngắt dòng của người dùng.
    - Nếu câu ngắn (<= 36 ký tự hoặc <= 5 từ): 1 dòng gọn gàng, không bị ngắt cụt.
    - Nếu câu dài hơn: ngắt tại dấu phẩy hoặc ngắt cân bằng giữa câu.
    - Đảm bảo phụ đề luôn tối đa 2 dòng.
    """
    text = text.strip()
    if "\\N" in text:
        return text
    if "\n" in text:
        return text.replace("\n", "\\N")
    if len(text) <= max_chars:
        return text

    words = text.split()
    if len(words) <= 5:
        return text

    # Tìm vị trí ngắt tại dấu phẩy nếu có
    if ", " in text:
        idx = text.find(", ")
        left = text[:idx + 1].strip()
        right = text[idx + 2:].strip()
        if len(left.split()) >= 2 and len(right.split()) >= 2:
            return f"{left}\\N{right}"

    # Ngắt cân bằng theo số từ gần giữa nhất
    mid = len(words) // 2
    part1 = " ".join(words[:mid])
    part2 = " ".join(words[mid:])
    return f"{part1}\\N{part2}"


def parse_srt_entries(srt_path: str) -> List[Dict[str, Any]]:
    """Phân tích các block từ file SRT thành danh sách dict."""
    if not os.path.exists(srt_path):
        return []
    with open(srt_path, "r", encoding="utf-8") as f:
        content = f.read()

    entries = []
    blocks = [b.strip() for b in content.split("\n\n") if b.strip()]
    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        if len(lines) >= 2:
            time_line = ""
            text_lines = []
            for line in lines:
                if "-->" in line:
                    time_line = line
                elif not line.isdigit() and time_line:
                    text_lines.append(line)
            if time_line:
                time_parts = time_line.split("-->")
                start_sec = srt_time_to_seconds(time_parts[0])
                end_sec = srt_time_to_seconds(time_parts[1])
                full_text = " ".join(text_lines)
                if full_text:
                    entries.append({"start": start_sec, "end": end_sec, "text": full_text})
    return entries


def make_ass_rounded_rect(w: int, h: int, r: int = 14) -> str:
    """Tạo vector path hình chữ nhật bo góc mềm mại cho ASS subtitle."""
    r = max(4, min(r, min(w, h) // 2))
    return (
        f"m {r} 0 "
        f"l {w - r} 0 "
        f"b {w} 0 {w} 0 {w} {r} "
        f"l {w} {h - r} "
        f"b {w} {h} {w} {h} {w - r} {h} "
        f"l {r} {h} "
        f"b 0 {h} 0 {h} 0 {h - r} "
        f"l 0 {r} "
        f"b 0 0 0 0 {r} 0"
    )


def get_pil_font(font_name: str, size: int):
    """Tìm font hệ thống tương ứng với font_name để đo kích thước chữ pixel chuẩn (macOS/Windows/Linux)."""
    windir = os.environ.get("WINDIR", r"C:\Windows")
    name_nospace = font_name.replace(" ", "")
    dirs = [
        # macOS
        "/System/Library/Fonts/Supplemental",
        "/System/Library/Fonts",
        "/Library/Fonts",
        os.path.expanduser("~/Library/Fonts"),
        # Windows
        f"{windir}\\Fonts",
        # Linux
        "/usr/share/fonts/truetype",
        "/usr/share/fonts",
        "/usr/local/share/fonts",
        os.path.expanduser("~/.local/share/fonts"),
        os.path.expanduser("~/.fonts"),
    ]
    exts = [".ttf", ".otf", ".ttc"]
    name_variants = [font_name, name_nospace, f"{font_name} Bold", f"{font_name}-Regular", f"{font_name}-Bold"]

    candidates = []
    for d in dirs:
        for n in name_variants:
            for ext in exts:
                candidates.append(os.path.join(d, f"{n}{ext}"))

    # Font dự phòng phổ biến của từng hệ điều hành nếu không tìm thấy font yêu cầu
    fallback_names = ["Arial", "arial", "DejaVuSans", "LiberationSans-Regular", "NotoSans-Regular", "Helvetica"]
    for d in dirs:
        for n in fallback_names:
            for ext in exts:
                candidates.append(os.path.join(d, f"{n}{ext}"))

    for c in candidates:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                pass

    # Font mặc định built-in của Pillow (luôn có sẵn, đảm bảo đo kích thước không bao giờ thất bại hoàn toàn)
    try:
        return ImageFont.load_default(size=size)
    except Exception:
        try:
            return ImageFont.load_default()
        except Exception:
            return None


_dummy_draw = None


def measure_text_line_width(text: str, font, font_size: int) -> int:
    """Đo chiều rộng pixel thực tế của một dòng chữ."""
    global _dummy_draw
    if not text:
        return 0
    if _dummy_draw is None:
        _dummy_draw = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    try:
        if font:
            bbox = _dummy_draw.textbbox((0, 0), text, font=font)
            return int(bbox[2] - bbox[0])
    except Exception:
        pass
    return int(len(text) * 0.54 * font_size)


def generate_ass_from_srt(
    srt_path: str,
    ass_path: str,
    video_w: int = 720,
    video_h: int = 1280,
    sub_font: str = "Oswald",
    sub_font_size: int = 50,
    sub_color: str = "#FFFFFF",
    sub_bg_color: str = "#000000",
    sub_bg_opacity: float = 50.0,
    sub_style_type: str = "box",
    sub_bold: bool = False,
    sub_italic: bool = False,
    sub_margin_v: int = 25,
    calculated_margin_v: Optional[int] = None,
    calculated_font_size: Optional[int] = None,
    time_scale: float = 1.0,
) -> str:
    """Tạo file phụ đề ASS chuẩn pixel độ phân giải cao từ file SRT với nền thống nhất (không bị tách nền nhiều nấc)."""
    entries = parse_srt_entries(srt_path)
    os.makedirs(os.path.dirname(ass_path), exist_ok=True)

    scale = video_w / 720.0
    if calculated_font_size is not None:
        ass_font_size = calculated_font_size
    else:
        # Cỡ chữ chuẩn theo PlayResX 720: scale trực tiếp theo cỡ chữ người dùng chọn (16 đến 140)
        ass_font_size = max(18, min(140, int(round(sub_font_size * scale))))

    # Khoảng cách đáy (MarginV)
    if calculated_margin_v is not None:
        scaled_margin_v = max(10, calculated_margin_v)
    else:
        scaled_margin_v = max(15, int(round(sub_margin_v * (video_h / 1280.0) * 1.5)))

    eff_bg_opacity = sub_bg_opacity * 100.0 if (0.0 < sub_bg_opacity <= 1.0) else sub_bg_opacity
    ass_primary = hex_to_ass_color(sub_color, 100)
    ass_back = hex_to_ass_color(sub_bg_color, eff_bg_opacity)
    bold_val = -1 if sub_bold else 0
    italic_val = -1 if sub_italic else 0

    if sub_style_type == "box":
        # CHẾ ĐỘ BOX (HIGHLIGHT NỀN NGUYÊN KHỐI THỐNG NHẤT):
        # Tạo khung nền bo góc (Layer 0) bao trọn toàn bộ các dòng chữ (không tách nền làm 2 nấc)
        pil_font = get_pil_font(sub_font, ass_font_size)
        pad_x = max(20, int(round(ass_font_size * 0.45)))
        pad_y = max(12, int(round(ass_font_size * 0.22)))
        line_height = int(round(ass_font_size * 1.25))
        corner_r = max(6, min(24, int(round(ass_font_size * 0.22))))

        ass_header = f"""[Script Info]
Title: Video Studio Subtitles
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: BgBox,Arial,{ass_font_size},{ass_back},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Default,{sub_font},{ass_font_size},{ass_primary},&H000000FF,&H00000000,&H00000000,{bold_val},{italic_val},0,0,100,100,0,0,1,0,0,5,35,35,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        dialogue_lines = []
        for item in entries:
            start_t = format_ass_time(item["start"] * time_scale)
            end_t = format_ass_time(item["end"] * time_scale)
            formatted_txt = format_subtitle_text(item["text"])
            raw_lines = [l.strip() for l in formatted_txt.split(r"\N") if l.strip()]
            if not raw_lines:
                raw_lines = [formatted_txt]

            widths = [measure_text_line_width(l, pil_font, ass_font_size) for l in raw_lines]
            max_w = max(widths) if widths else 100

            box_w = min(video_w - 40, int(max_w + 2 * pad_x))
            box_h = int(len(raw_lines) * line_height + 2 * pad_y)

            cx = video_w // 2
            cy = video_h - scaled_margin_v - box_h // 2
            bx = cx - box_w // 2
            by = cy - box_h // 2
            rect_path = make_ass_rounded_rect(box_w, box_h, r=corner_r)

            # Layer 0: Khung nền bao trọn chung toàn bộ các dòng
            dialogue_lines.append(f"Dialogue: 0,{start_t},{end_t},BgBox,,0,0,0,,{{\\an7\\pos({bx},{by})\\p1}}{rect_path}{{\\p0}}")
            # Layer 1: Chữ căn giữa chuẩn xác trong khung
            dialogue_lines.append(f"Dialogue: 1,{start_t},{end_t},Default,,0,0,0,,{{\\an5\\pos({cx},{cy})}}{formatted_txt}")

    else:
        # CÁC CHẾ ĐỘ VIỀN / BÓNG / CHỮ ĐƠN THUẦN (OUTLINE / SHADOW / BASIC)
        if sub_style_type == "outline":
            border_style = 1
            outline = max(3, min(12, int(round(ass_font_size * 0.08 * scale))))
            shadow = 0
        elif sub_style_type == "shadow":
            border_style = 1
            outline = 1
            shadow = max(3, min(12, int(round(ass_font_size * 0.08 * scale))))
        else:
            border_style = 0
            outline = 0
            shadow = 0

        ass_header = f"""[Script Info]
Title: Video Studio Subtitles
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{sub_font},{ass_font_size},{ass_primary},&H000000FF,{ass_back},{ass_back},{bold_val},{italic_val},0,0,100,100,0,0,{border_style},{outline},{shadow},2,35,35,{scaled_margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        dialogue_lines = []
        for item in entries:
            start_t = format_ass_time(item["start"] * time_scale)
            end_t = format_ass_time(item["end"] * time_scale)
            formatted_txt = format_subtitle_text(item["text"])
            dialogue_lines.append(f"Dialogue: 0,{start_t},{end_t},Default,,0,0,0,,{formatted_txt}")

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(ass_header + "\n".join(dialogue_lines) + "\n")

    return ass_path


def get_video_dimensions(file_path: str) -> tuple:
    """Lấy độ phân giải width, height chính xác của video bằng ffprobe."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=s=x:p=0",
            file_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        parts = res.stdout.strip().split("x")
        if len(parts) == 2:
            return int(parts[0]), int(parts[1])
    except Exception:
        pass
    return 720, 1280


def generate_srt_file(
    segments: List[Dict[str, Any]],
    srt_path: str,
    max_words_per_cue: int = 8,
    max_chars_per_cue: int = 36,
) -> str:
    """
    Tạo file SRT từ các phân đoạn thoại có timestamp và text_vi.
    Tự động phân tách các câu dài thành các cụm 1-2 dòng nhịp nhàng chuẩn TikTok/Shorts.
    """
    os.makedirs(os.path.dirname(srt_path), exist_ok=True)
    all_cues = []

    for seg in segments:
        s_time = float(seg.get("start", 0.0))
        e_time = float(seg.get("end", 0.0))
        text = (seg.get("text_vi") or seg.get("text") or "").strip()
        if not text:
            continue

        cues = split_segment_into_cues(
            text=text,
            start=s_time,
            end=e_time,
            max_words=max_words_per_cue,
            max_chars=max_chars_per_cue,
        )
        all_cues.extend(cues)

    with open(srt_path, "w", encoding="utf-8") as f:
        for idx, cue in enumerate(all_cues, start=1):
            start_str = format_srt_time(cue["start"])
            end_str = format_srt_time(cue["end"])
            f.write(f"{idx}\n")
            f.write(f"{start_str} --> {end_str}\n")
            f.write(f"{cue['text'].strip()}\n\n")

    return srt_path


def get_media_duration(file_path: str) -> float:
    """Lấy thời lượng chính xác của file media (giây) bằng ffprobe."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return float(res.stdout.strip())
    except Exception:
        return 0.0


def has_audio_stream(file_path: str) -> bool:
    """Kiểm tra file video có track audio hay không."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=codec_type",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return "audio" in res.stdout
    except Exception:
        return False


def hex_to_ass_color(hex_str: str, alpha_percent: float = 100.0) -> str:
    """Chuyển đổi màu hex #RRGGBB và opacity (0-100%) sang định dạng ASS &HAABBGGRR."""
    hex_clean = (hex_str or "#FFFFFF").lstrip("#")
    if len(hex_clean) == 3:
        hex_clean = "".join([c * 2 for c in hex_clean])
    elif len(hex_clean) < 6:
        hex_clean = hex_clean.ljust(6, "0")
    r = hex_clean[0:2]
    g = hex_clean[2:4]
    b = hex_clean[4:6]
    # In ASS, 00 is fully opaque, FF is fully transparent
    ass_alpha = int(round((100 - max(0, min(100, alpha_percent))) * 2.55))
    return f"&H{ass_alpha:02X}{b}{g}{r}"


def compose_localized_video(
    video_path: str,
    voiceover_path: Optional[str],
    srt_path: Optional[str],
    output_path: str,
    cover_old_sub: bool = True,
    bgm_volume: float = 0.15,
    voice_volume: float = 1.0,
    sync_mode: str = "keep_duration",
    # Mở rộng tùy chọn phụ đề & làm mờ OCR chuẩn
    show_subtitles: bool = True,
    sub_position_mode: str = "by_original",  # "by_original" | "by_height"
    sub_placement: str = "overlay",          # "overlay" | "above" | "below"
    auto_fit_sub_size: bool = True,
    sub_position_percent: int = 71,
    sub_font: str = "Oswald",
    sub_font_size: int = 50,
    sub_color: str = "#FFFFFF",
    sub_bg_color: str = "#000000",
    sub_bg_opacity: int = 50,
    sub_style_type: str = "box",
    sub_bold: bool = False,
    sub_italic: bool = False,
    sub_margin_v: int = 25,
    blur_amount: int = 25,
    blur_method: str = "blur",
    keep_original_audio: bool = True,
) -> str:
    """
    Ghép video hoàn chỉnh bằng FFmpeg:
    1. Làm mờ vùng phụ đề cũ tinh gọn (chiều cao ~9% màn hình, không che lấn nội dung video)
    2. Căn chỉnh phụ đề mới khớp chuẩn vị trí:
       - 'by_original' (Theo phụ đề gốc): Đè lên (overlay), Phía trên (above), Phía dưới (below)
       - 'by_height' (Theo chiều cao video): Đặt tại % chiều cao người dùng chọn (mặc định 71%)
    3. Đồng bộ thời lượng theo 2 chế độ:
       - 'keep_duration': Ưu tiên video (Giữ nguyên thời lượng gốc, time-stretch giọng đọc)
       - 'hybrid': Cân bằng hình/tiếng (Tự động giãn video / lặp frame cuối nếu giọng đọc dài hơn)
    4. Mix âm thanh: Giọng lồng tiếng TTS + âm thanh gốc với dropout_transition=0
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Input video not found: {video_path}")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    v_dur = get_media_duration(video_path)
    has_voiceover = bool(voiceover_path and os.path.exists(voiceover_path))
    a_dur = get_media_duration(str(voiceover_path)) if has_voiceover and voiceover_path else 0.0
    video_has_audio = has_audio_stream(video_path) and keep_original_audio
    video_w, video_h = get_video_dimensions(video_path)

    # Chuẩn hóa hệ số âm lượng (phòng ngừa truyền 0-100 hoặc 0-200 thay vì 0.0-2.0)
    if voice_volume > 5.0:
        voice_volume = voice_volume / 100.0
    if bgm_volume > 5.0:
        bgm_volume = bgm_volume / 100.0
    voice_volume = max(0.0, min(2.5, float(voice_volume)))
    actual_bgm_vol = max(0.0, min(1.5, float(bgm_volume if keep_original_audio else 0.0)))

    # ── TÍNH TOÁN VỊ TRÍ VÙNG MỜ & PHỤ ĐỀ CHUẨN XÁC ────────────────────────────
    scale = video_w / 720.0
    # Cỡ chữ tính theo pixel PlayResX 720: người dùng chọn bao nhiêu ăn bấy nhiêu (16 -> 140)
    calculated_font_size = max(20, min(140, int(round(sub_font_size * scale))))

    # Chiều cao dải làm mờ thích ứng theo cỡ chữ để che kín phụ đề cũ và ôm trọn phụ đề mới
    base_blur_h = int(round(video_h * 0.09))
    blur_h = max(base_blur_h, int(round(calculated_font_size * 2.2)))

    # Nhận diện chính xác toạ độ Y của phụ đề gốc bằng OCR (nếu video có sub)
    detected_sub = None
    if sub_position_mode == "by_original" or cover_old_sub:
        try:
            from app.services.ocr_service import detect_hardcoded_subtitle_bbox_ocr
            detected_sub = detect_hardcoded_subtitle_bbox_ocr(video_path)
        except Exception as e:
            logger.warning(f"Lỗi khi quét toạ độ phụ đề OCR: {e}")

    if sub_position_mode == "by_height":
        # Chế độ: Theo chiều cao video (pos_ratio: 0.10 -> 0.90)
        pos_ratio = max(0.10, min(0.90, float(sub_position_percent) / 100.0))
        blur_center_y = int(round(video_h * pos_ratio))
        blur_y = max(0, int(round(blur_center_y - blur_h / 2)))
        calculated_margin_v = max(15, int(round((video_h - blur_center_y) - calculated_font_size * 0.65)))
    else:
        # Chế độ: TỰ ĐỘNG NHẬN DIỆN PHỤ ĐỀ GỐC VÀ ĐÈ LÊN CHÍNH XÁC
        if detected_sub and detected_sub.get("has_subtitle"):
            blur_center_y = detected_sub["y_center"]
            blur_h = max(blur_h, detected_sub["blur_h"])
            blur_y = max(0, int(round(blur_center_y - blur_h / 2)))
        else:
            # Fallback vị trí phụ đề chuẩn TikTok/Douyin (84.25% chiều cao)
            blur_center_y = int(round(video_h * 0.8425))
            blur_y = max(0, int(round(blur_center_y - blur_h / 2)))

        if sub_placement == "overlay":
            # Chèn giữa vùng mờ (đè lên): tâm phụ đề khớp đúng tâm phụ đề cũ
            calculated_margin_v = max(15, int(round((video_h - blur_center_y) - calculated_font_size * 0.65)))
        elif sub_placement == "above":
            # Nằm ngay phía trên dải mờ
            calculated_margin_v = int(round((video_h - blur_y) + 12 * scale))
        elif sub_placement == "below":
            # Nằm ngay phía dưới dải mờ
            calculated_margin_v = max(10, int(round((video_h - (blur_y + blur_h)) - calculated_font_size * 1.3)))
        else:
            calculated_margin_v = max(15, int(round(sub_margin_v * (video_h / 1280.0) * 1.5)))

    filter_chains = []
    current_v = "[0:v]"

    # 1. Che phụ đề cũ bằng dải làm mờ tinh gọn
    # TỰ ĐỘNG THÔNG MINH: Chỉ làm mờ khi video thực sự phát hiện có phụ đề chữ cứng gốc.
    if cover_old_sub and detected_sub:
        if not detected_sub.get("has_subtitle", False):
            cover_old_sub = False

    if cover_old_sub:
        blur_rad = max(5, min(50, int(blur_amount)))
        blur_filter = (
            f"{current_v}split=2[main_v][blur_src];"
            f"[blur_src]crop=iw:{blur_h}:0:{blur_y},boxblur={blur_rad}:2[blurred_box];"
            f"[main_v][blurred_box]overlay=0:{blur_y}[v_covered]"
        )
        filter_chains.append(blur_filter)
        current_v = "[v_covered]"

    # 2. Đồng bộ hóa thời lượng & co giãn video (Xử lý kéo giãn video TRƯỚC KHI burn phụ đề)
    target_duration = v_dur

    if sync_mode == "hybrid" and has_voiceover and a_dur > v_dur and v_dur > 0:
        # Chế độ 2: Hybrid (Cân bằng hình/tiếng - Tự động giãn video để khớp hoàn toàn giọng đọc & sub)
        target_duration = a_dur
        stretch = a_dur / v_dur

        if stretch <= 1.25:
            filter_chains.append(f"{current_v}setpts={stretch:.5f}*PTS[v_stretched]")
            current_v = "[v_stretched]"
            bgm_tempo = f"atempo={1.0 / stretch:.5f},"
        else:
            pad_sec = a_dur - (v_dur * 1.20)
            filter_chains.append(
                f"{current_v}setpts=1.20000*PTS,tpad=stop_mode=clone:stop_duration={pad_sec:.3f}[v_stretched]"
            )
            current_v = "[v_stretched]"
            bgm_tempo = "atempo=0.83333,"

        # Voiceover plays at natural speed
        audio_filter_parts = [
            f"[1:a]volume={voice_volume:.3f},apad[a_voice]"
        ]
        if video_has_audio and actual_bgm_vol > 0.005:
            audio_filter_parts.append(f"[0:a]{bgm_tempo}volume={actual_bgm_vol:.3f},apad[a_bgm]")
            audio_filter_parts.append(
                f"[a_bgm][a_voice]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a_mixed]"
            )
            audio_filter_parts.append(f"[a_mixed]alimiter=limit=0.95:attack=5:release=50,atrim=0:{target_duration:.3f}[a_final]")
        else:
            audio_filter_parts.append(f"[a_voice]alimiter=limit=0.95:attack=5:release=50,atrim=0:{target_duration:.3f}[a_final]")

        filter_chains.extend(audio_filter_parts)

    else:
        # Chế độ 1: Ưu tiên video (Giữ nguyên thời lượng gốc)
        target_duration = v_dur if v_dur > 0 else a_dur
        filter_chains.append(f"{current_v}null[v_stretched]")
        current_v = "[v_stretched]"

        if has_voiceover:
            if v_dur > 0 and a_dur > v_dur:
                # Cần time-stretch audio vừa khít độ dài video gốc mà không đổi cao độ
                tempo = a_dur / v_dur
                if tempo > 2.0:
                    tempo_str = f"atempo=2.0,atempo={tempo / 2.0:.4f},"
                else:
                    tempo_str = f"atempo={tempo:.4f},"
            else:
                tempo_str = ""

            audio_filter_parts = [
                f"[1:a]{tempo_str}volume={voice_volume:.3f},apad[a_voice]"
            ]
            if video_has_audio and actual_bgm_vol > 0.005:
                audio_filter_parts.append(f"[0:a]volume={actual_bgm_vol:.3f},apad[a_bgm]")
                audio_filter_parts.append(
                    f"[a_bgm][a_voice]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a_mixed]"
                )
                audio_filter_parts.append(f"[a_mixed]alimiter=limit=0.95:attack=5:release=50,atrim=0:{target_duration:.3f}[a_final]")
            else:
                audio_filter_parts.append(f"[a_voice]alimiter=limit=0.95:attack=5:release=50,atrim=0:{target_duration:.3f}[a_final]")

            filter_chains.extend(audio_filter_parts)
        else:
            if video_has_audio and actual_bgm_vol > 0.005:
                filter_chains.append(f"[0:a]volume={actual_bgm_vol:.3f},alimiter=limit=0.95:attack=5:release=50[a_final]")

    # 3. Burn phụ đề mới tiếng Việt chuẩn pixel cao cấp (SAU KHI video đã được co giãn đồng bộ với giọng đọc)
    if show_subtitles and srt_path and os.path.exists(srt_path):
        ass_path = str(Path(srt_path).with_suffix(".ass"))
        time_scale = (v_dur / a_dur) if (sync_mode != "hybrid" and has_voiceover and v_dur > 0 and a_dur > v_dur) else 1.0
        generate_ass_from_srt(
            srt_path=srt_path,
            ass_path=ass_path,
            video_w=video_w,
            video_h=video_h,
            sub_font=sub_font,
            sub_font_size=sub_font_size,
            sub_color=sub_color,
            sub_bg_color=sub_bg_color,
            sub_bg_opacity=sub_bg_opacity,
            sub_style_type=sub_style_type,
            sub_bold=sub_bold,
            sub_italic=sub_italic,
            sub_margin_v=sub_margin_v,
            calculated_margin_v=calculated_margin_v,
            calculated_font_size=calculated_font_size,
            time_scale=time_scale,
        )
        safe_ass_path = ass_path.replace("\\", "/").replace(":", "\\:")
        filter_chains.append(f"{current_v}ass='{safe_ass_path}'[v_final]")
        current_v = "[v_final]"
    else:
        filter_chains.append(f"{current_v}null[v_final]")
        current_v = "[v_final]"

    # Build command
    cmd = ["ffmpeg", "-y", "-i", video_path]
    if has_voiceover and voiceover_path:
        cmd.extend(["-i", str(voiceover_path)])

    filter_complex = ";".join(filter_chains)
    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", current_v,
    ])

    if has_voiceover or video_has_audio:
        cmd.extend(["-map", "[a_final]"])

    if target_duration > 0:
        cmd.extend(["-t", f"{target_duration:.3f}"])

    temp_output_path = output_path + f".tmp_{os.getpid()}.mp4"
    cmd.extend([
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        temp_output_path,
    ])

    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        if os.path.exists(temp_output_path):
            try:
                os.remove(temp_output_path)
            except Exception:
                pass
        err_msg = result.stderr.decode("utf-8", errors="ignore")
        raise RuntimeError(f"FFmpeg composition failed: {err_msg[-600:]}")

    if os.path.exists(temp_output_path):
        os.replace(temp_output_path, output_path)

    return output_path


def compose_affiliate_video(
    source_video_path: str,
    scenes: List[Dict[str, Any]],
    output_path: str,
    srt_path: Optional[str] = None,
    voiceover_path: Optional[str] = None,
    bgm_volume: float = 0.15,
    voice_volume: float = 1.0,
    keep_original_audio: bool = True,
    original_volume: float = 0.1,
    ducking: bool = True,
    cover_old_sub: bool = False,
    blur_amount: int = 25,
    show_subtitles: bool = True,
    sub_position_percent: int = 80,
    sub_font: str = "Arial",
    sub_font_size: int = 24,
    sub_color: str = "#FFE600",
    sub_bg_color: str = "#000000",
    sub_bg_opacity: float = 0.75,
    sub_style_type: str = "full_box",
    sub_bold: bool = True,
    sub_italic: bool = False,
    sub_margin_v: int = 50,
) -> str:
    """
    Dựng video Affiliate Studio:
    1. Cắt và ghép các cảnh quay (scenes) theo đúng thứ tự (đã xáo trộn hoặc giữ nguyên).
    2. Tạo file phụ đề ASS bo góc hoặc viền nổi bật.
    3. Burn phụ đề vào khung hình.
    4. Mix âm thanh giọng đọc TTS với âm thanh gốc của video (hoặc nhạc nền).
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # Đo kích thước video gốc
    probe_cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,duration",
        "-of", "csv=p=0:s=x",
        source_video_path,
    ]
    probe_res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    parts = probe_res.stdout.strip().split("x")
    try:
        video_w = int(parts[0])
        video_h = int(parts[1])
    except Exception:
        video_w, video_h = 720, 1280

    # Kiểm tra xem video gốc có stream audio không
    check_a_cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=codec_type",
        "-of", "csv=p=0",
        source_video_path,
    ]
    check_a_res = subprocess.run(check_a_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    video_has_audio = "audio" in check_a_res.stdout.lower()

    filter_chains = []
    num_scenes = len(scenes)

    # 1. Trim và Concat các cảnh quay
    if num_scenes > 0:
        v_concat_inputs = []
        a_concat_inputs = []
        for i, sc in enumerate(scenes):
            st = max(0.0, float(sc.get("start_time", 0.0)))
            dur = max(0.5, float(sc.get("duration", 2.0)))
            et = max(st + 0.5, float(sc.get("end_time", st + dur)))

            filter_chains.append(f"[0:v]trim=start={st:.3f}:end={et:.3f},setpts=PTS-STARTPTS[v_sc{i}]")
            v_concat_inputs.append(f"[v_sc{i}]")

            if video_has_audio:
                filter_chains.append(f"[0:a]atrim=start={st:.3f}:end={et:.3f},asetpts=PTS-STARTPTS[a_sc{i}]")
                a_concat_inputs.append(f"[a_sc{i}]")

        # Concat video streams
        v_concat_str = "".join(v_concat_inputs) + f"concat=n={num_scenes}:v=1:a=0[v_concatted]"
        filter_chains.append(v_concat_str)
        current_v = "[v_concatted]"

        if video_has_audio:
            a_concat_str = "".join(a_concat_inputs) + f"concat=n={num_scenes}:v=0:a=1[a_concatted]"
            filter_chains.append(a_concat_str)
            current_a = "[a_concatted]"
        else:
            current_a = None
    else:
        current_v = "[0:v]"
        current_a = "[0:a]" if video_has_audio else None

    if not keep_original_audio:
        current_a = None

    # Tổng thời lượng các cảnh video đã cắt ghép (hoặc lấy từ video gốc nếu không chia scenes)
    total_dur = sum(float(sc.get("duration", 2.0)) for sc in scenes) if scenes else get_media_duration(source_video_path)
    total_dur = max(1.0, float(total_dur))

    # 1.5. Che mờ phụ đề cũ tiếng Trung nếu có yêu cầu (Cover Old Subtitle Blur)
    if cover_old_sub:
        pos_ratio = max(0.50, min(0.95, float(sub_position_percent) / 100.0))
        target_center_y = int(round(video_h * pos_ratio))
        blur_h = max(50, int(round(sub_font_size * 2.5)))
        blur_y = max(0, min(video_h - blur_h, target_center_y - blur_h // 2))
        blur_rad = max(5, min(50, int(blur_amount)))
        blur_filter = (
            f"{current_v}split=2[main_v][blur_src];"
            f"[blur_src]crop=iw:{blur_h}:0:{blur_y},boxblur={blur_rad}:2[blurred_box];"
            f"[main_v][blurred_box]overlay=0:{blur_y}[v_covered]"
        )
        filter_chains.append(blur_filter)
        current_v = "[v_covered]"

    # 2. Đồng bộ thời lượng Video & Âm thanh (Chống cắt cụt giọng đọc)
    has_voiceover = bool(voiceover_path and os.path.exists(voiceover_path))
    a_dur = get_media_duration(str(voiceover_path)) if has_voiceover else 0.0
    final_render_dur = total_dur

    if has_voiceover and a_dur > total_dur and total_dur > 0:
        extra_sec = round(a_dur - total_dur + 0.4, 3)
        filter_chains.append(f"{current_v}tpad=stop_mode=clone:stop_duration={extra_sec:.3f}[v_padded]")
        current_v = "[v_padded]"
        final_render_dur = total_dur + extra_sec

    # 3. Burn Subtitles nếu có (sau khi đã chuẩn hóa thời lượng video)
    if show_subtitles and srt_path and os.path.exists(srt_path):
        ass_path = str(Path(srt_path).with_suffix(".ass"))
        # Tính calculated_margin_v dựa theo sub_position_percent
        pos_ratio = max(0.10, min(0.90, float(sub_position_percent) / 100.0))
        target_center_y = int(round(video_h * pos_ratio))
        calc_margin_v = max(15, int(round((video_h - target_center_y) - sub_font_size * 0.7)))

        generate_ass_from_srt(
            srt_path=srt_path,
            ass_path=ass_path,
            video_w=video_w,
            video_h=video_h,
            sub_font=sub_font,
            sub_font_size=sub_font_size,
            sub_color=sub_color,
            sub_bg_color=sub_bg_color,
            sub_bg_opacity=sub_bg_opacity,
            sub_style_type=sub_style_type,
            sub_bold=sub_bold,
            sub_italic=sub_italic,
            sub_margin_v=sub_margin_v,
            calculated_margin_v=calc_margin_v,
            calculated_font_size=sub_font_size,
        )
        safe_ass_path = ass_path.replace("\\", "/").replace(":", "\\:")
        filter_chains.append(f"{current_v}ass='{safe_ass_path}'[v_subbed]")
        current_v = "[v_subbed]"

    # 4. Âm thanh: Mix voiceover + background music
    cmd = ["ffmpeg", "-y", "-i", source_video_path]
    if has_voiceover:
        cmd.extend(["-i", str(voiceover_path)])

    if has_voiceover:
        audio_parts = [f"[1:a]volume={voice_volume:.3f},apad[a_voice]"]
        if current_a is not None:
            audio_parts.append(f"{current_a}volume={bgm_volume:.3f},apad[a_bgm]")
            audio_parts.append("[a_voice][a_bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a_mixed]")
            if final_render_dur > 1.0:
                audio_parts.append(f"[a_mixed]afade=t=out:st={final_render_dur - 0.4:.2f}:d=0.4,alimiter=limit=0.95:attack=5:release=50[a_final]")
            else:
                audio_parts.append("[a_mixed]alimiter=limit=0.95:attack=5:release=50[a_final]")
        else:
            audio_parts.append("[a_voice]alimiter=limit=0.95:attack=5:release=50[a_final]")
        filter_chains.extend(audio_parts)
    elif current_a is not None:
        filter_chains.append(f"{current_a}volume=1.0[a_final]")

    filter_complex = ";".join(filter_chains)
    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", current_v,
    ])

    if has_voiceover or current_a is not None:
        cmd.extend(["-map", "[a_final]"])

    if final_render_dur > 0:
        cmd.extend(["-t", f"{final_render_dur:.3f}"])

    temp_output_path = output_path + f".tmp_{os.getpid()}.mp4"
    cmd.extend([
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        temp_output_path,
    ])

    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0:
        if os.path.exists(temp_output_path):
            try:
                os.remove(temp_output_path)
            except Exception:
                pass
        err = res.stderr.decode("utf-8", errors="ignore")
        raise RuntimeError(f"FFmpeg compose affiliate failed: {err[-600:]}")

    if os.path.exists(temp_output_path):
        os.replace(temp_output_path, output_path)

    return output_path


