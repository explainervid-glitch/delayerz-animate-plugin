@echo off
:: ============================================================
:: DelayerZ - Installer Launcher
:: Runs operator.ps1, which self-elevates to Administrator.
:: ============================================================

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0operator.ps1"
