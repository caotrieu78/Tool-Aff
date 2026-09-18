import sys
import os
import multiprocessing

# Ensure freeze support for Windows multiprocessing
if __name__ == "__main__":
    multiprocessing.freeze_support()

# Add current directory and backend root to sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if getattr(sys, "frozen", False):
    # Running in a PyInstaller bundle
    BASE_DIR = getattr(sys, "_MEIPASS", BASE_DIR)

if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

# Set environment variables for storage if not present
if "STORAGE_PATH" not in os.environ:
    if getattr(sys, "frozen", False):
        # In production, store user data in user documents or app directory
        user_data = os.path.join(os.path.expanduser("~"), ".video_studio")
        os.makedirs(user_data, exist_ok=True)
        os.environ["STORAGE_PATH"] = user_data

import uvicorn

def main():
    port = int(os.environ.get("BACKEND_PORT", 8765))
    host = os.environ.get("BACKEND_HOST", "127.0.0.1")
    
    print(f"[VideoStudioBackend] Starting server at http://{host}:{port}")
    print(f"[VideoStudioBackend] Frozen mode: {getattr(sys, 'frozen', False)}")
    print(f"[VideoStudioBackend] Base dir: {BASE_DIR}")
    
    # Import app directly to prevent string reload issues in frozen binaries
    from app.main import app
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
        access_log=True,
        loop="asyncio",
    )

if __name__ == "__main__":
    main()
