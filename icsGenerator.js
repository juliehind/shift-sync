const { createEvents } = require('ics');

function makeDateArray(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const hour = Number(timeStr.slice(0, 2));
  const minute = Number(timeStr.slice(2, 4));
  return [year, month, day, hour, minute];
}

function addDay(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + 1);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

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
        start: makeDateArray(shift.date, shift.startTime),
        end: makeDateArray(endDate, shift.endTime),
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
        startInputType: 'local',
        startOutputType: 'local',
        endInputType: 'local',
        endOutputType: 'local'
      };
    });

  const { error, value } = createEvents(events);

  if (error) {
    throw error;
  }

  return value;
}

module.exports = { shiftsToICS };