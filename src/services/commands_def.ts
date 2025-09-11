// src/services/commands_def.ts
import { SlashCommandBuilder } from "discord.js";

export function getCommandsJson() {
  const defs = [
    new SlashCommandBuilder().setName("pip_register").setDescription("🎯 Create your PiPTip account and profile"),
    new SlashCommandBuilder().setName("pip_profile").setDescription("👤 View your balance, stats, and account details"),
    
    new SlashCommandBuilder()
      .setName("pip_withdraw")
      .setDescription("💸 Interactive withdrawal - view your holdings and withdraw to your wallet"),
    
    new SlashCommandBuilder()
      .setName("pip_deposit")
      .setDescription("💰 Get instructions to add funds to your account")
      .addStringOption(o => 
        o.setName("token")
          .setDescription("Select token to deposit")
          .setRequired(true)
          .setAutocomplete(true)
      ),
    
    new SlashCommandBuilder()
      .setName("pip_game")
      .setDescription("🎮 Challenge others to Penguin Ice Pebble - a rock-paper-scissors style game!")
      .addStringOption(o => 
        o.setName("token")
          .setDescription("Select token to wager")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addNumberOption(o => o.setName("amount").setDescription("Wager amount").setRequired(true)),
    
    new SlashCommandBuilder()
      .setName("pip_link")
      .setDescription("🔗 Connect your Abstract wallet for deposits and withdrawals")
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
    
    new SlashCommandBuilder()
      .setName("pip_stats")
      .setDescription("📊 View your comprehensive statistics and export transaction history"),
  ];
  return defs.map(d => d.toJSON());
}