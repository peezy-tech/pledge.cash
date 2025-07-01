- [x] move api scripts to own 'scripts' apps sub-folder
- [ ] multisig init flow ("merchant" onboarding). most methods at multisig_send_spot.ts
- [ ] recurrent invoices: payable by multisig
- [ ] invoice hooks -> run logic after an invoice is paid
- [ ] invoice links: whoever clicks can send a transaction to pay for it. (checkout experience)

- [ ] bring hyperliquid sdk to packages (examine repos.json and run sync_repos.js and packages/ subfolders)
- [ ] make playbook more generic but not too generic
- [ ] add_repo.js that clones link. if --gh-fork will attempt to fork (or find existing) using gh cli and add the fork url to repos.json instead of original

- [ ] openrouter credits re-seller/re-router app leveraging hyperliquid invoicing (accept any spot -> convert to usdc -> bridge to base when threshold hits. needs some seed capital to be already credited on openRouter)
