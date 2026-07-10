Set WshShell = CreateObject("WScript.Shell")
smt = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - Len(WScript.ScriptName))

' Start server
WshShell.Run "cmd /c cd /d """ & smt & """ && node dist/index.js", 0, False
WScript.Sleep 4000

' Start Electron overlay using local binary
WshShell.Run "cmd /c cd /d """ & smt & """ && node_modules\.bin\electron.cmd app/main.cjs", 0, False
