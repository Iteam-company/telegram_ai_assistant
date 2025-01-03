export class StringParser {
  static dateAndOrTimeRegex =
    /^((0?[1-9]|[12][0-9]|3[01])[\/\-\.](0?[1-9]|1[012])[\/\-\.](2?\d{3})\s(([0-1]?[0-9]|2[0-3]):[0-5][0-9])|(([0-1]?[0-9]|2[0-3]):[0-5][0-9]))/;

  static getDateAndOrTime(str) {
    return str.match(this.dateAndOrTimeRegex)[0];
  }

  static nthIndexOf(str, pat, n) {
    let i;
    for (i = 0; n > 0 && i !== -1; n -= 1) {
      i = str.indexOf(pat, i ? i + 1 : i);
    }
    return i;
  }

  static getFirstAndRest(
    input: string,
    delimitier = ' ',
    nthOccurrence = 1,
  ): { first: string; rest: string } {
    const trimmedInput = input.trim();

    const delimitierIndex = this.nthIndexOf(
      trimmedInput,
      delimitier,
      nthOccurrence,
    );

    return {
      first: trimmedInput.slice(0, delimitierIndex).trim(),
      rest: trimmedInput.slice(delimitierIndex + 1).trim(),
    };
  }

  static parseDateTime(dateTimeStr: string): Date {
    const now = new Date();

    // "HH:MM" or "DD.MM.YYYY HH:MM"
    if (dateTimeStr.includes('.')) {
      const [dateStr, timeStr] = dateTimeStr.split(' ');
      const [day, month, year] = dateStr.split('.').map(Number);
      const [hours, minutes] = timeStr.split(':').map(Number);

      return new Date(
        year || now.getFullYear(),
        month - 1,
        day,
        hours,
        minutes,
      );
    } else {
      const [hours, minutes] = dateTimeStr.split(':').map(Number);

      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        hours,
        minutes,
      );
    }
  }

  static validateDateTime(date: Date): boolean {
    const now = new Date();
    if (date.getTime() < now.getTime()) {
      return false;
    }
    return true;
  }
}
