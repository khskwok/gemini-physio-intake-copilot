param(
  [string]$ProjectId = "physio-intake-copilot",
  [string]$Region = "us-central1",
  [string]$Service = "physio-intake-copilot",
  [string]$ProbeText = "knee pain for two weeks"
)

$ErrorActionPreference = "Stop"
$hadFailure = $false

function Write-Info($msg) {
  Write-Host "[INFO] $msg" -ForegroundColor Cyan
}

function Write-Ok($msg) {
  Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-Fail($msg) {
  Write-Host "[FAIL] $msg" -ForegroundColor Red
}

function Invoke-HttpGet([string]$Uri) {
  try {
    $resp = Invoke-WebRequest -Method Get -Uri $Uri -UseBasicParsing
    return [pscustomobject]@{
      StatusCode = [int]$resp.StatusCode
      Content = $resp.Content
      IsError = $false
    }
  }
  catch {
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $content = $reader.ReadToEnd()
      return [pscustomobject]@{
        StatusCode = $status
        Content = $content
        IsError = $true
      }
    }

    throw
  }
}

function Resolve-GcloudPath {
  $candidate = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
  if (Test-Path $candidate) {
    return $candidate
  }

  $cmd = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  throw "gcloud not found. Install Google Cloud CLI first."
}

function Invoke-JsonPost([string]$Uri, [hashtable]$Body) {
  $json = $Body | ConvertTo-Json -Compress
  try {
    $resp = Invoke-WebRequest -Method Post -Uri $Uri -ContentType "application/json" -Body $json -UseBasicParsing
    return [pscustomobject]@{
      StatusCode = [int]$resp.StatusCode
      Content = $resp.Content
      IsError = $false
    }
  }
  catch {
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $content = $reader.ReadToEnd()
      return [pscustomobject]@{
        StatusCode = $status
        Content = $content
        IsError = $true
      }
    }

    throw
  }
}

$gcloud = Resolve-GcloudPath
Write-Info "Using gcloud at $gcloud"

Write-Info "Resolving Cloud Run service URL for $Service in $Region..."
$serviceUrl = & $gcloud run services describe $Service --region $Region --project $ProjectId --format='value(status.url)'
if (-not $serviceUrl) {
  throw "Could not resolve service URL."
}
$serviceUrl = $serviceUrl.Trim()
Write-Ok "Service URL: $serviceUrl"

Write-Info "Checking app shell on / ..."
$root = Invoke-HttpGet -Uri "$serviceUrl/"
if ($root.StatusCode -ne 200) {
  Write-Fail "Root endpoint failed with status $($root.StatusCode)"
}
elseif ($root.Content -notmatch "Hold to Talk") {
  Write-Fail "Root HTML does not include the latest voice UI marker 'Hold to Talk'."
}
else {
  Write-Ok "/ returned 200 and includes the latest voice UI"
}

if ($root.StatusCode -ne 200 -or $root.Content -notmatch "Hold to Talk") {
  $hadFailure = $true
}

Write-Info "Checking static asset endpoints..."
$assetChecks = @(
  @{ Name = "/styles.css"; Uri = "$serviceUrl/styles.css"; Marker = ".btn.recording" },
  @{ Name = "/app.js"; Uri = "$serviceUrl/app.js"; Marker = "startPressToTalk" }
)

foreach ($assetCheck in $assetChecks) {
  $asset = Invoke-HttpGet -Uri $assetCheck.Uri
  if ($asset.StatusCode -ne 200) {
    Write-Fail "$($assetCheck.Name) failed with status $($asset.StatusCode)"
    $hadFailure = $true
    continue
  }
  if ($asset.Content -notmatch [regex]::Escape($assetCheck.Marker)) {
    Write-Fail "$($assetCheck.Name) returned 200 but did not contain expected marker '$($assetCheck.Marker)'."
    $hadFailure = $true
    continue
  }
  Write-Ok "$($assetCheck.Name) returned 200 and matches the deployed voice revision"
}

Write-Info "Checking /api/health ..."
$health = Invoke-HttpGet -Uri "$serviceUrl/api/health"
if ($health.StatusCode -ne 200) {
  Write-Fail "/api/health failed with status $($health.StatusCode)"
  $hadFailure = $true
}
else {
  Write-Ok "/api/health returned 200"
}

Write-Info "Checking /api/config ..."
$config = Invoke-HttpGet -Uri "$serviceUrl/api/config"
if ($config.StatusCode -ne 200) {
  Write-Fail "/api/config failed with status $($config.StatusCode)"
  $hadFailure = $true
}
else {
  Write-Ok "/api/config returned 200"
}

Write-Info "Checking /api/live/health ..."
$liveHealth = Invoke-HttpGet -Uri "$serviceUrl/api/live/health"
if ($liveHealth.StatusCode -ne 200) {
  Write-Fail "/api/live/health failed with status $($liveHealth.StatusCode)"
  Write-Host $liveHealth.Content
  $hadFailure = $true
  if ($liveHealth.StatusCode -eq 400 -or $liveHealth.StatusCode -eq 401 -or $liveHealth.StatusCode -eq 403) {
    Write-Host "Hint: Gemini Live API key access is invalid or unauthorized." -ForegroundColor Yellow
  }
  elseif ($liveHealth.StatusCode -eq 503) {
    Write-Host "Hint: The configured Gemini Live model is not available to the current API key." -ForegroundColor Yellow
  }
}
else {
  $livePayload = $null
  try {
    $livePayload = $liveHealth.Content | ConvertFrom-Json
  }
  catch {
    Write-Fail "/api/live/health returned 200 but non-JSON body."
    Write-Host $liveHealth.Content
    $hadFailure = $true
  }

  if ($livePayload) {
    if (-not $livePayload.ok) {
      Write-Fail "/api/live/health returned 200 but reported ok=false."
      Write-Host $liveHealth.Content
      $hadFailure = $true
    }
    else {
      Write-Ok "Gemini Live API readiness is healthy for model $($livePayload.liveModel)"
    }
  }
}

Write-Info "Checking Gemini response path via /api/chat..."
$chat = Invoke-JsonPost -Uri "$serviceUrl/api/chat" -Body @{ text = $ProbeText }

if ($chat.StatusCode -eq 200) {
  $parsed = $null
  try {
    $parsed = $chat.Content | ConvertFrom-Json
  }
  catch {
    Write-Fail "Chat endpoint returned 200 but non-JSON body."
    Write-Host $chat.Content
    $hadFailure = $true
  }

  if ($parsed -and -not $parsed.reply) {
    Write-Fail "Chat endpoint returned 200 but missing reply field."
    Write-Host $chat.Content
    $hadFailure = $true
  }

  if ($parsed -and $parsed.reply) {
    Write-Ok "Gemini chat path is healthy."
    Write-Host "Reply: $($parsed.reply)"
  }
}

if ($chat.StatusCode -ne 200) {
  Write-Fail "/api/chat failed with status $($chat.StatusCode)"
  Write-Host $chat.Content
  $hadFailure = $true

  if ($chat.StatusCode -eq 429) {
    Write-Host "Hint: Quota exhausted. Check AI Studio quota/billing and retry." -ForegroundColor Yellow
  }
  elseif ($chat.StatusCode -eq 400 -or $chat.StatusCode -eq 401 -or $chat.StatusCode -eq 403) {
    Write-Host "Hint: API key/model mismatch. Verify Secret Manager key and GEMINI_MODEL setting." -ForegroundColor Yellow
  }
}

if ($hadFailure) {
  exit 1
}

exit 0
