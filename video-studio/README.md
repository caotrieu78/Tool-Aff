# Video Studio

Ứng dụng desktop tự động **Việt hóa video** và **dựng video Affiliate**, tích hợp đăng tự động lên TikTok.

## Cấu trúc dự án

```
video-studio/
├── frontend/          # Electron + React + TypeScript + TailwindCSS
│   ├── src/
│   │   ├── main.ts        # Electron main process (spawn backend)
│   │   ├── preload.ts     # IPC bridge
│   │   └── renderer/      # React app
│   │       ├── App.tsx
│   │       ├── pages/     # Library, ModuleLocalize, ModuleAffiliate, Editor, Scheduler, Settings
│   │       ├── components/
│   │       ├── stores/    # Zustand
│   │       └── api/       # REST client → FastAPI
│   ├── index.html
│   └── package.json
│
├── backend/           # Python FastAPI
│   ├── app/
│   │   ├── main.py        # FastAPI entrypoint
│   │   ├── api/           # Route handlers
│   │   ├── models/        # SQLAlchemy models (SQLite)
│   │   ├── services/      # AI pipeline services
│   │   └── workers/       # Job queue runner
│   ├── requirements.txt
│   └── storage/           # Video files library
│
└── README.md
```

## Cài đặt & Chạy

### Backend (Python FastAPI)
```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Frontend (Electron + React)
```bash
cd frontend
npm install
npm run start
```

Electron sẽ tự động spawn Python backend khi khởi động.

## Stack

| Layer | Công nghệ |
|-------|-----------|
| **Frontend** | Electron + React 18 + TypeScript + TailwindCSS + Zustand |
| **Backend** | Python + FastAPI + SQLAlchemy + SQLite |
| **AI** | Gemini API + PaddleOCR + faster-whisper + Kokoro-TTS/Edge-TTS |
| **Video** | FFmpeg + OpenCV + PySceneDetect |
| **Đăng bài** | TikTok Content Posting API + APScheduler |
