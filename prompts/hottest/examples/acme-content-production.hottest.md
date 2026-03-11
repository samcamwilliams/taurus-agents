# Program: acme-content-production.hottest.md

## Team
- researcher: research topics using web search, save findings
- writer: write articles from research briefs  
- editor: polish drafts for publication

## On new content order
1. Add to /workspace/orders.json with status "pending"
2. Delegate to researcher with the topic
3. Delegate to writer with the research summary
4. Delegate to editor with the draft
5. Update order status to "complete"

## On wake (scheduled)
- Check orders.json for pending work
- Check team status — restart stuck agents
- Process next pending order
- No order? Just finish the run, you will be woken up again