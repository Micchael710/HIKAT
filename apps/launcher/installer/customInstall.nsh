!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinMessages.nsh"

/**
 * HiKAT Launcher NSIS Installer Customizations
 * - Clean assisted setup using nsDialogs and modern Windows IFileOpenDialog
 * - Official HiKAT branding in upper-right header (installerHeader.bmp)
 * - Root path derivation: User picks parent folder -> displays <PARENT>\HiKAT
 * - Binary installed into <PARENT>\HiKAT\Launcher
 * - Sibling data directories <PARENT>\HiKAT\games and <PARENT>\HiKAT\runtime
 * - Permissions: icacls applied conditionally only if installed under Program Files
 * - Updates: Skips setup UI during auto-updates (${isUpdated})
 */

!define CLSID_FileOpenDialog "{DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7}"
!define IID_IFileDialog      "{42F85136-DB7E-439C-85F1-E4075D135FC8}"
!define IID_IShellItem       "{43826D1E-E718-42EE-BC55-A1E261C37BFE}"
!define CLSCTX_INPROC_SERVER 1
!define FOS_PICKFOLDERS      0x00000020
!define FOS_FORCEFILESYSTEM  0x00000040
!define SIGDN_FILESYSPATH    0x80058000

Var /GLOBAL HiKatRoot
Var /GLOBAL Dialog
Var /GLOBAL TxtLocation
Var /GLOBAL BtnBrowse
Var /GLOBAL TitleFont

Var /GLOBAL UnDialog
Var /GLOBAL UnTitleFont
Var /GLOBAL ChkDeleteData
Var /GLOBAL DeleteDataSelected
Var /GLOBAL HiKatRootToDelete

# If building uninstaller, ensure components page is silently skipped so user goes straight to welcome page
!ifdef BUILD_UNINSTALLER
  Function un.SkipComponentsPage
    Abort
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_PRE un.SkipComponentsPage
!endif

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

  Function SelectModernFolder
    StrCpy $R1 ""

    # Initialize COM library
    System::Call "ole32::CoInitialize(p 0)"

    # Create IFileOpenDialog instance
    System::Call "ole32::CoCreateInstance(g '${CLSID_FileOpenDialog}', p 0, i ${CLSCTX_INPROC_SERVER}, g '${IID_IFileDialog}', *p .r1) i.r2"

    ${If} $2 == 0
      # Combine existing options with FOS_PICKFOLDERS (0x20) and FOS_FORCEFILESYSTEM (0x40)
      System::Call "$1->10(*i .r3)" ; GetOptions
      IntOp $3 $3 | 0x60
      System::Call "$1->9(i $3)"    ; SetOptions

      System::Call "$1->17(w 'Selecciona la carpeta donde deseas instalar HiKAT')" ; SetTitle

      # Set initial folder if $R0 exists on disk
      ${If} $R0 != ""
        ${If} ${FileExists} "$R0"
          System::Call "shell32::SHCreateItemFromParsingName(w '$R0', p 0, g '${IID_IShellItem}', *p .r4) i.r5"
          ${If} $5 == 0
            System::Call "$1->12(p $4)" ; SetFolder
            System::Call "$4->2()"       ; Release IShellItem
          ${EndIf}
        ${EndIf}
      ${EndIf}

      # Display modern Windows Explorer file/folder picker modal dialog
      System::Call "$1->3(p $HWNDPARENT) i.r2" ; Show
      ${If} $2 == 0
        # User confirmed folder selection
        System::Call "$1->20(*p .r4) i.r2" ; GetResult -> IShellItem
        ${If} $2 == 0
          System::Call "$4->5(i ${SIGDN_FILESYSPATH}, *p .r5) i.r2" ; GetDisplayName (SIGDN_FILESYSPATH)
          ${If} $2 == 0
            System::Call "*$5(&w1024 .r6)"
            StrCpy $R1 "$6"
            System::Call "ole32::CoTaskMemFree(p $5)"
          ${EndIf}
          System::Call "$4->2()" ; Release IShellItem
        ${EndIf}
      ${EndIf}

      # Release IFileDialog
      System::Call "$1->2()"
    ${Else}
      # Fallback for systems where COM IFileOpenDialog is unavailable
      nsDialogs::SelectFolderDialog "Selecciona la carpeta donde deseas instalar HiKAT" "$R0"
      Pop $R1
      ${If} $R1 == "error"
        StrCpy $R1 ""
      ${EndIf}
    ${EndIf}
  FunctionEnd

  Function OnBrowseClick
    Pop $0 # HWND of button

    # Determine initial dialog folder from parent of current HiKatRoot
    ${GetParent} "$HiKatRoot" $R0
    ${If} $R0 == ""
      StrCpy $R0 "$HiKatRoot"
    ${EndIf}

    Call SelectModernFolder

    ${If} $R1 != ""
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

    # Title: Instalar HiKAT Launcher
    ${NSD_CreateLabel} 15u 18u 270u 16u "Instalar HiKAT Launcher"
    Pop $0
    SetCtlColors $0 0x111827 0xFFFFFF
    CreateFont $TitleFont "Segoe UI" 12 700
    SendMessage $0 ${WM_SETFONT} $TitleFont 1

    # Subtitle / Label: Ubicación de instalación:
    ${NSD_CreateLabel} 15u 42u 270u 12u "Ubicación de instalación:"
    Pop $0
    SetCtlColors $0 0x374151 0xFFFFFF

    # Location display text control
    ${NSD_CreateText} 15u 58u 205u 14u "$HiKatRoot"
    Pop $TxtLocation
    SetCtlColors $TxtLocation 0x111827 0xF9FAFB

    # Browse button using modern Windows folder picker
    ${NSD_CreateButton} 225u 57u 60u 16u "Examinar..."
    Pop $BtnBrowse
    ${NSD_OnClick} $BtnBrowse OnBrowseClick

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

!macro customUnInit
  StrCpy $DeleteDataSelected "0"
  StrCpy $HiKatRootToDelete ""
!macroend


!macro customUnWelcomePage
  Function un.HiKatUninstallPageCreate
    # Create nsDialogs canvas
    nsDialogs::Create 1018
    Pop $UnDialog
    ${If} $UnDialog == error
      Abort
    ${EndIf}

    # Clean white background
    SetCtlColors $UnDialog 0x000000 0xFFFFFF

    # Configure Wizard Buttons: Next -> Desinstalar, Hide Back
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Desinstalar"

    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}

    # Title: Desinstalar HiKAT Launcher
    ${NSD_CreateLabel} 15u 18u 270u 16u "Desinstalar HiKAT Launcher"
    Pop $0
    SetCtlColors $0 0x111827 0xFFFFFF
    CreateFont $UnTitleFont "Segoe UI" 12 700
    SendMessage $0 ${WM_SETFONT} $UnTitleFont 1

    # Subtitle / prompt text
    ${NSD_CreateLabel} 15u 42u 270u 24u "Se desinstalará HiKAT Launcher de tu equipo.$\r$\nLos juegos descargados se conservarán para futuras instalaciones salvo que marques la casilla inferior."
    Pop $0
    SetCtlColors $0 0x374151 0xFFFFFF

    # Checkbox: Eliminar también los juegos descargados y los datos de HiKAT
    # Unchecked by default
    ${NSD_CreateCheckbox} 15u 72u 270u 14u "Eliminar también los juegos descargados y los datos de HiKAT"
    Pop $ChkDeleteData
    SetCtlColors $ChkDeleteData 0x111827 0xFFFFFF
    ${NSD_SetState} $ChkDeleteData ${BST_UNCHECKED}

    nsDialogs::Show
  FunctionEnd

  Function un.HiKatUninstallPageLeave
    ${NSD_GetState} $ChkDeleteData $DeleteDataSelected
  FunctionEnd

  UninstPage custom un.HiKatUninstallPageCreate un.HiKatUninstallPageLeave
!macroend

!macro customUnInstall
  StrCpy $HiKatRootToDelete ""
  ${If} $DeleteDataSelected == "1"
    # Derive HiKAT Root from $INSTDIR (<HiKatRoot>\Launcher) while $INSTDIR still exists on disk
    ${GetParent} "$INSTDIR" $0
    ${GetFileName} "$0" $R1
    ${GetFileName} "$INSTDIR" $R2

    # Robust Safety Validation:
    # 1. $0 must not be empty
    # 2. $0 must end with "HiKAT" (parent folder must strictly be named HiKAT)
    # 3. $INSTDIR must end with "Launcher"
    # 4. $0 must not be a drive root or system folder
    ${If} $0 != ""
    ${AndIf} $R1 == "HiKAT"
    ${AndIf} $R2 == "Launcher"
    ${AndIf} $0 != "$PROGRAMFILES"
    ${AndIf} $0 != "$PROGRAMFILES64"
    ${AndIf} $0 != "$WINDIR"
    ${AndIf} $0 != "C:\"
    ${AndIf} $0 != "D:\"
    ${AndIf} $0 != "E:\"
      # Save the validated HiKAT root. Electron-builder will then delete $INSTDIR (Launcher).
      StrCpy $HiKatRootToDelete "$0"
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstallSection
  Section "un.CleanHiKatRemaining"
    ${If} $DeleteDataSelected == "1"
    ${AndIf} $HiKatRootToDelete != ""
      # 1. Delete downloaded games
      RMDir /r "$HiKatRootToDelete\games"

      # 2. Delete shared runtime
      RMDir /r "$HiKatRootToDelete\runtime"

      # 3. Clean any additional files inside the HiKAT root folder
      Delete "$HiKatRootToDelete\*.*"

      # 4. Clean local user data inside AppData
      SetShellVarContext current
      RMDir /r "$APPDATA\HiKAT"
      RMDir /r "$APPDATA\hikat-launcher"
      RMDir /r "$LOCALAPPDATA\HiKAT"
      RMDir /r "$LOCALAPPDATA\hikat-launcher"
      SetShellVarContext all
      RMDir /r "$APPDATA\HiKAT"

      # 5. Remove the main HiKAT folder once Launcher and all contents are gone
      SetOutPath $TEMP
      RMDir "$HiKatRootToDelete"
    ${EndIf}
  SectionEnd
!macroend


