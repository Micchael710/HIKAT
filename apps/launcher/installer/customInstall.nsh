!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinMessages.nsh"

/**
 * HiKAT Launcher NSIS Installer Customizations
 * - Modern single-screen assisted setup using nsDialogs and native Windows folder picker
 * - Official HiKAT branding with cat medallion logo
 * - Root path derivation: User picks parent folder -> displays <PARENT>\HiKAT
 * - Binary installed into <PARENT>\HiKAT\Launcher
 * - Sibling data directories <PARENT>\HiKAT\games and <PARENT>\HiKAT\runtime
 * - Permissions: icacls applied conditionally only if installed under Program Files
 * - Updates: Skips setup UI during auto-updates (${isUpdated})
 */

Var /GLOBAL HiKatRoot
Var /GLOBAL Dialog
Var /GLOBAL TxtLocation
Var /GLOBAL BtnBrowse
Var /GLOBAL HwndImage
Var /GLOBAL ImageHandle
Var /GLOBAL TitleFont

!macro customWelcomePage
  Function DeriveHiKatRoot
    # Argument on stack: path chosen by user or initial directory
    Exch $R0

    # Strip trailing backslash if present and length > 3 (preserving drive roots like D:\)
    StrCpy $R9 "$R0" 1 -1
    ${If} $R9 == "\"
      StrLen $R8 "$R0"
      ${If} $R8 > 3
        StrCpy $R0 "$R0" -1
      ${EndIf}
    ${EndIf}

    # Inspect folder components
    ${GetFileName} "$R0" $R1
    ${GetParent} "$R0" $R2
    ${GetFileName} "$R2" $R3

    ${If} $R1 == "Launcher"
    ${AndIf} $R3 == "HiKAT"
      # User selected ...\HiKAT\Launcher -> root is ...\HiKAT
      StrCpy $HiKatRoot "$R2"
    ${ElseIf} $R1 == "HiKAT"
      # User selected ...\HiKAT -> root is ...\HiKAT
      StrCpy $HiKatRoot "$R0"
    ${Else}
      # User selected parent directory (e.g. D:\, C:\Program Files, E:\Games)
      StrCpy $R9 "$R0" 1 -1
      ${If} $R9 == "\"
        StrCpy $HiKatRoot "$R0HiKAT"
      ${Else}
        StrCpy $HiKatRoot "$R0\HiKAT"
      ${EndIf}
    ${EndIf}

    # Internal INSTDIR is always <HiKatRoot>\Launcher
    StrCpy $INSTDIR "$HiKatRoot\Launcher"

    Pop $R0
  FunctionEnd

  Function OnBrowseClick
    Pop $0 # HWND of button

    # Determine initial dialog folder from parent of current HiKatRoot
    ${GetParent} "$HiKatRoot" $R0
    ${If} $R0 == ""
      StrCpy $R0 "$HiKatRoot"
    ${EndIf}

    nsDialogs::SelectFolderDialog "Selecciona la carpeta donde deseas instalar HiKAT" "$R0"
    Pop $R1

    ${If} $R1 != "error"
    ${AndIf} $R1 != ""
      Push $R1
      Call DeriveHiKatRoot

      ${NSD_SetText} $TxtLocation "$HiKatRoot"
    ${EndIf}
  FunctionEnd

  Function HiKatInstallPageCreate
    ${If} ${isUpdated}
      Abort # Skip UI during auto-updates
    ${EndIf}

    # Initialize default HiKatRoot if empty
    ${If} $HiKatRoot == ""
      ${If} $PROGRAMFILES64 != ""
        StrCpy $HiKatRoot "$PROGRAMFILES64\HiKAT"
      ${Else}
        StrCpy $HiKatRoot "$PROGRAMFILES\HiKAT"
      ${EndIf}
      StrCpy $INSTDIR "$HiKatRoot\Launcher"
    ${EndIf}

    # Create nsDialogs canvas
    nsDialogs::Create 1018
    Pop $Dialog
    ${If} $Dialog == error
      Abort
    ${EndIf}

    # Clean white background
    SetCtlColors $Dialog 0x000000 0xFFFFFF

    # Configure Wizard Buttons: Next -> Instalar, Hide Back
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Instalar"

    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}

    # 1. Official HiKAT Logo (212x80 px -> 141u x 53u)
    ${NSD_CreateBitmap} 10u 8u 141u 53u ""
    Pop $HwndImage
    SetCtlColors $HwndImage 0x000000 0xFFFFFF
    File "/oname=$PLUGINSDIR\hikat-logo.bmp" "${PROJECT_DIR}\installer\resources\hikat-logo.bmp"
    ${NSD_SetStretchedImage} $HwndImage "$PLUGINSDIR\hikat-logo.bmp" $ImageHandle

    # 2. Title: Instalar HiKAT Launcher
    ${NSD_CreateLabel} 10u 66u 280u 14u "Instalar HiKAT Launcher"
    Pop $0
    SetCtlColors $0 0x111827 0xFFFFFF
    CreateFont $TitleFont "Segoe UI" 12 700
    SendMessage $0 ${WM_SETFONT} $TitleFont 1

    # 3. Subtitle / Description
    ${NSD_CreateLabel} 10u 82u 280u 11u "HiKAT y sus componentes se instalarán en la siguiente ubicación:"
    Pop $0
    SetCtlColors $0 0x4B5563 0xFFFFFF

    # 4. Location display text control
    ${NSD_CreateText} 10u 96u 220u 14u "$HiKatRoot"
    Pop $TxtLocation
    SetCtlColors $TxtLocation 0x111827 0xF9FAFB

    # 5. Browse button using native Windows folder picker
    ${NSD_CreateButton} 234u 95u 56u 16u "Examinar..."
    Pop $BtnBrowse
    ${NSD_OnClick} $BtnBrowse OnBrowseClick

    # 6. Explanatory subtext
    ${NSD_CreateLabel} 10u 114u 280u 18u "Se configurarán automáticamente las carpetas para Launcher, games y runtime."
    Pop $0
    SetCtlColors $0 0x6B7280 0xFFFFFF

    nsDialogs::Show
  FunctionEnd

  Function HiKatInstallPageLeave
    # Retrieve current text from control
    ${NSD_GetText} $TxtLocation $R0

    ${If} $R0 == ""
      MessageBox MB_ICONSTOP|MB_OK "Por favor, especifica una ruta de instalación válida."
      Abort
    ${EndIf}

    Push $R0
    Call DeriveHiKatRoot

    ${If} $INSTDIR == ""
      MessageBox MB_ICONSTOP|MB_OK "Ruta de instalación no válida."
      Abort
    ${EndIf}

    ${If} $ImageHandle != 0
      ${NSD_FreeBitmap} $ImageHandle
      StrCpy $ImageHandle 0
    ${EndIf}
  FunctionEnd

  Page custom HiKatInstallPageCreate HiKatInstallPageLeave
!macroend

!macro customInit
  ${If} $HiKatRoot == ""
    ${If} $PROGRAMFILES64 != ""
      StrCpy $HiKatRoot "$PROGRAMFILES64\HiKAT"
    ${Else}
      StrCpy $HiKatRoot "$PROGRAMFILES\HiKAT"
    ${EndIf}
    StrCpy $INSTDIR "$HiKatRoot\Launcher"
  ${EndIf}
!macroend

!macro customInstall
  ${IfNot} ${isUpdated}
    # $INSTDIR is <HiKatRoot>\Launcher -> $0 is <HiKatRoot>
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
