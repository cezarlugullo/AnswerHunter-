param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CliArgs)
& 'C:\Program Files\nodejs\npx.cmd' -y @playwright/cli@latest @CliArgs
exit $LASTEXITCODE
