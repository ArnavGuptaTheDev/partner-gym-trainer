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
export const tone: Record<PairType, Record<string, string>> = {
  couple: {
    partnerLabel: 'your love',
    greeting: 'Morning, gorgeous',
    homeLead: 'Two hearts, one routine.',
  },
  friends: {
    partnerLabel: 'your rival',
    greeting: 'Rise and grind',
    homeLead: 'May the best spotter win.',
  },
};

export const settings = {
  themeTitle: 'Theme',
  themeSystem: 'Auto',
  themeLight: 'Light',
  themeDark: 'Dark',
};
