// All user-facing copy lives here. Edit freely; the UI reads from this file.
// Strings that differ between couples and friends live under `tone`.

export const site = {
  name: 'Spotter',
  tagline: 'Coach each other. Show up together.',
  description: 'An invite-only gym app for two: set each other’s plans and share the daily grind.',
};

export const nav = {
  home: 'Home',
  plan: 'Plan',
  log: 'Log',
  photos: 'Photos',
  chat: 'Chat',
  settings: 'Settings',
  admin: 'Admin',
};

export const auth = {
  loginTitle: 'Welcome back',
  loginLead: 'Your spotter is waiting.',
  email: 'Email',
  password: 'Password',
  loginButton: 'Sign in',
  noAccount: 'Spotter is invite-only. Ask whoever invited you for a link.',
  registerTitle: 'Join Spotter',
  registerLead: 'You’ve been invited. Set up your account to start training together.',
  registerSuperLead: 'Setting up the first account? Use an email listed in SUPER_USER_EMAILS.',
  displayName: 'What should your partner call you?',
  passwordHint: 'At least 10 characters.',
  registerButton: 'Create account',
  haveAccount: 'Already have an account?',
  signIn: 'Sign in',
  inviteChecking: 'Checking your invite…',
  inviteInvalid: 'This invite link is invalid, used, or expired. Ask for a new one.',
  inviteMissing: 'You need an invite link to join. If you’re a super user, carry on with your listed email.',
  logout: 'Sign out',
};

export const admin = {
  title: 'Admin',
  lead: 'Invites, accounts and storage.',
  invitesTitle: 'Invites',
  newInvite: 'Create invite link',
  notePlaceholder: 'Note (optional), e.g. “for Priya”',
  noteLabel: 'Invite note',
  copyOnce: 'Copy this link now. For security it won’t be shown again.',
  copy: 'Copy link',
  copied: 'Copied!',
  revoke: 'Revoke',
  revokeConfirm: 'Revoke this invite? The link will stop working.',
  status: { active: 'Active', used: 'Used', revoked: 'Revoked', expired: 'Expired' } as Record<string, string>,
  usedBy: 'Used by',
  expires: 'Expires',
  usersTitle: 'Accounts',
  deactivate: 'Deactivate',
  reactivate: 'Reactivate',
  deactivateConfirm: 'Deactivate this account? They will be signed out and unable to sign in.',
  storageTitle: 'Photo storage',
  loadMore: 'Load more',
  empty: 'Nothing here yet.',
};

export const errors = {
  generic: 'Something went wrong. Please try again.',
  offline: 'You seem to be offline.',
};

export type PairType = 'couple' | 'friends';

/** Copy that changes with the pair type: warm for couples, playful for friends. */
export interface Tone {
  greeting: (name: string) => string;
  homeLead: string;
  sharedStreak: string;
  sharedStreakHint: string;
  bothLogged: string;
  nudgeProud: string;
  nudgeGym: string;
  nudgeSent: string;
  nudgeToast: Record<'proud' | 'gym', (from: string) => string>;
  noteTitle: (name: string) => string;
  notePlaceholder: string;
  noteFrom: (name: string) => string;
  partnerDayTitle: (name: string) => string;
  partnerQuiet: (name: string) => string;
  versus: (leader: string) => string;
  tie: string;
  daysTogether: (n: number) => string;
}

export const tone: Record<PairType, Tone> = {
  couple: {
    greeting: (name) => `Hey ${name}, you’ve got this 💞`,
    homeLead: 'Two hearts, one routine.',
    sharedStreak: 'Our streak',
    sharedStreakHint: 'Days you both showed up',
    bothLogged: 'You both logged today. Look at you two! 🥰',
    nudgeProud: 'Proud of you 💖',
    nudgeGym: 'Gym date? 🏋️',
    nudgeSent: 'Sent with love 💌',
    nudgeToast: {
      proud: (from) => `${from} is so proud of you 💖`,
      gym: (from) => `${from} wants you at the gym 🏋️ Go get it!`,
    },
    noteTitle: (name) => `Leave ${name} a note`,
    notePlaceholder: 'Something sweet for their home screen…',
    noteFrom: (name) => `A note from ${name}`,
    partnerDayTitle: (name) => `${name}’s day`,
    partnerQuiet: (name) => `${name} hasn’t logged anything yet today. Maybe send some love?`,
    versus: () => 'Teamwork makes the dream work 💞',
    tie: 'Perfectly in sync 💞',
    daysTogether: (n) => `${n.toLocaleString()} days together`,
  },
  friends: {
    greeting: (name) => `Rise and grind, ${name} 💪`,
    homeLead: 'May the best spotter win.',
    sharedStreak: 'Squad streak',
    sharedStreakHint: 'Days you both showed up',
    bothLogged: 'You both logged today. Nobody’s slacking. 😤',
    nudgeProud: 'Respect 🫡',
    nudgeGym: 'Get to the gym! 🏋️',
    nudgeSent: 'Nudge delivered 📣',
    nudgeToast: {
      proud: (from) => `${from} says: respect 🫡 Nice work!`,
      gym: (from) => `${from} says: GET TO THE GYM 🏋️ No excuses!`,
    },
    noteTitle: (name) => `Trash-talk ${name} (nicely)`,
    notePlaceholder: 'Motivation, smack talk, or both…',
    noteFrom: (name) => `${name} left you a note`,
    partnerDayTitle: (name) => `What ${name} is up to`,
    partnerQuiet: (name) => `${name} hasn’t logged a thing today. Suspicious. 👀`,
    versus: (leader) => `${leader} is ahead today 👑`,
    tie: 'Neck and neck! 🤝',
    daysTogether: (n) => `${n.toLocaleString()} days as gym buddies`,
  },
};

export const home = {
  title: 'Home',
  soloTitle: 'Find your spotter',
  soloLead: 'Spotter works best with a partner who sets your plan and cheers you on.',
  soloCta: 'Pair up',
  streakMine: 'You',
  streakDays: (n: number) => (n === 1 ? '1 day' : `${n} days`),
  todayTitle: 'Today',
  you: 'You',
  kcal: 'kcal',
  exercises: 'exercises',
  water: 'water',
  logCta: 'Log today',
  progressLink: 'Progress & weight',
  noteSave: 'Leave note',
  noteSaved: 'Note left ✓',
  noteClear: 'Remove note',
  noteLabel: 'Note of the day',
  yourDayTitle: 'Your day',
  yourQuiet: 'Nothing logged yet. Every streak starts with one day.',
  reactLabel: (emoji: string) => `React ${emoji}`,
  milestoneTitle: 'Milestone unlocked!',
  milestoneClose: 'Yay! 🎉',
  milestones: {
    first_kg: 'First kilo down! The hardest one.',
    halfway: 'Halfway to your target weight!',
    target: 'Target weight reached! You did it!',
    streak_7: '7-day streak! A whole week.',
    streak_30: '30-day streak! This is a habit now.',
    streak_100: '100-day streak! Legendary.',
  } as Record<string, string>,
  milestoneShort: {
    first_kg: 'first kilo',
    halfway: 'halfway to target',
    target: 'target weight',
    streak_7: '7-day streak',
    streak_30: '30-day streak',
    streak_100: '100-day streak',
  } as Record<string, string>,
};

/** Feed lines. `who` is the display name, or "You". */
export const feed = {
  workout: (who: string, n: number, names: string[]) =>
    `${who} finished ${n} exercise${n === 1 ? '' : 's'}${names.length ? `: ${names.join(', ')}` : ''} 🏋️`,
  meal: (who: string, n: number, kcal: number) => `${who} logged ${n} meal${n === 1 ? '' : 's'}${kcal ? ` (${kcal.toLocaleString()} kcal)` : ''} 🥗`,
  photo: (who: string) => `${who} posted a gym photo 📸`,
  weight: (who: string, w: string) => `${who} weighed in at ${w} ⚖️`,
  day: (who: string, water: number | null, burned: number | null) =>
    [water ? `${who} drank ${water.toLocaleString()} ml of water 💧` : '', burned ? `${water ? 'and' : who} burned ${burned} kcal 🔥` : '']
      .filter(Boolean)
      .join(' '),
  planOwn: (who: string) => `${who} tweaked their own plan ✍️`,
  planForYou: (who: string) => `${who} updated your plan ✍️`,
  planForPartner: (partner: string) => `You updated ${partner}’s plan ✍️`,
  milestone: (who: string, what: string) => `${who} unlocked a milestone: ${what}! 🏆`,
};

export const pairing = {
  title: 'Your spotter',
  unpairedLead: 'Spotter is for exactly two. Make a code and send it to your partner, or enter theirs.',
  typeLegend: 'You two are…',
  couple: 'A couple 💞',
  friends: 'Gym buddies 🤜🤛',
  makeCode: 'Make a pairing code',
  yourCode: 'Your code',
  codeHint: 'Send this to your partner. It works once and expires in 24 hours.',
  share: 'Share code',
  shareText: (code: string) => `Be my Spotter! Enter code ${code} in the app.`,
  cancelCode: 'Cancel code',
  haveCode: 'Got a code from your partner?',
  codeLabel: 'Partner’s code',
  join: 'Pair up',
  pairedWith: 'Paired with',
  pairTypeLabel: 'Pair type',
  togetherSince: 'Together since',
  togetherHint: 'Shows a days-together counter on Home.',
  selfEdit: 'Let us edit our own plans',
  selfEditHint: 'By default only your partner can change your plan.',
  save: 'Save',
  saved: 'Saved',
  unpair: 'Unpair',
  unpairConfirm: 'Unpair? Your chat history goes away. You each keep your own logs and photos.',
  welcome: 'You’re in! Pair up with your partner to get started.',
};

export const plan = {
  title: 'Plan',
  mine: 'Mine',
  partners: (name: string) => `${name}’s`,
  setBy: (name: string) => `Set by ${name}`,
  readOnlyNote: (name: string) => `${name} sets your plan. You can view it here.`,
  editPartnerLead: (name: string) => `You’re ${name}’s coach. Build their plan.`,
  noPlan: 'No plan yet.',
  noPlanMine: (name: string) => `${name} hasn’t set your plan yet. Give them a nudge!`,
  noPlanSolo: 'Pair up to have your partner set your plan, or build your own.',
  edit: 'Edit plan',
  create: 'Create plan',
  save: 'Save plan',
  saving: 'Saving…',
  cancel: 'Cancel',
  saved: 'Plan saved',
  conflict: 'This plan changed while you were editing. Reloaded the latest version.',
  targetsTitle: 'Daily targets',
  calories: 'Calories',
  caloriesUnit: 'kcal / day',
  goal: 'Goal',
  goals: { deficit: 'Deficit', surplus: 'Surplus', maintain: 'Maintain' } as Record<string, string>,
  protein: 'Protein (g)',
  carbs: 'Carbs (g)',
  fat: 'Fat (g)',
  lowCalorie: 'Heads up: under 1,200 kcal a day is very low for most adults. Make sure this is intentional (and ideally guided by a professional).',
  mealsTitle: 'Meals',
  mealName: 'Meal',
  mealItems: 'What to eat',
  notes: 'Notes',
  addMeal: 'Add meal',
  workoutTitle: 'Workout',
  restDay: 'Rest day. Recover well.',
  exercise: 'Exercise',
  equipment: 'Machine / equipment',
  sets: 'Sets',
  reps: 'Reps',
  targetWeight: 'Target',
  addExercise: 'Add exercise',
  remove: 'Remove',
  moveUp: 'Move up',
  moveDown: 'Move down',
  copyDay: 'Copy this day to…',
};

export const progress = {
  title: 'Progress',
  goalTitle: 'Goal',
  current: 'Current',
  target: 'Target',
  start: 'Start',
  toGo: (v: string) => `${v} to go`,
  reached: 'Target reached! 🎉',
  height: 'Height',
  goalMode: 'Goal',
  goalModes: { lose: 'Lose weight', gain: 'Gain weight', maintain: 'Maintain' } as Record<string, string>,
  targetDate: 'Target date',
  units: 'Units',
  metric: 'Metric (kg, cm)',
  imperial: 'Imperial (lb, in)',
  editGoal: 'Edit goal',
  saveGoal: 'Save goal',
  weightTitle: 'Weight log',
  logWeight: 'Log weight',
  weightToday: 'Today’s weight',
  chartLabel: (n: number) => `Weight over the last ${n} weigh-ins`,
  noWeights: 'No weigh-ins yet.',
  daysLeft: (n: number) => (n >= 0 ? `${n} days to target date` : `Target date passed ${-n} days ago`),
  remove: 'Remove',
};

export const log = {
  title: 'Log',
  today: 'Today',
  yesterday: 'Yesterday',
  prevDay: 'Previous day',
  nextDay: 'Next day',
  progressTitle: 'Today vs plan',
  caloriesEaten: 'Calories eaten',
  workoutDone: 'Workout',
  water: 'Water',
  of: 'of',
  noTarget: 'no target set',
  workoutTitle: 'Workout',
  planned: 'From the plan',
  restDay: 'Nothing planned today. Rest, or add your own below.',
  actualSets: 'Sets',
  actualReps: 'Reps',
  actualWeight: 'Weight',
  extraTitle: 'Extras',
  addExercise: 'Add exercise',
  exerciseName: 'Exercise name',
  mealsTitle: 'Meals',
  logMeal: 'Log it',
  logged: 'Logged',
  mealName: 'Meal name',
  mealCalories: 'Calories',
  addMeal: 'Add meal',
  remove: 'Remove',
  bodyTitle: 'Body & extras',
  waterAdd: (ml: number) => `+${ml} ml`,
  waterReset: 'Reset water',
  burned: 'Calories burned',
  bodyWeight: 'Body weight',
  save: 'Save',
  saved: 'Saved',
  partnerReadOnly: (name: string) => `You’re viewing ${name}’s day.`,
};

export const photos = {
  title: 'Photos',
  add: 'Add today’s gym photo',
  adding: 'Shrinking & uploading…',
  captionLabel: 'Caption (optional)',
  captionPlaceholder: 'PR on squats!',
  upload: 'Post photo',
  privacyNote: 'Photos are resized and stripped of location data before upload. Only you and your partner can see them.',
  empty: 'No gym photos yet. Snap one after your next session!',
  emptyPartner: (name: string) => `${name} hasn’t posted any gym photos yet.`,
  loadMore: 'Load older photos',
  compare: 'Compare',
  compareHint: 'Pick two photos for a before/after.',
  compareDone: 'Show comparison',
  compareCancel: 'Cancel',
  before: 'Before',
  after: 'After',
  close: 'Close',
  delete: 'Delete photo',
  deleteConfirm: 'Delete this photo for good?',
  photoAlt: (who: string, date: string) => `${who}’s gym photo from ${date}`,
};

export const chat = {
  title: 'Chat',
  unpaired: 'Pair up with your partner to start chatting.',
  pairCta: 'Go to pairing',
  empty: (name: string) => `Say hi to ${name}! 👋`,
  placeholder: 'Message…',
  messageLabel: 'Message',
  send: 'Send',
  attach: 'Attach photo',
  attaching: 'Uploading photo…',
  loadOlder: 'Load older messages',
  seen: 'Seen',
  you: 'You',
  emojiLabel: 'Quick emoji',
  emoji: ['💪', '🔥', '❤️', '😂', '🥵', '👏', '🏋️', '🥗', '😴', '🎉'],
  photoAlt: (name: string) => `Photo from ${name}`,
};

export const settings = {
  themeTitle: 'Theme',
  themeSystem: 'Auto',
  themeLight: 'Light',
  themeDark: 'Dark',
};
