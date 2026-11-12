@echo off
setlocal
title Actualizar AVG ACARS MSFS 2020
echo.
echo   AVG ACARS 0.1.4 - actualizacion de la instalacion existente
echo   Esta utilidad NO crea un segundo AVG ACARS.
echo   Cierra el AVG ACARS anterior antes de continuar.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Actualizar_AVG_ACARS.ps1"
if errorlevel 1 (
  echo.
  echo No se actualizo el ACARS. Revisa el mensaje y vuelve a intentarlo.
  pause
)
endlocal
