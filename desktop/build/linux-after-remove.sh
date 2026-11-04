#!/bin/sh
# Runs after the Hearth package is removed. Your data and any Hearth service are left alone:
#   remove the service with:  sudo /opt/hearth-server/hearth-server service uninstall --copy-to /opt/hearth-server
#   your data is in ~/.config/Hearth/data (desktop) or /var/lib/hearth (service)
exit 0
