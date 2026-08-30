$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$html = Join-Path $root "rapport-avancement.html"
$output = Join-Path $env:TEMP "anti-phishing-report-preview"
$profile = Join-Path $env:TEMP "anti-phishing-report-preview-chrome"

Remove-Item -LiteralPath $output -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $output | Out-Null

for ($page = 1; $page -le 20; $page += 1) {
    $image = Join-Path $output ("page-{0:D2}.png" -f $page)
    $uri = "$([System.Uri]::new($html).AbsoluteUri)?page=$page"
    $args = @(
        "--headless=new"
        "--disable-gpu"
        "--disable-background-networking"
        "--hide-scrollbars"
        "--force-device-scale-factor=1"
        "--window-size=794,1123"
        "--virtual-time-budget=500"
        "--user-data-dir=$profile"
        "--screenshot=$image"
        $uri
    )
    $process = Start-Process -FilePath $chrome -ArgumentList $args -Wait -PassThru
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $image)) {
        throw "Screenshot failed for page $page."
    }
}

$columns = 4
$rows = 5
$thumbWidth = 300
$thumbHeight = 424
$gutter = 12
$sheetWidth = $columns * $thumbWidth + ($columns + 1) * $gutter
$sheetHeight = $rows * $thumbHeight + ($rows + 1) * $gutter
$sheet = New-Object System.Drawing.Bitmap($sheetWidth, $sheetHeight)
$graphics = [System.Drawing.Graphics]::FromImage($sheet)
$graphics.Clear([System.Drawing.Color]::FromArgb(225, 230, 238))
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

try {
    for ($page = 1; $page -le 20; $page += 1) {
        $column = ($page - 1) % $columns
        $row = [math]::Floor(($page - 1) / $columns)
        $x = $gutter + $column * ($thumbWidth + $gutter)
        $y = $gutter + $row * ($thumbHeight + $gutter)
        $imagePath = Join-Path $output ("page-{0:D2}.png" -f $page)
        $image = [System.Drawing.Image]::FromFile($imagePath)
        try {
            $graphics.DrawImage($image, $x, $y, $thumbWidth, $thumbHeight)
        }
        finally {
            $image.Dispose()
        }
    }

    $contactSheet = Join-Path $output "contact-sheet.png"
    $sheet.Save($contactSheet, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $graphics.Dispose()
    $sheet.Dispose()
}

Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "PREVIEW_DIR=$output"
Write-Output "CONTACT_SHEET=$(Join-Path $output 'contact-sheet.png')"
