Set WshShell = CreateObject("WScript.Shell")

' Kill trace API server (port 6768)
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr "":6768 ""') do taskkill /f /pid %a 2>nul", 0, True

' Kill Electron overlay
WshShell.Run "taskkill /f /im electron.exe 2>nul", 0, True
