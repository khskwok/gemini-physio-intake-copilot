param(
  [string]$ProjectId = "physio-intake-copilot",
  [string]$Region = "us-central1",
  [string]$Service = "physio-intake-copilot",
  [string]$ProbeText = "knee pain for two weeks"
)

$ErrorActionPreference = "Stop"

function Write-Info($msg) {
  Write-Host "[INFO] $msg" -ForegroundColor Cyan
}

function Write-Ok($msg) {
  Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-Fail($msg) {
  Write-Host "[FAIL] $msg" -ForegroundColor Red
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

Write-Info "Checking health endpoint..."
$health = Invoke-WebRequest -UseBasicParsing "$serviceUrl/api/health"
if ([int]$health.StatusCode -ne 200) {
  Write-Fail "Health check failed with status $($health.StatusCode)"
  exit 1
}
Write-Ok "/api/health returned 200"

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
    exit 1
  }

  if (-not $parsed.reply) {
    Write-Fail "Chat endpoint returned 200 but missing reply field."
    Write-Host $chat.Content
    exit 1
  }

  Write-Ok "Gemini chat path is healthy."
  Write-Host "Reply: $($parsed.reply)"
  exit 0
}

Write-Fail "/api/chat failed with status $($chat.StatusCode)"
Write-Host $chat.Content

if ($chat.StatusCode -eq 429) {
  Write-Host "Hint: Quota exhausted. Check AI Studio quota/billing and retry." -ForegroundColor Yellow
}
elseif ($chat.StatusCode -eq 400 -or $chat.StatusCode -eq 401 -or $chat.StatusCode -eq 403) {
  Write-Host "Hint: API key/model mismatch. Verify Secret Manager key and GEMINI_MODEL setting." -ForegroundColor Yellow
}

exit 1
