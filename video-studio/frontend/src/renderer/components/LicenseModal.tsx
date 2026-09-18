import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Key,
  Check,
  RefreshCw,
  AlertTriangle,
  HelpCircle,
  Lock,
  Calendar,
  User,
  X,
  Eye,
  EyeOff,
  ExternalLink,
} from 'lucide-react';
import { licenseApi, LicenseStatus } from '../api/client';

interface LicenseModalProps {
  isOpen: boolean;
  licenseStatus: LicenseStatus | null;
  onSuccess: (updated: LicenseStatus) => void;
  onStatusUpdate?: (updated: LicenseStatus) => void;
  onClose?: () => void;
  canClose?: boolean;
}

export default function LicenseModal({
  isOpen,
  licenseStatus,
  onSuccess,
  onStatusUpdate,
  onClose,
  canClose = false,
}: LicenseModalProps) {
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setSuccessMsg('');
      if (licenseStatus?.license_key_raw) {
        setKeyInput(licenseStatus.license_key_raw);
      }
      // Luôn kiểm tra trạng thái mới nhất từ Google Sheets khi mở modal (chỉ cập nhật status, KHÔNG đóng modal)
      licenseApi.getStatus(true).then((fresh) => {
        if (onStatusUpdate) {
          onStatusUpdate(fresh);
        }
      }).catch(() => {
        // ignore network error
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleActivate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanKey = keyInput.trim().toUpperCase();
    if (!cleanKey) {
      setErrorMsg('Vui lòng nhập mã bản quyền!');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await licenseApi.activate(cleanKey);
      setSuccessMsg(res.message || 'Kích hoạt bản quyền thành công!');
      // Refresh full status
      const updated = await licenseApi.getStatus(true);
      setTimeout(() => {
        onSuccess(updated);
      }, 1200);
    } catch (err: any) {
      let msg = err.message || 'Kích hoạt thất bại. Vui lòng kiểm tra lại mã key!';
      // Format clean error message from API if JSON
      try {
        const parsed = JSON.parse(msg.replace(/^API .* failed \(\d+\): /, ''));
        if (parsed.detail) msg = parsed.detail;
      } catch (_jsonErr) {
        // ignore parse error
      }
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const isExpired = licenseStatus?.status === 'expired';
  const isBlocked = licenseStatus?.status === 'blocked';
  const isMismatch = licenseStatus?.status === 'mismatch';
  const isTampered = licenseStatus?.status === 'tampered';
  const formatExpireDate = (dateStr?: string) => {
    if (!dateStr) return '--/--/----';
    const months: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
    };
    const monthMatch = dateStr.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})/i);
    if (monthMatch) {
      const [, m, d, y] = monthMatch;
      const mNum = months[m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()] || '01';
      return `${d.padStart(2, '0')}/${mNum}/${y}`;
    }
    const m = dateStr.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
      return `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[1]}`;
    }
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      }
    } catch (_) {}
    return dateStr;
  };

  const isValid = licenseStatus?.is_valid === true;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-[540px] bg-[#161a24] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        {/* Top Accent Line */}
        <div className={`h-1.5 w-full bg-gradient-to-r ${
          isValid
            ? 'from-emerald-500 via-teal-400 to-indigo-500'
            : 'from-indigo-500 via-purple-500 to-pink-500'
        }`} />

        {/* Modal Header */}
        <div className="p-6 pb-4 flex items-start justify-between">
          <div className="flex items-center gap-3.5">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shadow-inner shrink-0 ${
              isValid
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
            }`}>
              {isValid ? <ShieldCheck size={28} /> : <Lock size={28} />}
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="font-bold text-xl text-white tracking-tight">Bản Quyền Video Studio</h3>
                {isValid && (
                  <span className="text-xs uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 whitespace-nowrap">
                    Đã kích hoạt
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {isValid
                  ? 'Bản quyền Pro đang hoạt động'
                  : 'Vui lòng kích hoạt bản quyền để sử dụng đầy đủ tính năng'}
              </p>
            </div>
          </div>

          {canClose && onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <X size={20} />
            </button>
          )}
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Active License Info Card */}
          {isValid && (
            <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-4 sm:p-4.5 text-sm space-y-3">
              <div className="flex items-center justify-between text-slate-300">
                <span className="flex items-center gap-2 text-slate-400 text-xs sm:text-sm">
                  <User size={16} className="text-emerald-400" /> Khách hàng:
                </span>
                <span className="font-semibold text-slate-100 text-sm">
                  {licenseStatus.customer_name || 'Khách hàng'}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span className="flex items-center gap-2 text-slate-400 text-xs sm:text-sm">
                  <Calendar size={16} className="text-emerald-400" /> Hạn sử dụng:
                </span>
                <div className="flex items-center gap-2.5">
                  <span className="font-bold text-emerald-400 font-mono text-sm">
                    {formatExpireDate(licenseStatus.expires_at)}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Còn {licenseStatus.days_left} ngày
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span className="flex items-center gap-2 text-slate-400 text-xs sm:text-sm">
                  <Key size={16} className="text-emerald-400" /> Key đang dùng:
                </span>
                <span className="font-mono text-slate-200 font-medium text-sm">
                  {licenseStatus.license_key_masked}
                </span>
              </div>
            </div>
          )}

          {/* License Key Input Form */}
          <form onSubmit={handleActivate} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Nhập Mã Bản Quyền (License Key):
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
                  placeholder="VD: VS-KEY-2026-XXXX"
                  disabled={loading}
                  className="w-full bg-[#0b0d14] border border-slate-700/80 rounded-xl pl-4 pr-11 py-3 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition uppercase tracking-wider"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-300 transition cursor-pointer"
                  title={showKey ? 'Ẩn mã key' : 'Hiện mã key'}
                >
                  {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-start gap-2.5">
                <ShieldAlert size={16} className="shrink-0 mt-0.5 text-rose-400" />
                <div className="flex-1 leading-relaxed">{errorMsg}</div>
              </div>
            )}

            {/* Success Message */}
            {successMsg && (
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-start gap-2.5">
                <Check size={16} className="shrink-0 mt-0.5 text-emerald-400" />
                <div className="flex-1 leading-relaxed">{successMsg}</div>
              </div>
            )}

            {/* General Status Warning if not active */}
            {!isValid && licenseStatus?.message && !errorMsg && !successMsg && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                  isBlocked || isTampered
                    ? 'bg-rose-950/30 border-rose-500/30 text-rose-300'
                    : isExpired
                    ? 'bg-amber-950/30 border-amber-500/30 text-amber-300'
                    : isMismatch
                    ? 'bg-purple-950/30 border-purple-500/30 text-purple-300'
                    : 'bg-slate-800/40 border-slate-700/60 text-slate-300'
                }`}
              >
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div className="flex-1 leading-relaxed">{licenseStatus.message}</div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="pt-2 flex items-center gap-3">
              <button
                type="submit"
                disabled={loading || !keyInput.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>Đang kiểm tra máy chủ...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={18} />
                    <span>{isValid ? 'Cập Nhật / Đổi Key' : 'Kích Hoạt Bản Quyền'}</span>
                  </>
                )}
              </button>

              {isValid && canClose && onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-sm font-medium transition cursor-pointer"
                >
                  Đóng
                </button>
              )}
            </div>
          </form>

          {/* Support / Contact Section */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs text-slate-400 space-y-2.5">
            <div className="font-semibold text-slate-200 flex items-center gap-2">
              <HelpCircle size={15} className="text-indigo-400" />
              Liên Hệ Mua Hoặc Gia Hạn Bản Quyền:
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-300 font-medium text-xs sm:text-sm">Cao Triều:</span>
              <a
                href="https://zalo.me/0386690764"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 font-semibold text-xs transition cursor-pointer"
                title="Bấm để mở Zalo chat với Cao Triều"
              >
                <span>Nhắn Zalo: 0386.690.764</span>
                <ExternalLink size={13} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
