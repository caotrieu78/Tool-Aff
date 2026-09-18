"""
TikTok Browser Service — Tự động hóa kết nối và đăng video TikTok qua Playwright.
Sử dụng persistent profile riêng biệt cho từng kênh để duy trì phiên đăng nhập lâu dài.
Không cần đăng ký TikTok Developer App phức tạp.
"""

import asyncio
import json
import logging
import os
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from playwright.async_api import async_playwright

from app.core.config import settings
from app.services.tiktok_channel_service import get_configured_tiktok_channels, update_tiktok_channel

logger = logging.getLogger(__name__)

# Thư mục lưu trữ Chromium profiles cho từng kênh
PROFILES_DIR = Path(settings.STORAGE_DIR).parent / "tiktok_profiles"
PROFILES_DIR.mkdir(parents=True, exist_ok=True)

# Trạng thái tiến trình login đang mở cho các kênh
_active_login_processes: dict[int, bool] = {}


def get_channel_profile_dir(channel_id: int) -> Path:
    """Đường dẫn thư mục profile lưu session/cookie của từng kênh."""
    p_dir = PROFILES_DIR / f"channel_{channel_id}"
    p_dir.mkdir(parents=True, exist_ok=True)
    return p_dir


def _get_session_file(channel_id: int) -> Path:
    return get_channel_profile_dir(channel_id) / "session_info.json"


def get_channel_session_info(channel_id: int) -> dict[str, Any]:
    """Đọc thông tin phiên đăng nhập đã lưu trong file session_info.json."""
    sf = _get_session_file(channel_id)
    if sf.exists():
        try:
            with open(sf, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "channel_id": channel_id,
        "is_logged_in": False,
        "username": "",
        "display_name": "",
        "avatar_url": "",
        "updated_at": None,
    }


def save_channel_session_info(channel_id: int, data: dict[str, Any]) -> None:
    """Ghi thông tin phiên đăng nhập vào session_info.json."""
    sf = _get_session_file(channel_id)
    try:
        with open(sf, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"Không thể lưu session_info.json cho kênh {channel_id}: {e}")


def logout_channel(channel_id: int) -> bool:
    """Xóa toàn bộ profile và cookie của kênh để đăng xuất."""
    p_dir = get_channel_profile_dir(channel_id)
    try:
        if p_dir.exists():
            shutil.rmtree(p_dir, ignore_errors=True)
            p_dir.mkdir(parents=True, exist_ok=True)
        # Reset session info
        save_channel_session_info(channel_id, {
            "channel_id": channel_id,
            "is_logged_in": False,
            "username": "",
            "display_name": "",
            "avatar_url": "",
            "updated_at": datetime.utcnow().isoformat(),
        })
        return True
    except Exception as e:
        logger.error(f"Lỗi khi đăng xuất kênh {channel_id}: {e}")
        return False


async def check_channel_login_status(channel_id: int) -> dict[str, Any]:
    """
    Kiểm tra xem kênh TikTok đã đăng nhập thành công hay chưa bằng cách kiểm tra
    file session hoặc mở browser ngầm kiểm tra cookie/profile TikTok.
    """
    profile_dir = get_channel_profile_dir(channel_id)
    session_info = get_channel_session_info(channel_id)

    # Nếu đang mở cửa sổ đăng nhập
    if _active_login_processes.get(channel_id, False):
        session_info["is_logging_in"] = True
        return session_info

    session_info["is_logging_in"] = False

    # Kiểm tra cookie database Chromium có tồn tại không
    default_storage = profile_dir / "Default"
    if not default_storage.exists():
        session_info["is_logged_in"] = False
        return session_info

    # Thử mở headless nhẹ để kiểm tra cookie sessionid
    try:
        async with async_playwright() as p:
            context = await p.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir),
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-gpu",
                ],
            )
            cookies = await context.cookies("https://www.tiktok.com")
            session_cookie = next((c for c in cookies if c.get("name") in ["sessionid", "sessionid_ss"]), None)
            
            is_valid = bool(session_cookie and session_cookie.get("value"))
            session_info["is_logged_in"] = is_valid
            
            # Nếu có session cookie hợp lệ, cố gắng trích xuất username nếu chưa có
            if is_valid and not session_info.get("username"):
                try:
                    page = context.pages[0] if context.pages else await context.new_page()
                    await page.goto("https://www.tiktok.com/creator-center/upload", timeout=12000, wait_until="domcontentloaded")
                    user_handle = await page.evaluate("""() => {
                        const avatar = document.querySelector('img[alt*="avatar"], .avatar img');
                        const userSpan = document.querySelector('[data-e2e="creator-center-user-name"], .user-info-name');
                        return {
                            username: userSpan ? userSpan.innerText : '',
                            avatar: avatar ? avatar.src : ''
                        };
                    }""")
                    if user_handle and user_handle.get("username"):
                        session_info["username"] = user_handle["username"]
                    if user_handle and user_handle.get("avatar"):
                        session_info["avatar_url"] = user_handle["avatar"]
                except Exception:
                    pass

            session_info["updated_at"] = datetime.utcnow().isoformat()
            save_channel_session_info(channel_id, session_info)
            await context.close()
    except Exception as e:
        logger.warning(f"Kiểm tra login status cho kênh {channel_id} gặp lỗi: {e}")

    return session_info


async def open_login_window(channel_id: int) -> dict[str, Any]:
    """
    Mở cửa sổ Chromium có giao diện trực quan (visible) để người dùng quét mã QR
    hoặc đăng nhập tài khoản TikTok. Khi đăng nhập xong sẽ tự động đóng và lưu session.
    """
    if _active_login_processes.get(channel_id, False):
        return {"status": "in_progress", "message": "Cửa sổ đăng nhập TikTok cho kênh này đang được mở."}

    _active_login_processes[channel_id] = True
    profile_dir = get_channel_profile_dir(channel_id)

    async def _run_login():
        try:
            logger.info(f"🌐 [TikTok Login] Đang mở trình duyệt đăng nhập cho Kênh #{channel_id}...")
            async with async_playwright() as p:
                context = await p.chromium.launch_persistent_context(
                    user_data_dir=str(profile_dir),
                    headless=False,
                    viewport={"width": 1100, "height": 800},
                    args=[
                        "--disable-blink-features=AutomationControlled",
                        "--no-sandbox",
                        "--window-position=150,100",
                    ],
                )
                page = context.pages[0] if context.pages else await context.new_page()
                
                # Mở trực tiếp trang đăng nhập TikTok
                await page.goto("https://www.tiktok.com/login?lang=vi-VN", wait_until="domcontentloaded")

                # Chờ tối đa 6 phút để người dùng quét mã QR hoặc đăng nhập
                max_wait = 360  # 6 phút
                start_time = time.time()
                logged_in = False
                found_username = ""
                found_avatar = ""

                while time.time() - start_time < max_wait:
                    try:
                        # Kiểm tra xem cửa sổ có bị người dùng tắt tay không
                        if context.pages == [] or page.is_closed():
                            logger.info(f"Người dùng đã tắt cửa sổ đăng nhập kênh #{channel_id}")
                            break

                        cookies = await context.cookies("https://www.tiktok.com")
                        session_cookie = next((c for c in cookies if c.get("name") in ["sessionid", "sessionid_ss"]), None)

                        # Nếu đã có cookie sessionid hoặc đang ở trang chủ/upload
                        curr_url = page.url
                        if (session_cookie and session_cookie.get("value")) or ("login" not in curr_url and "tiktok.com" in curr_url):
                            # Đợi thêm 2 giây để cookie đồng bộ hoàn chỉnh
                            await asyncio.sleep(2)
                            logged_in = True
                            
                            try:
                                info = await page.evaluate("""() => {
                                    const avatar = document.querySelector('img[alt*="avatar"], .avatar img');
                                    const profileLink = document.querySelector('a[href*="/@"]');
                                    let un = '';
                                    if (profileLink) {
                                        const m = profileLink.href.match(/@([^/?#]+)/);
                                        if (m) un = '@' + m[1];
                                    }
                                    return {
                                        username: un,
                                        avatar: avatar ? avatar.src : ''
                                    };
                                }""")
                                if info:
                                    found_username = info.get("username", "")
                                    found_avatar = info.get("avatar", "")
                            except Exception:
                                pass
                            
                            logger.info(f"✅ [TikTok Login] Kênh #{channel_id} đã đăng nhập thành công! Username: {found_username}")
                            break
                    except Exception as err:
                        logger.debug(f"Đang kiểm tra login: {err}")

                    await asyncio.sleep(2)

                # Lưu thông tin session
                session_data = {
                    "channel_id": channel_id,
                    "is_logged_in": logged_in,
                    "username": found_username,
                    "avatar_url": found_avatar,
                    "updated_at": datetime.utcnow().isoformat(),
                }
                save_channel_session_info(channel_id, session_data)

                # Đồng bộ tên username vào cấu hình tiktok_channels nếu có
                if found_username:
                    update_tiktok_channel(channel_id, {"username": found_username})

                try:
                    await context.close()
                except Exception:
                    pass

        except Exception as e:
            logger.error(f"Lỗi trong quá trình mở đăng nhập TikTok kênh #{channel_id}: {e}")
        finally:
            _active_login_processes[channel_id] = False

    # Chạy ngầm tác vụ đăng nhập trong background để không chặn HTTP API
    asyncio.create_task(_run_login())

    return {
        "status": "started",
        "message": f"Đã mở cửa sổ trình duyệt đăng nhập cho Kênh #{channel_id}. Vui lòng quét mã QR TikTok trên màn hình!",
    }


async def post_video_to_tiktok(
    channel_id: int,
    video_path: str,
    caption: str,
    hashtags: Optional[list[str]] = None,
    headless: bool = True,
) -> dict[str, Any]:
    """
    Tự động hóa đăng video lên TikTok bằng Playwright thông qua Persistent Profile:
    1. Khởi động Chromium ngầm (headless=True) hoặc có giao diện (headless=False).
    2. Truy cập TikTok Creator Center / Upload.
    3. Upload file video_path.
    4. Điền caption + hashtags.
    5. Chờ hoàn tất xử lý và click nút 'Đăng' (Post).
    """
    profile_dir = get_channel_profile_dir(channel_id)
    v_file = Path(video_path)

    if not v_file.exists():
        return {
            "success": False,
            "status": "failed",
            "error": f"Không tìm thấy file video tại: {video_path}",
        }

    # Chuẩn bị nội dung caption kèm hashtags
    ht_list = hashtags or []
    tags_str = " ".join(ht_list) if ht_list else ""
    full_caption = f"{caption.strip()} {tags_str}".strip()

    mode_label = "CHẠY NGẦM (Headless)" if headless else "CỬA SỔ TRỰC QUAN (Visible)"
    logger.info(f"🚀 [TikTok Auto-Post] Đang đăng video lên Kênh #{channel_id} [{mode_label}] | File: {v_file.name}")
    logger.info(f"📝 Caption: {full_caption[:60]}...")

    page = None
    try:
        async with async_playwright() as p:
            # Cấu hình chromium args tối ưu cho cả headless và visible
            chrome_args = [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-infobars",
                "--disable-dev-shm-usage",
            ]
            if headless:
                chrome_args.extend([
                    "--headless=new",
                    "--disable-gpu",
                ])
            else:
                chrome_args.append("--window-position=50,50")

            context = await p.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir),
                headless=headless,
                viewport={"width": 1440, "height": 900},
                locale="vi-VN",
                timezone_id="Asia/Ho_Chi_Minh",
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
                args=chrome_args,
            )
            page = context.pages[0] if context.pages else await context.new_page()

            # Anti-detection stealth script: che giấu navigator.webdriver và giả lập window.chrome
            await page.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
                if (!window.chrome) {
                    window.chrome = { runtime: {} };
                }
            """)

            # 1. Điều hướng trực tiếp đến trang tải lên TikTok Studio
            await page.goto("https://www.tiktok.com/tiktokstudio/upload?lang=vi-VN", wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(2)

            # Kiểm tra nếu bị redirect về login -> nghĩa là chưa đăng nhập hoặc hết hạn
            if "login" in page.url:
                await context.close()
                return {
                    "success": False,
                    "status": "rejected",
                    "error": f"Kênh #{channel_id} chưa đăng nhập hoặc phiên làm việc TikTok đã hết hạn. Vui lòng vào Cài Đặt -> Kênh TikTok để đăng nhập lại!",
                }

            # Hàm loại bỏ các popup hướng dẫn (Tour / Joyride overlay) của TikTok Studio
            async def _dismiss_popups():
                try:
                    await page.evaluate("""() => {
                        const portal = document.getElementById('react-joyride-portal');
                        if (portal) portal.remove();
                        const overlays = document.querySelectorAll('.react-joyride__overlay, .semi-modal-mask, .semi-modal-wrap');
                        overlays.forEach(el => el.remove());
                        const buttons = Array.from(document.querySelectorAll('button'));
                        for (const b of buttons) {
                            const t = (b.innerText || '').toLowerCase();
                            if (t.includes('got it') || t.includes('skip') || t.includes('đã hiểu') || t.includes('bỏ qua') || t.includes('kế tiếp')) {
                                b.click();
                            }
                        }
                    }""")
                except Exception:
                    pass

            await _dismiss_popups()

            # 2. Tìm input upload file video (lưu ý state='attached' vì input file bị ẩn trong DOM TikTok)
            logger.info("🔍 Đang tìm nút tải file video trên TikTok Studio...")
            file_input = await page.wait_for_selector('input[type="file"]', state="attached", timeout=30000)
            if not file_input:
                await context.close()
                return {
                    "success": False,
                    "status": "failed",
                    "error": "Không tìm thấy nút tải file trên trang TikTok Studio. TikTok có thể vừa cập nhật giao diện.",
                }

            logger.info(f"📤 Đang gửi file video '{v_file.name}' lên TikTok...")
            await file_input.set_input_files(str(v_file.resolve()))

            # 3. Chờ video upload và hiển thị khung soạn thảo caption
            logger.info("⏳ Đang chờ TikTok nhận diện video và mở khung nhập mô tả...")
            await asyncio.sleep(2)
            await _dismiss_popups()

            caption_selector = 'div.DraftEditor-editorContainer, div[contenteditable="true"], textarea[placeholder*="caption"], div[data-placeholder*="video"]'
            caption_box = await page.wait_for_selector(caption_selector, timeout=60000)

            if not caption_box:
                await context.close()
                return {
                    "success": False,
                    "status": "failed",
                    "error": "Không tìm thấy khung nhập Caption/Hashtag trên TikTok sau khi tải video.",
                }

            # 4. Điền Caption & Hashtags
            await _dismiss_popups()
            await caption_box.click(force=True)
            await asyncio.sleep(0.3)

            # Xóa tên file video mặc định mà TikTok tự điền vào khung caption
            await page.keyboard.press("Meta+A" if os.uname().sysname == "Darwin" else "Control+A")
            await asyncio.sleep(0.2)
            await page.keyboard.press("Backspace")
            await asyncio.sleep(0.3)

            if full_caption:
                logger.info(f"📝 Đang điền caption: {full_caption[:60]}...")
                await page.keyboard.type(full_caption, delay=20)
                await asyncio.sleep(1)

            # 5. Chờ Music copyright check + Content check lite hoàn tất
            # Dựa trên DOM thực: [data-e2e="copyright_container"] chứa text trạng thái check
            logger.info("⏳ Chờ TikTok kiểm tra bản quyền và nội dung trước khi đăng...")
            checks_passed = False
            for attempt in range(90):  # tối đa 135 giây
                await _dismiss_popups()
                check_result = await page.evaluate("""() => {
                    // Lấy text của copyright_container (Music copyright + Content check)
                    const copyrightBox = document.querySelector('[data-e2e="copyright_container"]');
                    const checkText = (copyrightBox ? copyrightBox.innerText : '').toLowerCase();

                    // "Checking in progress" = đang kiểm tra, chưa xong
                    const isStillChecking = checkText.includes('checking in progress') ||
                                            checkText.includes('checking...') ||
                                            checkText.includes('đang kiểm tra');

                    // Xác nhận nút Post tồn tại và không bị khoá
                    const postBtn = document.querySelector('button[data-e2e="post_video_button"]');
                    const btnDataDisabled = postBtn ? postBtn.getAttribute('data-disabled') : 'true';
                    const btnAriaDisabled = postBtn ? postBtn.getAttribute('aria-disabled') : 'true';
                    const btnLoading = postBtn ? postBtn.getAttribute('data-loading') : 'true';

                    const btnReady = postBtn &&
                                     btnDataDisabled !== 'true' &&
                                     btnAriaDisabled !== 'true' &&
                                     btnLoading !== 'true';

                    return {
                        done: !isStillChecking && btnReady,
                        checkText: checkText.substring(0, 200),
                        isStillChecking: isStillChecking,
                        btnReady: btnReady,
                    };
                }""")

                logger.debug(f"[checks] attempt={attempt} done={check_result.get('done')} "
                             f"checking={check_result.get('isStillChecking')} btn={check_result.get('btnReady')} "
                             f"text={check_result.get('checkText','')[:60]}")

                if check_result.get("done"):
                    checks_passed = True
                    logger.info("✅ Checks hoàn tất — Music & Content OK, nút Post sẵn sàng!")
                    break
                await asyncio.sleep(1.5)

            if not checks_passed:
                logger.warning("⚠️ Checks chưa hoàn tất sau 135s hoặc nút Post vẫn chưa ready — tiếp tục đăng...")

            await asyncio.sleep(1)

            # 6. Click nút Post — dùng đúng selector data-e2e="post_video_button"
            logger.info("🎯 Đang bấm nút 'Post' video lên TikTok...")
            await _dismiss_popups()

            # Thử JS click trước (nhanh, không bị intercept)
            clicked = await page.evaluate("""() => {
                const postBtn = document.querySelector('button[data-e2e="post_video_button"]');
                if (postBtn && postBtn.getAttribute('data-disabled') !== 'true') {
                    postBtn.click();
                    return true;
                }
                return false;
            }""")

            if not clicked:
                # Fallback: Playwright native click
                post_btn = await page.query_selector('button[data-e2e="post_video_button"]')
                if post_btn:
                    await post_btn.click(force=True)
                    clicked = True
                    logger.info("✅ Đã click Post (fallback Playwright)")
                else:
                    await context.close()
                    return {
                        "success": False,
                        "status": "failed",
                        "error": "Không tìm thấy nút Post (data-e2e=post_video_button) trên trang TikTok Studio.",
                    }

            logger.info("✅ Đã click nút Post!")

            # 7. Xử lý dialog "Continue to post?" nếu TikTok vẫn đang check
            # Dialog này xuất hiện khi click Post trong lúc checks chưa xong
            logger.info("🔔 Chờ và xử lý dialog 'Continue to post?' nếu có...")
            await asyncio.sleep(2)
            for _ in range(15):
                confirmed = await page.evaluate("""() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    // Tìm nút "Post now" trong dialog
                    const postNowBtn = buttons.find(b => {
                        const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                        return t === 'post now' || t === 'đăng ngay' || t === 'continue' || t === 'tiếp tục đăng';
                    });
                    if (postNowBtn) {
                        postNowBtn.click();
                        return 'clicked_post_now';
                    }
                    // Kiểm tra xem đã chuyển trang chưa (upload xong)
                    if (document.querySelector('[data-e2e="upload_success_container"]') ||
                        window.location.href.includes('manage')) {
                        return 'already_posted';
                    }
                    return null;
                }""")

                if confirmed == "clicked_post_now":
                    logger.info("✅ Đã nhấn 'Post now' — đăng kể cả khi checks chưa xong!")
                    break
                elif confirmed == "already_posted":
                    logger.info("✅ Trang đã chuyển sang manage — đăng thành công!")
                    break
                await asyncio.sleep(0.8)

            # 8. Chờ xác nhận đăng thành công (TikTok redirect hoặc hiện thông báo)
            logger.info("⏳ Chờ TikTok xác nhận đăng thành công...")
            await asyncio.sleep(5)

            success_confirmed = False
            for _ in range(30):
                curr_url = page.url.lower()
                page_text = (await page.content()).lower()
                if (
                    "manage" in curr_url
                    or "tiktokstudio/content" in curr_url
                    or "đã được tải lên" in page_text
                    or "video của bạn đã được đăng" in page_text
                    or "your video has been uploaded" in page_text
                    or "your video is being uploaded" in page_text
                    or "video posted" in page_text
                    or "upload_success" in page_text
                ):
                    success_confirmed = True
                    break
                await asyncio.sleep(1)

            await asyncio.sleep(2)
            await context.close()

            logger.info(f"🎉 [TikTok Auto-Post] Video đã được đăng thành công lên Kênh #{channel_id}!")
            return {
                "success": True,
                "status": "posted",
                "message": f"Đã đăng thành công video lên Kênh #{channel_id}!",
                "posted_at": datetime.utcnow().isoformat(),
            }

    except Exception as e:
        logger.error(f"❌ [TikTok Auto-Post] Lỗi khi đăng video: {e}", exc_info=True)
        # Tự động chụp ảnh màn hình lưu vào storage/logs để chẩn đoán lỗi khi chạy ngầm
        try:
            if page and not page.is_closed():
                log_dir = Path(settings.STORAGE_DIR) / "logs"
                log_dir.mkdir(parents=True, exist_ok=True)
                err_ss = log_dir / f"tiktok_err_ch{channel_id}_{int(time.time())}.png"
                await page.screenshot(path=str(err_ss), full_page=True)
                logger.info(f"📸 Đã lưu ảnh chụp lỗi giao diện tại: {err_ss}")
        except Exception as ss_err:
            logger.debug(f"Không thể chụp ảnh lỗi: {ss_err}")

        return {
            "success": False,
            "status": "failed",
            "error": f"Lỗi trong quá trình tương tác trình duyệt: {str(e)[:150]}",
        }
