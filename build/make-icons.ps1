Add-Type -AssemblyName System.Drawing

function Draw-CatFace($size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $s = $size / 512.0

    $pad = 24 * $s
    $r = 110 * $s
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($pad, $pad, 2*$r, 2*$r, 180, 90)
    $path.AddArc($size-$pad-2*$r, $pad, 2*$r, 2*$r, 270, 90)
    $path.AddArc($size-$pad-2*$r, $size-$pad-2*$r, 2*$r, 2*$r, 0, 90)
    $path.AddArc($pad, $size-$pad-2*$r, 2*$r, 2*$r, 90, 90)
    $path.CloseFigure()

    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        (New-Object System.Drawing.RectangleF 0,0,$size,$size)),
        ([System.Drawing.Color]::FromArgb(255,124,58,237)),
        ([System.Drawing.Color]::FromArgb(255,249,115,22)), 70
    $g.FillPath($bgBrush, $path)

    $face = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,255,241,221))
    $fcx = 256 * $s
    $fcy = 274 * $s
    $fwr = 150 * $s
    $fhr = 118 * $s
    $g.FillEllipse($face, $fcx-$fwr, $fcy-$fhr, 2*$fwr, 2*$fhr)

    $tri1 = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF (170*$s),(140*$s)),
        (New-Object System.Drawing.PointF (252*$s),(252*$s)),
        (New-Object System.Drawing.PointF (146*$s),(262*$s)))
    $tri2 = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF (342*$s),(140*$s)),
        (New-Object System.Drawing.PointF (260*$s),(252*$s)),
        (New-Object System.Drawing.PointF (366*$s),(262*$s)))
    $g.FillPolygon($face, $tri1)
    $g.FillPolygon($face, $tri2)

    $pink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,251,207,232))
    $tri1i = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF (182*$s),(156*$s)),
        (New-Object System.Drawing.PointF (236*$s),(246*$s)),
        (New-Object System.Drawing.PointF (166*$s),(250*$s)))
    $tri2i = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF (330*$s),(156*$s)),
        (New-Object System.Drawing.PointF (276*$s),(246*$s)),
        (New-Object System.Drawing.PointF (346*$s),(250*$s)))
    $g.FillPolygon($pink, $tri1i)
    $g.FillPolygon($pink, $tri2i)

    $g.FillEllipse([System.Drawing.Brushes]::Black, $fcx-50*$s, $fcy-32*$s, 28*$s, 46*$s)
    $g.FillEllipse([System.Drawing.Brushes]::Black, $fcx+22*$s, $fcy-32*$s, 28*$s, 46*$s)
    $g.FillEllipse([System.Drawing.Brushes]::White, $fcx-43*$s, $fcy-24*$s, 9*$s, 14*$s)
    $g.FillEllipse([System.Drawing.Brushes]::White, $fcx+29*$s, $fcy-24*$s, 9*$s, 14*$s)

    $nose = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,236,72,153))
    $g.FillEllipse($nose, $fcx-13*$s, $fcy+24*$s, 26*$s, 20*$s)

    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(150,80,45))
    $pen.Width = 5 * $s
    $g.DrawArc($pen, $fcx-32*$s, $fcy+34*$s, 64*$s, 36*$s, 20, 140)

    $whisk = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(200,180,120))
    $whisk.Width = 4 * $s
    $y1 = $fcy - 4*$s
    $y2 = $fcy + 14*$s
    $g.DrawLine($whisk, $fcx - $fwr + 8*$s, $y1, $fcx - 62*$s, $y1)
    $g.DrawLine($whisk, $fcx - $fwr + 8*$s, $y2, $fcx - 62*$s, $y2)
    $g.DrawLine($whisk, $fcx + $fwr - 8*$s, $y1, $fcx + 62*$s, $y1)
    $g.DrawLine($whisk, $fcx + $fwr - 8*$s, $y2, $fcx + 62*$s, $y2)

    $g.Dispose()
    return $bmp
}

# PNG 512 + 256
$p512 = Draw-CatFace 512
$p512.Save("C:\Users\turbo\Documents\Default Project\Meoow\build\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$p512.Dispose()
$p256 = Draw-CatFace 256
$p256.Save("C:\Users\turbo\Documents\Default Project\Meoow\src\icons\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$p256.Dispose()

# ICO 256
$icoBmp = Draw-CatFace 256
$hIcon = $icoBmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = [System.IO.File]::Create("C:\Users\turbo\Documents\Default Project\Meoow\build\icon.ico")
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$icoBmp.Dispose()
Write-Output "icons + ico written"