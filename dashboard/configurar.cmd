@echo off
rem Dois cliques aqui para configurar o dashboard (chaves, assistente, testes e programas instalados).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configurar.ps1"
