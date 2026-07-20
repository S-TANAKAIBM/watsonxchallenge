# AI Customer Success Coach - Watsonx.ai API Script
# Usage:
#   .\csm-coach\call_watsonx.ps1 -Mode onboarding
#   .\csm-coach\call_watsonx.ps1 -Mode nba
#   .\csm-coach\call_watsonx.ps1 -Mode qbr

param(
    [ValidateSet("onboarding", "nba", "qbr")]
    [string]$Mode = "onboarding"
)

# ---------------------------------------------------------------
# Settings
# ---------------------------------------------------------------
$API_KEY    = $env:WATSONX_API_KEY
$PROJECT_ID = $env:WATSONX_PROJECT_ID
$REGION     = "jp-tok"

$IAM_URL     = "https://iam.cloud.ibm.com/identity/token"
$WATSONX_URL = "https://$REGION.ml.cloud.ibm.com/ml/v1/text/generation?version=2024-05-01"
$MODEL_ID    = "meta-llama/llama-3-3-70b-instruct"

$PromptFiles = @{
    "onboarding" = ".\csm-coach\demo\prompt_onboarding_A.txt"
    "nba"        = ".\csm-coach\demo\prompt_nba_B.txt"
    "qbr"        = ".\csm-coach\demo\prompt_qbr_C.txt"
}

# ---------------------------------------------------------------
# Input check
# ---------------------------------------------------------------
if (-not $API_KEY) {
    Write-Host "ERROR: WATSONX_API_KEY is not set." -ForegroundColor Red
    Write-Host 'Set it with: $env:WATSONX_API_KEY = "your-api-key"' -ForegroundColor Yellow
    exit 1
}
if (-not $PROJECT_ID) {
    Write-Host "ERROR: WATSONX_PROJECT_ID is not set." -ForegroundColor Red
    Write-Host 'Set it with: $env:WATSONX_PROJECT_ID = "your-project-id"' -ForegroundColor Yellow
    exit 1
}

$promptFile = $PromptFiles[$Mode]
if (-not (Test-Path $promptFile)) {
    Write-Host "ERROR: Prompt file not found: $promptFile" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------
# Step 1: Get IAM Token
# ---------------------------------------------------------------
Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host " AI Customer Success Coach" -ForegroundColor Cyan
Write-Host " Mode: $Mode" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[1/3] Getting IAM token..." -ForegroundColor Yellow

try {
    $iamBody = "grant_type=urn:ibm:params:oauth:grant-type:apikey" + "&apikey=" + $API_KEY
    $iamResponse = Invoke-RestMethod -Uri $IAM_URL -Method POST `
        -ContentType "application/x-www-form-urlencoded" `
        -Body $iamBody
    $accessToken = $iamResponse.access_token
    Write-Host "      OK - Token acquired" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to get IAM token: $_" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------
# Step 2: Load prompt file
# ---------------------------------------------------------------
Write-Host "[2/3] Loading prompt: $promptFile" -ForegroundColor Yellow
$promptText = [string](Get-Content -Path $promptFile -Raw -Encoding UTF8)
Write-Host "      OK - Prompt length: $($promptText.Length) chars" -ForegroundColor Green

# ---------------------------------------------------------------
# Step 3: Call Watsonx.ai API
# ---------------------------------------------------------------
Write-Host "[3/3] Sending to Watsonx.ai (model: $MODEL_ID)..." -ForegroundColor Yellow

$requestHash = [ordered]@{
    model_id   = [string]$MODEL_ID
    project_id = [string]$PROJECT_ID
    input      = [string]$promptText
    parameters = [ordered]@{
        decoding_method    = "greedy"
        max_new_tokens     = [int]1500
        min_new_tokens     = [int]100
        repetition_penalty = [double]1.1
    }
}
$requestBody = $requestHash | ConvertTo-Json -Depth 5 -Compress

try {
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($requestBody)

    # Use WebClient to get raw bytes and decode as UTF-8
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add("Authorization", "Bearer $accessToken")
    $wc.Headers.Add("Content-Type", "application/json; charset=utf-8")
    $responseBytes = $wc.UploadData($WATSONX_URL, "POST", $bodyBytes)
    $responseJson  = [System.Text.Encoding]::UTF8.GetString($responseBytes)
    $response      = $responseJson | ConvertFrom-Json

    $generatedText = $response.results[0].generated_text
    $tokenCount    = $response.results[0].generated_token_count

    Write-Host "      OK - Generation complete (tokens: $tokenCount)" -ForegroundColor Green
    Write-Host ""
    Write-Host "=======================================" -ForegroundColor Cyan
    Write-Host " AI Coach Result" -ForegroundColor Cyan
    Write-Host "=======================================" -ForegroundColor Cyan
    Write-Host ""
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Host $generatedText
    Write-Host ""

    # Save result as UTF-8 without BOM
    $timestamp  = Get-Date -Format "yyyyMMdd_HHmmss"
    $outputPath = (Resolve-Path ".\csm-coach\demo").Path + "\output_${Mode}_${timestamp}.txt"
    $utf8NoBOM  = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($outputPath, $generatedText, $utf8NoBOM)
    Write-Host "Result saved: $outputPath" -ForegroundColor Green

} catch {
    Write-Host "ERROR: Watsonx.ai API call failed: $_" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader    = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errorBody = $reader.ReadToEnd()
        Write-Host "Response detail: $errorBody" -ForegroundColor Red
    }
    exit 1
}
