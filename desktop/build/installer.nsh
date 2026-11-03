; Extra steps for the Windows installer.
; Hearth's own setup (this computer / household server / Docker / Home Assistant) runs in the app
; straight after installing, so it can be changed later from the tray menu → "Change setup…".
!macro customUnInstall
  ; Leave a running Hearth service alone unless it was removed in the app first — it may be serving the household.
  DetailPrint "Your Hearth data is kept. To remove the Hearth service as well, use Change setup… before uninstalling."
!macroend
