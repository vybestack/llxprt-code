@echo off
setlocal enableextensions enabledelayedexpansion

rem LLxprt Code Windows launcher (issue #2978).
rem Finds the bundled Bun runtime and execs the LLxprt Code entry point.
rem Shipped by @vybestack/llxprt-cli-win32. It has NO Node dependency.

rem Resolve this script directory (the launcher package bin folder).
set "LAUNCHER_DIR=%~dp0"
set "LAUNCHER_DIR=!LAUNCHER_DIR:~0,-1!"

rem Resolve the main @vybestack/llxprt-code package directory.
set "MAIN_PKG=!LAUNCHER_DIR!\..\..\llxprt-code"
if exist "!MAIN_PKG!\index.ts" goto :main_ok
set "MAIN_PKG="
set "WALK=!LAUNCHER_DIR!"
:find_main
if exist "!WALK!\node_modules\@vybestack\llxprt-code\index.ts" (
  set "MAIN_PKG=!WALK!\node_modules\@vybestack\llxprt-code"
  goto :main_ok
)
for %%I in ("!WALK!\..") do set "PARENT=%%~fI"
if "!PARENT!"=="!WALK!" goto :main_missing
set "WALK=!PARENT!"
goto :find_main
:main_missing
echo LLxprt Code: could not locate the @vybestack/llxprt-code package. 1>&2
echo Your installation may be corrupt; reinstall @vybestack/llxprt-code. 1>&2
endlocal
exit /b 1
:main_ok

rem Resolve the entry point (prebuilt bundle first, then TypeScript source).
set "ENTRY=!MAIN_PKG!\index.ts"
if /i not "%LLXPRT_FORCE_SOURCE_ENTRY%"=="1" (
  if exist "!MAIN_PKG!\bundle\llxprt.js" set "ENTRY=!MAIN_PKG!\bundle\llxprt.js"
)
if exist "!ENTRY!" goto :entry_ok
echo LLxprt Code: entry point was not found. 1>&2
echo Expected: !ENTRY! 1>&2
echo Your installation may be corrupt; reinstall @vybestack/llxprt-code. 1>&2
endlocal
exit /b 1
:entry_ok

rem Resolve the Bun runtime (mirrors src/launcher/bun-path-resolver.ts).
set "BUN_EXE="

rem Pass 1: bundled bun.exe and its .bin shim, nearest ancestor first.
set "WALK=!MAIN_PKG!"
:bun_loop
if exist "!WALK!\node_modules\bun\bin\bun.exe" (
  set "BUN_EXE=!WALK!\node_modules\bun\bin\bun.exe"
  goto :bun_found
)
if exist "!WALK!\node_modules\.bin\bun.exe" (
  set "BUN_EXE=!WALK!\node_modules\.bin\bun.exe"
  goto :bun_found
)
for %%I in ("!WALK!\..") do set "PARENT=%%~fI"
if "!PARENT!"=="!WALK!" goto :bun_pass2
set "WALK=!PARENT!"
goto :bun_loop

:bun_pass2
rem Pass 2: @oven prebuilt variants (issue #2978), nearest ancestor first.
set "WALK=!MAIN_PKG!"
:oven_loop
if exist "!WALK!\node_modules\@oven\bun-windows-x64\bin\bun.exe" (
  set "BUN_EXE=!WALK!\node_modules\@oven\bun-windows-x64\bin\bun.exe"
  goto :bun_found
)
if exist "!WALK!\node_modules\@oven\bun-windows-x64-baseline\bin\bun.exe" (
  set "BUN_EXE=!WALK!\node_modules\@oven\bun-windows-x64-baseline\bin\bun.exe"
  goto :bun_found
)
for %%I in ("!WALK!\..") do set "PARENT=%%~fI"
if "!PARENT!"=="!WALK!" goto :bun_pass3
set "WALK=!PARENT!"
goto :oven_loop

:bun_pass3
rem Pass 3: a Bun already present on PATH.
for /f "delims=" %%P in ('where bun.exe 2^>nul') do (
  set "BUN_EXE=%%P"
  goto :bun_found
)
for /f "delims=" %%P in ('where bun.cmd 2^>nul') do (
  set "BUN_EXE=%%P"
  goto :bun_found
)

:bun_found
if not defined BUN_EXE (
  echo LLxprt Code: could not locate the Bun runtime. 1>&2
  echo Install Bun from https://bun.sh or ensure it is on PATH, then retry. 1>&2
  endlocal
  exit /b 1
)

rem Exec Bun with the entry point, forwarding all arguments verbatim.
"!BUN_EXE!" "!ENTRY!" %*
set "RC=!ERRORLEVEL!"
endlocal & exit /b %RC%
