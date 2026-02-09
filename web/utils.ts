export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) {
    return "Just now";
  }
  if (diffMins < 60) {
    return `${diffMins}m`;
  }
  if (diffHours < 24) {
    return `${diffHours}h`;
  }
  if (diffHours < 48) {
    return "1d ago";
  }
  if (diffHours < 72) {
    return "2d ago";
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const hours = pad(date.getHours());
  const mins = pad(date.getMinutes());

  if (date.getFullYear() === now.getFullYear()) {
    return `${day}/${month} ${hours}:${mins}`;
  }
  return `${day}/${month}/${date.getFullYear()} ${hours}:${mins}`;
}

const SANITIZE_PATTERNS = [
  /<command-name>[^<]*<\/command-name>/g,
  /<command-message>[^<]*<\/command-message>/g,
  /<command-args>[^<]*<\/command-args>/g,
  /<local-command-stdout>[^<]*<\/local-command-stdout>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<system-notification>[\s\S]*?<\/system-notification>/g,
  /^\s*Caveat:.*?unless the user explicitly asks you to\./s,
];

export function sanitizeText(text: string): string {
  let result = text;
  for (const pattern of SANITIZE_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.trim();
}
