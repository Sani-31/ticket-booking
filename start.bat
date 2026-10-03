@echo off
echo ========================================
echo   FairDrop - Quick Start Script
echo ========================================
echo.

echo [1/2] Checking Docker...
docker --version > nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker is not installed or not running.
    echo Please install Docker Desktop from https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

echo [2/2] Building and starting the full application...
if not exist .env copy .env.example .env > nul
docker compose up --build -d
if %errorlevel% neq 0 (
    echo ERROR: Docker Compose could not start FairDrop.
    pause
    exit /b 1
)
echo.
echo FairDrop is starting at http://localhost:3000
echo API health check: http://localhost:4000/health
echo Use "docker compose logs -f" to follow startup.
echo.
echo  Test accounts:
echo    User: user@fairdrop.com / user123
echo    Admin: admin@fairdrop.com / admin123
echo ========================================
pause
