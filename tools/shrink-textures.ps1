# Makes the 512 px copies of the downloaded textures that the game packs.
#   powershell -ExecutionPolicy Bypass -File tools/shrink-textures.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'assets\src'
$dst  = Join-Path $root 'assets\tex'
New-Item -ItemType Directory -Force $dst | Out-Null

$codec  = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 82L

Get-ChildItem $src -Filter *.jpg | ForEach-Object {
  $img = [System.Drawing.Image]::FromFile($_.FullName)
  $bmp = New-Object System.Drawing.Bitmap 512, 512
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, 512, 512)
  $out = Join-Path $dst $_.Name
  $bmp.Save($out, $codec, $params)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
  '{0,6} kB  {1}' -f [math]::Round((Get-Item $out).Length / 1KB), $_.Name
}
