@echo off
echo ================================================
echo    سامانه مدیریت دفتر حقوقی
echo ================================================
echo.
echo در حال نصب...
call npm install
echo.
echo در حال اجرا...
echo.
echo آدرس: http://localhost:3000
echo.
start http://localhost:3000
node server.js
pause
