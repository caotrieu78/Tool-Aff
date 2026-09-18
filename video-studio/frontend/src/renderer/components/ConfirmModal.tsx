import React from 'react';
import { AlertTriangle, Trash2, RefreshCw, X } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Xác nhận xóa',
  cancelText = 'Hủy',
  isDanger = true,
  isLoading = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div
        className="w-full max-w-sm bg-[#161922] border border-slate-700/80 rounded-2xl shadow-2xl p-5 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close icon */}
        <button
          onClick={onClose}
          disabled={isLoading}
          className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 p-1 rounded-md transition"
        >
          <X size={16} />
        </button>

        {/* Icon & Title */}
        <div className="flex items-start gap-3.5">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
              isDanger
                ? 'bg-rose-500/15 text-rose-400 border border-rose-500/25'
                : 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/25'
            }`}
          >
            {isDanger ? <Trash2 size={20} /> : <AlertTriangle size={20} />}
          </div>

          <div className="flex-1 pr-4">
            <h3 className="text-sm font-semibold text-white tracking-tight leading-snug">
              {title}
            </h3>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              {message}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-5 flex items-center justify-end gap-2 pt-3 border-t border-slate-800/80">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700/60 transition disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20'
                : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/20'
            }`}
          >
            {isLoading && <RefreshCw size={12} className="animate-spin" />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
