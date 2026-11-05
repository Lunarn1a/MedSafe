import { drugs } from '../data/medicine-catalog.js';

const catalog = Object.freeze([...drugs]);

export function listMedicines() {
  return catalog;
}

export function findMedicine(name) {
  const normalizedName = String(name || '').trim().toLocaleLowerCase();
  return catalog.find((medicine) => medicine.toLocaleLowerCase() === normalizedName) || null;
}

export function searchMedicines(query, limit = 120) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  const matches = normalizedQuery
    ? catalog.filter((medicine) => medicine.toLocaleLowerCase().includes(normalizedQuery))
    : catalog;

  return matches.slice(0, limit);
}

export function getCatalogSummary() {
  return { medicineCount: catalog.length };
}
