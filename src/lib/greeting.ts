import { AppUser } from './googleAuth';

const periods = [
  { start: 5, end: 12, base: 'Good morning', emoji: '☀️' },
  { start: 12, end: 17, base: 'Good afternoon', emoji: '🌤️' },
  { start: 17, end: 21, base: 'Good evening', emoji: '🌙' },
  { start: 21, end: 24, base: 'Good night', emoji: '✨' },
  { start: 0, end: 5, base: 'Good night', emoji: '✨' },
];

function firstNameFor(user: AppUser) {
  return (
    user.givenName ||
    user.displayName?.split(/\s+/)[0] ||
    user.email?.split('@')[0] ||
    'there'
  ).trim();
}

function currentPeriod(date: Date) {
  const hour = date.getHours();
  return periods.find(period => hour >= period.start && hour < period.end) || periods[0];
}

export function getOrionGreeting(user: AppUser | null, date: Date = new Date()): string {
  const period = currentPeriod(date);
  if (!user) return `${period.base} ${period.emoji}`;

  const firstName = firstNameFor(user);
  const phrases = [
    `${period.base}, ${firstName}.`,
    `Nice to see you, ${firstName}.`,
    `Good to have you here, ${firstName}.`,
    `Welcome back, ${firstName}.`,
  ];
  const index = (date.getDate() + date.getHours() + Math.floor(date.getMinutes() / 30)) % phrases.length;
  return phrases[index];
}