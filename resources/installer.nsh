; Force a user-writable TEMP before NSIS extracts plugins.
; Elevated / per-machine installs inherit C:\WINDOWS\TEMP, which BUILTIN\Users
; cannot write (Error 5: Access denied).
!macro redirectTemp
  StrCpy $0 "$LOCALAPPDATA\Temp"
  CreateDirectory "$0"
  System::Call 'kernel32::SetEnvironmentVariable(t "TEMP", t "$0")i .r1'
  System::Call 'kernel32::SetEnvironmentVariable(t "TMP", t "$0")i .r1'
!macroend

!macro preInit
  !insertmacro redirectTemp
!macroend

!macro customInit
  !insertmacro redirectTemp
!macroend
