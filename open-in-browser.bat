@echo off
rem Abre o Do Outro Lado no navegador padrao (o mesmo servidor do atalho).
cd /d "%~dp0"
start "" http://127.0.0.1:8084/
python start.py
