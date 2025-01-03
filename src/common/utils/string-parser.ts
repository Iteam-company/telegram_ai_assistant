export class StringParser {
  static dateAndOrTimeRegex =
    /^((0?[1-9]|[12][0-9]|3[01])[\/\-\.](0?[1-9]|1[012])[\/\-\.](2?\d{3})\s(([0-1]?[0-9]|2[0-3]):[0-5][0-9])|(([0-1]?[0-9]|2[0-3]):[0-5][0-9]))/;

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

    const firstAndRest = {
      first: trimmedInput.slice(0, delimitierIndex),
      rest: trimmedInput.slice(delimitierIndex + 1),
    };
    console.log(firstAndRest);
    return firstAndRest;
  }

  static getDateAndOrTime(str) {
    return str.match(this.dateAndOrTimeRegex)[0];
  }

  static getRegexAndRest(
    input: string,
    regex = this.dateAndOrTimeRegex,
  ): { first: string; rest: string } {
    const trimmedInput = input.trim();
    const match = trimmedInput.match(regex)[0];
    const firstIndex = trimmedInput.indexOf(match[0]);
    const lastIndex = trimmedInput.lastIndexOf(match[match.length - 1]) + 1;

    console.log(match, firstIndex, lastIndex);
    const firstAndRest = {
      first: trimmedInput.slice(firstIndex, lastIndex),
      rest: trimmedInput.slice(lastIndex + 1),
    };
    console.log(firstAndRest);
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
      console.log(retDate);
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
      console.log(retDate);
      return retDate;
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
