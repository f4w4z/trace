On Error Resume Next
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Resolve wsl.exe path (bypass SysWOW64 redirection if running in 32-bit process)
wslPath = "wsl.exe"
sysnative = WshShell.ExpandEnvironmentStrings("%windir%") & "\Sysnative\wsl.exe"
If fso.FileExists(sysnative) Then
    wslPath = sysnative
End If

' Kill Supermemory server process inside WSL directly
WshShell.Run wslPath & " -d Ubuntu -u root pkill -f supermemory", 0, True

' Kill trace API server (port 6768)
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr "":6768 ""') do taskkill /f /pid %a 2>nul", 0, True

' Kill supermemory server (port 6767)
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr "":6767 ""') do taskkill /f /pid %a 2>nul", 0, True

' Kill Electron overlay
WshShell.Run "taskkill /f /im electron.exe 2>nul", 0, True
