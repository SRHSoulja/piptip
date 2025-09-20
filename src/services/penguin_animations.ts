// src/services/penguin_animations.ts - Advanced text animations and visual effects

// Animated penguin expressions for different moods
export const PENGUIN_EXPRESSIONS = {
  happy: [
    "🐧😊", "🐧😄", "🐧😁", "🐧🤗", "🐧😆"
  ],
  excited: [
    "🐧🎉", "🐧✨", "🐧🌟", "🐧⚡", "🐧🎊"
  ],
  sleepy: [
    "🐧😴", "🐧💤", "🐧😪", "🐧🛌", "🐧💤"
  ],
  victory: [
    "🐧🏆", "🐧👑", "🐧🎖️", "🐧🥇", "🐧🎯"
  ],
  fishing: [
    "🐧🎣", "🐧🐟", "🐧🦐", "🐧🦀", "🐧🐠"
  ],
  confused: [
    "🐧🤔", "🐧❓", "🐧😕", "🐧🤷", "🐧😵"
  ],
  love: [
    "🐧💝", "🐧💖", "🐧💕", "🐧💗", "🐧💓"
  ]
};

// Animated sequences for different actions
export const PENGUIN_SEQUENCES = {
  waddle: {
    frames: ["🐧    ", " 🐧   ", "  🐧  ", "   🐧 ", "    🐧"],
    description: "Penguin waddling across the ice"
  },
  fishing: {
    frames: ["🐧🎣   ", "🐧🎣~  ", "🐧🎣~~~ ", "🐧🎣🐟!", "🐧🍽️"],
    description: "Penguin catching fish"
  },
  celebration: {
    frames: ["🐧", "🐧🎉", "🎉🐧🎉", "🎊🐧🎊", "✨🐧✨"],
    description: "Penguin celebrating"
  },
  levelUp: {
    frames: ["🐧", "🐧⚡", "⚡🐧⚡", "🌟🐧🌟", "👑🐧👑"],
    description: "Penguin leveling up"
  },
  sliding: {
    frames: ["🐧⛸️   ", " 🐧⛸️  ", "  🐧⛸️ ", "   🐧⛸️", "🧊🐧💨"],
    description: "Penguin sliding on ice"
  },
  thinking: {
    frames: ["🐧", "🐧💭", "🐧🤔", "🐧💡", "🐧✨"],
    description: "Penguin having an idea"
  }
};

// Create animated loading message
export function createAnimatedLoading(action: string, mood: keyof typeof PENGUIN_EXPRESSIONS = 'happy'): string {
  const expressions = PENGUIN_EXPRESSIONS[mood];
  const randomExpression = expressions[Math.floor(Math.random() * expressions.length)];

  const loadingDots = [
    "   ",
    ".  ",
    ".. ",
    "...",
    ".. ",
    ".  "
  ];

  const randomDots = loadingDots[Math.floor(Math.random() * loadingDots.length)];

  return `${randomExpression} ${action}${randomDots}`;
}

// Create progress animation
export function createProgressAnimation(progress: number, theme: 'penguin' | 'fish' | 'ice' = 'penguin'): string {
  const themes = {
    penguin: { filled: "🐧", empty: "❄️", start: "🏔️", end: "🎯" },
    fish: { filled: "🐟", empty: "🌊", start: "🎣", end: "🍽️" },
    ice: { filled: "🧊", empty: "💨", start: "❄️", end: "⚡" }
  };

  const { filled, empty, start, end } = themes[theme];
  const totalLength = 8;
  const filledLength = Math.floor((progress / 100) * totalLength);
  const emptyLength = totalLength - filledLength;

  const bar = filled.repeat(filledLength) + empty.repeat(emptyLength);
  return `${start} ${bar} ${end} ${progress}%`;
}

// Create typing animation effect
export function createTypingAnimation(text: string, speed: 'slow' | 'normal' | 'fast' = 'normal'): string[] {
  const frames: string[] = [];
  const speedSettings = {
    slow: { baseDelay: 200, variance: 100 },
    normal: { baseDelay: 100, variance: 50 },
    fast: { baseDelay: 50, variance: 25 }
  };

  for (let i = 0; i <= text.length; i++) {
    const partial = text.substring(0, i);
    const cursor = i < text.length ? "▋" : "";
    frames.push(partial + cursor);
  }

  return frames;
}

// Create penguin colony gathering animation
export function createColonyAnimation(memberCount: number): string {
  const penguins = ["🐧", "🐧", "🐧", "🐧", "🐧"];
  const displayCount = Math.min(memberCount, 10);

  if (displayCount <= 3) {
    return penguins.slice(0, displayCount).join(" ");
  } else if (displayCount <= 6) {
    const line1 = penguins.slice(0, 3).join(" ");
    const line2 = penguins.slice(0, displayCount - 3).join(" ");
    return `${line1}\n${line2}`;
  } else {
    const line1 = penguins.slice(0, 3).join(" ");
    const line2 = penguins.slice(0, 3).join(" ");
    const remaining = displayCount - 6;
    const line3 = remaining > 0 ? `+${remaining} more penguins` : "";
    return `${line1}\n${line2}\n${line3}`;
  }
}

// Create battle animation sequence
export function createBattleAnimation(move1: string, move2: string, result: 'win' | 'loss' | 'tie'): string[] {
  const moves = {
    penguin: "🐧",
    ice: "🧊",
    pebble: "🪨"
  };

  const m1 = moves[move1.toLowerCase() as keyof typeof moves] || "❓";
  const m2 = moves[move2.toLowerCase() as keyof typeof moves] || "❓";

  const frames = [
    `${m1}     ${m2}`,
    `${m1}  ⚔️  ${m2}`,
    `${m1} 💥⚔️💥 ${m2}`,
  ];

  if (result === 'tie') {
    frames.push(`${m1} 🤝 ${m2}`);
    frames.push(`🤝 TIE! 🤝`);
  } else if (result === 'win') {
    frames.push(`🏆${m1}   ${m2}💔`);
    frames.push(`🎉 VICTORY! 🎉`);
  } else {
    frames.push(`${m1}💔   ${m2}🏆`);
    frames.push(`💪 Nice try! 💪`);
  }

  return frames;
}

// Create fish sharing animation
export function createFishSharingAnimation(amount: string, isGroupTip: boolean = false): string[] {
  if (isGroupTip) {
    return [
      "🐧 📦",
      "🐧 📦🐟",
      "🐧 📦🐟🐟",
      "🐧 📦🐟🐟🐟",
      `🎉 ${amount} ready to share! 🎉`,
      "🐧🐧🐧 🍽️ Colony feast time! 🍽️"
    ];
  } else {
    return [
      "🐧     🐧",
      "🐧 🐟  🐧",
      "🐧  🐟 🐧",
      "🐧   🐟🐧",
      `💝 ${amount} shared! 💝`
    ];
  }
}

// Create achievement unlock animation
export function createAchievementAnimation(achievementName: string, rarity: string): string[] {
  const rarityEffects = {
    common: ["✨", "⭐"],
    rare: ["✨", "🌟", "✨"],
    epic: ["🌟", "💫", "🌟"],
    legendary: ["👑", "💎", "👑", "✨", "🏆"]
  };

  const effects = rarityEffects[rarity as keyof typeof rarityEffects] || ["✨"];
  const maxEffect = effects.join("");

  return [
    "🐧",
    "🐧✨",
    `✨🐧✨`,
    `${maxEffect}🐧${maxEffect}`,
    `🏆 ${achievementName} 🏆`,
    "🎉 Achievement Unlocked! 🎉"
  ];
}

// Create deposit animation
export function createDepositAnimation(amount: string, token: string): string[] {
  return [
    "🐧 💰",
    "🐧 ➡️ 💰",
    "🐧 ➡️ 🏦 💰",
    "🐧 ✅ 🏦",
    `🎉 ${amount} ${token} deposited! 🎉`,
    "🐧💪 Reserves growing stronger! 💪"
  ];
}

// Create withdrawal animation
export function createWithdrawalAnimation(amount: string, token: string): string[] {
  return [
    "🐧 🏦",
    "🐧 ⬅️ 🏦",
    "🐧 💰 ⬅️ 🏦",
    "🐧 💰 ✅",
    `🎉 ${amount} ${token} withdrawn! 🎉`,
    "🐧🏠 Heading home with the fish! 🏠"
  ];
}

// Create streak animation
export function createStreakAnimation(streakCount: number): string[] {
  const baseFrames = [
    "🐧",
    "🐧🔥",
    "🔥🐧🔥",
  ];

  if (streakCount >= 10) {
    baseFrames.push("⚡🔥🐧🔥⚡");
    baseFrames.push(`🏆 ${streakCount} WIN STREAK! 🏆`);
  } else if (streakCount >= 5) {
    baseFrames.push("🌟🔥🐧🔥🌟");
    baseFrames.push(`🔥 ${streakCount} wins in a row! 🔥`);
  } else {
    baseFrames.push("🔥🐧🔥");
    baseFrames.push(`✨ ${streakCount} streak! ✨`);
  }

  return baseFrames;
}

// Create level up animation with specific level info
export function createLevelUpAnimation(newLevel: any): string[] {
  return [
    "🐧",
    "🐧⚡",
    "⚡🐧⚡",
    "🌟⚡🐧⚡🌟",
    `${newLevel.emoji}`,
    `${newLevel.emoji} ${newLevel.title} ${newLevel.emoji}`,
    "🎉 LEVEL UP! 🎉",
    newLevel.unlockMessage
  ];
}

// Simulate animated message by returning random frame
export function getAnimatedFrame(animationType: keyof typeof PENGUIN_SEQUENCES): string {
  const sequence = PENGUIN_SEQUENCES[animationType];
  if (!sequence) return "🐧";

  const randomFrame = Math.floor(Math.random() * sequence.frames.length);
  return sequence.frames[randomFrame];
}

// Create random penguin action animation
export function getRandomPenguinAction(): string {
  const actions = [
    "🐧 *waddles around*",
    "🐧 *catches a fish* 🐟",
    "🐧 *slides on ice* 🧊",
    "🐧 *flaps flippers excitedly*",
    "🐧 *stacks pebbles* 🪨",
    "🐧 *huddles for warmth*",
    "🐧 *does a little dance* 💃",
    "🐧 *looks for friends* 👀",
    "🐧 *dives for fish* 🌊",
    "🐧 *preens feathers* ✨"
  ];

  return actions[Math.floor(Math.random() * actions.length)];
}