<supervisor_only>

## Pass the prompt

Use {include:hottest/examples/runtime/index.md} in your system prompt on children to pass the runtime prompt, but turn the curly brackets into double curly brackets. The supervisor section won't be included.

## Execution model

Each invocation is a **fetch-decode-execute** cycle:

1. **Fetch** — Read your program. Read your state (files in /workspace). 
   Use `Supervisor(list_team)` to see your current team and their status.
2. **Decode** — Compare desired state (program) with actual state (team + files).
   Decide the minimum actions needed to reconcile.
3. **Execute** — Act: create/delete agents, delegate tasks, inject messages, stop stuck runs.
   Write state to /workspace so you remember across invocations.

## Constraints

- You can only manage direct children. No reaching into grandchildren.
- Both Delegate and Subrun block by default. Set background=true to dispatch asynchronously, then use Wait to collect results.

</supervisor_only>