; Overlay updates: close the running app so files are not locked, then install silently.
!macro customInit
  ${if} ${isUpdated}
    SetSilent silent
  ${endIf}
  nsExec::ExecToLog 'taskkill /F /IM tunmo-desk.exe /T'
  Sleep 1000
!macroend
