$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = (Resolve-Path '.').Path
$work = Join-Path $env:RUNNER_TEMP 'avg-acars-seguridad'
$dist = Join-Path $repo 'dist'
New-Item -ItemType Directory -Path $work,$dist -Force | Out-Null
$sevenZip = (Get-Command '7z' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $sevenZip) { $sevenZip = 'C:\Program Files\7-Zip\7z.exe' }
if (-not (Test-Path $sevenZip)) { throw 'No se encontró 7-Zip en Windows.' }
$tools = Join-Path $work 'node-tools'
New-Item -ItemType Directory -Path $tools -Force | Out-Null
& npm install --prefix $tools --no-audit --no-fund --silent '@electron/asar@3.2.9'
if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar la herramienta ASAR.' }
$asarCli = Join-Path $tools 'node_modules\@electron\asar\bin\asar.js'
if (-not (Test-Path $asarCli)) { throw 'No se encontró el empaquetador ASAR.' }
$entries = @(
  [pscustomobject]@{
    kind='msfs'
    url='https://github.com/garridooliver48-afk/AVG-ACARS-Downloads/releases/download/v0.1.2/AVG-ACARS-Setup-0.1.2.exe'
    sha256='7fe1d47aff3b20e5ee56f1ffac41388d0fd0c16089a9de684ad008ccecd074ca'
    exe='AVG ACARS.exe'
    folder='AVG-ACARS-MSFS'
    zip='AVG_ACARS_MSFS_Seguridad_1_2.zip'
  },
  [pscustomobject]@{
    kind='xplane'
    url='https://github.com/garridooliver48-afk/AVG-ACARS-Downloads/releases/download/v0.1.2/AVG-ACARS-XPLANE-Setup-0.1.2.exe'
    sha256='5280d1cf1bf1bee2cd1a81a8967338d0d3fc8c7766fcc78eddec9accb892f399'
    exe='AVG ACARS XPLANE.exe'
    folder='AVG-ACARS-XPLANE'
    zip='AVG_ACARS_XPlane_Seguridad_1_2.zip'
  }
)
foreach ($entry in $entries) {
  Write-Host "=== AVG ACARS $($entry.kind): verificación de base oficial ==="
  $sandbox=Join-Path $work $entry.kind
  New-Item -ItemType Directory -Path $sandbox -Force | Out-Null
  $installer=Join-Path $sandbox 'original.exe'
  & curl.exe -fL --retry 3 --retry-delay 4 $entry.url -o $installer
  if ($LASTEXITCODE -ne 0) { throw "Descarga fallida: $($entry.kind)" }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant() -ne $entry.sha256) {
    throw "SHA256 del instalador oficial no coincide: $($entry.kind)"
  }
  $outer=Join-Path $sandbox 'outer'
  New-Item -ItemType Directory -Path $outer -Force | Out-Null
  & $sevenZip x $installer "-o$outer" -y | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "No se pudo abrir instalador NSIS: $($entry.kind)" }
  $compressedApp=Get-ChildItem -LiteralPath $outer -File -Recurse |
    Where-Object { $_.Name -match '^app.*\.(7z|zip)$' } |
    Sort-Object Length -Descending | Select-Object -First 1
  if ($compressedApp) {
    $program=Join-Path $sandbox 'program'
    New-Item -ItemType Directory -Path $program -Force | Out-Null
    & $sevenZip x $compressedApp.FullName "-o$program" -y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo extraer app-64.7z: $($entry.kind)" }
  } else { $program=$outer }
  $exeFile=Get-ChildItem -LiteralPath $program -File -Recurse |
    Where-Object { $_.Name -eq $entry.exe } |
    Sort-Object { $_.FullName.Length } | Select-Object -First 1
  if (-not $exeFile) { throw "No se encontró $($entry.exe) dentro del instalador." }
  $programRoot=$exeFile.Directory.FullName
  $asar=Join-Path $programRoot 'resources\app.asar'
  if (-not (Test-Path -LiteralPath $asar)) { throw "Falta resources/app.asar: $($entry.kind)" }
  $extractedApp=Join-Path $sandbox 'app-edit'
  & node $asarCli extract $asar $extractedApp
  if ($LASTEXITCODE -ne 0) { throw "No se pudo extraer app.asar ($($entry.kind))" }
  $patch=Join-Path $repo ("payload\" + $entry.kind)
  $patchFiles=@(Get-ChildItem -LiteralPath $patch -File -Recurse)
  if ($patchFiles.Count -lt 10) { throw 'El código de seguridad está incompleto.' }
  foreach ($file in $patchFiles) {
    $relative=[IO.Path]::GetRelativePath($patch,$file.FullName)
    $dest=Join-Path $extractedApp $relative
    New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $dest -Force
  }
  $newAsar=Join-Path $sandbox 'app-actualizada.asar'
  & node $asarCli pack $extractedApp $newAsar --unpack-dir node_modules
  if ($LASTEXITCODE -ne 0) { throw "No se pudo generar app.asar ($($entry.kind))" }
  $listing=& node $asarCli list $newAsar
  if ($LASTEXITCODE -ne 0 -or -not ($listing | Select-String -Pattern 'safety-recorder[.]js') -or
      -not ($listing | Select-String -Pattern 'main.js')) {
    throw "El app.asar nuevo no pasó la verificación: $($entry.kind)"
  }
  Copy-Item -LiteralPath $newAsar -Destination $asar -Force
  $newUnpacked=$newAsar+'.unpacked'
  $oldUnpacked=$asar+'.unpacked'
  if (Test-Path -LiteralPath $newUnpacked) {
    if (Test-Path -LiteralPath $oldUnpacked) { Remove-Item -LiteralPath $oldUnpacked -Force -Recurse }
    Move-Item -LiteralPath $newUnpacked -Destination $oldUnpacked
  }
  $outDir=Join-Path $dist $entry.folder
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  Get-ChildItem -LiteralPath $programRoot -Force |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $outDir -Recurse -Force }
  Get-ChildItem -LiteralPath $outDir -File |
    Where-Object { $_.Name -like 'Uninstall*' -or $_.Name -eq 'elevate.exe' } |
    Remove-Item -Force
  $lines=@(
    "AVG ACARS Seguridad 1.2 - $($entry.kind.ToUpperInvariant())",
    '1. Cierra el ACARS anterior por completo.',
    '2. Extrae todos los archivos de esta carpeta.',
    "3. Ejecuta $($entry.exe) después de extraer, nunca desde el ZIP.",
    '4. Comprueba que el vuelo registrado sea tu misión asignada en AVG.',
    '5. Para un vuelo personal, no dejes ACARS conectado a una misión AVG.',
    'Cierre completo y alertas conservadoras de incidentes para revisión AVG-001.',
    'Las alertas no confirman un accidente ni descuentan puntos automáticamente.'
  )
  [IO.File]::WriteAllText((Join-Path $outDir 'LEEME-SEGURIDAD.txt'),($lines -join [Environment]::NewLine),[Text.UTF8Encoding]::new($false))
  if (-not (Test-Path -LiteralPath (Join-Path $outDir $entry.exe))) { throw 'Faltó el ejecutable portable.' }
}
Push-Location $dist
try {
  foreach ($entry in $entries) {
    & $sevenZip a -tzip -mx=5 -y $entry.zip $entry.folder | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Error al comprimir $($entry.zip)" }
  }
  & $sevenZip a -tzip -mx=5 -y 'AVG_ACARS_COMPLETOS_MSFS_XPlane_Seguridad_1_2.zip' 'AVG-ACARS-MSFS' 'AVG-ACARS-XPLANE' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Error al generar el ZIP conjunto.' }
} finally { Pop-Location }
$archives=@(Get-ChildItem -LiteralPath $dist -Filter '*.zip' -File)
if ($archives.Count -ne 3) { throw 'Se esperaban tres archivos ZIP.' }
foreach ($f in $archives) {
  if ($f.Length -lt 20MB) { throw "ZIP sospechosamente pequeño: $($f.Name)" }
  Write-Host ("{0} | {1:N1} MB | SHA256 {2}" -f $f.Name,($f.Length/1MB),(Get-FileHash $f.FullName -Algorithm SHA256).Hash)
}
Write-Host 'AVG ACARS Seguridad 1.2: paquetes verificados.'
