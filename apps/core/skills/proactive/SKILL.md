---
name: proactive
description: Track local goals, step plans, progress and approvals.
metadata:
  seris:
    priority: 26
    tool_names: [proactive_create, proactive_plan, proactive_status, proactive_pause, proactive_resume, proactive_close, proactive_update, proactive_approvals]
---
# Goals

Create a goal only when the user requests ongoing work. Give its mandate concrete limits, then use `proactive_plan` to record steps. Inspect state using `proactive_status`; pause, resume and close affect that goal only. `proactive_approvals` lists pending decisions; approval must come from the user interface. A planned trade, transfer or message is not completed until its executor returns a successful result.
