const PENGUIN_EMOJIS = {
  // Animated penguin emojis (assuming they exist in the server)
  boxing: "<a:BoxingPengu:1234567890>",
  nerd: "<a:NerdPengu:1234567890>",
  sleepy: "<a:SleepyPengu:1234567890>",
  confused: "<a:ConfusedPengu:1234567890>",
  sad: "<a:SadPengu:1234567890>",
  grumpy: "<a:GrumpyPengu:1234567890>",
  excited: "<a:ExcitedPengu:1234567890>",
  // Standard emojis as fallbacks
  basic: "\u{1F427}",
  error: "\u274C",
  warning: "\u26A0\uFE0F",
  success: "\u2705",
  loading: "\u23F3",
  thinking: "\u{1F914}",
  money: "\u{1F4B0}",
  rocket: "\u{1F680}",
  snowflake: "\u2744\uFE0F",
  ice: "\u{1F9CA}",
  fish: "\u{1F41F}"
};
const PENGUIN_COLORS = {
  error: 16739179,
  // Red
  warning: 16767293,
  // Yellow
  success: 7065471,
  // Green
  info: 7651580,
  // Blue
  loading: 10980346,
  // Purple
  tip: 3725737,
  // Teal
  ice: 6809849
  // Ice blue
};
const PENGUIN_PERSONALITIES = {
  friendly: {
    greetings: ["Hey there!", "Howdy!", "Hello friend!", "Hiya!"],
    closings: ["Happy tipping!", "Stay cool!", "Catch you later!", "Keep it icy!"],
    encouragement: ["You got this!", "Almost there!", "Looking good!", "Nice work!"]
  },
  sad: {
    greetings: ["Oh no...", "Uh oh...", "Oopsie...", "Whoops..."],
    closings: ["Sorry about that!", "Better luck next time!", "We'll get it next time!"],
    encouragement: ["Don't worry!", "It happens to the best of us!", "No big deal!"]
  },
  confused: {
    greetings: ["Hmm...", "Wait, what?", "Hold on...", "That's odd..."],
    closings: ["Hope that helps!", "Let me know if you're still confused!", "Try again when ready!"],
    encouragement: ["No worries!", "We'll figure this out!", "Let's try again!"]
  },
  sleepy: {
    greetings: ["*yawn*...", "Zzz... oh!", "Just woke up and...", "*stretches*..."],
    closings: ["Time for a nap!", "*yawn* excuse me!", "Feeling sleepy now..."],
    encouragement: ["Just need some coffee...", "Almost awake...", "Give me a sec..."]
  },
  grumpy: {
    greetings: ["Ugh...", "*grumble*...", "Seriously?", "Come on..."],
    closings: ["*sigh*", "There, happy now?", "Next time read the instructions!"],
    encouragement: ["Just follow the rules!", "It's not that hard!", "Pay attention!"]
  },
  excited: {
    greetings: ["WOO!", "Amazing!", "Fantastic!", "Awesome!"],
    closings: ["Keep it up!", "So exciting!", "Can't wait for more!", "This is great!"],
    encouragement: ["You're crushing it!", "On fire!", "Incredible!", "So good!"]
  }
};
function createPenguinError(title, description, options = {}) {
  const {
    emoji = PENGUIN_EMOJIS.sad,
    personality = "sad",
    includeHelp = true
  } = options;
  const personalityData = PENGUIN_PERSONALITIES[personality];
  const greeting = personalityData.greetings[Math.floor(Math.random() * personalityData.greetings.length)];
  const closing = personalityData.closings[Math.floor(Math.random() * personalityData.closings.length)];
  let message = `${emoji} **${title}**

${greeting} ${description}`;
  if (includeHelp) {
    message += `

*${closing}*`;
  }
  return message;
}
function createPenguinSuccess(title, description, options = {}) {
  const {
    emoji = PENGUIN_EMOJIS.excited,
    personality = "excited"
  } = options;
  const personalityData = PENGUIN_PERSONALITIES[personality];
  const greeting = personalityData.greetings[Math.floor(Math.random() * personalityData.greetings.length)];
  const encouragement = personalityData.encouragement[Math.floor(Math.random() * personalityData.encouragement.length)];
  return `${emoji} **${title}**

${greeting} ${description}

*${encouragement}*`;
}
function createPenguinLoading(action, options = {}) {
  const {
    emoji = PENGUIN_EMOJIS.loading,
    personality = "sleepy"
  } = options;
  const personalityData = PENGUIN_PERSONALITIES[personality];
  const greeting = personalityData.greetings[Math.floor(Math.random() * personalityData.greetings.length)];
  const loadingTexts = [
    `${greeting} ${action}...`,
    `${greeting} Working on ${action.toLowerCase()}...`,
    `${greeting} Please wait while I ${action.toLowerCase()}...`,
    `${greeting} Hang tight, ${action.toLowerCase()}...`
  ];
  return `${emoji} ${loadingTexts[Math.floor(Math.random() * loadingTexts.length)]}`;
}
const PENGUIN_ERRORS = {
  invalidAmount: () => createPenguinError(
    "Whoops! Invalid Amount",
    "That amount doesn't look right to me! Please use a positive number with up to 2 decimal places (like 10.50).",
    { personality: "confused", emoji: `${PENGUIN_EMOJIS.confused} ${PENGUIN_EMOJIS.money}` }
  ),
  cannotTipBot: () => createPenguinError(
    "Bots Don't Need Tips!",
    "I appreciate the thought, but bots don't really need tips! Try tipping a real person instead - they'll love it! ${PENGUIN_EMOJIS.fish}",
    { personality: "friendly", emoji: `${PENGUIN_EMOJIS.nerd}` }
  ),
  cannotTipSelf: () => createPenguinError(
    "Can't Tip Yourself, Silly!",
    "Nice try, but you can't tip yourself! ${PENGUIN_EMOJIS.fish} If you want to share with everyone, try a group tip instead!",
    { personality: "grumpy", emoji: `${PENGUIN_EMOJIS.grumpy}` }
  ),
  noTokensAvailable: () => createPenguinError(
    "No Tokens Available",
    "Looks like there are no active tokens for tipping right now. The ice is a bit thin today! ${PENGUIN_EMOJIS.ice}",
    { personality: "sad", emoji: `${PENGUIN_EMOJIS.sad}` }
  ),
  walletNotLinked: () => createPenguinError(
    "Wallet Not Connected",
    "You need to link your wallet first! Use `/pip_link` to connect your Abstract wallet and start your penguin adventure! ${PENGUIN_EMOJIS.rocket}",
    { personality: "friendly", emoji: `${PENGUIN_EMOJIS.nerd}` }
  ),
  insufficientBalance: (token, balance) => createPenguinError(
    "Not Enough Tokens",
    `You don't have enough ${token} for this transaction! Your current balance is ${balance}. Time to get some more tokens! ${PENGUIN_EMOJIS.fish}`,
    { personality: "sad", emoji: `${PENGUIN_EMOJIS.sad} ${PENGUIN_EMOJIS.money}` }
  ),
  withdrawalFailed: (reason) => createPenguinError(
    "Withdrawal Didn't Work",
    `Something went wrong with your withdrawal: ${reason}. Don't worry, your tokens are safe! ${PENGUIN_EMOJIS.ice}`,
    { personality: "confused", emoji: `${PENGUIN_EMOJIS.confused}` }
  ),
  genericError: (operation) => createPenguinError(
    "Oops! Something Went Wrong",
    `I had trouble with that ${operation}. Even penguins slip on ice sometimes! Try again in a moment? ${PENGUIN_EMOJIS.ice}`,
    { personality: "sleepy", emoji: `${PENGUIN_EMOJIS.sleepy}` }
  ),
  membershipNotAvailable: () => createPenguinError(
    "Colony Full!",
    "This membership tier is no longer available! The ice caves might be full, try again later! ${PENGUIN_EMOJIS.ice}",
    { personality: "sad", emoji: `${PENGUIN_EMOJIS.sad}` }
  ),
  noPricingConfigured: () => createPenguinError(
    "Pricing Missing!",
    "No fish pricing configured for this colony tier! Please contact the Head Penguin (administrator)! ${PENGUIN_EMOJIS.fish}",
    { personality: "confused", emoji: `${PENGUIN_EMOJIS.confused}` }
  ),
  purchaseFailed: (reason) => createPenguinError(
    "Purchase Failed!",
    `Oh no! Your colony membership purchase failed: ${reason} Try waddling back and trying again! ${PENGUIN_EMOJIS.ice}`,
    { personality: "sad", emoji: `${PENGUIN_EMOJIS.sad}` }
  ),
  noMembershipTiers: () => createPenguinError(
    "No Colonies Available!",
    "No penguin colony memberships are currently available! The ice is probably too thick right now! ${PENGUIN_EMOJIS.ice}",
    { personality: "confused", emoji: `${PENGUIN_EMOJIS.confused}` }
  ),
  membershipLoadError: (reason) => createPenguinError(
    "Loading Error!",
    `Couldn't load colony membership options: ${reason} The fish delivery might be delayed! ${PENGUIN_EMOJIS.fish}`,
    { personality: "sleepy", emoji: `${PENGUIN_EMOJIS.sleepy}` }
  ),
  rateLimited: (secondsRemaining) => createPenguinError(
    "Slow Down There, Penguin!",
    `You're waddling too fast! Please wait ${secondsRemaining} more seconds before contributing again. Even penguins need to catch their breath! ${PENGUIN_EMOJIS.ice}`,
    { personality: "sleepy", emoji: `${PENGUIN_EMOJIS.sleepy}` }
  ),
  invalidContributionAmount: () => createPenguinError(
    "Invalid Fish Amount!",
    `That doesn't look like a valid amount of fish to contribute! Please enter a positive number. We penguins are picky about our fish counting! ${PENGUIN_EMOJIS.fish}`,
    { personality: "confused", emoji: `${PENGUIN_EMOJIS.confused}` }
  ),
  contributionFailed: (reason) => createPenguinError(
    "Contribution Went Sideways!",
    `Oh no! Your fish contribution didn't work: ${reason} Don't worry, your fish are safe in your pouch! ${PENGUIN_EMOJIS.sad}`,
    { personality: "sad", emoji: `${PENGUIN_EMOJIS.sad}` }
  )
};
const PENGUIN_LOADING = {
  tip: () => createPenguinLoading("sending your tip", { emoji: `${PENGUIN_EMOJIS.loading} ${PENGUIN_EMOJIS.fish}` }),
  withdraw: () => createPenguinLoading("processing your withdrawal", { emoji: `${PENGUIN_EMOJIS.loading} ${PENGUIN_EMOJIS.money}` }),
  link: () => createPenguinLoading("linking your wallet", { emoji: `${PENGUIN_EMOJIS.loading} ${PENGUIN_EMOJIS.rocket}` }),
  profile: () => createPenguinLoading("loading your profile", { emoji: `${PENGUIN_EMOJIS.loading} ${PENGUIN_EMOJIS.snowflake}` }),
  balance: () => createPenguinLoading("checking your balance", { emoji: `${PENGUIN_EMOJIS.loading} ${PENGUIN_EMOJIS.money}` })
};
const PENGUIN_SUCCESS = {
  tip: (amount, recipient) => createPenguinSuccess(
    "Tip Sent Successfully!",
    `You just sent ${amount} to ${recipient}! What a generous penguin! ${PENGUIN_EMOJIS.fish} ${PENGUIN_EMOJIS.money}`,
    { emoji: `${PENGUIN_EMOJIS.excited}` }
  ),
  withdraw: (amount) => createPenguinSuccess(
    "Withdrawal Complete!",
    `Your ${amount} is on its way to your wallet! Swimming through the blockchain as we speak! ${PENGUIN_EMOJIS.rocket}`,
    { emoji: `${PENGUIN_EMOJIS.excited}` }
  ),
  link: () => createPenguinSuccess(
    "Wallet Connected!",
    `Your wallet is now linked! Welcome to the penguin colony! ${PENGUIN_EMOJIS.ice} Time to start tipping and earning!`,
    { emoji: `${PENGUIN_EMOJIS.excited}` }
  )
};
export {
  PENGUIN_COLORS,
  PENGUIN_EMOJIS,
  PENGUIN_ERRORS,
  PENGUIN_LOADING,
  PENGUIN_PERSONALITIES,
  PENGUIN_SUCCESS,
  createPenguinError,
  createPenguinLoading,
  createPenguinSuccess
};
//# sourceMappingURL=penguin_messages.js.map
