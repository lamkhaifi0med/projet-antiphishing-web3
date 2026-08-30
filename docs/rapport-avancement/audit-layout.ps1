$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$html = Join-Path $root "rapport-avancement.html"
$profile = Join-Path $env:TEMP "anti-phishing-report-audit-chrome"
$dump = Join-Path $env:TEMP "anti-phishing-report-layout.html"
$errorLog = Join-Path $env:TEMP "anti-phishing-report-layout-errors.log"

Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $dump -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $errorLog -ErrorAction SilentlyContinue

$uri = "$([System.Uri]::new($html).AbsoluteUri)?audit=1"
$args = @(
    "--headless=new"
    "--disable-gpu"
    "--disable-background-networking"
    "--virtual-time-budget=1000"
    "--user-data-dir=$profile"
    "--dump-dom"
    $uri
)

$process = Start-Process -FilePath $chrome -ArgumentList $args -Wait -PassThru -RedirectStandardOutput $dump -RedirectStandardError $errorLog
if ($process.ExitCode -ne 0) {
    throw "Chrome layout audit exited with code $($process.ExitCode)."
}

$dom = Get-Content -LiteralPath $dump -Raw
$match = [regex]::Match($dom, '<pre id="layout-audit">(?<json>\[.*?\])</pre>')
if (-not $match.Success) {
    throw "Layout audit output was not found in the rendered DOM."
}

$results = $match.Groups["json"].Value | ConvertFrom-Json
$results | Format-Table page, clientHeight, scrollHeight, pageOverflow, contentFolioOverlap, clearancePx -AutoSize

$failures = @($results | Where-Object { $_.pageOverflow -or $_.contentFolioOverlap })
if ($failures.Count -gt 0) {
    throw "Layout audit found overflow or footer overlap on page(s): $($failures.page -join ', ')."
}

Write-Output "LAYOUT_OK=$($results.Count)"
Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
