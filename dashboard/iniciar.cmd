@echo off
rem Dois cliques aqui para abrir o dashboard (tunel + backend + tela). Feche esta janela para parar.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar.ps1"
pause
