export const DEFAULT_ANALYSIS_TIME_ZONE = 'America/Sao_Paulo';

const MAX_TIME_ZONE_LENGTH = 64;
const MAX_HOLIDAY_CONFIG_LENGTH = 8192;
const MAX_HOLIDAYS = 400;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function isValidDateKey(value) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function holidayCandidates(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || raw.length > MAX_HOLIDAY_CONFIG_LENGTH) {
    throw new TypeError('ANALYSIS_HOLIDAYS possui formato inválido.');
  }

  const value = raw.trim();
  if (!value) return [];
  if (value.startsWith('[')) {
    let parsed;
    try { parsed = JSON.parse(value); } catch { throw new TypeError('ANALYSIS_HOLIDAYS deve conter datas válidas.'); }
    if (!Array.isArray(parsed)) throw new TypeError('ANALYSIS_HOLIDAYS deve ser uma lista de datas.');
    return parsed;
  }
  return value.split(/[\s,;]+/);
}

export function parseAnalysisHolidays(raw) {
  const candidates = holidayCandidates(raw);
  if (candidates.length > MAX_HOLIDAYS) throw new TypeError('ANALYSIS_HOLIDAYS excede o limite permitido.');

  const holidays = new Set();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') throw new TypeError('ANALYSIS_HOLIDAYS deve conter apenas datas.');
    const value = candidate.trim();
    if (!isValidDateKey(value)) throw new TypeError(`Feriado inválido em ANALYSIS_HOLIDAYS: ${value || '(vazio)'}.`);
    holidays.add(value);
  }
  return [...holidays].sort();
}

export function analysisBusinessDayConfig(env = {}) {
  const primaryTimeZone = env?.ANALYSIS_TIME_ZONE;
  const legacyTimeZone = env?.ANALYSIS_TIMEZONE;
  const hasPrimaryTimeZone = primaryTimeZone != null && primaryTimeZone !== '';
  const hasLegacyTimeZone = legacyTimeZone != null && legacyTimeZone !== '';
  if (hasPrimaryTimeZone && hasLegacyTimeZone && String(primaryTimeZone).trim() !== String(legacyTimeZone).trim()) {
    throw new TypeError('ANALYSIS_TIME_ZONE e ANALYSIS_TIMEZONE não podem divergir.');
  }
  const configuredTimeZone = hasPrimaryTimeZone ? primaryTimeZone : hasLegacyTimeZone ? legacyTimeZone : null;
  let timeZone = DEFAULT_ANALYSIS_TIME_ZONE;
  if (configuredTimeZone != null && configuredTimeZone !== '') {
    if (typeof configuredTimeZone !== 'string') throw new TypeError('ANALYSIS_TIME_ZONE possui formato inválido.');
    const candidate = configuredTimeZone.trim();
    if (!candidate || candidate.length > MAX_TIME_ZONE_LENGTH || !isValidTimeZone(candidate)) {
      throw new TypeError('ANALYSIS_TIME_ZONE não é um fuso horário válido.');
    }
    timeZone = candidate;
  }

  return Object.freeze({
    timeZone,
    holidays: Object.freeze(parseAnalysisHolidays(env?.ANALYSIS_HOLIDAYS))
  });
}

function formatterFor(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function zonedParts(date, formatter) {
  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
    millisecond: date.getUTCMilliseconds()
  };
}

function naiveUtcValue(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond);
}

function addLocalCalendarDay(parts) {
  const calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return {
    ...parts,
    year: calendar.getUTCFullYear(),
    month: calendar.getUTCMonth() + 1,
    day: calendar.getUTCDate()
  };
}

function localDateKey(parts) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function localWeekday(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function localPartsToInstant(parts, formatter) {
  const target = naiveUtcValue(parts);
  let candidate = target;
  let bestCandidate = candidate;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const actual = zonedParts(new Date(candidate), formatter);
    const distance = target - naiveUtcValue(actual);
    if (Math.abs(distance) < bestDistance) {
      bestDistance = Math.abs(distance);
      bestCandidate = candidate;
    }
    if (distance === 0) return new Date(candidate);
    candidate += distance;
  }

  // Em transições de horário de verão, certos horários locais podem não existir.
  // Nesse caso, retorna o instante disponível mais próximo do horário original.
  return new Date(bestCandidate);
}

export function nextBusinessDay(value, config = analysisBusinessDayConfig()) {
  const source = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(source.getTime())) throw new TypeError('Data de referência inválida.');

  const safeConfig = analysisBusinessDayConfig({
    ANALYSIS_TIME_ZONE: config?.timeZone,
    ANALYSIS_HOLIDAYS: config?.holidays
  });
  const formatter = formatterFor(safeConfig.timeZone);
  const holidays = new Set(safeConfig.holidays);
  let target = zonedParts(source, formatter);

  do {
    target = addLocalCalendarDay(target);
  } while ([0, 6].includes(localWeekday(target)) || holidays.has(localDateKey(target)));

  return localPartsToInstant(target, formatter).toISOString();
}
