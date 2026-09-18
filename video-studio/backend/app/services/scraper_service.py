import re
import json
import logging
import requests
from typing import Dict, Any, Optional
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
}


def clean_price_text(raw_text: str) -> str:
    """Làm sạch và chuẩn hóa chuỗi giá tiền VNĐ."""
    if not raw_text:
        return ""
    # Tìm các mẫu như 199.000, 199k, 250,000, 150000
    m = re.search(r"(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:đ|vnd|vnđ|k)?", raw_text, re.IGNORECASE)
    if m:
        val = m.group(1).replace(".", "").replace(",", "")
        try:
            num = int(val)
            if "k" in raw_text.lower() and num < 1000:
                num *= 1000
            return f"{num:,}".replace(",", ".") + " đ"
        except Exception:
            return raw_text.strip()
    return raw_text.strip()


def scrape_product_info(url: str, timeout: int = 10) -> Dict[str, Any]:
    """
    Trích xuất thông tin sản phẩm từ đường link Shopee, TikTok Shop hoặc web bán hàng bất kỳ.
    Hỗ trợ đọc OpenGraph meta tags, Schema JSON-LD và regex.
    Luôn trả về kết quả an toàn (không crash) kể cả khi trang chặn bot/yêu cầu login.
    """
    url = url.strip()
    result: Dict[str, Any] = {
        "url": url,
        "platform": "unknown",
        "product_name": "",
        "price": "",
        "description": "",
        "thumbnail_url": "",
        "success": False,
        "message": "",
    }

    if not url:
        result["message"] = "URL sản phẩm trống"
        return result

    url_lower = url.lower()
    if "shopee" in url_lower:
        result["platform"] = "shopee"
    elif "tiktok" in url_lower:
        result["platform"] = "tiktok_shop"
    elif "lazada" in url_lower:
        result["platform"] = "lazada"
    elif "tiki" in url_lower:
        result["platform"] = "tiki"
    else:
        result["platform"] = "other"

    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        if resp.status_code != 200:
            result["message"] = f"Máy chủ web trả về HTTP {resp.status_code}. Bạn có thể nhập thông tin tay."
            return result

        html = resp.text
        soup = BeautifulSoup(html, "html.parser")

        # 1. Thử lấy từ JSON-LD schema
        scripts = soup.find_all("script", type="application/ld+json")
        for s in scripts:
            try:
                data = json.loads(s.string or "")
                if isinstance(data, list):
                    data = data[0] if data else {}
                if data.get("@type") in ["Product", "IndividualProduct"] or "name" in data:
                    if not result["product_name"]:
                        result["product_name"] = str(data.get("name") or "").strip()
                    if not result["description"]:
                        result["description"] = str(data.get("description") or "").strip()[:500]
                    if not result["thumbnail_url"]:
                        img = data.get("image")
                        if isinstance(img, list) and img:
                            result["thumbnail_url"] = str(img[0])
                        elif isinstance(img, str):
                            result["thumbnail_url"] = img
                    offers = data.get("offers", {})
                    if isinstance(offers, list) and offers:
                        offers = offers[0]
                    if isinstance(offers, dict) and "price" in offers:
                        result["price"] = clean_price_text(str(offers.get("price", "")))
            except Exception:
                pass

        # 2. Thử lấy từ OpenGraph Meta Tags
        if not result["product_name"]:
            og_title = soup.find("meta", property="og:title") or soup.find("meta", attrs={"name": "title"})
            if og_title and og_title.get("content"):
                title = str(og_title.get("content", "")).strip()
                # Cắt bỏ đuôi | Shopee Việt Nam, - TikTok Shop...
                title = re.sub(r"\s*[-|]\s*(Shopee|TikTok|Lazada|Tiki).*$", "", title, flags=re.IGNORECASE)
                result["product_name"] = title

        if not result["thumbnail_url"]:
            og_image = soup.find("meta", property="og:image")
            if og_image and og_image.get("content"):
                result["thumbnail_url"] = str(og_image.get("content", "")).strip()

        if not result["description"]:
            og_desc = soup.find("meta", property="og:description") or soup.find("meta", attrs={"name": "description"})
            if og_desc and og_desc.get("content"):
                result["description"] = str(og_desc.get("content", "")).strip()[:500]

        # 3. Giá tiền từ OpenGraph hoặc itemprop
        if not result["price"]:
            price_meta = (
                soup.find("meta", property="product:price:amount")
                or soup.find("meta", attrs={"name": "price"})
                or soup.select_one('[itemprop="price"]')
            )
            if price_meta:
                val = str(price_meta.get("content") or price_meta.text or "")
                result["price"] = clean_price_text(val)

        # 4. Tiêu đề fallback từ thẻ <title>
        if not result["product_name"] and soup.title and soup.title.string:
            t = soup.title.string.strip()
            t = re.sub(r"\s*[-|]\s*(Shopee|TikTok|Lazada|Tiki).*$", "", t, flags=re.IGNORECASE)
            result["product_name"] = t

        result["success"] = bool(result["product_name"])
        if result["success"]:
            result["message"] = "Đã lấy thông tin sản phẩm thành công!"
        else:
            result["message"] = "Trang web cần xác minh bảo mật hoặc không hỗ trợ đọc tự động. Bạn có thể tự điền thông tin."

    except Exception as e:
        logger.warning(f"Lỗi scrape {url}: {e}")
        result["message"] = f"Không thể cào tự động: {str(e)[:100]}. Bạn có thể tự điền tên và giá sản phẩm."

    return result
