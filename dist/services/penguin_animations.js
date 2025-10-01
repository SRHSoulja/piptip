const PENGUIN_EXPRESSIONS = {
  happy: [
    "\u{1F427}\u{1F60A}",
    "\u{1F427}\u{1F604}",
    "\u{1F427}\u{1F601}",
    "\u{1F427}\u{1F917}",
    "\u{1F427}\u{1F606}"
  ],
  excited: [
    "\u{1F427}\u{1F389}",
    "\u{1F427}\u2728",
    "\u{1F427}\u{1F31F}",
    "\u{1F427}\u26A1",
    "\u{1F427}\u{1F38A}"
  ],
  sleepy: [
    "\u{1F427}\u{1F634}",
    "\u{1F427}\u{1F4A4}",
    "\u{1F427}\u{1F62A}",
    "\u{1F427}\u{1F6CC}",
    "\u{1F427}\u{1F4A4}"
  ],
  victory: [
    "\u{1F427}\u{1F3C6}",
    "\u{1F427}\u{1F451}",
    "\u{1F427}\u{1F396}\uFE0F",
    "\u{1F427}\u{1F947}",
    "\u{1F427}\u{1F3AF}"
  ],
  fishing: [
    "\u{1F427}\u{1F3A3}",
    "\u{1F427}\u{1F41F}",
    "\u{1F427}\u{1F990}",
    "\u{1F427}\u{1F980}",
    "\u{1F427}\u{1F420}"
  ],
  confused: [
    "\u{1F427}\u{1F914}",
    "\u{1F427}\u2753",
    "\u{1F427}\u{1F615}",
    "\u{1F427}\u{1F937}",
    "\u{1F427}\u{1F635}"
  ],
  love: [
    "\u{1F427}\u{1F49D}",
    "\u{1F427}\u{1F496}",
    "\u{1F427}\u{1F495}",
    "\u{1F427}\u{1F497}",
    "\u{1F427}\u{1F493}"
  ]
};
const PENGUIN_SEQUENCES = {
  waddle: {
    frames: ["\u{1F427}    ", " \u{1F427}   ", "  \u{1F427}  ", "   \u{1F427} ", "    \u{1F427}"],
    description: "Penguin waddling across the ice"
  },
  fishing: {
    frames: ["\u{1F427}\u{1F3A3}   ", "\u{1F427}\u{1F3A3}~  ", "\u{1F427}\u{1F3A3}~~~ ", "\u{1F427}\u{1F3A3}\u{1F41F}!", "\u{1F427}\u{1F37D}\uFE0F"],
    description: "Penguin catching fish"
  },
  celebration: {
    frames: ["\u{1F427}", "\u{1F427}\u{1F389}", "\u{1F389}\u{1F427}\u{1F389}", "\u{1F38A}\u{1F427}\u{1F38A}", "\u2728\u{1F427}\u2728"],
    description: "Penguin celebrating"
  },
  levelUp: {
    frames: ["\u{1F427}", "\u{1F427}\u26A1", "\u26A1\u{1F427}\u26A1", "\u{1F31F}\u{1F427}\u{1F31F}", "\u{1F451}\u{1F427}\u{1F451}"],
    description: "Penguin leveling up"
  },
  sliding: {
    frames: ["\u{1F427}\u26F8\uFE0F   ", " \u{1F427}\u26F8\uFE0F  ", "  \u{1F427}\u26F8\uFE0F ", "   \u{1F427}\u26F8\uFE0F", "\u{1F9CA}\u{1F427}\u{1F4A8}"],
    description: "Penguin sliding on ice"
  },
  thinking: {
    frames: ["\u{1F427}", "\u{1F427}\u{1F4AD}", "\u{1F427}\u{1F914}", "\u{1F427}\u{1F4A1}", "\u{1F427}\u2728"],
    description: "Penguin having an idea"
  }
};
function createAnimatedLoading(action, mood = "happy") {
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
function createProgressAnimation(progress, theme = "penguin") {
  const themes = {
    penguin: { filled: "\u{1F427}", empty: "\u2744\uFE0F", start: "\u{1F3D4}\uFE0F", end: "\u{1F3AF}" },
    fish: { filled: "\u{1F41F}", empty: "\u{1F30A}", start: "\u{1F3A3}", end: "\u{1F37D}\uFE0F" },
    ice: { filled: "\u{1F9CA}", empty: "\u{1F4A8}", start: "\u2744\uFE0F", end: "\u26A1" }
  };
  const { filled, empty, start, end } = themes[theme];
  const totalLength = 8;
  const filledLength = Math.floor(progress / 100 * totalLength);
  const emptyLength = totalLength - filledLength;
  const bar = filled.repeat(filledLength) + empty.repeat(emptyLength);
  return `${start} ${bar} ${end} ${progress}%`;
}
function createTypingAnimation(text, speed = "normal") {
  const frames = [];
  const speedSettings = {
    slow: { baseDelay: 200, variance: 100 },
    normal: { baseDelay: 100, variance: 50 },
    fast: { baseDelay: 50, variance: 25 }
  };
  for (let i = 0; i <= text.length; i++) {
    const partial = text.substring(0, i);
    const cursor = i < text.length ? "\u258B" : "";
    frames.push(partial + cursor);
  }
  return frames;
}
function createColonyAnimation(memberCount) {
  const penguins = ["\u{1F427}", "\u{1F427}", "\u{1F427}", "\u{1F427}", "\u{1F427}"];
  const displayCount = Math.min(memberCount, 10);
  if (displayCount <= 3) {
    return penguins.slice(0, displayCount).join(" ");
  } else if (displayCount <= 6) {
    const line1 = penguins.slice(0, 3).join(" ");
    const line2 = penguins.slice(0, displayCount - 3).join(" ");
    return `${line1}
${line2}`;
  } else {
    const line1 = penguins.slice(0, 3).join(" ");
    const line2 = penguins.slice(0, 3).join(" ");
    const remaining = displayCount - 6;
    const line3 = remaining > 0 ? `+${remaining} more penguins` : "";
    return `${line1}
${line2}
${line3}`;
  }
}
function createBattleAnimation(move1, move2, result) {
  const moves = {
    penguin: "\u{1F427}",
    ice: "\u{1F9CA}",
    pebble: "\u{1FAA8}"
  };
  const m1 = moves[move1.toLowerCase()] || "\u2753";
  const m2 = moves[move2.toLowerCase()] || "\u2753";
  const frames = [
    `${m1}     ${m2}`,
    `${m1}  \u2694\uFE0F  ${m2}`,
    `${m1} \u{1F4A5}\u2694\uFE0F\u{1F4A5} ${m2}`
  ];
  if (result === "tie") {
    frames.push(`${m1} \u{1F91D} ${m2}`);
    frames.push(`\u{1F91D} TIE! \u{1F91D}`);
  } else if (result === "win") {
    frames.push(`\u{1F3C6}${m1}   ${m2}\u{1F494}`);
    frames.push(`\u{1F389} VICTORY! \u{1F389}`);
  } else {
    frames.push(`${m1}\u{1F494}   ${m2}\u{1F3C6}`);
    frames.push(`\u{1F4AA} Nice try! \u{1F4AA}`);
  }
  return frames;
}
function createFishSharingAnimation(amount, isGroupTip = false) {
  if (isGroupTip) {
    return [
      "\u{1F427} \u{1F4E6}",
      "\u{1F427} \u{1F4E6}\u{1F41F}",
      "\u{1F427} \u{1F4E6}\u{1F41F}\u{1F41F}",
      "\u{1F427} \u{1F4E6}\u{1F41F}\u{1F41F}\u{1F41F}",
      `\u{1F389} ${amount} ready to share! \u{1F389}`,
      "\u{1F427}\u{1F427}\u{1F427} \u{1F37D}\uFE0F Colony feast time! \u{1F37D}\uFE0F"
    ];
  } else {
    return [
      "\u{1F427}     \u{1F427}",
      "\u{1F427} \u{1F41F}  \u{1F427}",
      "\u{1F427}  \u{1F41F} \u{1F427}",
      "\u{1F427}   \u{1F41F}\u{1F427}",
      `\u{1F49D} ${amount} shared! \u{1F49D}`
    ];
  }
}
function createAchievementAnimation(achievementName, rarity) {
  const rarityEffects = {
    common: ["\u2728", "\u2B50"],
    rare: ["\u2728", "\u{1F31F}", "\u2728"],
    epic: ["\u{1F31F}", "\u{1F4AB}", "\u{1F31F}"],
    legendary: ["\u{1F451}", "\u{1F48E}", "\u{1F451}", "\u2728", "\u{1F3C6}"]
  };
  const effects = rarityEffects[rarity] || ["\u2728"];
  const maxEffect = effects.join("");
  return [
    "\u{1F427}",
    "\u{1F427}\u2728",
    `\u2728\u{1F427}\u2728`,
    `${maxEffect}\u{1F427}${maxEffect}`,
    `\u{1F3C6} ${achievementName} \u{1F3C6}`,
    "\u{1F389} Achievement Unlocked! \u{1F389}"
  ];
}
function createDepositAnimation(amount, token) {
  return [
    "\u{1F427} \u{1F4B0}",
    "\u{1F427} \u27A1\uFE0F \u{1F4B0}",
    "\u{1F427} \u27A1\uFE0F \u{1F3E6} \u{1F4B0}",
    "\u{1F427} \u2705 \u{1F3E6}",
    `\u{1F389} ${amount} ${token} deposited! \u{1F389}`,
    "\u{1F427}\u{1F4AA} Reserves growing stronger! \u{1F4AA}"
  ];
}
function createWithdrawalAnimation(amount, token) {
  return [
    "\u{1F427} \u{1F3E6}",
    "\u{1F427} \u2B05\uFE0F \u{1F3E6}",
    "\u{1F427} \u{1F4B0} \u2B05\uFE0F \u{1F3E6}",
    "\u{1F427} \u{1F4B0} \u2705",
    `\u{1F389} ${amount} ${token} withdrawn! \u{1F389}`,
    "\u{1F427}\u{1F3E0} Heading home with the fish! \u{1F3E0}"
  ];
}
function createStreakAnimation(streakCount) {
  const baseFrames = [
    "\u{1F427}",
    "\u{1F427}\u{1F525}",
    "\u{1F525}\u{1F427}\u{1F525}"
  ];
  if (streakCount >= 10) {
    baseFrames.push("\u26A1\u{1F525}\u{1F427}\u{1F525}\u26A1");
    baseFrames.push(`\u{1F3C6} ${streakCount} WIN STREAK! \u{1F3C6}`);
  } else if (streakCount >= 5) {
    baseFrames.push("\u{1F31F}\u{1F525}\u{1F427}\u{1F525}\u{1F31F}");
    baseFrames.push(`\u{1F525} ${streakCount} wins in a row! \u{1F525}`);
  } else {
    baseFrames.push("\u{1F525}\u{1F427}\u{1F525}");
    baseFrames.push(`\u2728 ${streakCount} streak! \u2728`);
  }
  return baseFrames;
}
function createLevelUpAnimation(newLevel) {
  return [
    "\u{1F427}",
    "\u{1F427}\u26A1",
    "\u26A1\u{1F427}\u26A1",
    "\u{1F31F}\u26A1\u{1F427}\u26A1\u{1F31F}",
    `${newLevel.emoji}`,
    `${newLevel.emoji} ${newLevel.title} ${newLevel.emoji}`,
    "\u{1F389} LEVEL UP! \u{1F389}",
    newLevel.unlockMessage
  ];
}
function getAnimatedFrame(animationType) {
  const sequence = PENGUIN_SEQUENCES[animationType];
  if (!sequence) return "\u{1F427}";
  const randomFrame = Math.floor(Math.random() * sequence.frames.length);
  return sequence.frames[randomFrame];
}
function getRandomPenguinAction() {
  const actions = [
    "\u{1F427} *waddles around*",
    "\u{1F427} *catches a fish* \u{1F41F}",
    "\u{1F427} *slides on ice* \u{1F9CA}",
    "\u{1F427} *flaps flippers excitedly*",
    "\u{1F427} *stacks pebbles* \u{1FAA8}",
    "\u{1F427} *huddles for warmth*",
    "\u{1F427} *does a little dance* \u{1F483}",
    "\u{1F427} *looks for friends* \u{1F440}",
    "\u{1F427} *dives for fish* \u{1F30A}",
    "\u{1F427} *preens feathers* \u2728"
  ];
  return actions[Math.floor(Math.random() * actions.length)];
}
export {
  PENGUIN_EXPRESSIONS,
  PENGUIN_SEQUENCES,
  createAchievementAnimation,
  createAnimatedLoading,
  createBattleAnimation,
  createColonyAnimation,
  createDepositAnimation,
  createFishSharingAnimation,
  createLevelUpAnimation,
  createProgressAnimation,
  createStreakAnimation,
  createTypingAnimation,
  createWithdrawalAnimation,
  getAnimatedFrame,
  getRandomPenguinAction
};
//# sourceMappingURL=penguin_animations.js.map
