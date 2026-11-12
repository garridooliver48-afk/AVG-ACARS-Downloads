$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

# Actualizacion EN EL MISMO LUGAR del AVG ACARS instalado (solo MSFS 2020).
# El EXE y los accesos directos originales se conservan; solo se reemplaza resources\app.asar.
$testedHash = '51ce9c84616271fb476d9fe87f7cc11970bc85ed5e924a4991ce8082884eb31a'
$originalExeHash = '154fec9c64bd8b107bb8ca5f2d9f2df38a7b66bd19fe504c8c9e44d30420fd24'

function Show-Notice([string] $message, [string] $title = 'AVG ACARS') {
  [void][System.Windows.Forms.MessageBox]::Show($message, $title)
}
function File-Hash([string] $path) {
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}
try {
  $sourceExe = Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File -Filter 'AVG ACARS.exe' |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.DirectoryName 'resources\app.asar') } |
    Select-Object -First 1
  if (-not $sourceExe) { throw 'No se encontro el AVG ACARS nuevo dentro de la carpeta extraida. Extrae TODO el ZIP primero.' }
  $sourceAsar = Join-Path $sourceExe.DirectoryName 'resources\app.asar'
  if ((File-Hash $sourceAsar) -ne $testedHash) {
    throw 'El paquete no corresponde al ACARS MSFS 2020 verificado. No se ha modificado la instalacion.'
  }

  # Buscar la instalacion existente mediante accesos directos de Escritorio e Inicio.
  $candidates = New-Object 'System.Collections.Generic.List[string]'
  $shell = New-Object -ComObject WScript.Shell
  $locations = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('CommonDesktopDirectory'),
    [Environment]::GetFolderPath('StartMenu'),
    [Environment]::GetFolderPath('CommonStartMenu')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
  foreach ($folder in $locations) {
    foreach ($link in (Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue)) {
      try {
        $dest = $shell.CreateShortcut($link.FullName).TargetPath
        if ([IO.Path]::GetFileName($dest) -ieq 'AVG ACARS.exe' -and
          (Test-Path -LiteralPath $dest) -and
          $dest -ne $sourceExe.FullName -and
          -not $candidates.Contains($dest)) {
          $candidates.Add($dest)
        }
      } catch { }
    }
  }

  $targetExe = $null
  $compatible = @($candidates | Where-Object {
    try { (File-Hash $_) -eq $originalExeHash } catch { $false }
  })
  if ($compatible.Count -eq 1) {
    $targetExe = $compatible[0]
  } else {
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = 'Selecciona el AVG ACARS.exe que ya usas (NO el descargado)'
    $picker.Filter = 'AVG ACARS.exe|AVG ACARS.exe'
    $picker.CheckFileExists = $true
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
      throw 'Actualizacion cancelada. Se conservo el ACARS anterior.'
    }
    $targetExe = $picker.FileName
  }

  if ([IO.Path]::GetFullPath($targetExe) -ieq [IO.Path]::GetFullPath($sourceExe.FullName)) {
    throw 'Seleccionaste el EXE nuevo extraido. Selecciona el AVG ACARS antiguo que abres normalmente.'
  }
  if ((File-Hash $targetExe) -ne $originalExeHash) {
    throw 'El ejecutable instalado no coincide con el original MSFS compatible. Se conservo intacto para evitar danos.'
  }
  $targetAsar = Join-Path (Split-Path $targetExe -Parent) 'resources\app.asar'
  if (-not (Test-Path -LiteralPath $targetAsar)) {
    throw 'No se encontro resources\app.asar en la instalacion anterior. No se hizo ningun cambio.'
  }

  $active = @(Get-Process -Name 'AVG ACARS' -ErrorAction SilentlyContinue)
  if ($active.Count -gt 0) {
    throw 'Cierra completamente AVG ACARS antes de actualizar. No se ha cambiado nada.'
  }
  if ((File-Hash $targetAsar) -eq $testedHash) {
    Show-Notice 'AVG ACARS 0.1.4 ya esta actualizado. Abre tu acceso directo habitual.' 'AVG - Ya actualizado'
    exit 0
  }
  $temporary = $targetAsar + '.avg-new'
  $backup = $targetAsar + '.antes-v0.1.4-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bak'
  try {
    [IO.File]::Copy($sourceAsar, $temporary, $true)
    if ((File-Hash $temporary) -ne $testedHash) { throw 'La copia temporal no paso la verificacion.' }
    [IO.File]::Replace($temporary, $targetAsar, $backup)
    if ((File-Hash $targetAsar) -ne $testedHash) {
      [IO.File]::Copy($backup, $targetAsar, $true)
      throw 'La actualizacion no paso la verificacion final. Se restauro el original.'
    }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  }

  Show-Notice 'AVG ACARS actualizado a 0.1.4 en la MISMA carpeta. Conservaste el EXE, el acceso directo, la configuracion y los PIREP. Ya puedes abrirlo como siempre.' 'AVG - Actualizacion terminada'
} catch {
  Show-Notice ($_.Exception.Message + [Environment]::NewLine + 'La instalacion anterior se mantiene. Si Windows denego permisos, ejecuta el actualizador como administrador.') 'AVG - No se pudo actualizar'
  exit 1
}
