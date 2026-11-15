$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
function Notice([string]$message) { [void][System.Windows.Forms.MessageBox]::Show($message,'AVG FDR') }
function Hash([string]$file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
try {
  $expectedOld = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'original-asar.sha256') -Raw).Trim()
  $expectedNew = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'new-asar.sha256') -Raw).Trim()
  $expectedExe = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'original-exe.sha256') -Raw).Trim()
  $source = Join-Path $PSScriptRoot 'app.asar'
  if ((Hash $source) -ne $expectedNew) { throw 'El archivo de actualizacion no coincide con el paquete.' }
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = 'Selecciona el ejecutable de AVG ACARS que ya utilizas'
  $dialog.Filter = 'Aplicaciones (*.exe)|*.exe'
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
  $exe = $dialog.FileName
  if ((Hash $exe) -ne $expectedExe) { throw 'Este ejecutable no corresponde al paquete oficial. No se hizo ningun cambio.' }
  $target = Join-Path (Split-Path $exe -Parent) 'resources\app.asar'
  if ((Hash $target) -eq $expectedNew) { Notice 'Esta actualizacion ya esta instalada.'; exit 0 }
  $compatible = @($expectedOld)
  $compatFile = Join-Path $PSScriptRoot 'compatible-asar.sha256'
  if (Test-Path -LiteralPath $compatFile) {
    foreach ($entry in (Get-Content -LiteralPath $compatFile)) {
      $candidate = $entry.Trim().ToLowerInvariant()
      if ($candidate.Length -eq 64 -and $candidate -notmatch '[^0-9a-f]') {
        $compatible += $candidate
      }
    }
  }
  if ($compatible -notcontains (Hash $target)) { throw 'Tu version de ACARS es distinta de la base comprobada. No se hizo ningun cambio.' }
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
