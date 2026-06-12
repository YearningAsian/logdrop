@echo off
echo Initializing logdrop repo...
git init
git add .
git commit -m "feat: initial scaffold — logdrop structured log explorer"
echo.
echo Done! Next steps:
echo   npm install
echo   npm run tauri dev
echo.
echo To push to GitHub:
echo   gh repo create logdrop --public --source=. --remote=origin --push
pause
