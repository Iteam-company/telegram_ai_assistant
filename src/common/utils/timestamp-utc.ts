export function timestampToUTCString(timestamp) {
  return (
    new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'UTC',
    })
      .format(new Date(timestamp * 1000))
      .replace(/\//g, '-') + ' UTC'
  );
}

export function formatDateTime(date: Date) {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${day}.${month}.${year}, ${hours}:${minutes}:${seconds}`;
}

export function detectTimezone(userLocalHour) {
  const utcHour = new Date().getUTCHours();

  let hourDiff = userLocalHour - utcHour;

  // Handle day wraparound
  if (hourDiff > 12) {
    hourDiff -= 24;
  } else if (hourDiff < -12) {
    hourDiff += 24;
  }

  // Convert hours to minutes for timezone offset
  return hourDiff * 60;
}

export function convertToUserTime(telegramTimestamp, userTimezoneOffset) {
  const messageDate = new Date(telegramTimestamp * 1000);

  const utcTimestamp = messageDate.getTime();

  // Apply user's timezone offset (convert minutes to milliseconds)
  const userLocalTimestamp = utcTimestamp + userTimezoneOffset * 60 * 1000;

  return new Date(userLocalTimestamp);
}

export function convertToUTC(localDate, userTimezoneOffset) {
  const localTimestamp = localDate.getTime();

  // Subtract the user's timezone offset to get UTC (convert minutes to milliseconds)
  const utcTimestamp = localTimestamp - userTimezoneOffset * 60 * 1000;

  return new Date(utcTimestamp);
}
