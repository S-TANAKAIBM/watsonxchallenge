# AI Customer Success Coach - Customer Karute (Record) Manager
# Usage:
#   .\csm-coach\karute.ps1 -Action load -ICN 1234567
#   .\csm-coach\karute.ps1 -Action save -ICN 1234567 -Mode onboarding -DataFile .\csm-coach\demo\prompt_onboarding_A.txt
#   .\csm-coach\karute.ps1 -Action history -ICN 1234567

param(
    [ValidateSet("load","save","history","list")]
    [string]$Action = "list",
    [string]$ICN    = "",
    [string]$Mode   = "",
    [string]$OutputFile = ""
)

$KaruteDir = ".\csm-coach\karute"
if (-not (Test-Path $KaruteDir)) { New-Item -ItemType Directory -Path $KaruteDir | Out-Null }

$utf8 = New-Object System.Text.UTF8Encoding $false

# ---------------------------------------------------------------
# Helper: Load karute
# ---------------------------------------------------------------
function Get-Karute($icn) {
    $path = "$KaruteDir\$icn.json"
    if (Test-Path $path) {
        $raw = [System.IO.File]::ReadAllText((Resolve-Path $path).Path, [System.Text.Encoding]::UTF8)
        return $raw | ConvertFrom-Json
    }
    return $null
}

# ---------------------------------------------------------------
# Helper: Save karute
# ---------------------------------------------------------------
function Save-Karute($icn, $obj) {
    $path = "$KaruteDir\$icn.json"
    $json = $obj | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText((Resolve-Path $KaruteDir).Path + "\$icn.json", $json, $utf8)
    Write-Host "Karute saved: $path" -ForegroundColor Green
}

# ---------------------------------------------------------------
# ACTION: list
# ---------------------------------------------------------------
if ($Action -eq "list") {
    $files = Get-ChildItem "$KaruteDir\*.json" -ErrorAction SilentlyContinue
    if (-not $files) {
        Write-Host "No karute found. Run with -Action save to create one." -ForegroundColor Yellow
        exit 0
    }
    Write-Host ""
    Write-Host "===== Saved Karute =====" -ForegroundColor Cyan
    foreach ($f in $files) {
        $raw = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
        $k   = $raw | ConvertFrom-Json
        $icn = $f.BaseName
        $updated = $k.last_updated
        $company = $k.company_name
        $product = $k.products
        $count   = if ($k.history) { $k.history.Count } else { 0 }
        Write-Host "  ICN: $icn | $company | $product | 最終更新: $updated | 実行回数: $count 回" -ForegroundColor White
    }
    Write-Host ""
    exit 0
}

# ---------------------------------------------------------------
# ACTION: load
# ---------------------------------------------------------------
if ($Action -eq "load") {
    if (-not $ICN) { Write-Host "ERROR: -ICN is required." -ForegroundColor Red; exit 1 }
    $k = Get-Karute $ICN
    if (-not $k) {
        Write-Host "Karute not found for ICN: $ICN" -ForegroundColor Yellow
        Write-Host "A new karute will be created when you run -Action save." -ForegroundColor Yellow
        exit 0
    }
    Write-Host ""
    Write-Host "===== Karute: ICN $ICN =====" -ForegroundColor Cyan
    Write-Host "  会社名    : $($k.company_name)"
    Write-Host "  契約製品  : $($k.products)"
    Write-Host "  最終更新  : $($k.last_updated)"
    Write-Host "  フェーズ  : $($k.current_state.phase)"
    Write-Host "  活動率    : $($k.current_state.active_rate)"
    Write-Host "  NPS       : $($k.current_state.nps_score)"
    Write-Host "  BP        : $($k.current_state.bp_name) / $($k.current_state.bp_experience)"
    Write-Host ""
    if ($k.introduced_webinars -and $k.introduced_webinars.Count -gt 0) {
        Write-Host "  紹介済みWebinar:" -ForegroundColor Yellow
        foreach ($w in $k.introduced_webinars) { Write-Host "    - $w" }
    } else {
        Write-Host "  紹介済みWebinar: なし" -ForegroundColor Gray
    }
    Write-Host ""
    if ($k.history -and $k.history.Count -gt 0) {
        Write-Host "  実行履歴（直近3件）:" -ForegroundColor Yellow
        $recent = $k.history | Select-Object -Last 3
        foreach ($h in $recent) {
            Write-Host "    [$($h.date)] Mode=$($h.mode) Risk=$($h.risk_level)"
        }
    }
    Write-Host ""
    exit 0
}

# ---------------------------------------------------------------
# ACTION: save  (called after call_watsonx.ps1 runs)
# ---------------------------------------------------------------
if ($Action -eq "save") {
    if (-not $ICN)        { Write-Host "ERROR: -ICN is required."        -ForegroundColor Red; exit 1 }
    if (-not $Mode)       { Write-Host "ERROR: -Mode is required."       -ForegroundColor Red; exit 1 }
    if (-not $OutputFile) { Write-Host "ERROR: -OutputFile is required." -ForegroundColor Red; exit 1 }
    if (-not (Test-Path $OutputFile)) { Write-Host "ERROR: OutputFile not found: $OutputFile" -ForegroundColor Red; exit 1 }

    $outputText = [System.IO.File]::ReadAllText((Resolve-Path $OutputFile).Path, [System.Text.Encoding]::UTF8)

    # Detect risk level from output
    $riskLevel = "UNKNOWN"
    if ($outputText -match "HIGH RISK")  { $riskLevel = "HIGH RISK" }
    elseif ($outputText -match "MEDIUM") { $riskLevel = "MEDIUM" }
    elseif ($outputText -match "HEALTHY|LOW") { $riskLevel = "HEALTHY" }

    # Load existing or create new
    $k = Get-Karute $ICN
    if (-not $k) {
        $k = [PSCustomObject]@{
            icn              = $ICN
            company_name     = "（未入力）"
            products         = "（未入力）"
            last_updated     = (Get-Date -Format "yyyy-MM-dd")
            current_state    = [PSCustomObject]@{
                phase        = "（未入力）"
                active_rate  = "（未入力）"
                nps_score    = "（未入力）"
                bp_name      = "不明"
                bp_experience= "不明"
            }
            history              = @()
            introduced_webinars  = @()
        }
        Write-Host "New karute created for ICN: $ICN" -ForegroundColor Yellow
    }

    # Append history entry
    $entry = [PSCustomObject]@{
        date           = (Get-Date -Format "yyyy-MM-dd HH:mm")
        mode           = $Mode
        risk_level     = $riskLevel
        output_file    = $OutputFile
    }
    $historyList = [System.Collections.Generic.List[object]]::new()
    if ($k.history) { foreach ($h in $k.history) { $historyList.Add($h) } }
    $historyList.Add($entry)
    $k.history      = $historyList.ToArray()
    $k.last_updated = (Get-Date -Format "yyyy-MM-dd")

    Save-Karute $ICN $k

    Write-Host ""
    Write-Host "Karute updated. Run '.\csm-coach\karute.ps1 -Action load -ICN $ICN' to review." -ForegroundColor Cyan
    exit 0
}

# ---------------------------------------------------------------
# ACTION: history
# ---------------------------------------------------------------
if ($Action -eq "history") {
    if (-not $ICN) { Write-Host "ERROR: -ICN is required." -ForegroundColor Red; exit 1 }
    $k = Get-Karute $ICN
    if (-not $k) { Write-Host "Karute not found for ICN: $ICN" -ForegroundColor Yellow; exit 0 }
    Write-Host ""
    Write-Host "===== History: ICN $ICN / $($k.company_name) =====" -ForegroundColor Cyan
    if (-not $k.history -or $k.history.Count -eq 0) {
        Write-Host "  No history yet." -ForegroundColor Gray
    } else {
        foreach ($h in $k.history) {
            Write-Host "  [$($h.date)] Mode=$($h.mode) | Risk=$($h.risk_level)"
            Write-Host "    File: $($h.output_file)" -ForegroundColor Gray
        }
    }
    Write-Host ""
    exit 0
}
