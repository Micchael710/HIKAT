!include "LogicLib.nsh"
!include "FileFunc.nsh"

/**
 * HiKAT Launcher NSIS Installer Customizations
 * - Directs installation to <CHOSEN_PARENT>\HiKAT\Launcher
 * - Creates sibling data directories <CHOSEN_PARENT>\HiKAT\games and runtime
 * - Conditionally applies write permissions for standard users ONLY if installed under Program Files
 * - Bypasses directory/permission operations during auto-updates (${isUpdated})
 */

Function HiKatInstFilesPre
  # Normalization & path derivation prior to files extraction
  StrCpy $R9 "$INSTDIR" 1 -1
  ${If} $R9 == "\"
    StrLen $R8 "$INSTDIR"
    ${If} $R8 > 3
      StrCpy $INSTDIR "$INSTDIR" -1
    ${EndIf}
  ${EndIf}

  ${GetFileName} "$INSTDIR" $R0
  ${GetParent} "$INSTDIR" $R1
  ${GetFileName} "$R1" $R2

  ${If} $R0 == "Launcher"
  ${AndIf} $R2 == "HiKAT"
    # Already canonical ...\HiKAT\Launcher
  ${ElseIf} $R0 == "HiKAT"
    StrCpy $INSTDIR "$INSTDIR\Launcher"
  ${Else}
    StrCpy $R9 "$INSTDIR" 1 -1
    ${If} $R9 == "\"
      StrCpy $INSTDIR "$INSTDIRHiKAT\Launcher"
    ${Else}
      StrCpy $INSTDIR "$INSTDIR\HiKAT\Launcher"
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE HiKatInstFilesPre
!macroend

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
