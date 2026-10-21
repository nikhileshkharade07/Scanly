# Launches the Scanly C++ processing backend on port 8080.
#
# The server binary links OpenCV, Tesseract and PoDoFo DLLs from MSYS2, so
# C:\msys64\ucrt64\bin must be on PATH, and Tesseract needs TESSDATA_PREFIX
# pointed at the language-data directory (otherwise OCR fails with
# "Error opening data file ./eng.traineddata").
#
# Usage:  .\scripts\start-backend.ps1     (from the scanly/ directory)

$server = Join-Path $PSScriptRoot "..\build\scanly_server.exe"
if (-not (Test-Path $server)) {
  Write-Error "scanly_server.exe not found at $server — build the backend first (cmake --build build)."
  exit 1
}

$env:PATH = "C:\msys64\ucrt64\bin;$env:PATH"
$env:TESSDATA_PREFIX = "C:\msys64\ucrt64\share\tessdata"

Write-Host "Starting scanly_server on http://127.0.0.1:8080 (Ctrl+C to stop)…"
& $server @args
