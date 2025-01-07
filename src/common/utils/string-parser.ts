export class StringParser {
  static dateAndOrTimeRegex =
    /^((0?[1-9]|[12][0-9]|3[01])[\/\-\.](0?[1-9]|1[012])[\/\-\.](2?\d{3})\s(([0-1]?[0-9]|2[0-3]):[0-5][0-9])|(([0-1]?[0-9]|2[0-3]):[0-5][0-9]))/;
  static underscoreCommandsRegex = /^\/\_[a-zA-Z]+\_/;

  static nthIndexOf(str, pat, n) {
    let i;
    for (i = 0; n > 0 && i !== -1; n -= 1) {
      i = str.indexOf(pat, i ? i + 1 : i);
    }
    return i;
  }

  static getFirstAndRest(
    input: string,
    delimitier: string = ' ',
    nthOccurrence = 1,
  ): { first: string; rest: string } {
    const trimmedInput = input.trim();

    const startIndex = this.nthIndexOf(trimmedInput, delimitier, nthOccurrence);
    const endIndex = startIndex + delimitier.length;

    const firstAndRest = {
      first: trimmedInput.slice(0, endIndex).trim(),
      rest: trimmedInput.slice(endIndex).trim(),
    };
    return firstAndRest;
  }

  static getRegexAndRest(
    input: string,
    regex = this.dateAndOrTimeRegex,
    nthOccurrence = 1,
  ): { first: string; rest: string } {
    const trimmedInput = input.trim();

    const matchObj = trimmedInput.match(regex);
    if (!matchObj) {
      const firstAndRest = {
        first: '',
        rest: trimmedInput,
      };
      return firstAndRest;
    }
    const match = matchObj[0];

    const startIndex = this.nthIndexOf(trimmedInput, match, nthOccurrence);
    const endIndex = startIndex + match.length;

    const firstAndRest = {
      first: trimmedInput.slice(startIndex, endIndex).trim(),
      rest: trimmedInput.slice(endIndex).trim(),
    };
    return firstAndRest;
  }

  static parseDateTime(dateTimeStr: string): Date {
    const now = new Date();

    // "HH:MM" or "DD.MM.YYYY HH:MM"
    if (dateTimeStr.includes('.')) {
      const [dateStr, timeStr] = dateTimeStr.split(' ');
      const [day, month, year] = dateStr.split('.').map(Number);
      const [hours, minutes] = timeStr.split(':').map(Number);

      const retDate = new Date(
        year || now.getFullYear(),
        month - 1,
        day,
        hours,
        minutes,
      );

      return retDate;
    } else {
      const [hours, minutes] = dateTimeStr.split(':').map(Number);

      const retDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        hours,
        minutes,
      );

      return retDate;
    }
  }

  static getDateAndOrTime(str) {
    return str.match(this.dateAndOrTimeRegex)[0];
  }

  static validateDateTime(date: Date): boolean {
    const now = new Date();
    if (date.getTime() < now.getTime()) {
      return false;
    }
    return true;
  }

  // TODO
  // Parser for date-time range parsing:
  // /remove_range 01.01.2025 00:00 01.01.2025 23:59
}
