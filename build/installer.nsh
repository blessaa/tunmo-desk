; Overlay updates: close the running app so files are not locked, then install silently.
; Do not use taskkill /T — that kills the installer too when it is still a child of tunmo-desk.exe.
!macro customInit
  ${if} ${isUpdated}
    SetSilent silent
    nsExec::ExecToLog 'taskkill /F /IM tunmo-desk.exe'
    Sleep 1500
  ${endIf}
!macroend

; ExecShellAsUser (used by electron-builder's doStartApp) often fails on per-user
; silent installs, so start the exe ourselves and blank $launchLink to avoid a second launch.
!macro customInstall
  ${if} ${isUpdated}
    StrCpy $launchLink ""
    HideWindow
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --updated'
  ${endIf}
!macroend
