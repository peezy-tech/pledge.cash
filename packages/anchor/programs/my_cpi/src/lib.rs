use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke, system_instruction};
use anchor_lang::system_program::{transfer, Transfer};

declare_program!(dynamic_bonding_curve);
use crate::dynamic_bonding_curve::*;

declare_id!("EhPfX28bxUEHw1CCyJcUZ8pr9SeyhtStz2N9NYWmv1th"); 

#[program]
pub mod my_cpi_instructions {

    use super::*;

    pub fn sol_transfer_one(ctx: Context<SolTransfer>, amount: u64) -> Result<()> {
        let from_pubkey = ctx.accounts.sender.to_account_info();
        let to_pubkey = ctx.accounts.recipient.to_account_info();
        let program_id = ctx.accounts.system_program.to_account_info();

        let cpi_context = CpiContext::new(
            program_id,
            Transfer {
                from: from_pubkey,
                to: to_pubkey,
            },
        );

        transfer(cpi_context, amount)?;
        Ok(())
    }

    pub fn sol_transfer_two(ctx: Context<SolTransfer>, amount: u64) -> Result<()> {
        let from_pubkey = ctx.accounts.sender.to_account_info();
        let to_pubkey = ctx.accounts.recipient.to_account_info();
        let program_id = ctx.accounts.system_program.to_account_info();

        let instruction =
            &system_instruction::transfer(&from_pubkey.key(), &to_pubkey.key(), amount);

        invoke(instruction, &[from_pubkey, to_pubkey, program_id])?;
        Ok(())
    }

    pub fn sol_transfer_three(ctx: Context<SolTransfer>, amount: u64) -> Result<()> {
        let from_pubkey = ctx.accounts.sender.to_account_info();
        let to_pubkey = ctx.accounts.recipient.to_account_info();
        let program_id = ctx.accounts.system_program.to_account_info();

        // Prepare instruction AccountMetas
        let account_metas = vec![
            AccountMeta::new(from_pubkey.key(), true),
            AccountMeta::new(to_pubkey.key(), false),
        ];

        // SOL transfer instruction discriminator
        let instruction_discriminator: u32 = 2;

        // Prepare instruction data
        let mut instruction_data = Vec::with_capacity(4 + 8);
        instruction_data.extend_from_slice(&instruction_discriminator.to_le_bytes());
        instruction_data.extend_from_slice(&amount.to_le_bytes());

        // Create instruction
        let instruction = Instruction {
            program_id: program_id.key(),
            accounts: account_metas,
            data: instruction_data,
        };

        // Invoke instruction
        invoke(&instruction, &[from_pubkey, to_pubkey, program_id])?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct SolTransfer<'info> {
    #[account(mut)]
    sender: Signer<'info>,
    #[account(mut)]
    recipient: SystemAccount<'info>,
    system_program: Program<'info, System>,
}
