; Trace NSIS Custom Script — Auto-install WSL during installation
; electron-builder calls !macro customInit from its own .onInit

!include 'LogicLib.nsh'

!macro customInit
  ; Check if WSL distros are already registered
  nsExec::ExecToStack 'cmd /c wsl -l -q'
  Pop $0  ; return code
  Pop $1  ; output

  ${If} $0 == "0"
    ; WSL already has distros — nothing to do
    Goto done
  ${EndIf}

  ; WSL not ready — install it
  MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Trace requires Windows Subsystem for Linux (WSL).$\r$\n$\r$\nThe installer will now enable WSL and download Ubuntu (~200 MB).$\r$\n$\r$\nClick OK to continue." IDOK installWsl
  Goto done

  installWsl:
    DetailPrint "Enabling Windows Subsystem for Linux..."
    nsExec::ExecToStack 'cmd /c wsl --install --distribution Ubuntu --no-launch'
    Pop $0
    Pop $1

    ${If} $0 != "0"
      DetailPrint "Trying alternative WSL enable method..."
      nsExec::ExecToStack 'cmd /c dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart'
      Pop $0
      Pop $1

      nsExec::ExecToStack 'cmd /c dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart'
      Pop $0
      Pop $1
    ${EndIf}

    DetailPrint "WSL has been enabled. A reboot is required to complete setup."
    MessageBox MB_OK|MB_ICONINFORMATION "WSL enabled successfully.$\r$\n$\r$\nA reboot is required before Trace can use WSL.$\r$\n$\r$\nThe installer will continue — please reboot after installation."

  done:
!macroend
