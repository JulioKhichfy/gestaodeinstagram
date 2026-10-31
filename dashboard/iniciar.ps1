# Inicia o dashboard: túnel (cloudflared) + backend + Angular, e abre o navegador.
# Uso: dois cliques em iniciar.cmd (ou: powershell -ExecutionPolicy Bypass -File iniciar.ps1).
# Para parar: feche esta janela ou aperte Ctrl+C.
# Compatível com o Windows PowerShell 5.1 (o que vem no Windows).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$envFile = Join-Path $root 'backend\.env'

# Primeira vez: cria o .env a partir do modelo e instala as dependências.
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $root 'backend\.env.example') $envFile
  Write-Host 'Criei backend\.env a partir do modelo. Preencha FB_APP_ID e FB_APP_SECRET (veja INSTALACAO-WINDOWS.md) e rode de novo.' -ForegroundColor Yellow
}
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host 'Instalando as dependências (só na primeira vez, leva alguns minutos)...'
  Push-Location $root
  npm install
  Pop-Location
}

# Túnel: endereço público para a Meta baixar fotos e vídeos ao publicar. O endereço muda a cada vez, então é
# gravado no .env (PUBLIC_BASE_URL) antes de subir o backend.
$tunnel = $null
if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
  $log = Join-Path $env:TEMP 'dashboard-tunel.log'
  Remove-Item $log -ErrorAction SilentlyContinue
  $tunnel = Start-Process cloudflared -ArgumentList @('tunnel', '--url', 'http://localhost:3000') -RedirectStandardError $log -WindowStyle Hidden -PassThru
  $url = $null
  for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $log) {
      $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
      if ($m) { $url = $m.Matches[0].Value }
    }
  }
  if ($url) {
    $content = [IO.File]::ReadAllText($envFile)
    if ($content -match '(?m)^PUBLIC_BASE_URL=.*$') { $content = $content -replace '(?m)^PUBLIC_BASE_URL=.*$', "PUBLIC_BASE_URL=$url" }
    else { $content = $content.TrimEnd() + "`r`nPUBLIC_BASE_URL=$url`r`n" }
    [IO.File]::WriteAllText($envFile, $content) # UTF-8 sem BOM
    Write-Host "Túnel no ar: $url (publicar e agendar liberados)" -ForegroundColor Green
  } else {
    Write-Host 'Não consegui abrir o túnel: o dashboard funciona, mas publicar fica desligado. Tente fechar e abrir de novo.' -ForegroundColor Yellow
  }
} else {
  Write-Host 'cloudflared não está instalado: o dashboard funciona, mas publicar fica desligado (veja o guia, passo 2).' -ForegroundColor Yellow
}

# Abre o navegador quando o Angular estiver pronto (leva uns 20 a 40 segundos).
Start-Job -ScriptBlock {
  for ($i = 0; $i -lt 90; $i++) {
    try { Invoke-WebRequest -Uri 'http://localhost:4300' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:4300'; return } catch { Start-Sleep 2 }
  }
} | Out-Null

Write-Host 'Subindo o dashboard... (para parar: feche esta janela ou Ctrl+C)'
try {
  Push-Location $root
  npm run dev
} finally {
  Pop-Location
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
  # No Windows, parar o npm pode deixar processos do Node presos nas portas 3000/4300: encerra só os deste projeto.
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$root*" -and @('node.exe', 'esbuild.exe') -contains $_.Name } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
