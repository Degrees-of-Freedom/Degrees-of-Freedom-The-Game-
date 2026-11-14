# Windows/GDI+ orthographic previews rendered from the exact fixture coordinates.
# No AI-generated geometry: supports, loads and member colors reflect the records.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Join-Path $PSScriptRoot '../apps/web/public/structures'
$catalog = Get-Content (Join-Path $root 'catalog.json') -Raw | ConvertFrom-Json
$out = Join-Path $root 'previews'
New-Item -ItemType Directory -Force $out | Out-Null
$colors = @{ shs='#426A83'; ipe='#447D64'; heb='#243E57'; glulam='#B57C46'; cable='#C59338' }
$font = [Drawing.Font]::new('Segoe UI', 22, [Drawing.FontStyle]::Bold)
$small = [Drawing.Font]::new('Segoe UI', 12)
$ink = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#233D4D'))
$muted = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#617680'))
$sheet = [Drawing.Bitmap]::new(1600, 1500)
$sg = [Drawing.Graphics]::FromImage($sheet)
$sg.Clear([Drawing.Color]::White)
$index = 0
foreach ($r in $catalog.records) {
  $bmp = [Drawing.Bitmap]::new(960, 720)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([Drawing.ColorTranslator]::FromHtml('#F2F5F2'))
  $points = @{}
  foreach ($m in $r.save.model.members) {
    foreach ($key in @($m.a, $m.b)) {
      $p = @($key.Split(',') | ForEach-Object { [double]$_ })
      $points[$key] = @((($p[0] - $p[1]) * 0.866), (($p[0] + $p[1]) * 0.40 - $p[2]))
    }
  }
  $xs = @($points.Values | ForEach-Object { $_[0] })
  $ys = @($points.Values | ForEach-Object { $_[1] })
  $xmin = ($xs | Measure-Object -Minimum).Minimum
  $xmax = ($xs | Measure-Object -Maximum).Maximum
  $ymin = ($ys | Measure-Object -Minimum).Minimum
  $ymax = ($ys | Measure-Object -Maximum).Maximum
  $scale = [Math]::Min(720 / [Math]::Max(2, $xmax-$xmin), 440 / [Math]::Max(2, $ymax-$ymin))
  $screen = @{}
  foreach ($key in $points.Keys) {
    $p = $points[$key]
    $screen[$key] = [Drawing.PointF]::new(480 + ($p[0]-($xmin+$xmax)/2)*$scale, 390 + ($p[1]-($ymin+$ymax)/2)*$scale)
  }
  $g.DrawString($r.name, $font, $ink, 36, 24)
  $g.DrawString("$($r.memberCount) members   /   $($r.nodeCount) nodes   /   $($r.extentMetres -join ' x ') m", $small, $muted, 38, 65)
  foreach ($m in $r.save.model.members) {
    $pen = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml($colors[$m.type]), $(if ($m.type -eq 'cable') { 2.5 } else { 5 }))
    $g.DrawLine($pen, $screen[$m.a], $screen[$m.b]); $pen.Dispose()
  }
  foreach ($key in $screen.Keys) {
    $p = $screen[$key]; $a = $r.save.model.attrs.$key
    $g.FillEllipse($ink, $p.X-3, $p.Y-3, 6, 6)
    if ($a.found) { $g.FillRectangle($ink, $p.X-9, $p.Y+3, 18, 8) }
    if ($a.load) {
      $pen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(202, 80, 61), 3)
      $pen.EndCap = 'ArrowAnchor'
      $g.DrawLine($pen, $p.X, $p.Y-39, $p.X, $p.Y-9); $pen.Dispose()
    }
  }
  $g.DrawString('ORTHOGRAPHIC GEOMETRY PREVIEW   |   blocks: supports   arrows: downward loads', $small, $muted, 36, 650)
  $g.DrawString("$($r.id)   /   intent: $($r.expectation.stability)   /   not a solved result", $small, $muted, 36, 677)
  $bmp.Save((Join-Path $out "$($r.id).png"), [Drawing.Imaging.ImageFormat]::Png)
  $sg.DrawImage($bmp, [Drawing.Rectangle]::new(($index % 4)*400, [Math]::Floor($index/4)*300, 400, 300))
  $g.Dispose(); $bmp.Dispose(); $index++
}
$sheet.Save((Join-Path $root 'contact-sheet.png'), [Drawing.Imaging.ImageFormat]::Png)
$sg.Dispose(); $sheet.Dispose(); $font.Dispose(); $small.Dispose(); $ink.Dispose(); $muted.Dispose()
Write-Output "Rendered $index previews and contact sheet."
