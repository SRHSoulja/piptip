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
      .setDescription("Tip another user or create a group tip")
      .addStringOption(o => 
        o.setName("token")
          .setDescription("Select token to tip")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addNumberOption(o => o.setName("amount").setDescription("Amount to tip").setRequired(true))
      .addStringOption(o => 
        o.setName("type")
          .setDescription("Type of tip")
          .setRequired(false)
          .addChoices(
            { name: "Direct Tip", value: "direct" },
            { name: "Group Tip", value: "group" }
          )
      )
      .addUserOption(o => o.setName("user").setDescription("Who to tip (direct tips only)").setRequired(false))
      .addIntegerOption(o => 
        o.setName("duration")
          .setDescription("Duration in minutes (group tips only, 1-60)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(60)
      )
      .addStringOption(o => o.setName("note").setDescription("Optional note")),
  ];
  return defs.map(d => d.toJSON());
}