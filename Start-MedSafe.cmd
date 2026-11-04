@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0MedSafe\backend\start.ps1" %*
if errorlevel 1 pause
