$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$html = Join-Path $root "rapport-avancement.html"
$pdf = Join-Path $root "Rapport-avancement_Anti-Phishing-Web3_11-08-2026.pdf"
$profile = Join-Path $env:TEMP "anti-phishing-report-chrome"

if (-not (Test-Path -LiteralPath $chrome)) {
    throw "Google Chrome is not installed at the expected path."
}
if (-not (Test-Path -LiteralPath $html)) {
    throw "Build rapport-avancement.html before generating the PDF."
}

Remove-Item -LiteralPath $pdf -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue

$htmlUri = [System.Uri]::new($html).AbsoluteUri
$chromeArgs = @(
    "--headless=new"
    "--disable-gpu"
    "--disable-background-networking"
    "--no-pdf-header-footer"
    "--user-data-dir=$profile"
    "--print-to-pdf=$pdf"
    $htmlUri
)

$process = Start-Process -FilePath $chrome -ArgumentList $chromeArgs -Wait -PassThru
if ($process.ExitCode -ne 0) {
    throw "Chrome exited with code $($process.ExitCode)."
}
if (-not (Test-Path -LiteralPath $pdf)) {
    throw "Chrome did not create the PDF."
}

$item = Get-Item -LiteralPath $pdf
Write-Output "PDF=$($item.FullName)"
Write-Output "SIZE=$($item.Length)"

Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
