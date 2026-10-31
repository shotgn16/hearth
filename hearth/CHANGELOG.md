# Changelog

## 1.1.0
- Removed browser device recognition and browser push notifications; notifications now go to Home Assistant notify services (your phones via the HA app), ntfy and Hearth's in-app inbox
- Home Assistant add-on: sidebar panel via ingress with automatic sign-in as your HA user
- Notifications through HA notify services, HA calendar entities as a calendar source, `sensor.hearth_*` entities, workflow actions to fire HA events and call HA services
- Local AI assistant rebuilt: looks up your data with tool calling, streams answers, keeps conversations, proposes actions you confirm
- Per-task models (chat, fast, vision), context window, keep-alive and house rules settings
- Receipt scanning, smart search ("coffee over £5 in September"), describe-a-workflow, AI monthly reviews, budget suggestions, subscription review, event cost estimates
- AI categorisations are reviewable, acceptable in one tap, or undoable; AI activity log

## 1.0.0
- First release
