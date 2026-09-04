const CPF_WEIGHTS_FIRST = [10, 9, 8, 7, 6, 5, 4, 3, 2];
const CPF_WEIGHTS_SECOND = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_FIRST = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_SECOND = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeCpfCnpj(value) {
  return String(value || '').toUpperCase().replace(/[.\/\-\s]/g, '');
}

function cpfDigit(sequence, weights) {
  const sum = weights.reduce((total, weight, index) => total + Number(sequence[index]) * weight, 0);
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

export function isValidCpf(value) {
  const normalized = normalizeCpfCnpj(value);
  if (!/^\d{11}$/.test(normalized) || /^(\d)\1{10}$/.test(normalized)) return false;
  const first = cpfDigit(normalized, CPF_WEIGHTS_FIRST);
  const second = cpfDigit(`${normalized.slice(0, 9)}${first}`, CPF_WEIGHTS_SECOND);
  return normalized.endsWith(`${first}${second}`);
}

function cnpjCharacterValue(character) {
  return character.charCodeAt(0) - 48;
}

function cnpjDigit(sequence, weights) {
  const sum = weights.reduce((total, weight, index) => total + cnpjCharacterValue(sequence[index]) * weight, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCnpj(value) {
  const normalized = normalizeCpfCnpj(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(normalized) || /^([A-Z0-9])\1{11}\d{2}$/.test(normalized)) return false;
  const base = normalized.slice(0, 12);
  const first = cnpjDigit(base, CNPJ_WEIGHTS_FIRST);
  const second = cnpjDigit(`${base}${first}`, CNPJ_WEIGHTS_SECOND);
  return normalized.endsWith(`${first}${second}`);
}

export function isValidCpfCnpj(value) {
  const normalized = normalizeCpfCnpj(value);
  return normalized.length === 11 ? isValidCpf(normalized) : isValidCnpj(normalized);
}
