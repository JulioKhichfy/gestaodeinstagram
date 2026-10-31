# Configura o dashboard (arquivo backend\.env) por um menu, testa as chaves e confere os programas instalados.
# Uso: dois cliques em configurar.cmd (ou: powershell -ExecutionPolicy Bypass -File configurar.ps1).
# Compatível com o Windows PowerShell 5.1. Os valores secretos nunca aparecem inteiros na tela.
param([switch]$SemMenu) # usado pelos testes: só carrega as funções

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$EnvFile = Join-Path $Root 'backend\.env'
$EnvExample = Join-Path $Root 'backend\.env.example'
$GraphVersion = 'v23.0'

# ---------- Leitura e gravação do .env (preserva comentários e a ordem) ----------

function Initialize-EnvFile([string]$Path = $EnvFile) {
  if (-not (Test-Path $Path)) {
    Copy-Item $EnvExample $Path
    Write-Host "Criei $Path a partir do modelo." -ForegroundColor Yellow
  }
}

function Get-EnvValue([string]$Name, [string]$Path = $EnvFile) {
  if (-not (Test-Path $Path)) { return '' }
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match "^\s*$([regex]::Escape($Name))=(.*)$") { return $Matches[1].Trim() }
  }
  return ''
}

# Grava NOME=valor: troca a linha existente (mesmo comentada, "# NOME=") ou acrescenta no fim. Vazio apaga o valor.
function Set-EnvValue([string]$Name, [string]$Value, [string]$Path = $EnvFile) {
  $lines = [Collections.Generic.List[string]]::new()
  if (Test-Path $Path) { $lines.AddRange([string[]][IO.File]::ReadAllLines($Path)) }
  $pattern = "^\s*(#\s*)?$([regex]::Escape($Name))=.*$"
  $done = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*$([regex]::Escape($Name))=") { $lines[$i] = "$Name=$Value"; $done = $true; break }
  }
  if (-not $done) {
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match $pattern) { $lines[$i] = "$Name=$Value"; $done = $true; break }
    }
  }
  if (-not $done) { $lines.Add("$Name=$Value") }
  [IO.File]::WriteAllText($Path, ($lines -join "`r`n") + "`r`n") # UTF-8 sem BOM
}

function Hide-Secret([string]$Value) {
  if (-not $Value) { return '(vazio)' }
  if ($Value.Length -le 8) { return '****' }
  return $Value.Substring(0, 4) + '…' + $Value.Substring($Value.Length - 4) + " ($($Value.Length) caracteres)"
}

function Read-Value([string]$Prompt, [string]$Current, [switch]$Secret) {
  $shown = if ($Secret) { Hide-Secret $Current } elseif ($Current) { $Current } else { '(vazio)' }
  Write-Host "$Prompt  [atual: $shown]"
  if ($Secret) {
    $s = Read-Host '  Cole o valor (Enter = manter; "-" = apagar)' -AsSecureString
    $v = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
  } else {
    $v = Read-Host '  Novo valor (Enter = manter; "-" = apagar)'
  }
  $v = $v.Trim()
  if ($v -eq '') { return $null }
  if ($v -eq '-') { return '' }
  return $v
}

# ---------- Validações de formato ----------

function Test-Format([string]$Name, [string]$Value) {
  if (-not $Value) { return $null }
  switch ($Name) {
    'FB_APP_ID' { if ($Value -notmatch '^\d{10,20}$') { return 'O ID do app tem só números (cerca de 15 a 16 dígitos).' } }
    'FB_APP_SECRET' { if ($Value -notmatch '^[0-9a-f]{32}$') { return 'A chave secreta tem 32 letras (a-f) e números. Confira se copiou inteira (clique em "Mostrar").' } }
    'FB_CONFIG_ID' { if ($Value -notmatch '^\d{5,25}$') { return 'O ID da configuração tem só números.' } }
    'PIXABAY_API_KEY' { if ($Value -notmatch '^\d+-[0-9a-f]+$') { return 'A chave do Pixabay costuma ser "números-letras" (ex.: 12345678-abcd...).' } }
  }
  return $null
}

# ---------- Testes das chaves (só leitura; não publicam nada) ----------

function Invoke-Check([scriptblock]$Block) {
  try { & $Block } catch {
    $msg = $_.Exception.Message
    if ($_.Exception.Response) {
      try {
        $reader = [IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $msg = "$msg $($reader.ReadToEnd())"
      } catch { }
    }
    return "falhou: $msg"
  }
}

function Test-Facebook {
  $id = Get-EnvValue 'FB_APP_ID'; $secret = Get-EnvValue 'FB_APP_SECRET'
  if (-not $id -or -not $secret) { return 'pulado: falta FB_APP_ID ou FB_APP_SECRET' }
  Invoke-Check {
    $q = "client_id=$id&client_secret=$secret&grant_type=client_credentials"
    $r = Invoke-RestMethod -Uri "https://graph.facebook.com/$GraphVersion/oauth/access_token?$q" -TimeoutSec 20
    if ($r.access_token) { 'ok: a Meta aceitou o ID e a chave do app' } else { 'falhou: resposta inesperada da Meta' }
  }
}

function Test-Jev {
  $key = Get-EnvValue 'TYPESAFE_API_KEY'
  if (-not $key) { $key = [Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY', 'User') }
  if (-not $key) { return 'pulado: sem TYPESAFE_API_KEY' }
  Invoke-Check {
    $r = Invoke-RestMethod -Uri 'https://api.typesafe.ai/v1/models' -Headers @{ Authorization = "Bearer $key" } -TimeoutSec 20
    if ($r) { 'ok: o Jev aceitou a chave' } else { 'falhou: resposta vazia' }
  }
}

function Test-Pixabay {
  $key = Get-EnvValue 'PIXABAY_API_KEY'
  if (-not $key) { return 'pulado: sem PIXABAY_API_KEY' }
  Invoke-Check {
    $r = Invoke-RestMethod -Uri "https://pixabay.com/api/?key=$key&q=cinema&per_page=3" -TimeoutSec 20
    if ($null -ne $r.totalHits) { 'ok: o Pixabay aceitou a chave' } else { 'falhou: resposta inesperada' }
  }
}

function Test-Unsplash {
  $key = Get-EnvValue 'UNSPLASH_ACCESS_KEY'
  if (-not $key) { return 'pulado: sem UNSPLASH_ACCESS_KEY' }
  Invoke-Check {
    $r = Invoke-RestMethod -Uri 'https://api.unsplash.com/search/photos?query=cinema&per_page=1' -Headers @{ Authorization = "Client-ID $key"; 'Accept-Version' = 'v1' } -TimeoutSec 20
    if ($null -ne $r.total) { 'ok: o Unsplash aceitou a chave' } else { 'falhou: resposta inesperada' }
  }
}

# Dica do que fazer quando o teste de cada chave falha.
$Hints = @{
  'Meta (app)' = 'Confira o ID do Aplicativo e a Chave Secreta (copie inteira, clicando em Mostrar) em Configurações do app › Básico.'
  'Jev' = 'Confira a chave do Jev (começa com "apikey_").'
  'Pixabay' = 'Confira a chave em pixabay.com/api/docs (logada, seção "key").'
  'Unsplash' = 'Use a "Access Key" (não a Secret Key) do app em unsplash.com/oauth/applications.'
}

function Show-Check([string]$Label, [string]$Result) {
  if ($Result -like 'falhou*' -and $Hints[$Label]) { $Result = "$Result`n               $($Hints[$Label])" }
  $color = if ($Result -like 'ok*') { 'Green' } elseif ($Result -like 'pulado*') { 'DarkGray' } else { 'Red' }
  Write-Host ("  {0,-12} {1}" -f $Label, $Result) -ForegroundColor $color
}

# ---------- Programas ----------

function Show-Programs {
  Write-Host ''
  Write-Host 'Programas:'
  $checks = @(
    @{ Name = 'git'; Label = 'Git'; Args = '--version'; Need = $true },
    @{ Name = 'node'; Label = 'Node.js'; Args = '-v'; Need = $true },
    @{ Name = 'npm'; Label = 'npm'; Args = '-v'; Need = $true },
    @{ Name = 'cloudflared'; Label = 'cloudflared'; Args = '--version'; Need = $true },
    @{ Name = 'codex'; Label = 'Codex'; Args = '--version'; Need = ((Get-EnvValue 'AI_PROVIDER') -eq 'chatgpt') },
    @{ Name = 'claude'; Label = 'Claude Code'; Args = '--version'; Need = ((Get-EnvValue 'AI_PROVIDER') -ne 'chatgpt') },
    @{ Name = 'ffmpeg'; Label = 'FFmpeg'; Args = '-version'; Need = $true }
  )
  foreach ($c in $checks) {
    $cmd = Get-Command $c.Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
      $color = if ($c.Need) { 'Red' } else { 'DarkGray' }
      $why = if ($c.Need) { 'NÃO INSTALADO (veja o guia, Partes 1 e 3)' } else { 'não instalado (opcional)' }
      Write-Host ("  {0,-12} {1}" -f $c.Label, $why) -ForegroundColor $color
      continue
    }
    $v = (& $c.Name $c.Args 2>&1 | Select-Object -First 1) -as [string]
    $color = 'Green'
    if ($c.Name -eq 'node' -and $v -notmatch '^v24\.') { $v = "$v  (use a v24: veja Problemas comuns no guia)"; $color = 'Yellow' }
    Write-Host ("  {0,-12} {1}" -f $c.Label, $v.Trim()) -ForegroundColor $color
  }
  $kdenlive = Test-Path (Join-Path $env:ProgramFiles 'kdenlive')
  Write-Host ("  {0,-12} {1}" -f 'Kdenlive', $(if ($kdenlive) { 'instalado' } else { 'não encontrado (opcional)' })) -ForegroundColor $(if ($kdenlive) { 'Green' } else { 'DarkGray' })
}

# ---------- Telas do menu ----------

function Show-Summary {
  Write-Host ''
  Write-Host "Configuração atual ($EnvFile):" -ForegroundColor Cyan
  $items = @(
    @('AI_PROVIDER', $false), @('FB_APP_ID', $false), @('FB_APP_SECRET', $true), @('FB_CONFIG_ID', $false),
    @('TYPESAFE_API_KEY', $true), @('UNSPLASH_ACCESS_KEY', $true), @('PIXABAY_API_KEY', $true), @('PEXELS_API_KEY', $true),
    @('IG_APP_ID', $false), @('IG_APP_SECRET', $true), @('PUBLIC_BASE_URL', $false)
  )
  foreach ($it in $items) {
    $v = Get-EnvValue $it[0]
    $shown = if ($it[1]) { Hide-Secret $v } elseif ($v) { $v } else { '(vazio)' }
    Write-Host ("  {0,-20} {1}" -f $it[0], $shown)
  }
}

function Edit-Values([object[]]$Fields) {
  foreach ($f in $Fields) {
    $v = Read-Value $f.Prompt (Get-EnvValue $f.Name) -Secret:([bool]$f.Secret)
    if ($null -eq $v) { continue }
    $problem = Test-Format $f.Name $v
    if ($problem) {
      Write-Host "  Atenção: $problem" -ForegroundColor Yellow
      if ((Read-Host '  Gravar mesmo assim? (s/N)') -notmatch '^[sS]') { continue }
    }
    Set-EnvValue $f.Name $v
    Write-Host "  $($f.Name) gravado." -ForegroundColor Green
  }
}

function Set-Assistant {
  Write-Host ''
  Write-Host 'Qual assinatura escreve os textos?'
  Write-Host '  1) ChatGPT (Codex)'
  Write-Host '  2) Claude (Claude Code)'
  switch (Read-Host 'Escolha') {
    '1' { Set-EnvValue 'AI_PROVIDER' 'chatgpt'; Write-Host 'AI_PROVIDER=chatgpt. Lembre: rode "codex" uma vez e escolha "Sign in with ChatGPT".' -ForegroundColor Green }
    '2' { Set-EnvValue 'AI_PROVIDER' 'claude'; Write-Host 'AI_PROVIDER=claude. Lembre: rode "claude" uma vez e entre com a sua conta.' -ForegroundColor Green }
    default { Write-Host 'Nada mudou.' }
  }
}

function Start-Login {
  $provider = Get-EnvValue 'AI_PROVIDER'
  $cmd = if ($provider -eq 'chatgpt') { 'codex' } else { 'claude' }
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    $pkg = if ($cmd -eq 'codex') { '@openai/codex' } else { '@anthropic-ai/claude-code' }
    if ((Read-Host "$cmd não está instalado. Instalar agora com npm? (S/n)") -match '^[nN]') { return }
    npm install -g $pkg
  }
  Write-Host "Abrindo o $cmd para entrar. Depois de entrar, feche com Ctrl+C para voltar ao menu." -ForegroundColor Cyan
  & $cmd
}

function Invoke-AllChecks {
  Write-Host ''
  Write-Host 'Testando as chaves (só leitura, nada é publicado):' -ForegroundColor Cyan
  Show-Check 'Meta (app)' (Test-Facebook)
  Show-Check 'Jev' (Test-Jev)
  Show-Check 'Pixabay' (Test-Pixabay)
  Show-Check 'Unsplash' (Test-Unsplash)
}

function Show-Menu {
  Initialize-EnvFile
  while ($true) {
    Show-Summary
    Write-Host ''
    Write-Host '=== Configurar o dashboard ===' -ForegroundColor Cyan
    Write-Host ' 1) Assistente de IA (ChatGPT ou Claude)'
    Write-Host ' 2) Entrar no assistente (login do ChatGPT/Codex ou do Claude)'
    Write-Host ' 3) App da Meta (ID, chave secreta e, se precisar, ID da configuração)'
    Write-Host ' 4) Jev (chave)'
    Write-Host ' 5) Bancos de imagem (Unsplash, Pixabay, Pexels)'
    Write-Host ' 6) Login pelo Instagram (opcional, avançado)'
    Write-Host ' 7) Testar as chaves'
    Write-Host ' 8) Conferir os programas instalados'
    Write-Host ' 9) Abrir o .env no Bloco de Notas'
    Write-Host ' 0) Sair'
    $op = Read-Host 'Escolha'
    switch ($op) {
      '1' { Set-Assistant }
      '2' { Start-Login }
      '3' { Edit-Values @(
          @{ Name = 'FB_APP_ID'; Prompt = 'ID do Aplicativo (Configurações do app › Básico)' },
          @{ Name = 'FB_APP_SECRET'; Prompt = 'Chave Secreta do Aplicativo (clique em Mostrar e copie inteira)'; Secret = $true },
          @{ Name = 'FB_CONFIG_ID'; Prompt = 'ID da configuração do Login para Empresas (só se a Meta recusou as permissões)' }
        ); Show-Check 'Meta (app)' (Test-Facebook) }
      '4' { Edit-Values @(@{ Name = 'TYPESAFE_API_KEY'; Prompt = 'Chave do Jev (TypeSafe)'; Secret = $true }); Show-Check 'Jev' (Test-Jev) }
      '5' { Edit-Values @(
          @{ Name = 'UNSPLASH_ACCESS_KEY'; Prompt = 'Unsplash: Access Key (unsplash.com/developers)'; Secret = $true },
          @{ Name = 'PIXABAY_API_KEY'; Prompt = 'Pixabay: chave (pixabay.com/api/docs, logada)'; Secret = $true },
          @{ Name = 'PEXELS_API_KEY'; Prompt = 'Pexels: chave (se tiver)'; Secret = $true }
        ); Show-Check 'Pixabay' (Test-Pixabay); Show-Check 'Unsplash' (Test-Unsplash) }
      '6' { Edit-Values @(
          @{ Name = 'IG_APP_ID'; Prompt = 'ID do app do Instagram (Configuração da API com login do Instagram)' },
          @{ Name = 'IG_APP_SECRET'; Prompt = 'Chave secreta do app do Instagram'; Secret = $true }
        ) }
      '7' { Invoke-AllChecks }
      '8' { Show-Programs }
      '9' { Start-Process notepad.exe $EnvFile }
      '0' { Write-Host 'Pronto. Se o dashboard estiver aberto, feche e abra de novo (iniciar.cmd) para valer.' -ForegroundColor Green; return }
      default { Write-Host 'Opção inválida.' -ForegroundColor Yellow }
    }
    Write-Host ''
    Read-Host 'Enter para voltar ao menu' | Out-Null
  }
}

if (-not $SemMenu) { Show-Menu }
