# AI Customer Success Coach - サーバー起動スクリプト
# =====================================================
# 起動前に環境変数を設定してください：
#   $env:WATSONX_API_KEY    = "your-api-key"
#   $env:WATSONX_PROJECT_ID = "your-project-id"
#
# またはこのファイルと同じ場所に .env.ps1 を作成して以下を記述：
#   $env:WATSONX_API_KEY    = "your-api-key"
#   $env:WATSONX_PROJECT_ID = "your-project-id"
# =====================================================

# .env.ps1 が存在すれば読み込む
$envFile = Join-Path $PSScriptRoot ".env.ps1"
if (Test-Path $envFile) {
  . $envFile
  Write-Host "Loaded credentials from .env.ps1" -ForegroundColor Gray
}

if (-not $env:WATSONX_API_KEY) {
  Write-Host "ERROR: WATSONX_API_KEY is not set." -ForegroundColor Red
  Write-Host "  Set it manually: `$env:WATSONX_API_KEY = 'your-api-key'" -ForegroundColor Yellow
  exit 1
}
if (-not $env:WATSONX_PROJECT_ID) {
  Write-Host "ERROR: WATSONX_PROJECT_ID is not set." -ForegroundColor Red
  Write-Host "  Set it manually: `$env:WATSONX_PROJECT_ID = 'your-project-id'" -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  AI Customer Success Coach" -ForegroundColor Cyan
Write-Host "  Powered by IBM Watsonx.ai" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting server..." -ForegroundColor Yellow
Write-Host "Open your browser: http://localhost:3000" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

Set-Location "$PSScriptRoot/server"
node index.js
