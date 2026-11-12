@echo off
title Threadscape Studio
cd /d "%~dp0"
echo Starting Threadscape Local Studio Server...
start "" "http://localhost:3000/level_editor.html"
node server.js
pause

