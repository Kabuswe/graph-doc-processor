param([int]$Port = 2028, [switch]$KeepServer)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$REPO  = "C:\Users\ULTRAPC\Documents\GitHub\graph-doc-processor"
$BASE  = "http://localhost:$Port"
$GRAPH = "docProcessor"
$PASS  = 0
$FAIL  = 0

function Write-Pass { param([string]$n) Write-Host "  [PASS] $n" -ForegroundColor Green; $script:PASS++ }
function Write-Fail { param([string]$n,[string]$d) Write-Host "  [FAIL] $n -- $d" -ForegroundColor Red; $script:FAIL++ }

function Wait-ServerReady {
  param([string]$url,[int]$max=60)
  $dl = (Get-Date).AddSeconds($max)
  while ((Get-Date) -lt $dl) {
    try { $r = Invoke-RestMethod "$url/ok" -TimeoutSec 2 -ErrorAction Stop; if ($r.ok -eq $true) { return $true } } catch {}
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Invoke-GraphRun {
  param([hashtable]$graphInput,[int]$timeout=120)
  $t = Invoke-RestMethod "$BASE/threads" -Method POST -ContentType "application/json" -Body "{}" -TimeoutSec 10
  $b = @{ assistant_id=$GRAPH; input=$graphInput } | ConvertTo-Json -Depth 8
  return Invoke-RestMethod "$BASE/threads/$($t.thread_id)/runs/wait" -Method POST -ContentType "application/json" -Body $b -TimeoutSec $timeout
}

Write-Host ""
Write-Host "-----------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  graph-doc-processor -- LangGraph API Integration Tests" -ForegroundColor Cyan
Write-Host "-----------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Starting langgraph dev on port $Port..." -ForegroundColor DarkGray

$serverJob = Start-Job -ScriptBlock {
  param($repo,$port)
  Set-Location $repo
  npx @langchain/langgraph-cli dev --port $port --no-browser 2>&1
} -ArgumentList $REPO,$Port

if (-not (Wait-ServerReady $BASE)) {
  Write-Host "  [ERROR] Server failed to start" -ForegroundColor Red
  Stop-Job $serverJob -PassThru | Remove-Job -Force
  exit 1
}
Write-Host "  Server ready" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Running tests..." -ForegroundColor DarkGray
Write-Host ""

# Test 1: Markdown document full processing
try {
  $md = "# LangGraph Overview`n`nLangGraph is a library for building stateful multi-actor LLM apps.`n`n## Installation`n`nnpm install @langchain/langgraph`n`n## Concepts`n`n- StateGraph`n- Nodes`n- Edges"
  $r = Invoke-GraphRun -graphInput @{ rawContent=$md; clientId="api-test"; processingDepth="full" }
  if ($r.detectedFormat -eq "markdown" -and $r.phase -eq "trigger-ingestion" -and $r.oneLiner.Length -gt 0) {
    Write-Pass "1. Markdown full -- format=$($r.detectedFormat) phase=$($r.phase) docId=$($r.docId)"
  } else {
    Write-Fail "1. Markdown full" "format=$($r.detectedFormat) phase=$($r.phase) oneLiner.len=$($r.oneLiner.Length)"
  }
} catch { Write-Fail "1. Markdown full" $_.Exception.Message }

# Test 2: JSON document full processing
try {
  $json = '{"name":"graph-contracts","version":"1.0.0","description":"Type contracts for the agent graph platform"}'
  $r = Invoke-GraphRun -graphInput @{ rawContent=$json; clientId="api-test"; processingDepth="full" }
  if ($r.detectedFormat -eq "json" -and $r.phase -eq "trigger-ingestion" -and $r.qaPairs.Count -gt 0) {
    Write-Pass "2. JSON full -- format=$($r.detectedFormat) qaPairs=$($r.qaPairs.Count)"
  } else {
    Write-Fail "2. JSON full" "format=$($r.detectedFormat) phase=$($r.phase) qaPairs=$($r.qaPairs.Count)"
  }
} catch { Write-Fail "2. JSON full" $_.Exception.Message }

# Test 3: Summary-only depth
try {
  $r = Invoke-GraphRun -graphInput @{ rawContent="Retrieval-Augmented Generation (RAG) combines LLMs with vector databases to answer questions using retrieved document context."; clientId="api-test"; processingDepth="summary-only" }
  if ($r.phase -eq "generate-summary" -and $r.oneLiner.Length -gt 5) {
    Write-Pass "3. Summary-only -- phase=$($r.phase) oneLiner.len=$($r.oneLiner.Length)"
  } else {
    Write-Fail "3. Summary-only" "phase=$($r.phase) oneLiner.len=$($r.oneLiner.Length)"
  }
} catch { Write-Fail "3. Summary-only" $_.Exception.Message }

# Test 4: Plain text with URL extracts externalRefs
try {
  $r = Invoke-GraphRun -graphInput @{ rawContent="See the LangChain docs at https://python.langchain.com for setup instructions. RAG pipelines are documented in the Retrieval section."; clientId="api-test"; processingDepth="full" }
  $refs = @($r.externalRefs)
  $hasRef = @($refs | Where-Object { $_ -like "*langchain*" }).Count -gt 0
  if ($r.detectedFormat -eq "txt" -and $r.phase -eq "trigger-ingestion" -and $hasRef) {
    Write-Pass "4. Plain text refs -- format=$($r.detectedFormat) externalRefs=$($refs.Count)"
  } else {
    Write-Fail "4. Plain text refs" "format=$($r.detectedFormat) phase=$($r.phase) refs=$($refs.Count) hasRef=$hasRef"
  }
} catch { Write-Fail "4. Plain text refs" $_.Exception.Message }

Write-Host ""
Write-Host "-----------------------------------------------------------" -ForegroundColor Cyan
$color = if ($FAIL -eq 0) { "Green" } else { "Red" }
Write-Host ("  Results: {0}/{1} passed" -f $PASS,($PASS+$FAIL)) -ForegroundColor $color
Write-Host "-----------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""

if (-not $KeepServer) {
  Stop-Job $serverJob -PassThru | Remove-Job -Force 2>$null
  Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}
exit $(if ($FAIL -eq 0) { 0 } else { 1 })