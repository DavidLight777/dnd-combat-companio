@echo off
chcp 65001 >nul
echo Stopping DnD Combat Companion server...

:: Kill all Python processes running main.py
for /f "tokens=2" %%a in ('tasklist ^| findstr "python.exe"') do (
    taskkill /F /PID %%a 2>nul
)

echo Server stopped.
pause
