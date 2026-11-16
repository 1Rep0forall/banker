import { addDays } from './dates';

export interface CalEvent {
  uid: string;
  /** YYYY-MM-DD, all-day event */
  date: string;
  title: string;
  description?: string;
  /** Reminder at 9:00 this many days before (0 = morning of). */
  alarmDaysBefore?: number;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const compact = (iso: string) => iso.replace(/-/g, '');

/** Fold lines longer than 75 bytes (RFC 5545), never splitting a multi-byte character. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 75) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function buildIcs(events: CalEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Banker//Money reminders//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Money reminders'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@banker.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(e.date, 1))}`,
      `SUMMARY:${esc(e.title)}`,
      'TRANSP:TRANSPARENT',
    );
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.alarmDaysBefore !== undefined) {
      // All-day events start at midnight; aim the reminder at 9am.
      const hours = e.alarmDaysBefore * 24 - 9;
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:${hours > 0 ? '-' : ''}PT${Math.abs(hours)}H`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
