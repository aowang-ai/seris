---
name: autopilot
description: Manage local recurring price and funding monitors and reminder schedules.
metadata:
  seris:
    priority: 25
    tool_names: [autopilot_register, autopilot_list, autopilot_pause, autopilot_resume, autopilot_run_now, autopilot_close]
---
# Local schedules

Use `autopilot_register` with a clear symbol, interval and threshold. Check the returned ID and status before saying monitoring started. `autopilot_list` reports recent runs; pause, resume and close use that schedule's ID. DCA schedules are reminders, not executed purchases. Checks only run while the application is running. Use `market_alert` from the Markets skill for instrument-specific chart alerts.
