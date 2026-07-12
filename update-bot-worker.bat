@echo off
echo ========================================
echo  LuauX Bot-Worker Update Script
echo ========================================

cd /d "C:\Users\Administrator\Downloads\luauxbeaming-main (6)\luauxbeaming-main"

echo.
echo [1/4] Pulling latest code from GitHub...
git pull origin main
if %errorlevel% neq 0 (
    echo ERROR: git pull failed
    pause
    exit /b 1
)

echo.
echo [2/4] Installing dependencies...
cd bot-worker
call npm install
if %errorlevel% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)

echo.
echo [3/4] Building...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: build failed
    pause
    exit /b 1
)

echo.
echo [4/4] Restarting bot-worker...
pm2 delete bot-worker 2>nul
pm2 start dist\index.js --name "bot-worker"
pm2 save

echo.
echo ========================================
echo  Done! Bot-worker updated and restarted
echo ========================================
pm2 status bot-worker
pause
