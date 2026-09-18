import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import {
  LayoutGrid, Wand2, ShoppingBag, Film, CalendarDays, Settings, ChevronRight,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react';

import LibraryPage from './pages/Library/LibraryPage';
import ModuleLocalizePage from './pages/ModuleLocalize/ModuleLocalizePage';
import LocalizeEditorPage from './pages/ModuleLocalize/LocalizeEditorPage';
import LocalizePresetsPage from './pages/ModuleLocalize/LocalizePresetsPage';
import ModuleAffiliatePage from './pages/ModuleAffiliate/ModuleAffiliatePage';
import EditorPage from './pages/Editor/EditorPage';
import SchedulerPage from './pages/Scheduler/SchedulerPage';
import SettingsPage from './pages/Settings/SettingsPage';

const NAV_ITEMS = [
  { to: '/library',   icon: LayoutGrid,    label: 'Thư Viện' },
  { to: '/localize',  icon: Wand2,         label: 'Lồng Tiếng' },
  { to: '/affiliate', icon: ShoppingBag,   label: 'Affiliate' },
  { to: '/editor',    icon: Film,          label: 'Hậu Kỳ & Lên Lịch' },
  { to: '/scheduler', icon: CalendarDays,  label: 'Lịch Đăng' },
];

export default function App() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('sidebar_collapsed', String(isCollapsed));
    } catch {}
  }, [isCollapsed]);

  // Keyboard shortcut: Cmd/Ctrl + B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <HashRouter>
      <div className="flex h-screen overflow-hidden bg-[#0f1117] text-slate-200">
        {/* Sidebar */}
        <aside
          className={`${
            isCollapsed ? 'w-16' : 'w-56'
          } flex-shrink-0 bg-[#12151e] border-r border-slate-800/80 flex flex-col transition-all duration-200 ease-in-out select-none`}
        >
          {/* Logo & Toggle Button */}
          <div className="h-12 flex items-center px-3.5 border-b border-slate-800/80 justify-between">
            {!isCollapsed ? (
              <>
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0 shadow-sm shadow-indigo-500/20">
                    <Film size={14} className="text-white" />
                  </div>
                  <span className="text-sm font-bold text-slate-100 whitespace-nowrap tracking-tight">Video Studio</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCollapsed(true)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
                  title="Thu gọn menu (Ctrl+B / Cmd+B)"
                >
                  <PanelLeftClose size={17} />
                </button>
              </>
            ) : (
              <div className="w-full flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => setIsCollapsed(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
                  title="Mở rộng menu (Ctrl+B / Cmd+B)"
                >
                  <PanelLeftOpen size={18} />
                </button>
              </div>
            )}
          </div>

          {/* Nav */}
          <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto overflow-x-hidden">
            {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                title={isCollapsed ? label : undefined}
                className={({ isActive }) =>
                  `flex items-center rounded-xl text-xs font-medium transition-all duration-150 group ${
                    isCollapsed
                      ? 'justify-center p-2.5'
                      : 'gap-3 px-3 py-2.5'
                  } ${
                    isActive
                      ? 'bg-indigo-600/20 text-indigo-400 font-semibold border border-indigo-500/30 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={18}
                      className={`shrink-0 transition ${
                        isActive ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-200'
                      }`}
                    />
                    {!isCollapsed && <span className="flex-1 truncate">{label}</span>}
                    {!isCollapsed && isActive && <ChevronRight size={13} className="text-indigo-400/60" />}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Bottom: Settings */}
          <div className="p-2 border-t border-slate-800/80">
            <NavLink
              to="/settings"
              title={isCollapsed ? 'Cài Đặt' : undefined}
              className={({ isActive }) =>
                `flex items-center rounded-xl text-xs font-medium transition-all duration-150 group ${
                  isCollapsed
                    ? 'justify-center p-2.5'
                    : 'gap-3 px-3 py-2.5'
                } ${
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-400 font-semibold border border-indigo-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Settings
                    size={18}
                    className={`shrink-0 transition ${
                      isActive ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  />
                  {!isCollapsed && <span className="flex-1 truncate">Cài Đặt</span>}
                </>
              )}
            </NavLink>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/library" replace />} />
            <Route path="/library"   element={<LibraryPage />} />
            <Route path="/localize"  element={<ModuleLocalizePage />} />
            <Route path="/localize/presets" element={<LocalizePresetsPage />} />
            <Route path="/localize/editor/:videoId" element={<LocalizeEditorPage />} />
            <Route path="/affiliate" element={<ModuleAffiliatePage />} />
            <Route path="/editor"    element={<EditorPage />} />
            <Route path="/scheduler" element={<SchedulerPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
