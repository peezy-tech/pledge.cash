- [x] move api scripts to own 'scripts' apps sub-folder
- [ ] test agent spotSend (with a approveAgent frontend button and a script?)
- [ ] unlocks: recurrent payments. every X seconds check which recurrent_invoices trigger and call them (i guess each of recurrent store a `trigger_after` column with a timestamp? and we compare against the latest block timestamp from hyperliquid sdk `blockDetails`)

- [ ] bring hyperliquid sdk to packages (examine repos.json and run sync_repos.js and packages/ subfolders)
- [ ] make playbook more generic but not too generic
- [ ] add_repo.js that clones link. if --gh-fork will attempt to fork (or find existing) using gh cli and add the fork url to repos.json instead of original

- [ ] openrouter credits re-seller/re-router app leveraging hyperliquid invoicing (accept any spot -> convert to usdc -> bridge to base when threshold hits. needs some seed capital to be already credited on openRouter)
