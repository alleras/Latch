param(
  [Parameter(Mandatory)]
  [ValidateSet('x64', 'arm64')]
  [string]$Architecture
)

$ErrorActionPreference = 'Stop'
$nativeArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($nativeArchitecture -ne $Architecture) {
  throw "Installer test requires a native $Architecture runner; this runner is $nativeArchitecture."
}

$version = (Get-Content ./package.json -Raw | ConvertFrom-Json).version
$installer = (Resolve-Path "release/Latch-$version-windows-$Architecture.exe").Path
$installDirectory = Join-Path $env:RUNNER_TEMP "Latch-install-test-$Architecture"
if (Test-Path $installDirectory) {
  throw "Installer test directory already exists: $installDirectory"
}

# NSIS requires /D to be the last argument; it consumes the remaining command line.
$process = Start-Process -FilePath $installer -ArgumentList @('/S', '/currentuser', "/D=$installDirectory") -Wait -PassThru
if ($process.ExitCode -ne 0) {
  throw "Installer failed with exit code $($process.ExitCode)."
}

# The broken extractor reports success while silently skipping executable files.
foreach ($file in @('Latch.exe', 'ffmpeg.dll', 'libEGL.dll', 'libGLESv2.dll', 'resources/app.asar')) {
  if (-not (Test-Path (Join-Path $installDirectory $file) -PathType Leaf)) {
    throw "Installer reported success but did not install $file."
  }
}

$executable = Join-Path $installDirectory 'Latch.exe'
$previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
  $env:ELECTRON_RUN_AS_NODE = '1'
  $installedArchitecture = (& $executable -p 'process.arch' | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $installedArchitecture -ne $Architecture) {
    throw "Installed executable failed to run as $Architecture (exit $LASTEXITCODE, output '$installedArchitecture')."
  }
} finally {
  $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode
}

Write-Host "Installed Latch $version successfully; executable runs as $installedArchitecture."
