$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
function Notice([string]$message) { [void][System.Windows.Forms.MessageBox]::Show($message,'AVG FDR') }
function Hash([string]$file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
try {
  $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'versiones.json') -Raw | ConvertFrom-Json
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = 'Selecciona el ejecutable de AVG ACARS X-Plane que ya utilizas'
  $dialog.Filter = 'Aplicaciones (*.exe)|*.exe'
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
  $exe = $dialog.FileName
  $target = Join-Path (Split-Path $exe -Parent) 'resources\app.asar'
  $exeHash = Hash $exe
  $oldHash = Hash $target
  $matches = @($manifest | Where-Object { $_.exe -eq $exeHash -and $_.old -eq $oldHash })
  if ($matches.Count -eq 0) {
    if (@($manifest | Where-Object { $_.exe -eq $exeHash -and $_.new -eq $oldHash }).Count -gt 0) { Notice 'Ya tienes AVG FDR actualizado.'; exit 0 }
    throw 'No se reconoce esta compilacion. No se modifico nada. Puedes seguir usando tu ACARS anterior o descargar el paquete completo oficial de X-Plane.'
  }
  $entry = $matches[0]
  $expectedNew = [string]$entry.new
  $source = Join-Path $PSScriptRoot ([string]$entry.file)
  if ((Hash $source) -ne $expectedNew) { throw 'La actualizacion no paso la verificacion de integridad.' }
  if (Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($exe)) -ErrorAction SilentlyContinue) { throw 'Cierra completamente AVG ACARS antes de actualizar.' }
  $answer = [System.Windows.Forms.MessageBox]::Show('Actualizacion oficial AVG FDR. El EXE y la configuracion no se modifican. Deseas continuar?','AVG FDR',[System.Windows.Forms.MessageBoxButtons]::YesNo)
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { exit 0 }
  $tmp = $target + '.avg-fdr-new'
  $backup = $target + '.antes-fdr-' + (Get-Date -Format 'yyyyMMddHHmmssfff') + '.bak'
  try {
    [IO.File]::Copy($source,$tmp,$true)
    if ((Hash $tmp) -ne $expectedNew) { throw 'La copia temporal no paso la verificacion.' }
    [IO.File]::Replace($tmp,$target,$backup)
    if ((Hash $target) -ne $expectedNew) { [IO.File]::Copy($backup,$target,$true); throw 'Se restauro la version anterior.' }
  } finally { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force } }
  Notice ('Actualizacion instalada en la carpeta original. Abre tu acceso directo habitual. Respaldo: ' + $backup)
} catch { Notice $_.Exception.Message; exit 1 }
