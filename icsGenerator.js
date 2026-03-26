const { createEvents } = require('ics');

const BRISBANE_OFFSET_HOURS = 10; // Australia/Brisbane, no DST

function buildUid(shift) {
  return [
    shift.date,
    shift.name,
    shift.startTime,
    shift.endTime,
    shift.shiftLine
  ]
    .join('-')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase();
}

function addDay(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getShiftType(startTime) {
  const hour = parseInt(startTime.slice(0, 2), 10);
  const minute = parseInt(startTime.slice(2, 4), 10);
  const totalMinutes = hour * 60 + minute;

  const dayStart = 2 * 60;         // 02:00
  const dayEnd = 10 * 60 + 59;     // 10:59

  const eveningStart = 11 * 60;    // 11:00
  const eveningEnd = 15 * 60 + 59; // 15:59

  if (totalMinutes >= dayStart && totalMinutes <= dayEnd) {
    return 'Day Shift';
  }

  if (totalMinutes >= eveningStart && totalMinutes <= eveningEnd) {
    return 'Evening Shift';
  }

  return 'Night Shift';
}

function getShiftColourName(shiftType) {
  if (shiftType === 'Day Shift') return 'Green';
  if (shiftType === 'Evening Shift') return 'Orange';
  return 'Red';
}

/**
 * Convert Australia/Brisbane local date/time into a UTC date array for the ics package.
 * Example:
 * 2026-04-08 08:00 Brisbane -> 2026-04-07 22:00 UTC
 */
function brisbaneLocalToUtcArray(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const hour = Number(timeStr.slice(0, 2));
  const minute = Number(timeStr.slice(2, 4));

  const utcMillis = Date.UTC(year, month - 1, day, hour - BRISBANE_OFFSET_HOURS, minute, 0);
  const d = new Date(utcMillis);

  return [
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes()
  ];
}

function shiftsToICS(shifts) {
  const events = shifts
    .filter(shift => shift.date && shift.startTime && shift.endTime)
    .map((shift) => {
      const isOvernight = shift.endTime < shift.startTime;
      const endDate = isOvernight ? addDay(shift.date) : shift.date;
      const shiftType = getShiftType(shift.startTime);
      const colourName = getShiftColourName(shiftType);

      return {
        uid: buildUid(shift),
        title: `${shiftType} – ${shift.shiftLine || shift.name}`,
        start: brisbaneLocalToUtcArray(shift.date, shift.startTime),
        end: brisbaneLocalToUtcArray(endDate, shift.endTime),
        description: [
          `Name: ${shift.name || ''}`,
          `Role: ${shift.role || ''}`,
          `Shift: ${shift.shiftLine || ''}`,
          `Team: ${shift.team || ''}`,
          `Shift Type: ${shiftType}`,
          `Suggested Colour: ${colourName}`,
          `Source: HRS Billboard Sync`
        ].join('\n'),
        location: shift.team || 'Hospital',
        categories: [shiftType],
        status: 'CONFIRMED',
        busyStatus: 'BUSY',
        productId: 'hrs-shift-sync',
        startInputType: 'utc',
        startOutputType: 'utc',
        endInputType: 'utc',
        endOutputType: 'utc'
      };
    });

  const { error, value } = createEvents(events);

  if (error) {
    throw error;
  }

  return value;
}

module.exports = { shiftsToICS };