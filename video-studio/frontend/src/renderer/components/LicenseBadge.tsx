import React from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle, Lock } from 'lucide-react';
import { LicenseStatus } from '../api/client';

interface LicenseBadgeProps {
  licenseStatus: LicenseStatus | null;
  isCollapsed?: boolean;
  onClick: () => void;
}

export default function LicenseBadge({
  licenseStatus,
  isCollapsed = false,
  onClick,
}: LicenseBadgeProps) {
  if (!licenseStatus) {
    return null;
  }

  const { is_valid, days_left, status } = licenseStatus;

  // Status visual variations
  let badgeClasses = '';
  let Icon = ShieldCheck;
  let text = '';
  let subText = '';

  if (is_valid) {
    if (days_left <= 3) {
      badgeClasses = 'bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25';
      Icon = AlertTriangle;
      text = `Sắp hết hạn (${days_left} ngày)`;
      subText = 'Bấm để gia hạn';
    } else {
      badgeClasses = 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20';
      Icon = ShieldCheck;
      text = `Còn ${days_left} ngày`;
      subText = 'Bản quyền Pro';
    }
  } else {
    badgeClasses = 'bg-rose-500/15 border-rose-500/30 text-rose-300 hover:bg-rose-500/25';
    Icon = status === 'blocked' ? ShieldAlert : Lock;
    text = status === 'blocked' ? 'Bị khóa' : status === 'expired' ? 'Hết hạn' : 'Chưa kích hoạt';
    subText = 'Bấm kích hoạt';
  }

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={`Bản quyền: ${text}`}
        className={`w-10 h-10 mx-auto rounded-xl border flex items-center justify-center transition cursor-pointer ${badgeClasses}`}
      >
        <Icon size={18} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border transition text-left cursor-pointer select-none ${badgeClasses}`}
    >
      <div className="shrink-0">
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold leading-tight truncate">{text}</div>
        <div className="text-[10px] opacity-75 truncate">{subText}</div>
      </div>
    </button>
  );
}
