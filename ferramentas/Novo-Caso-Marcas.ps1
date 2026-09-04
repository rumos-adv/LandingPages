param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$AceiteId,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Marca,

  [string]$BasePath = "C:\Users\WiFi\Desktop\Advocacia\Marcas\Casos"
)

$safeId = ($AceiteId.Trim() -replace '[^A-Za-z0-9_-]', '_')
$normalizedMark = $Marca.Trim().Normalize([Text.NormalizationForm]::FormD)
$safeMark = (($normalizedMark -replace '\p{M}', '') -replace '[^A-Za-z0-9]+', '_').Trim('_')

if (-not $safeId -or -not $safeMark) {
  throw 'AceiteId e Marca precisam conter caracteres válidos.'
}

$baseFullPath = [IO.Path]::GetFullPath($BasePath)
if (-not (Test-Path -LiteralPath $baseFullPath)) {
  New-Item -ItemType Directory -Path $baseFullPath | Out-Null
}

$folderName = '{0}_{1}_{2}' -f (Get-Date -Format 'yyyy-MM-dd'), $safeId, $safeMark
$casePath = Join-Path $baseFullPath $folderName
$caseFullPath = [IO.Path]::GetFullPath($casePath)

if (-not $caseFullPath.StartsWith($baseFullPath, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'O caminho calculado saiu da pasta-base autorizada.'
}

$subfolders = @(
  '01_briefing',
  '02_evidencias_inpi',
  '03_analise',
  '04_relatorio',
  '05_entrega',
  '06_registro'
)

New-Item -ItemType Directory -Path $caseFullPath -Force | Out-Null
foreach ($subfolder in $subfolders) {
  New-Item -ItemType Directory -Path (Join-Path $caseFullPath $subfolder) -Force | Out-Null
}

$readme = @"
CASO DE MARCA

Aceite ID: $AceiteId
Marca: $Marca
Pasta criada em: $(Get-Date -Format 'dd/MM/yyyy HH:mm')

Não guardar tokens, chaves de API ou senhas nesta pasta.
O painel administrativo é a fonte de verdade para prazo, entrega e conversão.
Relatório final: relatorio-viabilidade-$safeMark-$(Get-Date -Format 'yyyy-MM-dd').pdf
"@

Set-Content -LiteralPath (Join-Path $caseFullPath 'LEIA-ME.txt') -Value $readme -Encoding utf8
Write-Output $caseFullPath

