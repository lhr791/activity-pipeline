@echo off
chcp 65001 >nul
echo ============================================
echo   活动整理 Pipeline - 一键部署
echo ============================================
echo.

REM 检查 Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] 未找到 Python，请先安装 Python 3.11+
    echo     https://www.python.org/downloads/
    pause
    exit /b 1
)

REM 创建虚拟环境
echo [1/4] 创建 Python 虚拟环境...
python -m venv venv
call venv\Scripts\activate.bat

REM 安装 Python 依赖
echo [2/4] 安装 Python 依赖...
python -m pip install --upgrade pip -q
python -m pip install -r requirements.txt -q

REM 安装 Playwright 浏览器
echo [3/4] 安装 Playwright Chromium...
playwright install chromium

REM 检查 .env
if not exist .env (
    echo [!] 请先配置 .env 文件（参考 .env.example）
    copy .env.example .env
    echo     已复制 .env.example -> .env，请填入 API Key
)

echo.
echo [4/4] 检查 Node.js（前端仪表盘，可选）...
node --version >nul 2>&1
if %errorlevel% equ 0 (
    if exist web\package.json (
        cd web
        npm install -q
        cd ..
        echo     前端依赖已安装
    )
) else (
    echo     未找到 Node.js，跳过前端安装（不影响核心功能）
)

echo.
echo ============================================
echo   部署完成！
echo.
echo   运行方式：
echo     venv\Scripts\python.exe run_pipeline.py
echo     venv\Scripts\python.exe bonus_rules.py --bonus-rules
echo ============================================
pause
