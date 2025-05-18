use anchor_lang::prelude::*;

declare_id!("Fbh7hB3QeqmcPuWCPWRPXRzJTfbvx9aQaVQdcjH69jRQ");

#[program]
pub mod anchor {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
