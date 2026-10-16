@echo off
setlocal EnableExtensions
title DJ Doktor
cd /d "%~dp0"
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

rem ---------------------------------------------------------------
rem  DJ Doktor 2 - Windows baslatici
rem  Cift tiklayin. Program tarayicida acilir.
rem  Kapatmak icin bu siyah pencereyi kapatin.
rem ---------------------------------------------------------------

call :findpy
if defined PY goto run

echo.
echo  Python 3 bulunamadi. Bu program Python 3.8 veya ustu ile calisir.
echo.
where winget >nul 2>&1
if errorlevel 1 goto manual
choice /c EH /m " Python simdi otomatik kurulsun mu? (E = Evet, H = Hayir)"
if errorlevel 2 goto manual
echo.
echo  Python kuruluyor (birkac dakika surebilir)...
winget install -e --id Python.Python.3.12
call :findpy
if defined PY goto run
echo.
echo  Kurulum bitti ama Python bu pencerede henuz gorunmuyor.
echo  Bu pencereyi kapatip Baslat_Windows.bat dosyasini tekrar acin.
pause
exit /b 1

:manual
echo  1) Acilan sayfadan "Python 3" indirip kurun.
echo  2) Kurulumun ilk ekraninda "Add python.exe to PATH" kutusunu isaretleyin.
echo  3) Sonra bu dosyayi tekrar acin.
start "" "https://www.python.org/downloads/windows/"
pause
exit /b 1

:run
echo  Python: %PY%
%PY% baslat.py %*
if errorlevel 1 pause
exit /b

rem --- Python'u PATH'te ve bilinen kurulum yerlerinde ara ---
:findpy
set "PY="
for %%C in ("py -3" "python" "python3") do (
  if not defined PY (
    %%~C -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>&1 && set "PY=%%~C"
  )
)
if defined PY exit /b 0
for %%L in ("%LOCALAPPDATA%\Programs\Python\Launcher\py.exe" "%WINDIR%\py.exe") do (
  if not defined PY if exist %%L (
    %%L -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>&1 && set "PY=%%L -3"
  )
)
if defined PY exit /b 0
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*" "%ProgramFiles%\Python3*") do (
  if not defined PY if exist "%%~D\python.exe" (
    "%%~D\python.exe" -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>&1 && set PY="%%~D\python.exe"
  )
)
exit /b 0
