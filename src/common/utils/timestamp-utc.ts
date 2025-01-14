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
