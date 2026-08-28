; Overlay 更新：关掉旧进程避免文件占用，但不要 SetSilent。
; 静默安装没有进度窗口，复制 tunmo-backend.asar 时会像卡住。
; 不要用 taskkill /T，安装程序还是 tunmo-desk 的子进程时会被一起杀掉。
!macro customInit
  ${if} ${isUpdated}
    nsExec::ExecToLog 'taskkill /F /IM tunmo-desk.exe'
    Sleep 1200
  ${endIf}
!macroend

; 更新时跳过完成页，直接打开新版本，避免多点一次「完成」。
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function skipFinishIfUpdated
    ${if} ${isUpdated}
      HideWindow
      Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --updated'
      Abort
    ${endif}
  FunctionEnd

  !ifndef HIDE_RUN_AFTER_FINISH
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_PRE skipFinishIfUpdated
  !insertmacro MUI_PAGE_FINISH
!macroend
