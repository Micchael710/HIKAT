!include "LogicLib.nsh"
!include "FileFunc.nsh"

/**
 * HiKAT Launcher NSIS Installer Customizations
 * - Directs installation to <CHOSEN_PARENT>\HiKAT\Launcher
 * - Creates sibling data directories <CHOSEN_PARENT>\HiKAT\games and runtime
 * - Conditionally applies write permissions for standard users ONLY if installed under Program Files
 * - Bypasses directory/permission operations during auto-updates (${isUpdated})
 */

!macro customHeader
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirectoryLeave
!macroend

Function DirectoryLeave
  # Ensure the target installation directory is always formatted as <PARENT>\HiKAT\Launcher
  ${GetFileName} "$INSTDIR" $R0
  ${GetParent} "$INSTDIR" $R1
  ${GetFileName} "$R1" $R2

  ${If} $R0 == "Launcher"
  ${AndIf} $R2 == "HiKAT"
    # User already has canonical ...\HiKAT\Launcher path
  ${ElseIf} $R0 == "HiKAT"
    # User selected ...\HiKAT -> append \Launcher
    StrCpy $INSTDIR "$INSTDIR\Launcher"
  ${Else}
    # User selected parent folder (e.g. D:\, C:\Program Files) -> append \HiKAT\Launcher
    StrCpy $INSTDIR "$INSTDIR\HiKAT\Launcher"
  ${EndIf}
FunctionEnd

!macro customInstall
  ${IfNot} ${isUpdated}
    # $INSTDIR is <PARENT>\HiKAT\Launcher -> $0 is <PARENT>\HiKAT
    ${GetParent} "$INSTDIR" $0

    CreateDirectory "$0\games"
    CreateDirectory "$0\runtime"

    # Robust Protected Location Check (e.g. C:\Program Files, C:\Program Files (x86))
    GetFullPathName $1 "$INSTDIR"
    GetFullPathName $2 "$PROGRAMFILES"
    GetFullPathName $3 "$PROGRAMFILES64"

    StrLen $4 "$2"
    StrCpy $5 "$1" $4
    StrLen $6 "$3"
    StrCpy $7 "$1" $6

    # Verify character immediately following the prefix is a path separator
    StrCpy $8 "$1" 1 $4
    StrCpy $9 "$1" 1 $6

    # Check match against PROGRAMFILES or PROGRAMFILES64
    ${If} "$5" == "$2"
    ${AndIf} "$8" == "\"
      ExecWait 'icacls "$0\games" /grant "*S-1-5-32-545:(OI)(CI)M" /T /C /Q'
      ExecWait 'icacls "$0\runtime" /grant "*S-1-5-32-545:(OI)(CI)M" /T /C /Q'
    ${ElseIf} "$7" == "$3"
    ${AndIf} "$9" == "\"
      ExecWait 'icacls "$0\games" /grant "*S-1-5-32-545:(OI)(CI)M" /T /C /Q'
      ExecWait 'icacls "$0\runtime" /grant "*S-1-5-32-545:(OI)(CI)M" /T /C /Q'
    ${EndIf}
  ${EndIf}
!macroend
