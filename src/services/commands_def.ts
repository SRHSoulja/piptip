// src/services/commands_def.ts
import { SlashCommandBuilder } from "discord.js";

export function getCommandsJson() {
  const defs = [
    new SlashCommandBuilder().setName("pip_register").setDescription("Create your PiPTip profile"),
    new SlashCommandBuilder().setName("pip_profile").setDescription("Show your profile and balance"),
    
    new SlashCommandBuilder()
      .setName("pip_withdraw")
      .setDescription("Withdraw tokens to your linked wallet")
      .addStringOption(o => 
        o.setName("token")
          .setDescription("Select token to withdraw")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addNumberOption(o => o.setName("amount").setDescription("Amount to withdraw").setRequired(true))
      .addStringOption(o => o.setName("address").setDescription("Override destination (0x...)")),
    
    new SlashCommandBuilder()
      .setName("pip_deposit")
      .setDescription("Get deposit instructions")
      .addStringOption(o => 
        o.setName("token")
          .setDescription("Select token to deposit")
          .setRequired(true)
          .setAutocomplete(true)
      ),
    
    new SlashCommandBuilder()
      .setName("pip_start")
      .setDescription("Start a Penguin Ice Pebble match")
      .addStringOption(o => 
        o.setName("token")
          .setDescription("Select token to wager")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addNumberOption(o => o.setName("amount").setDescription("Wager amount").setRequired(true)),
    
    new SlashCommandBuilder()
      .setName("pip_link")
      .setDescription("Link your wallet for deposits")
      .addStringOption(o => o.setName("address").setDescription("Your wallet address (0x...)").setRequired(true)),
    
    new SlashCommandBuilder()
      .setName("pip_tip")
      .setDescription("💸 Tip tokens - specify user for direct tip, leave empty for group tip!")
      .addNumberOption(o => o.setName("amount").setDescription("Amount to tip").setRequired(true))
      .addUserOption(o => o.setName("user").setDescription("Who to tip (leave empty for group tip that everyone can claim)").setRequired(false))
      .addStringOption(o => o.setName("note").setDescription("Optional note").setRequired(false)),
    
    new SlashCommandBuilder()
      .setName("pip_help")
      .setDescription("📚 Learn how to use PIPTip bot - commands, tips, and getting started!"),
  ];
  return defs.map(d => d.toJSON());
}