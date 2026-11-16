import type { Data } from '../useData';
import { buildIcs } from '../lib/ics';
import { calendarEvents } from '../lib/insights';
import { download } from '../lib/download';

export function CalendarButton({ data, className = 'btn' }: { data: Data; className?: string }) {
  const events = calendarEvents(data.accounts, data.recurring, data.transactions, data.today, data.settings.currency);
  return (
    <button className={className} disabled={!events.length} onClick={() => download(`money-reminders-${data.today}.ics`, buildIcs(events), 'text/calendar')}>
      📅 Add {events.length} reminders to my calendar
    </button>
  );
}
