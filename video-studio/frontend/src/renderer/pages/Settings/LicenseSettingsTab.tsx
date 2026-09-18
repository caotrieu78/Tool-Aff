import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Key,
  Copy,
  Check,
  RefreshCw,
  Cpu,
  Calendar,
  User,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { licenseApi, LicenseStatus } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';

export default function LicenseSettingsTab() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [copiedHwid, setCopiedHwid] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Confirm Modal state for Deactivate
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const loadStatus = async (force = false) => {
    try {
      if (force) setRefreshing(true);
      else setLoading(true);
      const data = await licenseApi.getStatus(force);
      setStatus(data);
    } catch (e: any) {
      setAlertInfo({ type: 'error', message: `Không thể nạp thông tin bản quyền: ${e.message}` });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleCopyHwid = async () => {
    if (!status?.machine_id) return;
    try {
      await navigator.clipboard.writeText(status.machine_id);
      setCopiedHwid(true);
      setTimeout(() => setCopiedHwid(false), 2000);
    } catch (_err) {
      // ignore clipboard error
    }
  };

  const handleActivateNewKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = newKey.trim().toUpperCase();
    if (!cleanKey) {
      setAlertInfo({ type: 'error', message: 'Vui lòng nhập License Key!' });
      return;
    }

    setActivating(true);
    setAlertInfo(null);
    try {
      const res = await licenseApi.activate(cleanKey);
      setAlertInfo({ type: 'success', message: res.message || 'Kích hoạt thành công!' });
      setNewKey('');
      await loadStatus(true);
    } catch (err: any) {
      let msg = err.message || 'Kích hoạt thất bại!';
      try {
        const parsed = JSON.parse(msg.replace(/^API .* failed \(\d+\): /, ''));
        if (parsed.detail) msg = parsed.detail;
      } catch (_jsonErr) {
        // ignore parse error
      }
      setAlertInfo({ type: 'error', message: msg });
    } finally {
      setActivating(false);
    }
  };


  const handleConfirmDeactivate = async () => {
    setDeactivating(true);
    try {
      await licenseApi.deactivate();
      setShowDeactivateModal(false);
      setAlertInfo({ type: 'success', message: 'Đã hủy kích hoạt bản quyền trên máy này.' });
      await loadStatus(true);
    } catch (err: any) {
      setAlertInfo({ type: 'error', message: `Lỗi: ${err.message}` });
    } finally {
      setDeactivating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
        <RefreshCw size={18} className="animate-spin text-indigo-400" />
        <span className="text-sm">Đang tải thông tin bản quyền...</span>
      </div>
    );
  }

  const isValid = status?.is_valid;
  const isBlocked = status?.status === 'blocked';
  const isExpired = status?.status === 'expired';

  return (
    <div className="space-y-6">
      {/* Alert banner */}
      {alertInfo && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between transition ${
            alertInfo.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {alertInfo.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
            <span>{alertInfo.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setAlertInfo(null)}
            className="text-xs opacity-75 hover:opacity-100 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Main Status Card */}
      <div className="bg-[#161a24] border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div className="flex items-center gap-3.5">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center border shadow-md ${
                isValid
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-emerald-500/10'
                  : isBlocked || isExpired
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 shadow-rose-500/10'
                  : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 shadow-indigo-500/10'
              }`}
            >
              {isValid ? <ShieldCheck size={26} /> : <ShieldAlert size={26} />}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-base font-bold text-slate-100">
                  {isValid ? 'Bản Quyền Đang Hoạt Động' : 'Chưa Kích Hoạt / Bản Quyền Hết Hạn'}
                </h3>
                <span
                  className={`text-[11px] font-semibold uppercase px-2.5 py-0.5 rounded-full border ${
                    isValid
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : isBlocked
                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                      : isExpired
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : 'bg-slate-700/40 border-slate-600/40 text-slate-300'
                  }`}
                >
                  {status?.status === 'active'
                    ? 'PRO ACTIVE'
                    : status?.status === 'offline_grace'
                    ? 'OFFLINE GRACE'
                    : status?.status?.toUpperCase() || 'INACTIVE'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {status?.message || 'Quản lý thời hạn và thông tin kích hoạt máy tính.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => loadStatus(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              <span>{refreshing ? 'Đang kiểm tra...' : 'Kiểm tra máy chủ'}</span>
            </button>

            {isValid && (
              <button
                type="button"
                onClick={() => setShowDeactivateModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-950/30 hover:bg-rose-900/40 text-rose-300 text-xs font-medium border border-rose-800/40 transition cursor-pointer"
              >
                <Trash2 size={13} />
                <span>Hủy kích hoạt</span>
              </button>
            )}
          </div>
        </div>

        {/* License details grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-5">
          <div className="bg-[#11141c] border border-slate-800/80 rounded-xl p-4">
            <div className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5 mb-1.5">
              <User size={13} className="text-indigo-400" />
              Khách Hàng Đăng Ký
            </div>
            <div className="text-sm font-semibold text-slate-100 truncate">
              {status?.customer_name || 'Chưa có thông tin'}
            </div>
          </div>

          <div className="bg-[#11141c] border border-slate-800/80 rounded-xl p-4">
            <div className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5 mb-1.5">
              <Calendar size={13} className="text-indigo-400" />
              Hạn Sử Dụng & Ngày Còn Lại
            </div>
            <div className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="font-mono text-emerald-400">
                {(() => {
                  const dateStr = status?.expires_at;
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
                })()}
              </span>
              {isValid && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                  Còn {status?.days_left} ngày
                </span>
              )}
            </div>
          </div>

          <div className="bg-[#11141c] border border-slate-800/80 rounded-xl p-4">
            <div className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5 mb-1.5">
              <Key size={13} className="text-indigo-400" />
              Mã Bản Quyền (License Key)
            </div>
            <div className="text-sm font-mono font-semibold text-slate-100">
              {status?.license_key_masked || 'Chưa nhập key'}
            </div>
          </div>
        </div>
      </div>

      {/* Hardware ID (HWID) Section */}
      <div className="bg-[#161a24] border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Cpu size={16} className="text-indigo-400" />
          <h4 className="text-sm font-bold text-slate-100">Mã Phần Cứng Máy Tính (Hardware ID)</h4>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Hệ thống sử dụng Hardware ID để tự động ghim bản quyền vào máy tính của khách hàng, chống chia sẻ key ra ngoài.
        </p>

        <div className="flex items-center gap-3 bg-[#11141c] border border-slate-800 rounded-xl p-3 max-w-2xl">
          <span className="font-mono text-sm font-semibold text-indigo-300 tracking-wider flex-1 select-all">
            {status?.machine_id}
          </span>
          <button
            type="button"
            onClick={handleCopyHwid}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition cursor-pointer"
          >
            {copiedHwid ? (
              <>
                <Check size={14} className="text-emerald-400" />
                <span className="text-emerald-400">Đã sao chép!</span>
              </>
            ) : (
              <>
                <Copy size={14} />
                <span>Sao chép HWID</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Activate / Change Key Form */}
      <div className="bg-[#161a24] border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Key size={16} className="text-indigo-400" />
          <h4 className="text-sm font-bold text-slate-100">Kích Hoạt / Đổi Mã Bản Quyền Mới</h4>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Nhập mã License Key nhận từ Cao Triều để kích hoạt hoặc gia hạn gói phần mềm.
        </p>

        <form onSubmit={handleActivateNewKey} className="flex items-center gap-3 max-w-2xl">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase())}
            placeholder="VD: VS-KEY-2026-XXXX"
            className="flex-1 bg-[#11141c] border border-slate-700/80 rounded-xl px-4 py-2 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition uppercase"
          />
          <button
            type="submit"
            disabled={activating || !newKey.trim()}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-600/20 transition disabled:opacity-50 cursor-pointer flex items-center gap-2"
          >
            {activating ? (
              <>
                <RefreshCw size={13} className="animate-spin" />
                <span>Đang kiểm tra...</span>
              </>
            ) : (
              <>
                <ShieldCheck size={14} />
                <span>Kích hoạt</span>
              </>
            )}
          </button>
        </form>
      </div>


      {/* Confirm Deactivate Modal */}
      <ConfirmModal
        isOpen={showDeactivateModal}
        title="Xác nhận hủy kích hoạt bản quyền?"
        message="Mã bản quyền hiện tại sẽ bị xóa khỏi máy này. Ứng dụng sẽ bị khóa cho đến khi được nhập mã bản quyền mới."
        isLoading={deactivating}
        confirmText="Hủy kích hoạt ngay"
        isDanger={true}
        onConfirm={handleConfirmDeactivate}
        onClose={() => setShowDeactivateModal(false)}
      />
    </div>
  );
}
