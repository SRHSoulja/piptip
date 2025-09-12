// src/discord/customId.ts - Centralized customId parsing with discriminated unions

// Discriminated union for all possible custom ID types
export type CustomIdPayload = 
  // Pip-related interactions
  | { kind: 'PIP_PICK', matchId: number, move: string }
  | { kind: 'PIP_JOIN', matchId: number, move: string }
  | { kind: 'PIP_CANCEL', matchId: number }
  | { kind: 'PIP_PROFILE_REFRESH' }
  | { kind: 'PIP_PROFILE_DISMISS' }
  | { kind: 'PIP_SHOW_HELP' }
  | { kind: 'PIP_PROMPT_LINK_WALLET' }
  | { kind: 'PIP_SHOW_DEPOSIT_INSTRUCTIONS' }
  | { kind: 'PIP_PURCHASE_MEMBERSHIP' }
  | { kind: 'PIP_EXPORT_CSV' }
  | { kind: 'PIP_LINK_WALLET_MODAL' }
  | { kind: 'PIP_LINK_WALLET_SUBMIT', walletAddress: string }
  
  // Group tip interactions
  | { kind: 'GROUP_TIP_CLAIM', groupTipId: number }
  
  // Unknown/unparseable
  | { kind: 'UNKNOWN', rawId: string };

/**
 * Parse a Discord customId string into a discriminated union
 * This centralizes all customId parsing logic and provides type safety
 */
export function parseCustomId(customId: string): CustomIdPayload {
  try {
    // Group tip interactions
    if (customId.startsWith('grouptip:claim:')) {
      const groupTipId = parseInt(customId.split(':')[2]);
      if (isNaN(groupTipId)) {
        return { kind: 'UNKNOWN', rawId: customId };
      }
      return { kind: 'GROUP_TIP_CLAIM', groupTipId };
    }

    // Pip interactions
    if (customId.startsWith('pip:')) {
      const parts = customId.split(':');
      
      switch (parts[1]) {
        case 'pick':
          if (parts.length >= 4) {
            const matchId = parseInt(parts[2]);
            const move = parts[3];
            if (!isNaN(matchId) && move) {
              return { kind: 'PIP_PICK', matchId, move };
            }
          }
          break;
          
        case 'join':
          if (parts.length >= 4) {
            const matchId = parseInt(parts[2]);
            const move = parts[3];
            if (!isNaN(matchId) && move) {
              return { kind: 'PIP_JOIN', matchId, move };
            }
          }
          break;
          
        case 'cancel':
          if (parts.length >= 3) {
            const matchId = parseInt(parts[2]);
            if (!isNaN(matchId)) {
              return { kind: 'PIP_CANCEL', matchId };
            }
          }
          break;
          
        case 'refresh_profile':
          return { kind: 'PIP_PROFILE_REFRESH' };
          
        case 'dismiss_profile':
          return { kind: 'PIP_PROFILE_DISMISS' };
          
        case 'show_help':
          return { kind: 'PIP_SHOW_HELP' };
          
        case 'prompt_link_wallet':
          return { kind: 'PIP_PROMPT_LINK_WALLET' };
          
        case 'show_deposit_instructions':
          return { kind: 'PIP_SHOW_DEPOSIT_INSTRUCTIONS' };
          
        case 'purchase_membership':
          return { kind: 'PIP_PURCHASE_MEMBERSHIP' };
          
        case 'export_csv':
          return { kind: 'PIP_EXPORT_CSV' };

        case 'link_wallet_modal':
          return { kind: 'PIP_LINK_WALLET_MODAL' };

        case 'link_wallet_submit':
          // This is for modal submissions where wallet address is in the modal fields
          return { kind: 'PIP_LINK_WALLET_SUBMIT', walletAddress: '' }; // Address comes from modal fields
      }
    }

    // Fallback for unknown patterns
    return { kind: 'UNKNOWN', rawId: customId };
  } catch (error) {
    console.error('Error parsing customId:', customId, error);
    return { kind: 'UNKNOWN', rawId: customId };
  }
}

/**
 * Type guard to ensure exhaustive handling of CustomIdPayload
 */
export function assertNever(payload: never): never {
  throw new Error(`Unhandled payload: ${JSON.stringify(payload)}`);
}